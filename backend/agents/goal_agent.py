"""Goal Agent — goal feasibility before the decision and the committee's goal check."""

from __future__ import annotations

from agents.common import opinion, pct
from utils.inr import inr, inr_short


def feasibility(goal: dict, affordable_sip: float) -> str:
    if not goal.get("target"):
        return "No goal set — plans are judged on wealth and resilience"
    req = goal["required_monthly_sip"]
    verdict = "within" if req <= affordable_sip else "above"
    return (
        f"{goal['name']}: {inr_short(goal['target'])} in {goal['months'] // 12} years needs "
        f"{inr(req)}/mo at the plan rate — {verdict} the {inr(affordable_sip)}/mo you can "
        "afford"
    )


def opine(ctx: dict) -> dict:
    gp = ctx["goal_probability"]
    goal = ctx["goal"]
    if gp is None:
        return opinion(
            "Goal",
            "Goal keeper",
            "support",
            0.6,
            "No target to test",
            ["Plan judged on resilience; add a goal to measure success"],
            "Support",
        )
    reasons = [
        f"{goal['name']}: {pct(gp)} of 10,000 futures reach {inr_short(goal['target'])}",
        f"Monthly investment {inr(ctx['plan']['monthly_sip'])} vs "
        f"{inr(goal['required_monthly_sip'])} required at the plan rate",
    ]
    if ctx.get("goal_probability_before") is not None:
        reasons.append(
            f"Before this decision the goal stood at {pct(ctx['goal_probability_before'])}"
        )
    if gp >= 0.7:
        return opinion(
            "Goal",
            "Goal keeper",
            "support",
            gp,
            "Goal is on track",
            reasons,
            f"Support: {pct(gp)} success",
        )
    if gp >= 0.5:
        return opinion(
            "Goal",
            "Goal keeper",
            "conditional",
            gp,
            f"Goal success {pct(gp)} is a coin-flip-plus",
            reasons,
            "Approve only with a higher SIP or a longer deadline",
        )
    return opinion(
        "Goal",
        "Goal keeper",
        "oppose",
        1 - gp,
        f"Goal success falls to {pct(gp)}",
        reasons,
        "Oppose: this decision puts the goal out of reach",
    )
