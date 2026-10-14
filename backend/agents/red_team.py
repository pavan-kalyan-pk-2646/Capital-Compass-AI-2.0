"""Red Team — tries to prove the recommendation wrong. Tests run in engines/decision_engine."""

from __future__ import annotations

from engines import decision_engine


def attack(profile, twin, plan, seed: int = 42) -> dict:
    rt = decision_engine.red_team(profile, twin, plan, seed=seed)
    fails = [t for t in rt["tests"] if t["status"] == "FAIL"]
    warns = [t for t in rt["tests"] if t["status"] == "WARN"]
    if fails:
        headline = f"Red Team broke the plan on {len(fails)} test(s): " + ", ".join(
            t["name"] for t in fails
        )
    elif warns:
        headline = f"Plan survived every attack with {len(warns)} warning(s)"
    else:
        headline = f"Plan survived all {len(rt['tests'])} attacks"
    return {**rt, "headline": headline}
