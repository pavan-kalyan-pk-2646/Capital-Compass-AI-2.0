"""LangGraph nodes. Each is a thin wrapper: read state → call engine/agent → write state.

`node()` adds the audit record and emits `running` / `done` events to whoever is listening
(the SSE stream), so the UI can show every stage of the pipeline live.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

from agents import (
    bear_agent,
    bull_agent,
    compliance_agent,
    critic,
    debate,
    explanation,
    goal_agent,
    loan_agent,
    market_agent,
    portfolio_agent,
    red_team,
    risk_agent,
)
from agents.supervisor import parse_command, route_summary
from engines import (
    crisis_engine,
    decision_engine,
    goal_engine,
    loan_engine,
    portfolio_doctor,
    portfolio_engine,
    spending_engine,
)
from engines.digital_twin import build_twin, twin_payload
from engines.plan import LoanTerms, Plan, crash_loss, goal_context, run
from engines.risk_engine import compute_risk_dna
from engines.simulation_engine import summary as sim_summary
from graph.state import MAX_RETRIES, FinancialState
from market import loader
from schemas.profile import ProfileInput
from utils.inr import inr, inr_short

LABELS = {
    "profile_parser": "Financial Profile Engine",
    "financial_twin": "Financial Digital Twin",
    "supervisor": "Supervisor AI",
    "risk_dna": "Risk DNA",
    "goal_agent": "Goal Agent",
    "market_agent": "Market Agent",
    "decision_router": "Financial Decision Router",
    "investment": "Investment Engine",
    "loan": "Loan Decision Simulator",
    "spending": "High-Risk Spending Analyzer",
    "crisis": "Emergency / Crisis Engine",
    "portfolio_doctor": "Portfolio Doctor",
    "simulation_engine": "Simulation Engine",
    "crisis_engine": "Crisis War Room",
    "financial_committee": "AI Financial Committee",
    "debate": "Committee Debate",
    "red_team": "Red Team",
    "critic": "Critic",
    "re_optimize": "Re-optimiser",
    "counterfactual": "Counterfactual Explanation",
    "explanation": "Explanation Agent",
    "trust_center": "Trust Center",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def node(name: str):
    def deco(fn):
        def wrapped(state: FinancialState, config=None):
            cfg = (config or {}).get("configurable", {}) if config else {}
            emit = cfg.get("emit") or (lambda e: None)
            emit(
                {
                    "node": name,
                    "label": LABELS[name],
                    "status": "running",
                    "ts": _now(),
                    "summary": f"{LABELS[name]} running…",
                    "payload": {},
                }
            )
            t0 = time.perf_counter()
            try:
                update, summary, payload = fn(state)
            except Exception as exc:
                emit(
                    {
                        "node": name,
                        "label": LABELS[name],
                        "status": "failed",
                        "ts": _now(),
                        "summary": f"{LABELS[name]} failed: {exc}",
                        "payload": {},
                    }
                )
                raise
            ms = round((time.perf_counter() - t0) * 1000)
            ts = _now()
            emit(
                {
                    "node": name,
                    "label": LABELS[name],
                    "status": "done",
                    "ts": ts,
                    "summary": summary,
                    "payload": payload,
                    "duration_ms": ms,
                }
            )
            update = dict(update)
            update["audit_trail"] = [
                {
                    "node_name": name,
                    "label": LABELS[name],
                    "status": "done",
                    "message": summary,
                    "timestamp": ts,
                    "duration_ms": ms,
                }
            ]
            return update

        wrapped.__name__ = name
        return wrapped

    return deco


# ---------- helpers ----------
def _p(state) -> ProfileInput:
    return ProfileInput.model_validate(state["profile"])


def _twin(state):
    return build_twin(_p(state))


def _dna(state):
    p = _p(state)
    return compute_risk_dna(p, build_twin(p))


def _apply_params(profile: dict, dtype: str | None, params: dict) -> dict:
    prof = {
        **profile,
        "goals": [dict(g) for g in profile.get("goals", [])],
        "behaviour": dict(profile.get("behaviour") or {}),
    }
    if dtype == "goal" and (params.get("target") or params.get("years")):
        goals = prof["goals"]
        if goals:
            order = {"high": 0, "medium": 1, "low": 2}
            i = min(
                range(len(goals)),
                key=lambda k: (order.get(goals[k].get("priority", "high"), 0), goals[k]["years"]),
            )
            g = goals[i]
        else:
            g = {
                "name": "Goal",
                "goal_type": "wealth",
                "priority": "high",
                "target_amount": 1_000_000,
                "years": 5,
            }
            goals.append(g)
        if params.get("target"):
            g["target_amount"] = int(params["target"])
        if params.get("years"):
            g["years"] = float(params["years"])
    if dtype == "spending" and params.get("monthly_spend") is not None:
        prof["behaviour"]["high_risk_spending"] = int(params["monthly_spend"])
    if dtype == "investment" and params.get("monthly_sip"):
        prof["behaviour"]["current_monthly_investment"] = int(params["monthly_sip"])
    return ProfileInput.model_validate(prof).model_dump(mode="json")


def _ctx(state) -> dict:
    p = _p(state)
    twin = build_twin(p)
    plan = state["proposal"]
    sim = state["simulation_results"]
    loan = plan.get("loan")
    loan_emi = loan["emi"] if loan else 0.0
    burn = twin.essential_expenses + twin.monthly_emi + loan_emi
    gc = state["goal_context"]
    pl = Plan.from_dict(plan)
    _, _, required, affordable = portfolio_engine.plan_sip(p, twin, pl.weights, extra_emi=loan_emi)
    la = state.get("loan_analysis") or {}
    return {
        "decision_type": state["decision_type"],
        "age": p.age,
        "plan": plan,
        "goal_probability": sim.get("goal_success_probability"),
        "goal_probability_before": la.get("goal_probability_before"),
        "ending_p5": sim["ending"]["p5"],
        "ending_p50": sim["ending"]["p50"],
        "ending_p95": sim["ending"]["p95"],
        "max_drawdown_p95": sim["max_drawdown"]["p95"],
        "prob_loss_beyond_limit": sim.get("prob_loss_beyond_limit"),
        "forced_liquidation_probability": sim["forced_liquidation_probability"],
        "crash_loss": crash_loss(plan["weights"]),
        "max_loss": p.risk.max_tolerated_loss_pct / 100,
        "ef_months": float(p.assets.cash) / burn if burn > 0 else 99.0,
        "foir": (twin.monthly_emi + loan_emi) / twin.monthly_income if twin.monthly_income else 1.0,
        "crisis": state.get("crisis_results"),
        "recovery_months": (state.get("crisis_results") or {}).get("recovery_months"),
        "market": state["market_data"],
        "dna_summary": risk_agent.dna_summary(state["risk_dna"]),
        "goal": {**gc, "required_monthly_sip": round(required)},
        "affordable_sip": affordable,
        "loan": loan,
    }


def _slim_sim(sim: dict) -> dict:
    return {k: v for k, v in sim.items() if k != "sample_paths"}


# ---------- nodes ----------
@node("profile_parser")
def profile_parser(state):
    raw = state["profile"]
    dtype = state.get("decision_type")
    params = dict(state.get("params") or {})
    cmd = (state.get("command") or "").strip()
    parsed = None
    if cmd:
        parsed = parse_command(cmd)
        if not dtype and parsed["decision_type"] not in (None, "explain"):
            dtype = parsed["decision_type"]
        for k, v in parsed["params"].items():
            params.setdefault(k, v)
    dtype = dtype or "investment"
    prof = _apply_params(raw, dtype, params)
    p = ProfileInput.model_validate(prof)
    update = {
        "profile": prof,
        "decision_type": dtype,
        "params": params,
        "user_profile": {
            "name": p.name,
            "age": p.age,
            "dependents": p.dependents,
            "employment": p.employment,
            "experience": p.risk.experience,
        },
        "income": {"salary": p.monthly_income, "other": p.other_income},
        "expenses": {
            "essential": p.essential_expenses,
            "discretionary": p.discretionary_expenses,
            "high_risk": p.behaviour.high_risk_spending,
        },
        "assets": p.assets.model_dump(),
        "liabilities": [li.model_dump() for li in p.liabilities],
        "goals": [g.model_dump() for g in p.goals],
        "retry_count": 0,
        "rounds": [],
        "plan_history": [],
    }
    msg = (
        f"Age {p.age}, income {inr(p.monthly_income + p.other_income)}/mo, "
        f"{len(p.goals)} goal(s), {len(p.liabilities)} liability(ies)"
    )
    if parsed:
        msg = f"Command understood: “{cmd}”. " + msg
    return update, msg, {"params": params}


@node("financial_twin")
def financial_twin(state):
    p = _p(state)
    t = build_twin(p)
    payload = twin_payload(p, t)
    gc = goal_context(p, t)
    msg = (
        f"Net worth {inr_short(t.net_worth)}, surplus {inr(t.monthly_surplus)}/mo, "
        f"emergency fund {t.emergency_fund_months:.1f} months, health "
        f"{t.health_score:.0f}/100 {t.health_band}"
    )
    return {"twin": payload, "goal_context": gc}, msg, {"twin": payload["twin"]}


@node("supervisor")
def supervisor(state):
    dtype = state["decision_type"]
    reason = route_summary(dtype, state.get("params") or {})
    return {"route_reason": reason}, f"Decision type: {dtype}. {reason}", {"decision_type": dtype}


@node("risk_dna")
def risk_dna_node(state):
    d = _dna(state).to_dict()
    return {"risk_dna": d}, risk_agent.dna_summary(d), {"scores": d["scores"], "label": d["label"]}


@node("goal_agent")
def goal_agent_node(state):
    p = _p(state)
    t = build_twin(p)
    w = portfolio_engine.weights_for(0.5)
    _, _, required, affordable = portfolio_engine.plan_sip(p, t, w)
    gc = goal_context(p, t)
    brief = goal_agent.feasibility({**gc, "required_monthly_sip": required}, affordable)
    return {"goal_brief": brief}, brief, {}


@node("market_agent")
def market_agent_node(state):
    b = market_agent.brief()
    return {"market_data": b, "market_regime": b["regime"]}, b["summary"], {"regime": b["regime"]}


@node("decision_router")
def decision_router(state):
    dtype = state["decision_type"]
    target = "investment" if dtype == "goal" else dtype
    return {}, f"Routing {dtype} decision to the {LABELS[target]}", {"route": target}


def route_decision(state) -> str:
    return "investment" if state["decision_type"] == "goal" else state["decision_type"]


def _base_plan(state) -> tuple:
    p = _p(state)
    t = build_twin(p)
    dna = compute_risk_dna(p, t)
    return p, t, portfolio_engine.generate_plan(p, t, dna, state.get("market_regime"))


@node("investment")
def investment(state):
    p, t, plan = _base_plan(state)
    params = state.get("params") or {}
    if state["decision_type"] == "investment" and params.get("monthly_sip"):
        _, _, _, affordable = portfolio_engine.plan_sip(p, t, plan.weights)
        sip = min(float(params["monthly_sip"]), max(affordable, 0))
        plan = plan.with_(
            monthly_sip=round(sip),
            notes=plan.notes
            + [
                f"Requested {inr(params['monthly_sip'])}/mo"
                + ("" if sip >= params["monthly_sip"] else f", capped at affordable {inr(sip)}")
            ],
        )
    update = {
        "proposal": plan.to_dict(),
        "plan_history": [plan.to_dict()],
        "portfolio": {
            "allocation": portfolio_engine.breakdown(plan, goal_context(p, t)["start_corpus"])
        },
    }
    msg = (
        f"Proposed {plan.weights['equity']:.0%} equity / {plan.weights['debt']:.0%} debt / "
        f"{plan.weights['gold']:.0%} gold, {inr(plan.monthly_sip)}/mo"
    )
    if state["decision_type"] == "goal":
        gs = goal_engine.survival(p, t, plan)
        update["goal_survival"] = {k: v for k, v in gs.items() if k != "simulation"}
        normal = gs["scenarios"][0]["success_probability"]
        msg += (
            f"; goal survival {normal:.0%} normal → "
            + f"{gs['scenarios'][-1]['success_probability']:.0%} crash + job loss"
        )
    return update, msg, {"plan": plan.to_dict()}


@node("loan")
def loan(state):
    p, t, plan = _base_plan(state)
    prm = state.get("params") or {}
    ltype = prm.get("loan_type", "personal")
    terms = LoanTerms(
        loan_type=ltype,
        amount=float(prm.get("amount", 500_000)),
        annual_rate_pct=float(
            prm.get("annual_rate_pct", loan_engine.TYPICAL_RATES.get(ltype, 14.0))
        ),
        tenure_months=int(prm.get("tenure_months", 60)),
        processing_fee_pct=float(prm.get("processing_fee_pct", 1.0)),
    )
    a = loan_engine.analyze(p, t, plan, terms)
    proposal = Plan.from_dict(a["plan_with_loan"]).with_(label="Proposed plan (with loan)")
    slim = {k: v for k, v in a.items() if k not in ("simulation_before", "simulation_after")}
    slim["percentiles_before"] = a["simulation_before"]["percentiles"]
    slim["percentiles_after"] = a["simulation_after"]["percentiles"]
    return (
        {
            "loan_request": terms.to_dict(),
            "loan_analysis": slim,
            "proposal": proposal.to_dict(),
            "plan_history": [proposal.to_dict()],
        },
        loan_agent.brief(a),
        {
            "risk_band": a["risk_band"],
            "emi": a["emi"],
            "goal_before": a["goal_probability_before"],
            "goal_after": a["goal_probability_after"],
        },
    )


@node("spending")
def spending(state):
    p, t, plan = _base_plan(state)
    a = spending_engine.analyze(p, t, plan)
    proposal = Plan.from_dict(a["plans"]["halved"]).with_(
        label="Proposed plan (spending capped at 50%)"
    )
    msg = (
        f"High-risk spending {inr(a['monthly_spend'])}/mo = {a['share_of_income']:.0%} of "
        f"income ({a['risk_level']}); goal {a['goal_probability_with']:.0%} as-is vs "
        f"{a['goal_probability_redirected']:.0%} if redirected"
    )
    return (
        {
            "spending_analysis": a,
            "proposal": proposal.to_dict(),
            "plan_history": [proposal.to_dict()],
        },
        msg,
        {"risk_level": a["risk_level"]},
    )


@node("crisis")
def crisis(state):
    p, t, plan = _base_plan(state)
    prm = state.get("params") or {}
    kind = prm.get("scenario", "market_crash")
    c = crisis_engine.simulate_crisis(
        p,
        t,
        plan,
        kind,
        severity=float(prm.get("severity", 1.0)),
        job_loss_months=int(prm.get("job_loss_months", 6)),
        medical_cost=float(prm.get("medical_cost", 300_000)),
    )
    proposal = plan.with_(label="Resilience plan")
    msg = (
        f"{c['label']}: severity {c['severity_label']}, goal "
        f"{(c['goal_probability_before'] or 0):.0%} → {(c['goal_probability_after'] or 0):.0%}"
        f", emergency fund lasts {c['emergency_fund_survival_months']:.1f} months"
    )
    return (
        {
            "crisis_scenario": {"kind": kind, **{k: prm[k] for k in prm if k != "scenario"}},
            "proposal": proposal.to_dict(),
            "plan_history": [proposal.to_dict()],
        },
        msg,
        {"severity": c["severity_label"]},
    )


@node("portfolio_doctor")
def portfolio_doctor_node(state):
    p = _p(state)
    holdings = (state.get("params") or {}).get("holdings")
    if holdings:
        dna = state["risk_dna"]
        h = portfolio_doctor.diagnose(
            p, holdings, Plan.from_dict(state["proposal"]), dna["scores"]["liquidity_need"]
        )
        h = {k: v for k, v in h.items() if k != "correlation"}
        msg = (
            f"Uploaded portfolio health {h['health_score']:.0f}/100 ({h['health_label']}), "
            f"{len(h['issues'])} issue(s)"
        )
    else:
        h = portfolio_agent.proposal_health(
            state["proposal"], p.risk.max_tolerated_loss_pct / 100, p.age
        )
        msg = (
            f"Proposed mix health {h['health_score']}/100: {h['asset_classes']} asset "
            f"classes, crash loss {h['crash_loss']:.1%}"
            + (f"; issues: {', '.join(h['issues'])}" if h["issues"] else "")
        )
    return {"portfolio_health": h}, msg, {"health_score": h["health_score"]}


@node("simulation_engine")
def simulation_engine(state):
    p = _p(state)
    t = build_twin(p)
    plan = Plan.from_dict(state["proposal"])
    sim = run(p, t, plan, n_paths=10_000, seed=42)
    gp = sim["goal_success_probability"]
    msg = (
        f"{sim['n_paths']:,} futures in {sim['elapsed_ms']:.0f} ms ({sim['regime']} regime): "
        + (f"goal success {gp:.0%}, " if gp is not None else "")
        + f"median {inr_short(sim['ending']['p50'])}, worst-5% "
        f"{inr_short(sim['ending']['p5'])}"
    )
    return (
        {
            "simulation_results": sim,
            "simulation_config": {
                "n_paths": sim["n_paths"],
                "months": sim["months"],
                "seed": sim["seed"],
                "regime": sim["regime"],
                "method": "6-month block bootstrap of NIFTY 50 + debt "
                "history, regime-scaled; parametric gold",
            },
        },
        msg,
        {"summary": sim_summary(sim)},
    )


@node("crisis_engine")
def crisis_engine_node(state):
    p = _p(state)
    t = build_twin(p)
    plan = Plan.from_dict(state["proposal"])
    cs = state.get("crisis_scenario") or {}
    prm = state.get("params") or {}
    kind = cs.get("kind") or prm.get("crisis") or "market_crash"
    c = crisis_engine.simulate_crisis(
        p,
        t,
        plan,
        kind,
        severity=float(cs.get("severity", prm.get("severity", 1.0))),
        job_loss_months=int(cs.get("job_loss_months", 6)),
        medical_cost=float(cs.get("medical_cost", 300_000)),
    )
    slim = {k: v for k, v in c.items() if k not in ("simulation", "baseline")}
    slim["percentiles_after"] = c["simulation"]["percentiles"]
    slim["percentiles_before"] = c["baseline"]["percentiles"]
    msg = (
        f"{c['label']} on the proposal: portfolio −{c['portfolio_loss_pct']:.0%}, goal "
        f"{(c['goal_probability_before'] or 0):.0%} → {(c['goal_probability_after'] or 0):.0%}"
        + (f", recovery ~{c['recovery_months']:.0f} months" if c["recovery_months"] else "")
        + f" — severity {c['severity_label']}"
    )
    return (
        {"crisis_results": slim, "crisis_scenario": {"kind": kind, **cs}},
        msg,
        {"severity": c["severity_label"]},
    )


@node("financial_committee")
def financial_committee(state):
    ctx = _ctx(state)
    comp = compliance_agent.review(ctx)
    ops = [
        bull_agent.opine(ctx),
        bear_agent.opine(ctx),
        risk_agent.opine(ctx),
        goal_agent.opine(ctx),
        comp["opinion"],
    ]
    msg = "; ".join(f"{o['agent']}: {o['stance']}" for o in ops)
    return (
        {"agent_opinions": ops, "compliance": {k: v for k, v in comp.items() if k != "opinion"}},
        msg,
        {"opinions": ops},
    )


@node("debate")
def debate_node(state):
    turns, decision = debate.run(state["agent_opinions"])
    return (
        {"debate": turns, "committee_decision": decision},
        decision["summary"],
        {"turns": turns, "decision": decision},
    )


@node("red_team")
def red_team_node(state):
    p = _p(state)
    rt = red_team.attack(p, build_twin(p), Plan.from_dict(state["proposal"]))
    return (
        {"red_team": rt, "weaknesses": rt["weaknesses"], "red_team_score": rt["red_team_score"]},
        f"{rt['headline']} — robustness {rt['red_team_score']}/100",
        {"tests": rt["tests"], "score": rt["red_team_score"]},
    )


@node("critic")
def critic_node(state):
    p = _p(state)
    gp = state["simulation_results"].get("goal_success_probability")
    retry = state.get("retry_count", 0)
    v = critic.judge(p, gp, state["red_team"], retry, state["committee_decision"])
    rounds = list(state.get("rounds") or [])
    rounds.append(
        {
            "round": len(rounds) + 1,
            "plan": state["proposal"],
            "goal_probability": gp,
            "ending_p50": state["simulation_results"]["ending"]["p50"],
            "red_team": {
                k: state["red_team"][k]
                for k in ("tests", "red_team_score", "weaknesses", "headline", "most_fragile")
            },
            "committee": state["committee_decision"],
            "opinions": state["agent_opinions"],
            "debate": state["debate"],
            "critic": v,
        }
    )
    update = {"critic_decision": v["verdict"], "critic": v, "rounds": rounds}
    if v["verdict"] == "ACCEPT" and v["forced"]:
        best = max(
            rounds, key=lambda r: (r["red_team"]["red_team_score"], r["goal_probability"] or 0)
        )
        update["proposal"] = best["plan"]
        update["recommendation_plan"] = best["plan"]
    elif v["verdict"] == "ACCEPT":
        update["recommendation_plan"] = state["proposal"]
    label = "ACCEPTED" if v["verdict"] == "ACCEPT" else "REJECTED → RE-OPTIMIZE"
    if v["verdict"] == "ACCEPT" and v["forced"]:
        label = "ACCEPTED (best available, weaknesses flagged)"
    return (
        update,
        f"{label}: " + "; ".join(v["reasons"][:2]),
        {"verdict": v["verdict"], "reasons": v["reasons"], "round": len(rounds)},
    )


def route_critic(state) -> str:
    if state["critic_decision"] == "REJECT" and state.get("retry_count", 0) < MAX_RETRIES:
        return "re_optimize"
    return "counterfactual"


@node("re_optimize")
def re_optimize(state):
    p = _p(state)
    t = build_twin(p)
    r = decision_engine.reoptimize(
        p, t, Plan.from_dict(state["proposal"]), state.get("weaknesses") or []
    )
    new = r["plan"].with_(
        label=f"Re-optimised plan #{state.get('retry_count', 0) + 1}", notes=r["changes"]
    )
    hist = list(state.get("plan_history") or []) + [new.to_dict()]
    return (
        {
            "proposal": new.to_dict(),
            "plan_history": hist,
            "retry_count": state.get("retry_count", 0) + 1,
            "reoptimization": {k: v for k, v in r.items() if k != "plan"},
        },
        f"Searched {r['searched']} candidates ({r['feasible']} within hard limits). "
        + "; ".join(r["changes"]),
        {"changes": r["changes"], "plan": new.to_dict()},
    )


@node("counterfactual")
def counterfactual(state):
    p = _p(state)
    cf = decision_engine.counterfactual(
        p, build_twin(p), Plan.from_dict(state["recommendation_plan"])
    )
    ch, hi, lo = cf["chosen"], cf["higher_risk"], cf["lower_risk"]

    def g(x):
        return "n/a" if x is None else f"{x:.0%}"

    msg = (
        f"Chosen {g(ch['goal_success_probability'])} goal success; higher risk "
        f"{g(hi['goal_success_probability'])} with {hi['crash_loss']:.0%} crash loss; lower "
        f"risk {g(lo['goal_success_probability'])}"
    )
    return {"counterfactual": cf}, msg, {}


@node("explanation")
def explanation_node(state):
    p = _p(state)
    t = build_twin(p)
    first = Plan.from_dict(state["plan_history"][0])
    final = Plan.from_dict(state["recommendation_plan"])
    comparison = {
        "before": decision_engine.plan_health(p, t, first),
        "after": decision_engine.plan_health(p, t, final),
    }
    e = explanation.build({**state, "plan_comparison": comparison})
    e["comparison"] = comparison
    return {"explanation": e}, e["summary"], {"headline": e["headline"]}


@node("trust_center")
def trust_center(state):
    from engines.simulation_engine import _tally

    tally = _tally.get() or [0, 0]
    s = loader.stats()
    rounds = state.get("rounds") or []
    last = rounds[-1] if rounds else {}
    gp = state["simulation_results"].get("goal_success_probability")
    rts = float(last.get("red_team", {}).get("red_team_score", 0) or 0)
    profile = state.get("profile") or state.get("user_profile") or {}
    sections = [
        profile.get("income"), profile.get("expenses"), profile.get("assets"),
        profile.get("liabilities"), profile.get("goals"), profile.get("risk"),
    ]
    completeness = sum(1 for x in sections if x not in (None, {}, [], "")) / len(sections)
    n_paths = int(state["simulation_results"].get("n_paths", 0) or 0)
    simulation_stability = 1.0 if n_paths >= 10_000 else 0.8 if n_paths >= 5_000 else 0.6
    goal_signal = float(gp) if gp is not None else 0.5
    unresolved = len((last.get("red_team") or {}).get("weaknesses") or [])
    risk_alignment = max(0.0, 1.0 - min(0.55, unresolved * 0.11))
    committee = state.get("committee_decision") or {}
    committee_score = float(committee.get("score", 0.5) or 0.5)
    committee_agreement = 0.5 + abs(committee_score - 0.5)
    # Market history is explicitly historical in this product,
    # so freshness is capped rather than faked.
    data_freshness = 0.45
    assumptions = 3  # gold/inflation/correlation are documented model assumptions in Trust Center.
    assumption_quality = max(0.55, 1.0 - assumptions * 0.07)
    conf = (
        0.18 * completeness +
        0.16 * simulation_stability +
        0.18 * goal_signal +
        0.16 * risk_alignment +
        0.14 * committee_agreement +
        0.08 * data_freshness +
        0.10 * assumption_quality
    )
    label = "High" if conf >= 0.76 else "Moderate" if conf >= 0.56 else "Low"
    comp = state.get("compliance") or {}
    agents_used = [
        "Supervisor",
        "Risk DNA",
        "Goal",
        "Market",
        "Portfolio",
        "Bull",
        "Bear",
        "Risk",
        "Compliance",
        "Red Team",
        "Critic",
        "Explanation",
    ]
    if state["decision_type"] == "loan":
        agents_used.insert(5, "Loan")
    trust = {
        "data_sources": [
            {
                "name": "NIFTY 50 history",
                "detail": f"{s['equity']['period']}, {s['equity']['months']} monthly total returns",
                "kind": "historical",
            },
            {
                "name": "Indian debt returns",
                "detail": "Annual returns 2000–2023",
                "kind": "historical",
            },
            {
                "name": "Gold, cash, inflation",
                "detail": "Documented parametric assumptions",
                "kind": "assumption",
            },
            {
                "name": "User inputs",
                "detail": "Your Financial Digital Twin profile",
                "kind": "user",
            },
            {
                "name": "Compliance knowledge base",
                "detail": "5 local rule documents, BM25 retrieval",
                "kind": "rag",
            },
        ],
        "market": s,
        "simulation_runs": tally[0],
        "simulated_paths": tally[1],
        "paths_per_run": 10_000,
        "agents_used": agents_used,
        "critic_review": {
            "verdict": state["critic_decision"],
            "rounds": len(rounds),
            "forced": (state.get("critic") or {}).get("forced", False),
        },
        "compliance_status": comp.get("status", "n/a"),
        "compliance_checks": comp.get("checks", []),
        "citations": comp.get("citations", []),
        "confidence": {
            "score": round(conf, 3),
            "label": label,
            "basis": (
                "Derived from data completeness, simulation stability, goal signal, "
                "unresolved risk, committee agreement, data freshness and documented assumptions."
            ),
            "signals": {
                "data_completeness": round(completeness, 3),
                "simulation_stability": round(simulation_stability, 3),
                "goal_signal": round(goal_signal, 3),
                "risk_alignment": round(risk_alignment, 3),
                "committee_agreement": round(committee_agreement, 3),
                "data_freshness": data_freshness,
                "assumption_quality": round(assumption_quality, 3),
            },
        },
        "limitations": [
            "Market history ends in December 2023; the regime is detected from that window.",
            "Gold returns, inflation and the holdings correlation model are assumptions.",
            "Taxes, fund expense ratios and exit loads are not modelled.",
            "Equity is simulated as the NIFTY 50 index; individual funds will differ.",
            "Simulated outcomes are not guaranteed predictions and should not be interpreted as "
            "regulated personalized financial advice.",
        ],
        "llm_used": (state.get("explanation") or {}).get("llm_used", False),
    }
    final = state["recommendation_plan"]
    critic_v = state.get("critic") or {}
    status = "ACCEPTED" if len(rounds) == 1 else "ACCEPTED AFTER RE-OPTIMIZATION"
    if critic_v.get("forced"):
        status = "ACCEPTED WITH FLAGGED WEAKNESSES"
    rec = {
        "status": status,
        "plan": final,
        "goal_probability": gp,
        "confidence": trust["confidence"],
        "red_team_score": rts,
        "headline": (state.get("explanation") or {}).get("headline"),
        "action": (state.get("explanation") or {}).get("action"),
    }
    msg = (
        f"{tally[1]:,} simulated paths across {tally[0]} runs; compliance "
        f"{trust['compliance_status']}; confidence {label} ({conf:.0%})"
    )
    return (
        {"trust": trust, "confidence": trust["confidence"], "recommendation": rec},
        msg,
        {"confidence": trust["confidence"]},
    )
