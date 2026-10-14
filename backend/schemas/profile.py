"""Financial profile — the raw input the Financial Digital Twin is built from.

Money inputs are whole rupees (int) so they persist exactly; engine outputs may be floats.
Domains follow the architecture: personal, income, expenses, assets, liabilities, goals,
risk and behaviour.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Rupees = int

EmploymentType = Literal["salaried_stable", "salaried_variable", "self_employed", "gig"]
Experience = Literal["none", "beginner", "intermediate", "advanced"]
DropReaction = Literal["sell_all", "sell_some", "hold", "buy_more"]
LiabilityType = Literal["personal", "education", "home", "vehicle", "credit_card", "other"]
GoalType = Literal[
    "home", "education", "retirement", "wealth", "emergency", "travel", "vehicle", "other"
]


class Assets(BaseModel):
    cash: Rupees = Field(0, ge=0, description="Bank balance + liquid savings (emergency fund)")
    equity: Rupees = Field(0, ge=0, description="Stocks + equity mutual funds")
    debt: Rupees = Field(0, ge=0, description="Debt funds, FDs, PPF, bonds")
    gold: Rupees = Field(0, ge=0)
    real_estate: Rupees = Field(0, ge=0)
    other: Rupees = Field(0, ge=0)


class Liability(BaseModel):
    type: LiabilityType = "personal"
    name: str = Field("Loan", max_length=80)
    outstanding: Rupees = Field(ge=0)
    emi: Rupees = Field(ge=0, description="Monthly instalment")
    annual_rate_pct: float = Field(0, ge=0, le=60)
    remaining_months: int = Field(0, ge=0, le=480)
    floating_rate: bool = False


class Goal(BaseModel):
    name: str = Field(max_length=80)
    goal_type: GoalType = "wealth"
    target_amount: Rupees = Field(gt=0, description="Nominal rupees needed at the deadline")
    current_amount: Rupees = Field(0, ge=0, description="Already earmarked for this goal")
    years: float = Field(gt=0, le=50)
    priority: Literal["high", "medium", "low"] = "high"


class RiskInputs(BaseModel):
    max_tolerated_loss_pct: float = Field(ge=0, le=100, description="Max portfolio fall tolerated")
    experience: Experience = "beginner"
    reaction_to_20pct_drop: DropReaction = "hold"


class Behaviour(BaseModel):
    investment_frequency: Literal["none", "irregular", "monthly_sip", "lump_sum"] = "irregular"
    current_monthly_investment: Rupees = Field(0, ge=0)
    high_risk_spending: Rupees = Field(0, ge=0, description="Betting / speculative spend per month")
    credit_card_behaviour: Literal["full", "partial", "minimum", "none"] = "full"


class ProfileInput(BaseModel):
    name: str = Field("Investor", max_length=80)
    age: int = Field(ge=18, le=100)
    dependents: int = Field(0, ge=0, le=20)
    employment: EmploymentType = "salaried_stable"
    monthly_income: Rupees = Field(ge=0, description="Take-home salary per month")
    other_income: Rupees = Field(0, ge=0, description="Rent, freelance, interest per month")
    essential_expenses: Rupees = Field(ge=0, description="Rent, food, utilities, insurance / month")
    discretionary_expenses: Rupees = Field(0, ge=0, description="Lifestyle spend / month")
    assets: Assets = Assets()
    liabilities: list[Liability] = Field(default_factory=list, max_length=20)
    goals: list[Goal] = Field(default_factory=list, max_length=10)
    risk: RiskInputs
    behaviour: Behaviour = Behaviour()
