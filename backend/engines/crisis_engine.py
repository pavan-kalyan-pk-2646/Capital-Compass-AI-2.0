"""Crisis War Room — apply a shock to the Digital Twin and measure what breaks.

Scenarios (severity s scales every shock linearly, 0.5–2.0):
  market_crash       NIFTY −30%·s instantly (gold +5%, debt flat)
  job_loss           salary stops for N·s months; spending falls to essentials + EMIs
  inflation_spike    inflation +5%·s for the whole horizon; the goal cost rises by the excess
                     inflation and purchasing power falls by the same factor
  rate_hike          floating-rate EMIs re-priced at +2.5%·s for their remaining tenure
  medical_emergency  one-off bill (₹3 L·s by default) paid from cash, then investments
  crash_job_loss     market_crash + job_loss together

Measured: portfolio impact (₹ and %), per-asset impact, goal probability before/after
(10,000 paths, same seed), emergency-fund survival months, EMI affordability, real purchasing
power, recovery time (median months for the portfolio NAV to regain its pre-crisis peak),
liquidity before/after and a severity label. Responses are rule-based from those numbers.
"""

from __future__ import annotations

from engines.digital_twin import Twin
from engines.finance_math import emi
from engines.plan import Plan, crash_loss, run
from engines.simulation_engine import Crash
from schemas.profile import ProfileInput
from utils.inr import inr

KINDS = {
    "market_crash": "Market crash",
    "job_loss": "Job loss",
    "inflation_spike": "Inflation spike",
    "rate_hike": "Interest-rate shock",
    "medical_emergency": "Medical emergency",
    "crash_job_loss": "Crash + income loss",
}


def _rate_shock_emi(p: ProfileInput, bump_pct: float, plan: Plan) -> tuple[float, float]:
    """(old total EMI, new total EMI) when floating loans + any new loan re-price."""
    old = new = 0.0
    for li in p.liabilities:
        old += li.emi
        if li.floating_rate and li.remaining_months > 0 and li.outstanding > 0:
            new += emi(li.outstanding, li.annual_rate_pct + bump_pct, li.remaining_months)
        else:
            new += li.emi
    if plan.loan:
        old += plan.loan.emi
        new += emi(plan.loan.amount, plan.loan.annual_rate_pct + bump_pct, plan.loan.tenure_months)
    return old, new


def simulate_crisis(
    p: ProfileInput,
    twin: Twin,
    plan: Plan,
    kind: str,
    *,
    severity: float = 1.0,
    job_loss_months: int = 6,
    medical_cost: float = 300_000,
    seed: int = 42,
) -> dict:
    if kind not in KINDS:
        raise ValueError(f"Unknown crisis scenario: {kind}")
    s = max(0.25, min(severity, 3.0))
    overrides: dict = {}
    port_before = float(p.assets.equity + p.assets.debt + p.assets.gold)
    impacts = {"equity": 0.0, "debt": 0.0, "gold": 0.0}
    loan_emi = plan.loan.emi if plan.loan else 0.0
    burn = twin.essential_expenses + twin.monthly_emi + loan_emi
    cash = float(p.assets.cash)
    months_jobless = 0
    emi_after = twin.monthly_emi + loan_emi
    one_off = 0.0
    real_power = None

    if kind in ("market_crash", "crash_job_loss"):
        drop = -0.30 * s
        overrides["crash"] = Crash(equity_drop=drop, gold_change=0.05)
        impacts = {
            "equity": round(p.assets.equity * drop),
            "debt": 0,
            "gold": round(p.assets.gold * 0.05),
        }
    if kind in ("job_loss", "crash_job_loss"):
        months_jobless = max(1, round(job_loss_months * s))
        overrides["job_loss_months"] = months_jobless
    if kind == "inflation_spike":
        from engines.decision_engine import excess_inflation_multiplier
        from engines.plan import goal_context

        gc = goal_context(p, twin)
        mult = excess_inflation_multiplier(5.0 * s, gc["months"])
        overrides["inflation_pct"] = 5.5 + 5.0 * s
        if gc["target"]:
            overrides["target"] = gc["target"] * mult
        real_power = round(1 / mult, 4)
    if kind == "rate_hike":
        old, new = _rate_shock_emi(p, 2.5 * s, plan)
        emi_after = twin.monthly_emi + loan_emi + (new - old)
        overrides["monthly_emi"] = emi_after
        burn = twin.essential_expenses + emi_after
    if kind == "medical_emergency":
        one_off = medical_cost * s
        overrides["one_off_expense"] = one_off
        overrides["one_off_month"] = 0

    base = run(p, twin, plan, seed=seed)
    gp_before = base["goal_success_probability"]
    target_override = overrides.pop("target", ...)
    shocked = run(p, twin, plan, seed=seed, target=target_override, **overrides)

    port_after = port_before + sum(impacts.values())
    if kind == "medical_emergency":
        from_cash = min(cash, one_off)
        from_port = one_off - from_cash
        cash_after = cash - from_cash
        port_after = port_before - from_port
    else:
        cash_after = cash
    ef_survival = cash_after / burn if burn > 0 else 99.0
    income = twin.monthly_income
    emi_ok = (emi_after / income <= 0.5) if income > 0 else False
    liquidity_before = cash + float(p.assets.debt)
    liquidity_after = cash_after + float(p.assets.debt)

    # Recovery: median months for NAV to regain its peak after the shock
    rec = shocked["recovery_months_median"]
    if kind not in ("market_crash", "crash_job_loss"):
        rec = None

    loss_pct = (port_before - port_after) / port_before if port_before > 0 else 0.0
    gp_after = shocked["goal_success_probability"]
    drop = (gp_before or 0) - (gp_after or 0)
    severity_label = "LOW"
    if drop > 0.10 or ef_survival < 6:
        severity_label = "MODERATE"
    if drop > 0.25 or ef_survival < 3 or loss_pct > p.risk.max_tolerated_loss_pct / 100:
        severity_label = "HIGH"
    if drop > 0.50 or ef_survival < 1.5 or shocked["forced_liquidation_probability"] > 0.5:
        severity_label = "SEVERE"

    responses: list[str] = []
    if kind in ("market_crash", "crash_job_loss"):
        responses.append("Do not sell equity into the fall; keep SIPs running if income allows")
        if loss_pct > p.risk.max_tolerated_loss_pct / 100:
            responses.append(
                f"Portfolio fell {loss_pct:.0%}, beyond your {p.risk.max_tolerated_loss_pct:g}% "
                f"limit — lower equity to ≤{crash_loss_cap(p):.0%} when rebalancing"
            )
    if months_jobless:
        responses.append(
            f"Cut to essentials: {inr(burn)}/mo burn covers {ef_survival:.1f} months from cash"
        )
        if ef_survival < months_jobless:
            responses.append(
                "Emergency fund runs out before income returns — build it to "
                f"{months_jobless} months of essentials + EMIs"
            )
    if kind == "rate_hike":
        responses.append(
            f"EMIs rise to {inr(emi_after)}/mo — consider prepaying the costliest "
            "floating loan or extending tenure"
        )
    if kind == "inflation_spike":
        responses.append(
            "Raise the SIP annually with inflation (step-up SIP) to protect the "
            "real value of the goal"
        )
    if kind == "medical_emergency":
        responses.append(
            "Health insurance with adequate cover limits this shock; keep the "
            "emergency fund separate from goal money"
        )
    if shocked["forced_liquidation_probability"] > 0.25:
        responses.append(
            f"Forced selling of investments in {shocked['forced_liquidation_probability']:.0%} "
            "of futures — liquidity is the weak point"
        )

    return {
        "scenario": kind,
        "label": KINDS[kind],
        "severity": s,
        "severity_label": severity_label,
        "portfolio_before": round(port_before),
        "portfolio_after": round(port_after),
        "portfolio_loss_pct": round(loss_pct, 4),
        "asset_impacts": impacts,
        "goal_probability_before": gp_before,
        "goal_probability_after": gp_after,
        "emergency_fund_survival_months": round(ef_survival, 1),
        "job_loss_months": months_jobless,
        "monthly_burn": round(burn),
        "emi_before": round(twin.monthly_emi + loan_emi),
        "emi_after": round(emi_after),
        "emi_affordable": emi_ok,
        "real_purchasing_power": real_power,
        "recovery_months": rec,
        "liquidity_before": round(liquidity_before),
        "liquidity_after": round(liquidity_after),
        "forced_liquidation_probability": shocked["forced_liquidation_probability"],
        "ending_p50_before": base["ending"]["p50"],
        "ending_p50_after": shocked["ending"]["p50"],
        "recommended_response": responses,
        "simulation": shocked,
        "baseline": base,
    }


def crash_loss_cap(p: ProfileInput) -> float:
    """Highest equity weight whose −30% crash loss stays inside the user's limit."""
    limit = p.risk.max_tolerated_loss_pct / 100
    for eq in [x / 100 for x in range(90, 4, -1)]:
        gold = 0.05 if eq < 0.30 else 0.10
        w = {"equity": eq, "debt": 1 - eq - gold, "gold": gold}
        if crash_loss(w) <= limit + 1e-9:
            return eq
    return 0.05
