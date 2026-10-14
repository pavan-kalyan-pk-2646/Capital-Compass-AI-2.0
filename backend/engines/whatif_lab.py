"""What-If Lab: change a few numbers without touching the saved twin.

`apply_changes` returns a modified copy of the profile and plan:
    income            → take-home salary (other income unchanged)
    expenses          → essential + discretionary scaled together; high-risk spend unchanged
    emergency_fund    → cash
    sip               → the plan's monthly investment
    equity            → the plan's equity weight, with gold/debt from `weights_for`
    loan_amount/rate  → a new personal loan over 60 months (EMI by the standard formula)

`preview` is arithmetic only, cheap enough to run while a slider moves:
    surplus after plan = income − expenses − EMIs − new EMI − SIP
    FOIR               = (EMIs + new EMI) / income
    emergency cover    = cash / (essential + EMIs + new EMI)
    goal corpus        = FV(start corpus) + FV(SIP annuity) at the allocation's expected return
                         (deterministic: no volatility, so it is a reference line, not a forecast)
    crash loss         = instant loss of the allocation in a NIFTY −30% shock

`simulate` runs the full 10,000-path Monte Carlo on the modified plan.
"""

from __future__ import annotations

from engines.digital_twin import build_twin
from engines.finance_math import fv_annuity, fv_lump_sum
from engines.plan import LoanTerms, Plan, crash_loss, goal_context, run
from engines.portfolio_engine import expected_return, weights_for
from schemas.profile import ProfileInput

LOAN_TENURE_MONTHS = 60


def current_values(p: ProfileInput, plan: Plan) -> dict:
    twin = build_twin(p)
    return {
        "income": round(float(p.monthly_income)),
        "expenses": round(twin.monthly_expenses),
        "sip": round(plan.monthly_sip),
        "loan_amount": round(plan.loan.amount) if plan.loan else 0,
        "loan_rate": plan.loan.annual_rate_pct if plan.loan else 14.0,
        "equity": round(plan.equity, 2),
        "emergency_fund": round(float(p.assets.cash)),
    }


def apply_changes(p: ProfileInput, plan: Plan, ch: dict) -> tuple[ProfileInput, Plan]:
    q = p.model_copy(deep=True)
    if "income" in ch:
        q.monthly_income = ch["income"]
    if "expenses" in ch:
        flexible = float(q.essential_expenses + q.discretionary_expenses)
        target = max(0.0, ch["expenses"] - float(q.behaviour.high_risk_spending))
        k = target / flexible if flexible > 0 else 0.0
        if flexible > 0:
            q.essential_expenses = round(float(q.essential_expenses) * k, 2)
            q.discretionary_expenses = round(float(q.discretionary_expenses) * k, 2)
        else:
            q.essential_expenses = target
    if "emergency_fund" in ch:
        q.assets.cash = ch["emergency_fund"]
    new = plan
    if "sip" in ch:
        new = new.with_(monthly_sip=ch["sip"])
    if "equity" in ch:
        new = new.with_(weights=weights_for(ch["equity"]))
    if "loan_amount" in ch or "loan_rate" in ch:
        amount = ch.get("loan_amount", plan.loan.amount if plan.loan else 0.0)
        rate = ch.get("loan_rate", plan.loan.annual_rate_pct if plan.loan else 14.0)
        loan = LoanTerms("personal", amount, rate, LOAN_TENURE_MONTHS) if amount > 0 else None
        new = new.with_(loan=loan)
    return q, new


def preview(p: ProfileInput, plan: Plan) -> dict:
    twin = build_twin(p)
    new_emi = plan.loan.emi if plan.loan else 0.0
    income = twin.monthly_income
    burn = twin.essential_expenses + twin.monthly_emi + new_emi
    gc = goal_context(p, twin)
    rate = expected_return(plan.weights)
    corpus = fv_lump_sum(gc["start_corpus"], rate, gc["months"]) + fv_annuity(
        plan.monthly_sip, rate, gc["months"]
    )
    return {
        "surplus_after_plan": round(twin.monthly_surplus - new_emi - plan.monthly_sip),
        "new_emi": round(new_emi),
        "foir": round((twin.monthly_emi + new_emi) / income, 4) if income > 0 else None,
        "emergency_months": round(float(p.assets.cash) / burn, 2) if burn > 0 else None,
        "goal_corpus": round(corpus),
        "goal_target": gc["target"],
        "goal_name": gc["name"],
        "goal_months": gc["months"],
        "expected_return_pct": round(rate, 2),
        "crash_loss": round(crash_loss(plan.weights), 4),
    }


def simulate(p: ProfileInput, plan: Plan) -> dict:
    twin = build_twin(p)
    sim = run(p, twin, plan)
    return {
        "n_paths": sim["n_paths"],
        "goal_success_probability": sim["goal_success_probability"],
        "ending": sim["ending"],
        "max_drawdown_p95": sim["max_drawdown"]["p95"],
        "forced_liquidation_probability": sim["forced_liquidation_probability"],
        "percentiles": sim["percentiles"],
        "target": sim["target"],
    }
