"""Decision engine — the numbers behind the Red Team, the Critic, re-optimisation and the
counterfactual explanation. Agents narrate these results; they never compute their own.

Red Team tests (each simulated with 10,000 paths and the decision's seed)
--------------------------------------------------------------------------
crash        instant portfolio loss for NIFTY −30% (gold +5%) vs the user's max-loss limit
             PASS ≤ limit · FAIL > limit                                    [critical]
inflation    inflation 5 points above the 5.5% base for the whole horizon; the target is
             re-priced by the excess inflation ((1.105/1.055)^years); goal success
             PASS ≥ 35% · WARN ≥ 20% · FAIL
income_stop  6-month salary stop: months the cash covers essentials + all EMIs
             PASS ≥ 6 · WARN ≥ 4 · FAIL < 4                                 [critical]
goal_change  target +20%; goal success      PASS ≥ 40% · WARN ≥ 25% · FAIL
low_return   equity drift −4%/yr; goal success   PASS ≥ 50% · WARN ≥ 30% · FAIL
rate_shock   floating + new-loan rates +2.5%; FOIR
             PASS ≤ 40% · WARN ≤ 50% · FAIL > 50%                           [critical]

Robustness score = 100 − Σ penalties (critical FAIL 25 · FAIL 15 · WARN 7), floored at 0.

Critic rules
------------
REJECT when any critical test FAILS, when base-case goal success < 50% for a high-priority
goal, or when the robustness score < 55 — unless the retry budget (2) is spent, in which case
the best candidate seen so far is ACCEPTED with its open weaknesses recorded.
"""

from __future__ import annotations

from dataclasses import dataclass

from engines.crisis_engine import crash_loss_cap
from engines.digital_twin import Twin
from engines.finance_math import emi as emi_fn
from engines.plan import LoanTerms, Plan, crash_loss, goal_context, run
from engines.portfolio_engine import plan_sip, weights_for
from engines.risk_engine import primary_goal
from schemas.profile import ProfileInput
from utils.inr import inr, inr_short

GOAL_THRESHOLD = 0.50
ROBUSTNESS_THRESHOLD = 55
PENALTY = {("FAIL", True): 25, ("FAIL", False): 15, ("WARN", True): 7, ("WARN", False): 7}
MAX_TENURE = {"personal": 84, "vehicle": 84, "education": 180, "home": 360}


def excess_inflation_multiplier(extra_pct: float, months: int, base_pct: float = 5.5) -> float:
    """How much more a goal costs if inflation runs `extra_pct` above the base assumption."""
    return ((1 + (base_pct + extra_pct) / 100) / (1 + base_pct / 100)) ** (months / 12)


def _grade(value: float, pass_at: float, warn_at: float, higher_is_better: bool = True) -> str:
    if higher_is_better:
        return "PASS" if value >= pass_at else "WARN" if value >= warn_at else "FAIL"
    return "PASS" if value <= pass_at else "WARN" if value <= warn_at else "FAIL"


def total_emi_after_shock(p: ProfileInput, plan: Plan, bump: float = 2.5) -> float:
    total = 0.0
    for li in p.liabilities:
        if li.floating_rate and li.remaining_months > 0 and li.outstanding > 0:
            total += emi_fn(li.outstanding, li.annual_rate_pct + bump, li.remaining_months)
        else:
            total += li.emi
    if plan.loan:
        total += emi_fn(plan.loan.amount, plan.loan.annual_rate_pct + bump, plan.loan.tenure_months)
    return total


def red_team(p: ProfileInput, twin: Twin, plan: Plan, seed: int = 42) -> dict:
    limit = p.risk.max_tolerated_loss_pct / 100
    gc = goal_context(p, twin)
    has_goal = gc["target"] is not None
    tests = []

    loss = crash_loss(plan.weights)
    tests.append(
        {
            "key": "crash",
            "name": "Crash test",
            "critical": True,
            "status": "PASS" if loss <= limit + 1e-9 else "FAIL",
            "metric": round(loss, 4),
            "threshold": limit,
            "detail": f"NIFTY −30% wipes {loss:.1%} off the portfolio; your limit is {limit:.0%}",
        }
    )

    if has_goal:
        mult = excess_inflation_multiplier(5.0, gc["months"])
        sim = run(p, twin, plan, seed=seed, inflation_pct=10.5, target=gc["target"] * mult)
        v = sim["goal_success_probability"] or 0
        tests.append(
            {
                "key": "inflation",
                "name": "Inflation test",
                "critical": False,
                "status": _grade(v, 0.35, 0.20),
                "metric": v,
                "threshold": 0.35,
                "detail": f"Inflation at 10.5% lifts the goal cost to "
                f"{inr_short(gc['target'] * mult)}; success {v:.0%}",
            }
        )

    loan_emi = plan.loan.emi if plan.loan else 0.0
    burn = twin.essential_expenses + twin.monthly_emi + loan_emi
    ef_months = float(p.assets.cash) / burn if burn > 0 else 99.0
    job = run(p, twin, plan, seed=seed, job_loss_months=6)
    tests.append(
        {
            "key": "income_stop",
            "name": "Income-stop test",
            "critical": True,
            "status": _grade(ef_months, 6, 4),
            "metric": round(ef_months, 2),
            "threshold": 6,
            "detail": f"Cash covers {ef_months:.1f} months of essentials + EMIs ({inr(burn)}/mo); "
            f"forced selling in {job['forced_liquidation_probability']:.0%} of futures",
        }
    )

    if has_goal:
        sim = run(p, twin, plan, seed=seed, target=gc["target"] * 1.2)
        v = sim["goal_success_probability"] or 0
        tests.append(
            {
                "key": "goal_change",
                "name": "Goal-change test",
                "critical": False,
                "status": _grade(v, 0.40, 0.25),
                "metric": v,
                "threshold": 0.40,
                "detail": f"If the target rises 20% to {inr_short(gc['target'] * 1.2)}, success is "
                f"{v:.0%}",
            }
        )
        sim = run(p, twin, plan, seed=seed, equity_return_shift_pct=-4.0)
        v = sim["goal_success_probability"] or 0
        tests.append(
            {
                "key": "low_return",
                "name": "Low-return test",
                "critical": False,
                "status": _grade(v, 0.50, 0.30),
                "metric": v,
                "threshold": 0.50,
                "detail": f"With equity returns 4%/yr lower than history, success is {v:.0%}",
            }
        )

    # Liquidity crisis: an emergency bill (two months of income) lands while you also need
    # three months of essentials + EMIs, in the middle of a NIFTY −30% crash. Can cash and
    # debt holdings cover it without selling equity at crash prices?
    need = 3 * burn + 2 * twin.monthly_income
    liquid = float(p.assets.cash) + float(p.assets.debt)
    cover = liquid / need if need > 0 else 99.0
    shortfall = max(0.0, need - liquid)
    tests.append(
        {
            "key": "liquidity",
            "name": "Liquidity-crisis test",
            "critical": False,
            "status": _grade(cover, 1.0, 0.6),
            "metric": round(cover, 4),
            "threshold": 1.0,
            "detail": (
                f"An emergency of {inr_short(need)} during a crash: cash + debt cover {cover:.0%}"
                + (
                    f"; {inr_short(shortfall)} of equity would be sold about 30% below value"
                    if shortfall > 0
                    else " without selling equity"
                )
            ),
        }
    )

    shocked_emi = total_emi_after_shock(p, plan)
    foir = shocked_emi / twin.monthly_income if twin.monthly_income > 0 else 1.0
    tests.append(
        {
            "key": "rate_shock",
            "name": "Loan / interest shock",
            "critical": True,
            "status": _grade(foir, 0.40, 0.50, higher_is_better=False),
            "metric": round(foir, 4),
            "threshold": 0.40,
            "detail": f"Rates +2.5%: EMIs become {inr(shocked_emi)}/mo, FOIR {foir:.0%}",
        }
    )

    score = 100
    for t in tests:
        score -= PENALTY.get((t["status"], t["critical"]), 0)
        t["question"] = QUESTIONS[t["key"]]
        t["severity"] = severity(t)
        lower_better = t["key"] in ("crash", "rate_shock")
        thr = t["threshold"] or 1e-9
        t["stress"] = round(
            (t["metric"] - thr) / thr if lower_better else (thr - t["metric"]) / thr, 4
        )
    weaknesses = [
        {
            "test": t["key"],
            "name": t["name"],
            "question": t["question"],
            "status": t["status"],
            "severity": t["severity"],
            "critical": t["critical"],
            "detail": t["detail"],
        }
        for t in tests
        if t["status"] != "PASS"
    ]
    order = {"High": 0, "Medium": 1, "Low": 2}
    weaknesses.sort(key=lambda w: order[w["severity"]])
    fragile = max(tests, key=lambda t: t["stress"])
    return {
        "tests": tests,
        "red_team_score": max(0, score),
        "weaknesses": weaknesses,
        "most_fragile": {
            "test": fragile["key"],
            "name": fragile["name"],
            "question": fragile["question"],
            "detail": fragile["detail"],
        },
    }


QUESTIONS = {
    "crash": "What happens during a 30% market crash?",
    "inflation": "What if inflation runs 5 points higher than planned?",
    "income_stop": "What if income stops for six months?",
    "goal_change": "What if the goal costs 20% more?",
    "low_return": "What if equity returns are 4% a year lower?",
    "liquidity": "What if an emergency needs cash in the middle of a crash?",
    "rate_shock": "What if interest rates rise 2.5%?",
}


def severity(t: dict) -> str:
    """High: a critical test broke. Medium: a non-critical test broke. Low: strained."""
    if t["status"] == "FAIL":
        return "High" if t["critical"] else "Medium"
    if t["status"] == "WARN":
        return "Low"
    return "None"


def critic_rules(p: ProfileInput, base_goal_probability: float | None, rt: dict) -> list[str]:
    reasons = []
    for t in rt["tests"]:
        if t["critical"] and t["status"] == "FAIL":
            reasons.append(f"{t['name']} failed — {t['detail']}")
    g = primary_goal(p.goals)
    if (
        g
        and g.priority == "high"
        and base_goal_probability is not None
        and base_goal_probability < GOAL_THRESHOLD
    ):
        reasons.append(
            f"Base-case goal success {base_goal_probability:.0%} is below the "
            f"{GOAL_THRESHOLD:.0%} bar for a high-priority goal"
        )
    if rt["red_team_score"] < ROBUSTNESS_THRESHOLD:
        reasons.append(f"Robustness score {rt['red_team_score']} is below {ROBUSTNESS_THRESHOLD}")
    return reasons


@dataclass
class Candidate:
    plan: Plan
    goal_probability: float
    crash_loss: float
    foir_shocked: float
    ef_months: float
    score: float


def _candidate_plans(p: ProfileInput, twin: Twin, plan: Plan) -> list[Plan]:
    cap = crash_loss_cap(p)
    eq_options = sorted(
        {
            round(min(plan.equity, cap) - d, 2)
            for d in (0.0, 0.05, 0.10)
            if min(plan.equity, cap) - d >= 0.15
        },
        reverse=True,
    )
    loans: list[LoanTerms | None] = [plan.loan]
    if plan.loan:
        loans = []
        mx = MAX_TENURE.get(plan.loan.loan_type, 120)
        for frac in (1.0, 0.8, 0.6, 0.4):
            for extra in (0, 12, 24):
                n = min(mx, plan.loan.tenure_months + extra)
                lt = LoanTerms(
                    plan.loan.loan_type,
                    round(plan.loan.amount * frac, -3),
                    plan.loan.annual_rate_pct,
                    n,
                    plan.loan.processing_fee_pct,
                )
                if lt not in loans:
                    loans.append(lt)
    cuts = [plan.spending_cut]
    if twin.high_risk_spending > 0:
        cuts = sorted({plan.spending_cut, 0.5, 1.0})
    out = []
    for eq in eq_options or [0.15]:
        w = weights_for(eq)
        for loan in loans:
            for cut in cuts:
                extra = loan.emi if loan else 0.0
                sip, ef, _, _ = plan_sip(
                    p, twin, w, extra_emi=extra, freed=twin.high_risk_spending * cut
                )
                out.append(
                    Plan(
                        weights=w,
                        monthly_sip=round(sip),
                        ef_topup=round(ef),
                        loan=loan,
                        spending_cut=cut,
                        label="Re-optimised plan",
                    )
                )
    return out


def reoptimize(
    p: ProfileInput, twin: Twin, plan: Plan, weaknesses: list[dict], seed: int = 42
) -> dict:
    """Search allocation × SIP × loan terms × spending cut for a plan the Critic can accept.

    1. analytic filter: crash loss ≤ limit, shocked FOIR ≤ 50%, cash ≥ 4 months of burn
    2. simulate survivors with 2,000 paths (same seed) for goal success
    3. rank: plans clearing the 50% goal bar first; then by
       goal success + 0.25 · share of the requested loan kept − 0.04 · extra years of tenure
    """
    limit = p.risk.max_tolerated_loss_pct / 100
    gc = goal_context(p, twin)
    cands: list[Candidate] = []
    rejected = 0
    for c in _candidate_plans(p, twin, plan):
        cl = crash_loss(c.weights)
        foir = total_emi_after_shock(p, c) / max(twin.monthly_income, 1)
        burn = twin.essential_expenses + twin.monthly_emi + (c.loan.emi if c.loan else 0)
        ef = float(p.assets.cash) / burn if burn > 0 else 99
        if cl > limit + 1e-9 or foir > 0.50 or ef < 4:
            rejected += 1
            continue
        sim = run(p, twin, c, n_paths=2000, seed=seed)
        gp = sim["goal_success_probability"]
        gp = gp if gp is not None else 1.0
        kept = c.loan.amount / plan.loan.amount if (c.loan and plan.loan) else 1.0
        extra_years = (
            (c.loan.tenure_months - plan.loan.tenure_months) / 12 if (c.loan and plan.loan) else 0
        )
        score = gp + 0.25 * kept - 0.04 * extra_years - 0.05 * c.spending_cut
        cands.append(Candidate(c, gp, cl, foir, ef, score))
    if not cands:
        # Nothing clears the hard filters: fall back to the most defensive allocation
        w = weights_for(0.15)
        sip, ef, _, _ = plan_sip(p, twin, w, extra_emi=plan.loan.emi if plan.loan else 0)
        best = plan.with_(
            weights=w,
            monthly_sip=round(sip),
            ef_topup=round(ef),
            label="Re-optimised plan (defensive)",
        )
        return {
            "plan": best,
            "searched": rejected,
            "feasible": 0,
            "changes": _diff(plan, best),
            "note": "No candidate cleared every hard limit; moved to the most defensive mix",
        }

    meeting = [c for c in cands if c.goal_probability >= GOAL_THRESHOLD or gc["target"] is None]
    pool = meeting or cands
    best = max(pool, key=lambda c: c.score if meeting else c.goal_probability)
    note = (
        "Best plan that clears every hard limit and the 50% goal bar"
        if meeting
        else "No plan reaches the 50% goal bar — chose the highest goal probability within limits"
    )
    return {
        "plan": best.plan,
        "searched": len(cands) + rejected,
        "feasible": len(cands),
        "goal_probability_estimate": best.goal_probability,
        "changes": _diff(plan, best.plan),
        "note": note,
    }


def _diff(old: Plan, new: Plan) -> list[str]:
    ch = []
    if abs(old.equity - new.equity) > 1e-6:
        ch.append(
            f"Equity {old.equity:.0%} → {new.equity:.0%} (crash loss "
            f"{crash_loss(old.weights):.1%} → {crash_loss(new.weights):.1%})"
        )
    if abs(old.monthly_sip - new.monthly_sip) >= 1:
        ch.append(f"Monthly investment {inr(old.monthly_sip)} → {inr(new.monthly_sip)}")
    if old.loan and new.loan:
        if old.loan.amount != new.loan.amount:
            ch.append(f"Loan amount {inr_short(old.loan.amount)} → {inr_short(new.loan.amount)}")
        if old.loan.tenure_months != new.loan.tenure_months:
            ch.append(
                f"Tenure {old.loan.tenure_months} → {new.loan.tenure_months} months "
                f"(EMI {inr(old.loan.emi)} → {inr(new.loan.emi)})"
            )
    if abs(old.spending_cut - new.spending_cut) > 1e-6:
        ch.append(f"High-risk spending redirected {old.spending_cut:.0%} → {new.spending_cut:.0%}")
    return ch or ["No parameter change was needed"]


def plan_metrics(p: ProfileInput, twin: Twin, plan: Plan, seed: int = 42) -> dict:
    sim = run(p, twin, plan, seed=seed)
    return {
        "plan": plan.to_dict(),
        "goal_success_probability": sim["goal_success_probability"],
        "ending_p5": sim["ending"]["p5"],
        "ending_p50": sim["ending"]["p50"],
        "crash_loss": round(crash_loss(plan.weights), 4),
        "max_drawdown_p95": sim["max_drawdown"]["p95"],
        "forced_liquidation_probability": sim["forced_liquidation_probability"],
    }


def counterfactual(p: ProfileInput, twin: Twin, final: Plan, seed: int = 42) -> dict:
    """Why this, why not higher / lower risk, and which assumptions matter most."""
    chosen = plan_metrics(p, twin, final, seed)
    hi = final.with_(weights=weights_for(min(0.90, final.equity + 0.15)), label="Higher risk")
    lo = final.with_(weights=weights_for(max(0.10, final.equity - 0.15)), label="Lower risk")
    higher = plan_metrics(p, twin, hi, seed)
    lower = plan_metrics(p, twin, lo, seed)

    base_gp = chosen["goal_success_probability"]
    sens = []
    if base_gp is not None:
        gc = goal_context(p, twin)
        checks = [
            ("Equity returns −2%/yr", {"equity_return_shift_pct": -2.0}),
            (
                "Inflation +2%/yr",
                {
                    "inflation_pct": 7.5,
                    "target": gc["target"] * excess_inflation_multiplier(2.0, gc["months"]),
                },
            ),
            ("Monthly investment −20%", {"monthly_sip": final.monthly_sip * 0.8}),
            ("Deadline one year sooner", {"months": max(12, gc["months"] - 12)}),
            ("Volatility ×1.3", {"vol_multiplier": 1.3}),
        ]
        for label, ov in checks:
            months = ov.pop("months", None)
            sim = run(p, twin, final, seed=seed, n_paths=4000, months=months, **ov)
            gp = sim["goal_success_probability"] or 0
            sens.append(
                {"assumption": label, "goal_probability": gp, "impact": round(gp - base_gp, 4)}
            )
        sens.sort(key=lambda s: s["impact"])
    return {"chosen": chosen, "higher_risk": higher, "lower_risk": lower, "sensitivity": sens}


def plan_health(p: ProfileInput, twin: Twin, plan: Plan, seed: int = 42) -> dict:
    """Resilience, debt stress, liquidity and cash flow of a plan, for old-vs-new comparisons."""
    from engines.digital_twin import build_twin
    from engines.loan_engine import band, stress_score
    from engines.risk_engine import compute_risk_dna

    loan_emi = plan.loan.emi if plan.loan else 0.0
    loan_amt = plan.loan.amount if plan.loan else 0.0
    t2 = build_twin(p, extra_monthly_emi=loan_emi, extra_liability=loan_amt)
    resilience = compute_risk_dna(p, t2).score("financial_resilience")
    stress = stress_score(t2.dti, t2.emergency_fund_months, t2.monthly_surplus, t2.monthly_income)
    sim = run(p, twin, plan, seed=seed)
    return {
        "goal_success_probability": sim["goal_success_probability"],
        "financial_resilience": round(resilience, 1),
        "debt_stress_score": stress,
        "debt_stress_band": band(stress, t2.dti),
        "foir": round(t2.dti, 4),
        "emergency_fund_months": round(t2.emergency_fund_months, 2),
        "crash_loss": round(crash_loss(plan.weights), 4),
        "ending_p50": sim["ending"]["p50"],
        # monthly money left once the plan runs: surplus after all EMIs (new loan included),
        # minus the SIP and the emergency-fund top-up, plus any high-risk spend the plan cuts
        "monthly_left_after_plan": round(
            t2.monthly_surplus
            - plan.monthly_sip
            - plan.ef_topup
            + t2.high_risk_spending * plan.spending_cut
        ),
        "monthly_sip": round(plan.monthly_sip),
        "loan_emi": round(loan_emi),
        "equity": round(plan.equity, 4),
    }
