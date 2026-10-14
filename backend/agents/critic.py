"""Critic — accepts the plan or sends it back for re-optimisation (max 2 retries)."""

from __future__ import annotations

from engines import decision_engine
from graph.state import MAX_RETRIES


def judge(
    profile, base_goal_probability, red_team: dict, retry_count: int, committee: dict
) -> dict:
    reasons = decision_engine.critic_rules(profile, base_goal_probability, red_team)
    if committee.get("compliance_veto") and not any("Crash test" in r for r in reasons):
        reasons.append("Compliance vetoed the committee decision")
    if not reasons:
        return {
            "verdict": "ACCEPT",
            "outcome": "APPROVED",
            "forced": False,
            "reasons": [
                "All critical tests pass",
                f"Robustness {red_team['red_team_score']}/100",
                "Goal bar met"
                if base_goal_probability is None or base_goal_probability >= 0.5
                else "No high-priority goal at stake",
            ],
        }
    if retry_count >= MAX_RETRIES:
        return {
            "verdict": "ACCEPT",
            "outcome": "APPROVED WITH FLAGGED RISKS",
            "forced": True,
            "reasons": reasons
            + [
                f"Retry budget ({MAX_RETRIES}) spent — accepting the best plan found and flagging "
                "these weaknesses"
            ],
        }
    return {
        "verdict": "REJECT",
        "outcome": "REJECTED — RE-OPTIMIZATION REQUIRED",
        "forced": False,
        "reasons": reasons,
    }
