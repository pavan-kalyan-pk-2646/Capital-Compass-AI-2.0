"""Financial Digital Twin engine.

Turns a raw ProfileInput into the `Twin` every other engine consumes. Pure, no I/O.

Definitions
-----------
monthly_income        = salary + other income
total_assets          = cash + equity + debt + gold + real_estate + other
liquid_assets         = cash + debt                (redeemable within days)
investable_assets     = equity + debt + gold       (goal corpus; cash is the emergency fund)
total_liabilities     = Σ outstanding
net_worth             = total_assets − total_liabilities
monthly_expenses      = essential + discretionary + high-risk spending
monthly_emi           = Σ liability EMIs (+ any new loan being modelled)
monthly_surplus       = income − expenses − emi
savings_rate          = surplus / income
emergency_fund_months = cash / (essential + emi)   (months of non-negotiable outflow covered)
dti                   = emi / income
liquidity_ratio       = liquid_assets / total_assets

health_score (0–100)  = 0.35·EF + 0.35·SR + 0.30·DTI, where
    EF  = min(ef_months, 6) / 6 · 100
    SR  = clamp(savings_rate / 0.30 · 100)
    DTI = clamp((1 − dti / 0.50) · 100)
health_band: ≥80 STRONG, ≥60 STABLE, ≥40 STRETCHED, else FRAGILE
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

from engines.finance_math import clamp
from schemas.profile import ProfileInput

EF_TARGET_MONTHS = 6.0
SAVINGS_RATE_TARGET = 0.30
DTI_CEILING = 0.50


@dataclass(frozen=True)
class Twin:
    total_assets: float
    liquid_assets: float
    investable_assets: float
    total_liabilities: float
    net_worth: float
    monthly_income: float
    monthly_expenses: float
    essential_expenses: float
    high_risk_spending: float
    monthly_emi: float
    monthly_surplus: float
    savings_rate: float
    emergency_fund_months: float
    dti: float
    liquidity_ratio: float
    health_score: float
    health_band: str
    sub_scores: dict

    def to_dict(self) -> dict:
        return asdict(self)


def _ratio(num: float, den: float, when_zero: float = 0.0) -> float:
    return num / den if den > 0 else when_zero


def health_band(score: float) -> str:
    if score >= 80:
        return "STRONG"
    if score >= 60:
        return "STABLE"
    if score >= 40:
        return "STRETCHED"
    return "FRAGILE"


def build_twin(
    p: ProfileInput,
    extra_monthly_emi: float = 0.0,
    extra_liability: float = 0.0,
    cash_delta: float = 0.0,
    income_multiplier: float = 1.0,
) -> Twin:
    """Build the twin. Extra arguments let other engines model a new loan or a shock."""
    a = p.assets
    cash = max(0.0, float(a.cash) + cash_delta)
    total_assets = cash + float(a.equity + a.debt + a.gold + a.real_estate + a.other)
    liquid = cash + float(a.debt)
    investable = float(a.equity + a.debt + a.gold)
    liabilities = float(sum(li.outstanding for li in p.liabilities)) + extra_liability
    emi = float(sum(li.emi for li in p.liabilities)) + extra_monthly_emi
    income = float(p.monthly_income + p.other_income) * income_multiplier
    essential = float(p.essential_expenses)
    risky = float(p.behaviour.high_risk_spending)
    expenses = essential + float(p.discretionary_expenses) + risky
    surplus = income - expenses - emi

    savings_rate = _ratio(surplus, income)
    ef_months = _ratio(cash, essential + emi, when_zero=99.0)
    dti = _ratio(emi, income, when_zero=1.0 if emi > 0 else 0.0)
    liquidity_ratio = _ratio(liquid, total_assets)

    ef_score = min(ef_months, EF_TARGET_MONTHS) / EF_TARGET_MONTHS * 100
    sr_score = clamp(savings_rate / SAVINGS_RATE_TARGET * 100)
    dti_score = clamp((1 - dti / DTI_CEILING) * 100)
    score = round(0.35 * ef_score + 0.35 * sr_score + 0.30 * dti_score, 1)

    return Twin(
        total_assets=total_assets,
        liquid_assets=liquid,
        investable_assets=investable,
        total_liabilities=liabilities,
        net_worth=total_assets - liabilities,
        monthly_income=income,
        monthly_expenses=expenses,
        essential_expenses=essential,
        high_risk_spending=risky,
        monthly_emi=emi,
        monthly_surplus=surplus,
        savings_rate=savings_rate,
        emergency_fund_months=ef_months,
        dti=dti,
        liquidity_ratio=liquidity_ratio,
        health_score=score,
        health_band=health_band(score),
        sub_scores={
            "emergency_fund": round(ef_score, 1),
            "savings_rate": round(sr_score, 1),
            "debt": round(dti_score, 1),
        },
    )


def twin_payload(p: ProfileInput, t: Twin) -> dict:
    """Twin + the relationship graph the Digital Twin page renders (all numbers from `t`)."""
    a = p.assets
    flows = {
        "income": round(t.monthly_income),
        "essential": round(t.essential_expenses),
        "discretionary": round(float(p.discretionary_expenses)),
        "high_risk": round(t.high_risk_spending),
        "emi": round(t.monthly_emi),
        "surplus": round(t.monthly_surplus),
        "current_investment": round(float(p.behaviour.current_monthly_investment)),
    }
    balance = {
        "assets": {
            "cash": a.cash,
            "equity": a.equity,
            "debt": a.debt,
            "gold": a.gold,
            "real_estate": a.real_estate,
            "other": a.other,
        },
        "liabilities": {li.name: li.outstanding for li in p.liabilities},
    }
    d = t.to_dict()
    d = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in d.items()}
    return {"twin": d, "flows": flows, "balance": balance}
