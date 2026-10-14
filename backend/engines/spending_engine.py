"""High-Risk Spending / Betting Risk Analyzer — financial consequences only.

This engine never recommends platforms, strategies or odds and never predicts outcomes.
It treats high-risk spending (betting, speculative punts) as an expense and measures:

  share of income       = spend / income
  annual cost           = spend · 12
  5-year opportunity    = FV of the same amount invested monthly at the plan's expected return
  cash-flow impact      = surplus with vs without the spend
  emergency-fund impact = months to rebuild a 6-month fund with vs without
  goal impact           = goal probability (10,000 paths) with the spend vs redirected
Risk level: share < 5% LOW · < 10% ELEVATED · < 20% HIGH · else CRITICAL
            (raised one level if surplus is negative)
"""

from __future__ import annotations

from engines.digital_twin import Twin
from engines.finance_math import fv_annuity
from engines.plan import Plan, run
from engines.portfolio_engine import expected_return, plan_sip
from schemas.profile import ProfileInput
from utils.inr import inr, inr_short

LEVELS = ["LOW", "ELEVATED", "HIGH", "CRITICAL"]


def analyze(
    p: ProfileInput, twin: Twin, plan: Plan, monthly_spend: float | None = None, seed: int = 42
) -> dict:
    spend = float(p.behaviour.high_risk_spending if monthly_spend is None else monthly_spend)
    if monthly_spend is not None and monthly_spend != p.behaviour.high_risk_spending:
        p = p.model_copy(
            update={
                "behaviour": p.behaviour.model_copy(
                    update={"high_risk_spending": int(monthly_spend)}
                )
            }
        )
        from engines.digital_twin import build_twin

        twin = build_twin(p)
    income = twin.monthly_income
    share = spend / income if income > 0 else 1.0
    level = 0 if share < 0.05 else 1 if share < 0.10 else 2 if share < 0.20 else 3
    if twin.monthly_surplus < 0:
        level = min(3, level + 1)

    rate = expected_return(plan.weights)
    opportunity = fv_annuity(spend, rate, 60)

    sip_with, _, _, _ = plan_sip(p, twin, plan.weights)
    sip_without, _, _, _ = plan_sip(p, twin, plan.weights, freed=spend)
    with_spend = plan.with_(monthly_sip=sip_with, spending_cut=0.0, label="Current spending")
    redirected = plan.with_(monthly_sip=sip_without, spending_cut=1.0, label="Spending redirected")
    half = plan_sip(p, twin, plan.weights, freed=spend * 0.5)[0]
    halved = plan.with_(monthly_sip=half, spending_cut=0.5, label="Spending halved")
    sim_with = run(p, twin, with_spend, seed=seed)
    sim_half = run(p, twin, halved, seed=seed)
    sim_without = run(p, twin, redirected, seed=seed)

    ef_target = 6 * (twin.essential_expenses + twin.monthly_emi)
    gap = max(0.0, ef_target - float(p.assets.cash))
    months_with = gap / twin.monthly_surplus if twin.monthly_surplus > 0 else None
    months_without = (
        gap / (twin.monthly_surplus + spend) if twin.monthly_surplus + spend > 0 else None
    )

    adjustment = [
        {
            "month": "Month 1–2",
            "action": f"Set a hard cap at {inr(spend * 0.5)}/mo and move "
            f"{inr(spend * 0.5)} to an automatic SIP on payday",
        },
        {
            "month": "Month 3–4",
            "action": f"Lower the cap to {inr(spend * 0.25)}/mo; redirect "
            "the difference to the emergency fund",
        },
        {
            "month": "Month 5+",
            "action": "Redirect the full amount to the goal SIP; review the "
            "trend monthly on this dashboard",
        },
    ]
    alerts = []
    if share >= 0.10:
        alerts.append(f"{share:.0%} of income goes to high-risk spending")
    if (sim_with["goal_success_probability"] or 0) + 0.10 < (
        sim_without["goal_success_probability"] or 0
    ):
        alerts.append(
            f"Goal probability is {sim_with['goal_success_probability']:.0%} with this spending "
            f"vs {sim_without['goal_success_probability']:.0%} if it were invested"
        )
    if twin.monthly_surplus < 0:
        alerts.append("Monthly cash flow is negative — this spending is being funded by savings")

    return {
        "monthly_spend": round(spend),
        "share_of_income": round(share, 4),
        "annual_cost": round(spend * 12),
        "five_year_opportunity_cost": round(opportunity),
        "opportunity_text": f"{inr_short(opportunity)} if invested instead for 5 years",
        "risk_level": LEVELS[level],
        "surplus_with": round(twin.monthly_surplus),
        "surplus_without": round(twin.monthly_surplus + spend),
        "ef_rebuild_months_with": None if months_with is None else round(months_with, 1),
        "ef_rebuild_months_without": None if months_without is None else round(months_without, 1),
        "goal_probability_with": sim_with["goal_success_probability"],
        "goal_probability_halved": sim_half["goal_success_probability"],
        "goal_probability_redirected": sim_without["goal_success_probability"],
        "ending_p50_with": sim_with["ending"]["p50"],
        "ending_p50_redirected": sim_without["ending"]["p50"],
        "alerts": alerts,
        "budget_adjustment": adjustment,
        "scope_note": "Consequence analysis only. Capital Compass does not recommend betting "
        "platforms or strategies and does not predict outcomes.",
        "support_note": "If spending feels hard to control, talking to someone you trust or a "
        "counsellor can help.",
        "plans": {
            "with": with_spend.to_dict(),
            "halved": halved.to_dict(),
            "redirected": redirected.to_dict(),
        },
    }
