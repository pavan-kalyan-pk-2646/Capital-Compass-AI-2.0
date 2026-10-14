"""Explanation Agent — plain-language final report built from engine numbers.

An optional local/hosted LLM may rephrase the summary paragraph (agents/llm.py); the
deterministic text is always produced first and is used whenever the LLM is off or slow.
"""

from __future__ import annotations

from agents import llm
from utils.inr import inr, inr_short


def _pct(x):
    return "n/a" if x is None else f"{x:.0%}"


def build(state: dict) -> dict:
    final = state["recommendation_plan"]
    sim = state["simulation_results"]
    first = state["plan_history"][0]
    rounds = state.get("rounds", [])
    cf = state.get("counterfactual", {})
    dtype = state["decision_type"]
    gp = sim.get("goal_success_probability")
    goal = state["goal_context"]

    headline = {
        "loan": "Loan decision",
        "investment": "Investment decision",
        "goal": "Goal plan",
        "crisis": "Crisis-resilience plan",
        "spending": "Spending decision",
    }[dtype]
    w = final["weights"]
    parts = [
        f"Invest {inr(final['monthly_sip'])}/month split {w['equity']:.0%} equity, "
        f"{w['debt']:.0%} debt and {w['gold']:.0%} gold"
    ]
    if final.get("ef_topup"):
        parts.append(f"add {inr(final['ef_topup'])}/month to the emergency fund")
    if final.get("loan"):
        ln = final["loan"]
        parts.append(
            f"borrow {inr_short(ln['amount'])} over {ln['tenure_months']} months "
            f"(EMI {inr(ln['emi'])})"
        )
    if final.get("spending_cut"):
        parts.append(f"redirect {final['spending_cut']:.0%} of high-risk spending")
    action = "; ".join(parts) + "."

    reasons = []
    if gp is not None:
        reasons.append(
            f"{_pct(gp)} of 10,000 simulated futures reach "
            f"{inr_short(goal['target'])} by the deadline"
        )
    rt = rounds[-1]["red_team"] if rounds else {}
    if rt:
        passed = sum(t["status"] == "PASS" for t in rt["tests"])
        warned = sum(t["status"] == "WARN" for t in rt["tests"])
        reasons.append(
            f"Passes {passed} of {len(rt['tests'])} Red Team attacks outright"
            + (f", {warned} with warnings" if warned else "")
            + f"; every critical test holds (robustness {rt['red_team_score']}/100)"
            if not any(t["critical"] and t["status"] == "FAIL" for t in rt["tests"])
            else f"Robustness {rt['red_team_score']}/100 after the Red Team attack"
        )
    from engines.plan import crash_loss

    reasons.append(
        f"A NIFTY −30% crash costs {crash_loss(w):.1%}, inside your "
        f"{state['profile']['risk']['max_tolerated_loss_pct']:g}% limit"
        if crash_loss(w) <= state["profile"]["risk"]["max_tolerated_loss_pct"] / 100 + 1e-9
        else f"A NIFTY −30% crash costs {crash_loss(w):.1%}"
    )
    risks = [wk["detail"] for wk in (rt.get("weaknesses") or [])]

    why_not = []
    if cf:
        hi, lo, ch = cf["higher_risk"], cf["lower_risk"], cf["chosen"]
        why_not.append(
            {
                "option": f"Higher risk ({hi['plan']['weights']['equity']:.0%} equity)",
                "text": f"Goal success {_pct(hi['goal_success_probability'])} vs "
                f"{_pct(ch['goal_success_probability'])}, but a crash would cost "
                f"{hi['crash_loss']:.1%} — "
                + (
                    "beyond your limit"
                    if hi["crash_loss"] > state["profile"]["risk"]["max_tolerated_loss_pct"] / 100
                    else "with deeper drawdowns"
                )
                + f" (worst-5% drawdown "
                f"{abs(hi['max_drawdown_p95']):.0%})",
            }
        )
        why_not.append(
            {
                "option": f"Lower risk ({lo['plan']['weights']['equity']:.0%} equity)",
                "text": f"Crash loss only {lo['crash_loss']:.1%}, but goal success drops to "
                f"{_pct(lo['goal_success_probability'])} and median wealth to "
                f"{inr_short(lo['ending_p50'])}",
            }
        )
    constraints = []
    for r in rounds:
        if r["critic"]["verdict"] == "REJECT":
            constraints.extend(r["critic"]["reasons"])
    key_assumptions = [
        f"{s['assumption']}: goal success {_pct(s['goal_probability'])} "
        f"({s['impact'] * 100:+.0f} pts)"
        for s in cf.get("sensitivity", [])[:3]
    ]

    changed = len(state["plan_history"]) > 1
    summary = (
        f"{headline}: {action} "
        + (
            f"The first proposal was rejected by the Critic and re-optimised "
            f"{len(state['plan_history']) - 1} time(s). "
            if changed
            else "The first proposal passed the Critic. "
        )
        + (f"Goal success is {_pct(gp)}." if gp is not None else "")
    )
    polished, used_llm = llm.polish(summary)

    forced = bool((state.get("critic") or {}).get("forced"))
    verdict = (
        "APPROVED WITH FLAGGED RISKS"
        if forced
        else "APPROVED WITH MODIFICATIONS"
        if changed
        else "APPROVED"
    )
    first_round = rounds[0] if rounds else {}
    found = (first_round.get("red_team") or {}).get("weaknesses", [])
    last_rt = rt or {}
    fail_paths = [f"{w['question']} {w['detail']}" for w in (last_rt.get("weaknesses") or [])]
    for s_ in cf.get("sensitivity", [])[:2]:
        if s_["impact"] < -0.05:
            fail_paths.append(
                f"{s_['assumption']}: goal success would fall to {_pct(s_['goal_probability'])}"
            )
    critic_final = (state.get("critic") or {}).get("reasons", [])
    major_changes = list((state.get("reoptimization") or {}).get("changes", [])) if changed else []

    return {
        "verdict": verdict,
        "major_changes": major_changes,
        "what_could_fail": fail_paths,
        "red_team_found": found,
        "red_team_found_count": len(found),
        "most_fragile": (first_round.get("red_team") or {}).get("most_fragile"),
        "why_critic_approved": critic_final,
        "headline": headline,
        "action": action,
        "summary": polished,
        "llm_used": used_llm,
        "why_this": reasons,
        "why_not_that": why_not,
        "constraints_that_changed_it": constraints,
        "key_assumptions": key_assumptions,
        "risks": risks,
        "old_vs_new": {
            "changed": changed,
            "before": first,
            "after": final,
        },
    }
