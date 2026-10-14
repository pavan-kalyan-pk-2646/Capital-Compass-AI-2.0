"""Loan Decision Simulator — affordability and consequences. Never submits applications.

Repayment
  EMI = P·r·(1+r)^n / ((1+r)^n − 1);  total interest = EMI·n − P;  fee = P · fee%
  total repayment = EMI·n + fee

Affordability
  FOIR (all EMIs / income) before and after; surplus after EMI
  Emergency-fund months after = cash / (essential + all EMIs)

Debt Stress Score (0–100, higher = more stress)
  = 0.45 · clamp(FOIR_after / 0.50 · 100)
  + 0.30 · clamp((6 − EF_months_after) / 6 · 100)
  + 0.25 · clamp((1 − (surplus_after / income) / 0.30) · 100)
Risk band: <35 LOW · <55 MODERATE · <72 MODERATE-HIGH · else HIGH (FOIR > 50 % → HIGH)

Stress tests
  normal          surplus and EF cover with today's income
  income −30 %    surplus; if negative, months until the emergency fund runs out
  job loss        months the emergency fund covers essentials + all EMIs
  loan+goal+crisis  goal probability with the loan, a NIFTY −30 % crash and income −30 %
Goal impact: goal success probability without vs with the loan, the SIP falling to what the
post-EMI surplus can afford. Resilience change: Risk-DNA Financial Resilience before vs after.
"""

from __future__ import annotations

from engines.digital_twin import Twin, build_twin
from engines.finance_math import clamp, emi
from engines.plan import LoanTerms, Plan, run
from engines.portfolio_engine import plan_sip
from engines.risk_engine import compute_risk_dna
from engines.simulation_engine import Crash
from schemas.profile import ProfileInput
from utils.inr import inr, inr_short

TYPICAL_RATES = {"personal": 14.0, "education": 10.0, "home": 8.75, "vehicle": 9.5}
FOIR_CEILING = 0.50
FOIR_COMFORT = 0.40


def stress_score(foir: float, ef_months: float, surplus: float, income: float) -> float:
    sr = surplus / income if income > 0 else -1
    return round(
        0.45 * clamp(foir / FOIR_CEILING * 100)
        + 0.30 * clamp((6 - ef_months) / 6 * 100)
        + 0.25 * clamp((1 - sr / 0.30) * 100),
        1,
    )


def band(score: float, foir: float) -> str:
    if foir > FOIR_CEILING or score >= 72:
        return "HIGH"
    if score >= 55:
        return "MODERATE-HIGH"
    if score >= 35:
        return "MODERATE"
    return "LOW"


def amortization(loan: LoanTerms) -> list[dict]:
    r = loan.annual_rate_pct / 1200
    bal = loan.amount
    e = loan.emi
    rows, yi, yp = [], 0.0, 0.0
    for m in range(1, loan.tenure_months + 1):
        interest = bal * r
        principal = e - interest
        bal = max(0.0, bal - principal)
        yi += interest
        yp += principal
        if m % 12 == 0 or m == loan.tenure_months:
            rows.append(
                {
                    "year": (m - 1) // 12 + 1,
                    "interest": round(yi),
                    "principal": round(yp),
                    "balance": round(bal),
                }
            )
            yi = yp = 0.0
    return rows


def max_affordable_amount(twin: Twin, loan: LoanTerms, foir_target: float = FOIR_COMFORT) -> float:
    room = foir_target * twin.monthly_income - twin.monthly_emi
    if room <= 0:
        return 0.0
    unit = emi(1.0, loan.annual_rate_pct, loan.tenure_months)
    return room / unit


def tenure_for_foir(twin: Twin, loan: LoanTerms, foir_target: float = FOIR_COMFORT) -> int | None:
    for n in range(12, 361, 6):
        if (twin.monthly_emi + emi(loan.amount, loan.annual_rate_pct, n)) / max(
            twin.monthly_income, 1
        ) <= foir_target:
            return n
    return None


def analyze(p: ProfileInput, twin: Twin, base_plan: Plan, loan: LoanTerms, seed: int = 42) -> dict:
    e = loan.emi
    after = build_twin(p, extra_monthly_emi=e, extra_liability=loan.amount)
    foir_before, foir_after = twin.dti, after.dti
    score = stress_score(
        foir_after, after.emergency_fund_months, after.monthly_surplus, after.monthly_income
    )
    risk_band = band(score, foir_after)

    # Goal impact — same allocation, SIP limited to what the post-EMI surplus allows
    sip_after, ef_after, _, _ = plan_sip(p, twin, base_plan.weights, extra_emi=e)
    sip_after = min(base_plan.monthly_sip, sip_after)
    with_loan = base_plan.with_(
        monthly_sip=sip_after,
        ef_topup=ef_after,
        loan=loan,
        label="Plan with loan",
        notes=[
            f"Same allocation; investment limited to what the "
            f"post-EMI surplus affords ({inr(sip_after)}/mo)"
        ],
    )
    sim_before = run(p, twin, base_plan, seed=seed)
    sim_after = run(p, twin, with_loan, seed=seed)
    gp_before = sim_before["goal_success_probability"]
    gp_after = sim_after["goal_success_probability"]

    res_before = compute_risk_dna(p, twin).score("financial_resilience")
    res_after = compute_risk_dna(p, after).score("financial_resilience")

    # Stress tests
    low = build_twin(p, extra_monthly_emi=e, income_multiplier=0.7)
    cash = float(p.assets.cash)
    burn = -low.monthly_surplus
    low_months = None if burn <= 0 else round(cash / burn, 1)
    crisis = run(p, twin, with_loan, seed=seed, crash=Crash(), income_change_pct=-30)
    tests = [
        {
            "scenario": "normal",
            "label": "Normal income",
            "monthly_surplus": round(after.monthly_surplus),
            "emergency_fund_months": round(after.emergency_fund_months, 1),
            "passed": after.monthly_surplus > 0 and foir_after <= FOIR_CEILING,
            "detail": f"Surplus after all EMIs {inr(after.monthly_surplus)}/mo, "
            f"FOIR {foir_after:.0%}",
        },
        {
            "scenario": "income_minus_30",
            "label": "Income −30%",
            "monthly_surplus": round(low.monthly_surplus),
            "emergency_fund_months": low_months,
            "passed": low.monthly_surplus >= 0,
            "detail": (
                f"Still saves {inr(low.monthly_surplus)}/mo"
                if low.monthly_surplus >= 0
                else f"Shortfall {inr(burn)}/mo; emergency fund lasts {low_months} months"
            ),
        },
        {
            "scenario": "job_loss",
            "label": "Job loss",
            "monthly_surplus": round(-(after.essential_expenses + after.monthly_emi)),
            "monthly_burn": round(after.essential_expenses + after.monthly_emi),
            "emergency_fund_months": round(after.emergency_fund_months, 1),
            "passed": after.emergency_fund_months >= 4,
            "detail": f"Emergency fund covers essentials + EMIs for "
            f"{after.emergency_fund_months:.1f} months (minimum 4, target 6)",
        },
        {
            "scenario": "loan_goal_crisis",
            "label": "Loan + goal + crisis",
            "monthly_surplus": round(low.monthly_surplus),
            "emergency_fund_months": None,
            "goal_success_probability": crisis["goal_success_probability"],
            "forced_liquidation_probability": crisis["forced_liquidation_probability"],
            "passed": (crisis["goal_success_probability"] or 0) >= 0.30
            and crisis["forced_liquidation_probability"] < 0.25,
            "detail": f"NIFTY −30% and income −30%: goal probability "
            f"{(crisis['goal_success_probability'] or 0):.0%}, forced selling in "
            f"{crisis['forced_liquidation_probability']:.0%} of futures",
        },
    ]

    concerns = []
    if sip_after < base_plan.monthly_sip - 1:
        concerns.append(
            f"EMI cuts the monthly investment from {inr(base_plan.monthly_sip)} to {inr(sip_after)}"
        )
    if gp_before is not None and gp_after is not None and gp_after < gp_before - 0.05:
        concerns.append(f"Goal probability falls from {gp_before:.0%} to {gp_after:.0%}")
    if after.emergency_fund_months < 6:
        concerns.append(
            f"Emergency fund covers only {after.emergency_fund_months:.1f} months "
            "of essentials + EMIs"
        )
    if foir_after > FOIR_COMFORT:
        concerns.append(f"FOIR {foir_after:.0%} is above the 40% comfort level")
    if not tests[1]["passed"]:
        concerns.append("A 30% income cut would make monthly cash flow negative")

    alt_tenure = tenure_for_foir(twin, loan)
    max_amt = max_affordable_amount(twin, loan)
    safer = []
    if foir_after > FOIR_COMFORT and alt_tenure and alt_tenure != loan.tenure_months:
        safer.append(f"Stretch tenure to {alt_tenure} months to bring FOIR under 40%")
    if max_amt < loan.amount:
        safer.append(f"Borrow up to {inr_short(max_amt)} to stay under 40% FOIR at this rate")
    if gp_after is not None and gp_before is not None and gp_after < gp_before - 0.10:
        safer.append(
            f"Defer or shrink the loan: it costs {gp_before - gp_after:.0%} of goal probability"
        )

    # Verdict: affordability band, downgraded by goal damage and failed stress tests
    level = {"LOW": 0, "MODERATE": 1, "MODERATE-HIGH": 2, "HIGH": 3}[risk_band]
    goal_drop = (gp_before or 0) - (gp_after or 0) if gp_before is not None else 0
    if goal_drop > 0.25:
        level = max(level, 2)
    if goal_drop > 0.50:
        level = max(level, 3)
    failed = sum(not t["passed"] for t in tests)
    if failed >= 2:
        level = max(level, 2)
    verdict = ["AFFORDABLE", "AFFORDABLE WITH CAUTION", "RECONSIDER", "NOT ADVISABLE"][level]

    return {
        "loan": loan.to_dict(),
        "emi": round(e, 2),
        "total_interest": round(loan.total_interest, 2),
        "processing_fee": round(loan.fee, 2),
        "total_repayment": round(e * loan.tenure_months + loan.fee, 2),
        "foir_before": round(foir_before, 4),
        "foir_after": round(foir_after, 4),
        "surplus_before": round(twin.monthly_surplus),
        "surplus_after": round(after.monthly_surplus),
        "liquidity_impact": {
            "monthly_cash_flow_change": round(-e),
            "fee_paid": round(loan.fee),
        },
        "emergency_fund_months_before": round(twin.emergency_fund_months, 2),
        "emergency_fund_months_after": round(after.emergency_fund_months, 2),
        "debt_stress_score": score,
        "risk_band": risk_band,
        "goal_probability_before": gp_before,
        "goal_probability_after": gp_after,
        "sip_before": round(base_plan.monthly_sip),
        "sip_after": round(sip_after),
        "resilience_before": res_before,
        "resilience_after": res_after,
        "stress_tests": tests,
        "concerns": concerns,
        "safer_alternatives": safer,
        "max_affordable_amount": round(max_amt),
        "recommendation": verdict,
        "amortization": amortization(loan),
        "simulation_before": sim_before,
        "simulation_after": sim_after,
        "plan_with_loan": with_loan.to_dict(),
    }
