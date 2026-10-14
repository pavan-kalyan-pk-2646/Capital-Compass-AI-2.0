"""LangGraph wiring (architecture §21).

START → profile_parser → financial_twin → supervisor
      → [risk_dna ∥ goal_agent ∥ market_agent] → decision_router
      → {investment | loan | spending | crisis} → portfolio_doctor → simulation_engine
      → crisis_engine → financial_committee → debate → red_team → critic
      → (REJECT, retry < 2) re_optimize → simulation_engine …
      → (ACCEPT) counterfactual → explanation → trust_center → END
"""

from __future__ import annotations

from functools import lru_cache

from langgraph.graph import END, START, StateGraph

from graph import nodes as n
from graph.state import FinancialState


@lru_cache(maxsize=1)
def build_graph():
    g = StateGraph(FinancialState)
    for name, fn in [
        ("profile_parser", n.profile_parser),
        ("financial_twin", n.financial_twin),
        ("supervisor", n.supervisor),
        ("risk_dna", n.risk_dna_node),
        ("goal_agent", n.goal_agent_node),
        ("market_agent", n.market_agent_node),
        ("decision_router", n.decision_router),
        ("investment", n.investment),
        ("loan", n.loan),
        ("spending", n.spending),
        ("crisis", n.crisis),
        ("portfolio_doctor", n.portfolio_doctor_node),
        ("simulation_engine", n.simulation_engine),
        ("crisis_engine", n.crisis_engine_node),
        ("financial_committee", n.financial_committee),
        ("debate", n.debate_node),
        ("red_team", n.red_team_node),
        ("critic", n.critic_node),
        ("re_optimize", n.re_optimize),
        ("counterfactual", n.counterfactual),
        ("explanation", n.explanation_node),
        ("trust_center", n.trust_center),
    ]:
        g.add_node(name, fn)

    g.add_edge(START, "profile_parser")
    g.add_edge("profile_parser", "financial_twin")
    g.add_edge("financial_twin", "supervisor")
    for branch in ("risk_dna", "goal_agent", "market_agent"):
        g.add_edge("supervisor", branch)
    g.add_edge(["risk_dna", "goal_agent", "market_agent"], "decision_router")
    g.add_conditional_edges(
        "decision_router",
        n.route_decision,
        {k: k for k in ("investment", "loan", "spending", "crisis")},
    )
    for engine in ("investment", "loan", "spending", "crisis"):
        g.add_edge(engine, "portfolio_doctor")
    g.add_edge("portfolio_doctor", "simulation_engine")
    g.add_edge("simulation_engine", "crisis_engine")
    g.add_edge("crisis_engine", "financial_committee")
    g.add_edge("financial_committee", "debate")
    g.add_edge("debate", "red_team")
    g.add_edge("red_team", "critic")
    g.add_conditional_edges(
        "critic", n.route_critic, {"re_optimize": "re_optimize", "counterfactual": "counterfactual"}
    )
    g.add_edge("re_optimize", "simulation_engine")
    g.add_edge("counterfactual", "explanation")
    g.add_edge("explanation", "trust_center")
    g.add_edge("trust_center", END)
    return g.compile()


def run_decision(initial: dict, emit=None) -> dict:
    from engines.simulation_engine import start_tally

    start_tally()
    return build_graph().invoke(
        initial, config={"configurable": {"emit": emit}, "recursion_limit": 100}
    )
