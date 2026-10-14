"""FinancialState — the single shared LangGraph state (architecture §20).

Every node reads what it needs from here and writes its results back. `audit_trail` uses an
`add` reducer so parallel branches (risk_dna ∥ goal_agent ∥ market_agent) can all append.
"""

from __future__ import annotations

from operator import add
from typing import Annotated, Any, TypedDict

MAX_RETRIES = 2


class FinancialState(TypedDict, total=False):
    # identity / routing
    decision_id: str
    decision_type: str  # investment | loan | goal | crisis | spending
    command: str
    params: dict[str, Any]
    route_reason: str

    # profile + twin (architecture fields)
    profile: dict[str, Any]
    user_profile: dict[str, Any]
    income: dict[str, Any]
    expenses: dict[str, Any]
    assets: dict[str, Any]
    liabilities: list[dict[str, Any]]
    goals: list[dict[str, Any]]
    twin: dict[str, Any]
    goal_context: dict[str, Any]
    goal_brief: str

    # engine outputs
    risk_dna: dict[str, Any]
    portfolio: dict[str, Any]
    portfolio_health: dict[str, Any]
    loan_request: dict[str, Any]
    loan_analysis: dict[str, Any]
    spending_analysis: dict[str, Any]
    goal_survival: dict[str, Any]
    market_data: dict[str, Any]
    market_regime: str
    simulation_config: dict[str, Any]
    simulation_results: dict[str, Any]
    crisis_scenario: dict[str, Any]
    crisis_results: dict[str, Any]

    # plans
    proposal: dict[str, Any]  # current plan under review
    plan_history: list[dict[str, Any]]
    reoptimization: dict[str, Any]

    # agents
    agent_opinions: list[dict[str, Any]]
    compliance: dict[str, Any]
    debate: list[dict[str, Any]]
    committee_decision: dict[str, Any]
    red_team: dict[str, Any]
    weaknesses: list[dict[str, Any]]
    red_team_score: float
    critic_decision: str  # ACCEPT | REJECT
    critic: dict[str, Any]
    retry_count: int
    rounds: list[dict[str, Any]]

    # outputs
    recommendation_plan: dict[str, Any]
    recommendation: dict[str, Any]
    counterfactual: dict[str, Any]
    explanation: dict[str, Any]
    confidence: dict[str, Any]
    trust: dict[str, Any]
    audit_trail: Annotated[list[dict[str, Any]], add]
