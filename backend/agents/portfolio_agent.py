"""Portfolio Agent — health of the proposed (or uploaded) portfolio."""

from __future__ import annotations

from engines.plan import crash_loss


def proposal_health(plan: dict, max_loss: float, age: int) -> dict:
    w = plan["weights"]
    cap = min(0.85, (100 - age) / 100 + 0.10)
    classes = sum(1 for v in w.values() if v > 0.02)
    cl = crash_loss(w)
    issues = []
    if classes < 3:
        issues.append("Fewer than three asset classes")
    if w["equity"] > cap:
        issues.append(f"Equity {w['equity']:.0%} above age cap {cap:.0%}")
    if cl > max_loss:
        issues.append(f"Crash loss {cl:.1%} exceeds the {max_loss:.0%} limit")
    score = max(0, 100 - 20 * len(issues))
    return {
        "source": "proposal",
        "health_score": score,
        "asset_classes": classes,
        "crash_loss": round(cl, 4),
        "equity_cap": round(cap, 2),
        "issues": issues,
    }
