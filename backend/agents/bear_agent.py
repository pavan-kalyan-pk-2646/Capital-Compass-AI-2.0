"""Bear Agent — argues the downside case from crash, drawdown and crisis numbers."""

from __future__ import annotations

from agents.common import opinion, pct
from utils.inr import inr_short


def opine(ctx: dict) -> dict:
    limit = ctx["max_loss"]
    cl = ctx["crash_loss"]
    dd = ctx["max_drawdown_p95"]
    crisis = ctx.get("crisis") or {}
    reasons = [
        f"A NIFTY −30% shock costs {cl:.1%} instantly (limit {limit:.0%})",
        f"In the worst 5% of futures the portfolio falls {abs(dd):.0%} from its peak",
        f"Worst 5% ending wealth: {inr_short(ctx['ending_p5'])}",
    ]
    if crisis:
        reasons.append(
            f"{crisis['label']}: goal success {pct(crisis.get('goal_probability_before'))} → "
            f"{pct(crisis.get('goal_probability_after'))}"
        )
    if ctx.get("prob_loss_beyond_limit") is not None:
        reasons.append(
            f"{ctx['prob_loss_beyond_limit']:.0%} of futures see a drawdown deeper "
            "than your stated limit at some point"
        )
    if cl > limit + 1e-9:
        return opinion(
            "Bear",
            "Downside sceptic",
            "oppose",
            0.8,
            f"Crash loss {cl:.1%} breaks your {limit:.0%} loss limit",
            reasons,
            "Oppose: equity exposure is too high for the stated loss limit",
        )
    drop = (crisis.get("goal_probability_before") or 0) - (
        crisis.get("goal_probability_after") or 0
    )
    if drop > 0.25:
        return opinion(
            "Bear",
            "Downside sceptic",
            "conditional",
            0.65,
            f"A {crisis.get('label', 'crisis').lower()} removes {drop:.0%} of goal probability",
            reasons,
            "Proceed only with a bigger cash buffer",
        )
    return opinion(
        "Bear",
        "Downside sceptic",
        "conditional" if dd < -0.25 else "support",
        0.6,
        "Drawdowns are survivable but will be uncomfortable"
        if dd < -0.25
        else "Downside stays inside your limits",
        reasons,
        "Accept, provided SIPs continue through falls",
    )
