"""Risk DNA engine — 8 deterministic dimensions, each 0–100. No LLM.

Shared sub-scores
-----------------
loss_score       = clamp(max_tolerated_loss_pct / 30 · 100)        (30% loss tolerated → 100)
experience_score = none 10 · beginner 35 · intermediate 65 · advanced 90
reaction_score   = sell_all 5 · sell_some 35 · hold 65 · buy_more 95
                   (stated reaction to a 20% market fall)

Dimensions
----------
growth_appetite      = 0.50·loss + 0.25·experience + 0.25·reaction
loss_tolerance       = 0.60·loss + 0.40·reaction
liquidity_need       = 10 + 60·EF_gap + 8·min(dependents, 3) + 16·[nearest goal ≤ 3 y]
                       EF_gap = clamp((6 − ef_months) / 6, 0, 1)
time_horizon         = 0.70·min(goal_years, 20)/20·100 + 0.30·clamp(60 − age, 0, 40)/40·100
                       goal_years = primary goal (else years to 60)
income_stability     = employment base (85/65/45/30) − 5·min(dependents, 3)
goal_pressure        = clamp(required_SIP / surplus · 100)  (100 when surplus ≤ 0 and SIP > 0)
debt_burden          = clamp(dti / 0.50 · 100)
financial_resilience = 0.35·EF + 0.25·SR + 0.20·DTIs + 0.20·income_stability
                       (EF, SR, DTIs are the twin health sub-scores)

Profile
-------
profile_score = 0.30·GA + 0.25·LT + 0.20·TH + 0.15·FR + 0.10·IS − 0.10·DB, clamped 0–100
label: <40 Conservative · <60 Moderate · <78 Growth · else Aggressive,
       then capped by stated max loss: <10% → Conservative, <20% → Moderate, <30% → Growth.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

from engines.digital_twin import DTI_CEILING, EF_TARGET_MONTHS, SAVINGS_RATE_TARGET, Twin
from engines.finance_math import clamp, required_monthly_sip
from schemas.profile import Goal, ProfileInput
from utils.inr import inr

PLANNING_RETURN_PCT = 10.0  # long-run nominal return used only for the SIP target

EXPERIENCE = {"none": 10, "beginner": 35, "intermediate": 65, "advanced": 90}
REACTION = {"sell_all": 5, "sell_some": 35, "hold": 65, "buy_more": 95}
EMPLOYMENT = {"salaried_stable": 85, "salaried_variable": 65, "self_employed": 45, "gig": 30}
LABELS = ["Conservative", "Moderate", "Growth", "Aggressive"]
PRIORITY_RANK = {"high": 0, "medium": 1, "low": 2}


@dataclass(frozen=True)
class Dimension:
    key: str
    label: str
    score: float
    explanation: str


@dataclass(frozen=True)
class RiskDNA:
    dimensions: list[Dimension]
    profile_score: float
    label: str
    capped_by_max_loss: bool
    required_monthly_sip: float
    planning_return_pct: float

    def score(self, key: str) -> float:
        return next(d.score for d in self.dimensions if d.key == key)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["scores"] = {x.key: x.score for x in self.dimensions}
        return d


def primary_goal(goals: list[Goal]) -> Goal | None:
    """Highest priority first, then the nearest deadline."""
    if not goals:
        return None
    return min(goals, key=lambda g: (PRIORITY_RANK[g.priority], g.years))


def _label_for(score: float) -> int:
    if score < 40:
        return 0
    if score < 60:
        return 1
    if score < 78:
        return 2
    return 3


def _max_label_for_loss(max_loss_pct: float) -> int:
    if max_loss_pct < 10:
        return 0
    if max_loss_pct < 20:
        return 1
    if max_loss_pct < 30:
        return 2
    return 3


def compute_risk_dna(p: ProfileInput, twin: Twin) -> RiskDNA:
    r = p.risk
    loss = clamp(r.max_tolerated_loss_pct / 30 * 100)
    exp = EXPERIENCE[r.experience]
    react = REACTION[r.reaction_to_20pct_drop]
    deps = min(p.dependents, 3)

    goal = primary_goal(p.goals)
    goal_years = goal.years if goal else max(60 - p.age, 1)
    nearest = min((g.years for g in p.goals), default=goal_years)

    growth = 0.5 * loss + 0.25 * exp + 0.25 * react
    loss_tol = 0.6 * loss + 0.4 * react

    ef_gap = clamp((EF_TARGET_MONTHS - twin.emergency_fund_months) / EF_TARGET_MONTHS, 0, 1)
    liquidity = clamp(10 + 60 * ef_gap + 8 * deps + (16 if nearest <= 3 else 0))

    horizon = 0.7 * min(goal_years, 20) / 20 * 100 + 0.3 * clamp(60 - p.age, 0, 40) / 40 * 100

    stability = clamp(EMPLOYMENT[p.employment] - 5 * deps)

    sip = 0.0
    if goal:
        sip = required_monthly_sip(
            goal.target_amount,
            max(twin.investable_assets, goal.current_amount),
            PLANNING_RETURN_PCT,
            round(goal.years * 12),
        )
    if twin.monthly_surplus > 0:
        pressure = clamp(sip / twin.monthly_surplus * 100)
    else:
        pressure = 100.0 if sip > 0 else 0.0

    debt = clamp(twin.dti / DTI_CEILING * 100)

    ef_s = min(twin.emergency_fund_months, EF_TARGET_MONTHS) / EF_TARGET_MONTHS * 100
    sr_s = clamp(twin.savings_rate / SAVINGS_RATE_TARGET * 100)
    dti_s = clamp((1 - twin.dti / DTI_CEILING) * 100)
    resilience = 0.35 * ef_s + 0.25 * sr_s + 0.20 * dti_s + 0.20 * stability

    dims = [
        Dimension(
            "growth_appetite",
            "Growth Appetite",
            growth,
            f"{r.max_tolerated_loss_pct:g}% max loss, {r.experience} investor, "
            f"would {r.reaction_to_20pct_drop.replace('_', ' ')} in a 20% fall",
        ),
        Dimension(
            "loss_tolerance",
            "Loss Tolerance",
            loss_tol,
            f"Stated max loss {r.max_tolerated_loss_pct:g}% and fall reaction",
        ),
        Dimension(
            "liquidity_need",
            "Liquidity Need",
            liquidity,
            f"{twin.emergency_fund_months:.1f} months emergency cover, "
            f"{p.dependents} dependents, nearest goal {nearest:g} y",
        ),
        Dimension(
            "time_horizon",
            "Time Horizon",
            horizon,
            f"Primary goal in {goal_years:g} y, age {p.age}",
        ),
        Dimension(
            "income_stability",
            "Income Stability",
            stability,
            f"{p.employment.replace('_', ' ')} income, {p.dependents} dependents",
        ),
        Dimension(
            "goal_pressure",
            "Goal Pressure",
            pressure,
            f"Goal needs {inr(sip)}/mo invested vs surplus of {inr(twin.monthly_surplus)}/mo",
        ),
        Dimension("debt_burden", "Debt Burden", debt, f"EMIs are {twin.dti * 100:.1f}% of income"),
        Dimension(
            "financial_resilience",
            "Financial Resilience",
            resilience,
            f"Emergency fund, {twin.savings_rate * 100:.1f}% savings rate, debt, income stability",
        ),
    ]
    dims = [Dimension(d.key, d.label, round(clamp(d.score), 1), d.explanation) for d in dims]

    profile = clamp(
        0.30 * growth
        + 0.25 * loss_tol
        + 0.20 * horizon
        + 0.15 * resilience
        + 0.10 * stability
        - 0.10 * debt
    )
    raw = _label_for(profile)
    cap = _max_label_for_loss(r.max_tolerated_loss_pct)

    return RiskDNA(
        dimensions=dims,
        profile_score=round(profile, 1),
        label=LABELS[min(raw, cap)],
        capped_by_max_loss=raw > cap,
        required_monthly_sip=round(sip, 2),
        planning_return_pct=PLANNING_RETURN_PCT,
    )
