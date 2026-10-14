"""Bull Agent — argues for the growth case, using the simulated upside."""

from __future__ import annotations

from agents.common import opinion, pct
from utils.inr import inr_short


def opine(ctx: dict) -> dict:
    gp = ctx["goal_probability"]
    eq = ctx["plan"]["weights"]["equity"]
    reasons = [
        f"Median outcome {inr_short(ctx['ending_p50'])}; best 5% of futures reach "
        f"{inr_short(ctx['ending_p95'])}",
        f"Historical NIFTY 50 total return {ctx['market']['equity_cagr_pct']:.1f}%/yr over "
        f"{ctx['market']['equity_months']} months of data",
        f"Market regime is {ctx['market']['regime']} — volatility near the "
        f"{ctx['market']['regime_percentile']:.0f}th percentile of history",
    ]
    if ctx.get("recovery_months"):
        reasons.append(
            f"After a −30% crash the median recovery took "
            f"{ctx['recovery_months']:.0f} months in simulation"
        )
    if gp is None:
        stance, conf = "support", 0.6
        decision = "Support: stay invested for growth"
        concern = "Too little equity would leave compounding on the table"
    elif gp >= 0.7:
        stance, conf = "support", gp
        decision = f"Support: {pct(gp)} goal success leaves room for growth"
        concern = "Cutting equity further would trade upside for little extra safety"
    elif gp >= 0.5:
        stance, conf = "conditional", gp
        decision = "Support if the monthly investment is protected"
        concern = f"Goal success is only {pct(gp)}; growth needs steady SIPs"
    else:
        stance, conf = "conditional", 0.4
        decision = "Growth alone cannot rescue this plan"
        concern = f"Goal success {pct(gp)} — the gap is contributions, not returns"
    if eq < 0.30 and gp is not None and gp < 0.7:
        reasons.append(f"Equity at {eq:.0%} limits long-run growth")
    return opinion("Bull", "Growth advocate", stance, conf, concern, reasons, decision)
