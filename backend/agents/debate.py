"""Committee debate — structured rebuttals between agents, then a weighted vote.

Vote weights: Risk and Compliance 1.5, others 1.0; support = 1, conditional = 0.5, oppose = 0.
Compliance opposing is a veto. Score ≥ 0.70 APPROVE · ≥ 0.45 APPROVE WITH CONDITIONS · else REJECT.
"""

from __future__ import annotations

WEIGHT = {"Risk": 1.5, "Compliance": 1.5}
VALUE = {"support": 1.0, "conditional": 0.5, "oppose": 0.0}


def run(opinions: list[dict]) -> tuple[list[dict], dict]:
    by = {o["agent"]: o for o in opinions}
    turns = []

    def say(speaker: str, to: str | None, text: str):
        turns.append({"speaker": speaker, "to": to, "text": text, "stance": by[speaker]["stance"]})

    bull, bear, risk, goal, comp = (by[k] for k in ("Bull", "Bear", "Risk", "Goal", "Compliance"))
    say("Bull", None, f"{bull['decision']}. {bull['reasoning'][0]}.")
    say("Bear", "Bull", f"{bear['key_concern']}. {bear['reasoning'][0]}.")
    if len(bull["reasoning"]) > 3:
        say(
            "Bull",
            "Bear",
            f"{bull['reasoning'][3]} — falls have been temporary for patient investors.",
        )
    else:
        say("Bull", "Bear", f"{bull['key_concern']}.")
    say("Goal", None, f"{goal['reasoning'][0]}. {goal['decision']}.")
    say("Risk", "Goal", f"{risk['key_concern']}. {risk['decision']}.")
    if goal["stance"] != "support" and risk["stance"] != "oppose":
        say(
            "Goal",
            "Risk",
            "Then the extra safety has to come from contributions, not from "
            "taking more market risk.",
        )
    say("Compliance", None, f"{comp['key_concern']}. {comp['decision']}.")

    num = sum(VALUE[o["stance"]] * WEIGHT.get(o["agent"], 1.0) for o in opinions)
    den = sum(WEIGHT.get(o["agent"], 1.0) for o in opinions)
    score = num / den
    veto = comp["stance"] == "oppose"
    if veto:
        verdict = "REJECT"
    elif score >= 0.70:
        verdict = "APPROVE"
    elif score >= 0.45:
        verdict = "APPROVE WITH CONDITIONS"
    else:
        verdict = "REJECT"
    conditions = [o["key_concern"] for o in opinions if o["stance"] != "support"]
    major_arguments = [
        f"{o['agent']}: {o['decision']}" for o in opinions if o["stance"] == "support"
    ] or [f"{o['agent']}: {o['decision']}" for o in opinions[:2]]
    confidence = round(
        sum(o["confidence"] * WEIGHT.get(o["agent"], 1.0) for o in opinions) / den, 3
    )
    decision = {
        "verdict": verdict,
        "score": round(score, 3),
        "votes": {o["agent"]: o["stance"] for o in opinions},
        "compliance_veto": veto,
        "conditions": conditions,
        "unresolved_concerns": conditions,
        "major_arguments": major_arguments,
        "confidence": confidence,
        "summary": f"Committee {verdict.lower()} ({score:.0%} weighted support"
        + (", compliance veto" if veto else "")
        + ")",
    }
    return turns, decision
