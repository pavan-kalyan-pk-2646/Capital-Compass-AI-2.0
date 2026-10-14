"""Decision-module endpoints: investment, loan, goals, multiverse, crisis, spending, portfolio.

Every endpoint is stateless over the profile it receives (the frontend sends the current
Digital Twin profile) and logs its simulations to MySQL.
"""

from __future__ import annotations

from flask import Blueprint

from api.common import (
    ApiError,
    body,
    context,
    current_user_id,
    log_simulation,
    num,
    ok,
    profile_from,
)
from db.session import session_scope
from engines import (
    crisis_engine,
    decision_engine,
    goal_engine,
    loan_engine,
    portfolio_doctor,
    portfolio_engine,
    spending_engine,
)
from engines.decision_engine import excess_inflation_multiplier, total_emi_after_shock
from engines.plan import LoanTerms, crash_loss, goal_context, sim_config
from engines.risk_engine import compute_risk_dna
from engines.simulation_engine import Crash, simulate
from models import Loan, Portfolio, PortfolioHolding

bp = Blueprint("modules", __name__)


def _strip(d: dict, *keys) -> dict:
    return {k: v for k, v in d.items() if k not in keys}


# ---------- Investment ----------
@bp.post("/api/investment/analyze")
def investment_analyze():
    p = profile_from(body())
    twin, dna, _ = context(p)
    a = portfolio_engine.analyze(p, twin, dna)
    log_simulation(
        "investment", {"weights": a["plan"]["weights"]}, a["sim"], count=a["sim"]["n_paths"] * 3
    )
    return ok(a)


@bp.post("/api/investment/optimize")
def investment_optimize():
    data = body()
    p = profile_from(data)
    twin, _, plan = context(p, data.get("plan"))
    before = decision_engine.red_team(p, twin, plan)
    r = decision_engine.reoptimize(p, twin, plan, before["weaknesses"])
    after = decision_engine.red_team(p, twin, r["plan"])
    return ok(
        {
            "before": {**decision_engine.plan_metrics(p, twin, plan), "red_team": before},
            "after": {**decision_engine.plan_metrics(p, twin, r["plan"]), "red_team": after},
            "changes": r["changes"],
            "note": r["note"],
            "searched": r["searched"],
        }
    )


# ---------- Loan ----------
def _loan_terms(data: dict) -> LoanTerms:
    ln = data.get("loan") or data
    ltype = str(ln.get("loan_type", "personal")).lower()
    if ltype not in loan_engine.TYPICAL_RATES:
        raise ApiError("loan_type must be personal, education, home or vehicle", 422)
    return LoanTerms(
        loan_type=ltype,
        amount=num(ln, "amount", None, 1_000, 100_000_000),
        annual_rate_pct=num(ln, "annual_rate_pct", loan_engine.TYPICAL_RATES[ltype], 0.1, 40),
        tenure_months=int(num(ln, "tenure_months", 60, 6, 360)),
        processing_fee_pct=num(ln, "processing_fee_pct", 1.0, 0, 5),
    )


def _loan(data: dict) -> dict:
    p = profile_from(data)
    terms = _loan_terms(data)
    twin, _, plan = context(p, data.get("plan"))
    a = loan_engine.analyze(p, twin, plan, terms)
    try:
        with session_scope() as db:
            db.add(
                Loan(
                    user_id=current_user_id(),
                    type=terms.loan_type,
                    amount=terms.amount,
                    interest_rate=terms.annual_rate_pct,
                    tenure=terms.tenure_months,
                    fee=terms.fee,
                    emi=round(terms.emi, 2),
                    total_interest=round(terms.total_interest, 2),
                    risk_score=a["debt_stress_score"],
                )
            )
    except Exception:  # noqa: BLE001
        pass
    log_simulation("loan", terms.to_dict(), a["simulation_after"], count=10_000 * 3)
    a["percentiles_before"] = a["simulation_before"]["percentiles"]
    a["percentiles_after"] = a["simulation_after"]["percentiles"]
    return _strip(a, "simulation_before", "simulation_after")


@bp.post("/api/loan/analyze")
def loan_analyze():
    return ok(_loan(body()))


@bp.post("/api/loan/simulate")
def loan_simulate():
    a = _loan(body())
    keep = (
        "loan",
        "emi",
        "total_interest",
        "total_repayment",
        "amortization",
        "goal_probability_before",
        "goal_probability_after",
        "percentiles_before",
        "percentiles_after",
        "sip_before",
        "sip_after",
    )
    return ok({k: a[k] for k in keep})


@bp.post("/api/loan/stress-test")
def loan_stress():
    a = _loan(body())
    keep = (
        "loan",
        "emi",
        "stress_tests",
        "debt_stress_score",
        "risk_band",
        "foir_before",
        "foir_after",
        "emergency_fund_months_before",
        "emergency_fund_months_after",
    )
    return ok({k: a[k] for k in keep})


# ---------- Goals ----------
@bp.post("/api/goals/survival")
def goals_survival():
    data = body()
    p = profile_from(data)
    twin, _, plan = context(p, data.get("plan"))
    target = num(data, "target", goal_context(p, twin)["target"] or 0, 0, 1e10) or None
    if not target:
        raise ApiError("Add a goal to your Digital Twin or pass a target amount", 422)
    years = num(data, "years", goal_context(p, twin)["months"] / 12, 0.5, 40)
    sip = data.get("monthly_sip")
    sip = num(data, "monthly_sip", None, 0, 10_000_000) if sip not in (None, "") else None
    corpus = data.get("current_corpus")
    corpus = num(data, "current_corpus", None, 0, 1e10) if corpus not in (None, "") else None
    ret = data.get("expected_return_pct")
    ret = num(data, "expected_return_pct", None, 0, 30) if ret not in (None, "") else None
    g = goal_engine.survival(
        p,
        twin,
        plan,
        target=target,
        years=years,
        monthly_sip=sip,
        current_corpus=corpus,
        expected_return_pct=ret,
    )
    log_simulation(
        "goal_survival", {"target": target, "years": years}, g["simulation"], count=40_000
    )
    if data.get("theatre"):
        # Opt-in extra data for the 3D Goal Survival Theatre; the base response is unchanged.
        paths = round(num(data, "paths", 240, 40, 300))
        g["theatre"] = goal_engine.theatre(p, twin, plan, g, expected_return_pct=ret, paths=paths)
        g["theatre"]["risk_dna"] = compute_risk_dna(p, twin).to_dict()["dimensions"]
    return ok(g)


# ---------- What-if multiverse ----------
@bp.post("/api/simulation/what-if")
def what_if():
    data = body()
    p = profile_from(data)
    twin, _, plan = context(p, data.get("plan"))
    futures = data.get("futures") or []
    if not isinstance(futures, list) or not 1 <= len(futures) <= 4:
        raise ApiError("Send between 1 and 4 futures", 422)
    gc = goal_context(p, twin)
    out = []
    for i, f in enumerate(futures):
        if not isinstance(f, dict):
            raise ApiError(f"Future {i + 1} must be an object", 422)
        name = str(f.get("name") or f"Future {chr(65 + i)}")[:40]
        move = num(f, "market_return_pct", 0, -50, 50)
        infl = num(f, "inflation_pct", 5.5, 2, 12)
        inc = num(f, "income_change_pct", 0, -100, 100)
        mult = num(f, "sip_multiplier", 1.0, 0, 5)
        sip = num(
            f,
            "monthly_investment",
            round(plan.monthly_sip * mult / 500) * 500 if mult != 1 else plan.monthly_sip,
            0,
            200_000,
        )
        rate = num(f, "interest_rate_change_pct", 0, -2, 5)
        years = num(f, "years", gc["months"] / 12, 1, 30)
        months = round(years * 12)
        pl = plan.with_(monthly_sip=sip)
        emi_total = total_emi_after_shock(p, pl, bump=rate) if rate else twin.monthly_emi
        target = gc["target"]
        if target:
            target = target * excess_inflation_multiplier(infl - 5.5, months)
        cfg = sim_config(
            p,
            twin,
            pl,
            months=months,
            target=target,
            income_change_pct=inc,
            inflation_pct=infl,
            monthly_emi=emi_total,
        )
        if move:
            cfg.crash = Crash(month=0, equity_drop=move / 100, gold_change=0.0)
        sim = simulate(cfg)
        income = twin.monthly_income * (1 + inc / 100)
        out.append(
            {
                "name": name,
                "inputs": {
                    "market_return_pct": move,
                    "inflation_pct": infl,
                    "income_change_pct": inc,
                    "monthly_investment": sip,
                    "interest_rate_change_pct": rate,
                    "years": years,
                },
                "goal_target": target,
                "goal_success_probability": sim["goal_success_probability"],
                "ending": sim["ending"],
                "max_drawdown_p95": sim["max_drawdown"]["p95"],
                "liquidity_risk": sim["forced_liquidation_probability"],
                "min_cash_p5": sim["min_cash_p5"],
                "debt_stress_foir": round(emi_total / income, 4) if income > 0 else None,
                "recovery_months_median": sim["recovery_months_median"],
                "percentiles": sim["percentiles"],
            }
        )
    log_simulation("what_if", {"futures": len(out)}, None, count=10_000 * len(out))
    return ok({"futures": out, "plan": plan.to_dict(), "goal": gc})


# ---------- Crisis ----------
@bp.post("/api/crisis/simulate")
def crisis_simulate():
    data = body()
    p = profile_from(data)
    kind = data.get("scenario", "market_crash")
    if kind not in crisis_engine.KINDS:
        raise ApiError(f"scenario must be one of {', '.join(crisis_engine.KINDS)}", 422)
    twin, _, plan = context(p, data.get("plan"))
    c = crisis_engine.simulate_crisis(
        p,
        twin,
        plan,
        kind,
        severity=num(data, "severity", 1.0, 0.25, 3),
        job_loss_months=int(num(data, "job_loss_months", 6, 1, 36)),
        medical_cost=num(data, "medical_cost", 300_000, 0, 1e8),
    )
    log_simulation("crisis", {"scenario": kind}, c["simulation"], count=20_000)
    c["percentiles_after"] = c["simulation"]["percentiles"]
    c["percentiles_before"] = c["baseline"]["percentiles"]
    c["plan"] = plan.to_dict()
    c["crash_loss_cap"] = crisis_engine.crash_loss_cap(p)
    c["plan_crash_loss"] = round(crash_loss(plan.weights), 4)
    return ok(_strip(c, "simulation", "baseline"))


# ---------- Spending ----------
@bp.post("/api/spending/analyze")
def spending_analyze():
    data = body()
    p = profile_from(data)
    twin, _, plan = context(p, data.get("plan"))
    spend = data.get("monthly_spend")
    spend = num(data, "monthly_spend", None, 0, 10_000_000) if spend is not None else None
    a = spending_engine.analyze(p, twin, plan, spend)
    log_simulation("spending", {"monthly_spend": a["monthly_spend"]}, None, count=30_000)
    return ok(a)


# ---------- Portfolio ----------
def _holdings(data: dict) -> list[dict]:
    if data.get("csv"):
        try:
            return portfolio_doctor.parse_csv(str(data["csv"]))
        except portfolio_doctor.CsvError as exc:
            raise ApiError(str(exc), 422) from exc
    hs = data.get("holdings")
    if not isinstance(hs, list) or not hs:
        raise ApiError("Upload a portfolio.csv or add holdings manually", 422)
    out = []
    for i, h in enumerate(hs, start=1):
        if not isinstance(h, dict):
            raise ApiError(f"Holding {i} is invalid", 422)
        ac = portfolio_doctor.CLASS_ALIASES.get(str(h.get("asset_class", "")).lower())
        if not ac:
            raise ApiError(f"Holding {i}: unknown asset class", 422)
        sym = str(h.get("symbol") or "").strip()[:40]
        if not sym:
            raise ApiError(f"Holding {i}: name is required", 422)
        out.append(
            {
                "symbol": sym,
                "asset_class": ac,
                "sector": (
                    str(h.get("sector") or "").strip()[:40]
                    or ("diversified" if ac == "equity" else ac)
                ),
                "value": num(h, "value", None, 0, 1e11),
            }
        )
    return out


def _doctor(data: dict) -> dict:
    p = profile_from(data)
    twin, dna, plan = context(p, data.get("plan"))
    hs = _holdings(data)
    try:
        d = portfolio_doctor.diagnose(p, hs, plan, dna.score("liquidity_need"))
    except portfolio_doctor.CsvError as exc:
        raise ApiError(str(exc), 422) from exc
    return d


@bp.post("/api/portfolio/analyze")
def portfolio_analyze():
    data = body()
    hs = _holdings(data)
    total = sum(h["value"] for h in hs)
    if total <= 0:
        raise ApiError("Total value must be positive", 422)
    by = {}
    for h in hs:
        by[h["asset_class"]] = by.get(h["asset_class"], 0) + h["value"] / total
    return ok({"holdings": hs, "total_value": round(total), "by_class": by})


@bp.post("/api/portfolio/doctor")
def portfolio_doctor_ep():
    data = body()
    d = _doctor(data)
    try:
        with session_scope() as db:
            row = Portfolio(
                user_id=current_user_id(),
                name=str(data.get("name") or "My portfolio")[:80],
                total_value=d["total_value"],
                risk_score=d["portfolio_vol_pct"],
                health_score=d["health_score"],
            )
            db.add(row)
            db.flush()
            for h in d["holdings"]:
                db.add(
                    PortfolioHolding(
                        portfolio_id=row.id,
                        asset=h["symbol"],
                        type=h["asset_class"],
                        sector=h["sector"],
                        value=h["value"],
                        weight=h["weight"],
                    )
                )
            d["portfolio_id"] = row.id
    except Exception:  # noqa: BLE001
        pass
    log_simulation("portfolio_doctor", {"holdings": len(d["holdings"])}, None, count=20_000)
    return ok(d)


@bp.post("/api/portfolio/rebalance")
def portfolio_rebalance():
    d = _doctor(body())
    keep = (
        "treatment",
        "allocation_before",
        "allocation_after",
        "target_weights",
        "goal_probability_current",
        "goal_probability_prescribed",
        "total_value",
    )
    return ok({k: d[k] for k in keep})


# ---------- Command center ----------
def dashboard_payload(p):
    """Goals with simulated probabilities and a health check of what the user holds today
    (asset classes from the Digital Twin). Shared by the Command Center and Atlas."""
    from datetime import date, timedelta

    from engines.plan import run

    twin, dna, plan = context(p)
    goals = []
    gc = goal_context(p, twin)
    for g in p.goals[:6]:
        is_primary = gc["target"] == g.target_amount and gc["name"] == g.name
        start = gc["start_corpus"] if is_primary else float(g.current_amount)
        sim = run(
            p,
            twin,
            plan,
            n_paths=4000,
            months=max(1, round(g.years * 12)),
            target=float(g.target_amount),
            start_portfolio=start,
        )
        goals.append(
            {
                "name": g.name,
                "goal_type": g.goal_type,
                "priority": g.priority,
                "target": g.target_amount,
                "current": round(start),
                "remaining": round(max(0.0, g.target_amount - start)),
                "years": g.years,
                "deadline": (date.today() + timedelta(days=round(g.years * 365.25))).isoformat(),
                "probability": sim["goal_success_probability"],
                "primary": is_primary,
                "basis": "Primary goal: current investments + planned monthly investment"
                if is_primary
                else "Tested on its own with its earmarked amount + planned investment",
            }
        )
    # What the user holds today, by asset class (the Doctor diagnoses individual holdings)
    from engines.finance_math import clamp
    from engines.portfolio_engine import expected_vol

    a = p.assets
    vals = {
        "equity": a.equity,
        "debt": a.debt,
        "gold": a.gold,
        "cash": a.cash,
        "real_estate": a.real_estate,
        "other": a.other,
    }
    total = float(sum(vals.values()))
    portfolio = None
    if total > 0:
        w = {k: v / total for k, v in vals.items() if v > 0}
        hhi = sum(x * x for x in w.values())
        n = len(w)
        div = clamp((1 - hhi) / (1 - 1 / n) * 100) if n > 1 else 0.0
        top_cls, top_w = max(w.items(), key=lambda kv: kv[1])
        liquid = sum(w.get(k, 0) for k in ("equity", "debt", "gold", "cash"))
        inv = a.equity + a.debt + a.gold
        cur_w = (
            {"equity": a.equity / inv, "debt": a.debt / inv, "gold": a.gold / inv}
            if inv
            else {"equity": 0.0, "debt": 0.0, "gold": 0.0}
        )
        vol = expected_vol(cur_w) if inv else 0.0
        target_vol = expected_vol(plan.weights)
        risk = clamp(100 - 3 * abs(vol - target_vol))
        align = clamp(100 - 2 * abs(cur_w["equity"] - plan.equity) * 100)
        conc = clamp(100 - 2 * max(0.0, top_w * 100 - 50))
        sub = {
            "diversification": round(div, 1),
            "concentration": round(conc, 1),
            "liquidity": round(liquid * 100, 1),
            "risk": round(risk, 1),
            "goal_alignment": round(align, 1),
        }
        health = sum(sub.values()) / len(sub)
        portfolio = {
            "total_value": round(total),
            "investable_value": round(inv),
            "health_score": round(health, 1),
            "sub_scores": sub,
            "by_class": {k: round(v, 4) for k, v in w.items()},
            "largest_class": top_cls,
            "largest_share": round(top_w, 4),
            "portfolio_vol_pct": round(vol, 2),
            "target_vol_pct": round(target_vol, 2),
            "equity_share": round(cur_w["equity"], 4),
            "target_equity": plan.equity,
        }
    return twin, dna, {"goals": goals, "portfolio": portfolio, "plan": plan.to_dict()}


def _has_completed_decision() -> bool:
    """Whether the caller (signed-in user, or this browser's guest key) has a finished decision."""
    from sqlalchemy import select

    from api.common import current_guest_key
    from models import Decision

    uid, gk = current_user_id(), current_guest_key()
    if not uid and not gk:
        return False
    q = select(Decision.id).where(Decision.status == "completed").limit(1)
    q = q.where(Decision.user_id == uid) if uid else q.where(
        Decision.user_id.is_(None), Decision.guest_key == gk
    )
    with session_scope() as db:
        return db.scalar(q) is not None


def _atlas(p, twin, dna, data) -> dict:
    from engines.atlas import brief

    return brief(
        twin,
        dna,
        data["goals"],
        data["portfolio"],
        float(p.behaviour.current_monthly_investment),
        _has_completed_decision(),
    )


@bp.post("/api/dashboard")
def dashboard():
    """Everything the Command Center needs in one call, including Atlas's guidance."""
    p = profile_from(body())
    twin, dna, data = dashboard_payload(p)
    return ok({**data, "atlas": _atlas(p, twin, dna, data)})


@bp.post("/api/atlas/brief")
def atlas_brief():
    """Capital Health Index, the recommended next action and progress for the Atlas map."""
    p = profile_from(body())
    twin, dna, data = dashboard_payload(p)
    atlas = _atlas(p, twin, dna, data)
    return ok({"atlas": atlas, "goals": data["goals"], "portfolio": data["portfolio"]})


# ---------- What-If Lab ----------
LAB_FIELDS = {
    "income": (0, 10_000_000),
    "expenses": (0, 10_000_000),
    "sip": (0, 2_000_000),
    "loan_amount": (0, 50_000_000),
    "loan_rate": (0, 40),
    "equity": (0, 0.95),
    "emergency_fund": (0, 100_000_000),
}


@bp.post("/api/whatif/lab")
def whatif_lab():
    """Preview (arithmetic) or full simulation of changes, without saving the profile.

    Body: {profile, changes: {income?, expenses?, sip?, loan_amount?, loan_rate?, equity?,
    emergency_fund?}, simulate?: bool}. Returns the twin's current values, the preview for
    the unchanged and changed inputs, and — when `simulate` is true — the 10,000-path run.
    """
    from engines import whatif_lab as lab

    data = body()
    p = profile_from(data)
    raw = data.get("changes") or {}
    if not isinstance(raw, dict):
        raise ApiError("changes must be an object", 422)
    changes = {k: num(raw, k, None, lo, hi) for k, (lo, hi) in LAB_FIELDS.items() if k in raw}
    twin, dna, plan = context(p)
    q, new_plan = lab.apply_changes(p, plan, changes)
    out = {
        "current": lab.current_values(p, plan),
        "base": lab.preview(p, plan),
        "preview": lab.preview(q, new_plan),
    }
    if data.get("simulate"):
        sim = lab.simulate(q, new_plan)
        log_simulation("whatif_lab", changes, None, sim["n_paths"])
        out["simulation"] = sim
    return ok(out)
