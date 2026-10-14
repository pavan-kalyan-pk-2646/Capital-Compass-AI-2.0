"""Atlas: the health index is arithmetic on engine outputs; guidance follows the rules."""

from api.common import context
from engines.atlas import ROUTES, WEIGHTS, brief, capital_health_index, findings
from engines.digital_twin import build_twin
from engines.risk_engine import compute_risk_dna


def _parts(judge):
    twin = build_twin(judge)
    return twin, compute_risk_dna(judge, twin)


def test_index_is_the_weighted_mean_of_its_pillars(judge):
    twin, dna = _parts(judge)
    idx = capital_health_index(twin, dna, 0.8, 15000)
    by = {p["key"]: p for p in idx["pillars"]}
    assert by["liquidity"]["score"] == round(twin.sub_scores["emergency_fund"], 1)
    assert by["debt"]["score"] == round(twin.sub_scores["debt"], 1)
    assert by["goals"]["score"] == 80.0
    assert by["resilience"]["score"] == round(dna.score("financial_resilience"), 1)
    expected = sum(p["score"] * WEIGHTS[p["key"]] for p in idx["pillars"])
    assert abs(idx["score"] - round(expected, 1)) <= 0.1
    assert abs(sum(WEIGHTS.values()) - 1) < 1e-9
    # deterministic: same inputs, same answer
    assert capital_health_index(twin, dna, 0.8, 15000) == idx


def test_missing_goal_is_left_out_not_invented(judge):
    twin, dna = _parts(judge)
    idx = capital_health_index(twin, dna, None, 15000)
    goals = next(p for p in idx["pillars"] if p["key"] == "goals")
    assert goals["score"] is None and idx["renormalised"]
    scored = [p for p in idx["pillars"] if p["score"] is not None]
    expected = sum(p["score"] * p["weight"] for p in scored) / sum(p["weight"] for p in scored)
    assert abs(idx["score"] - round(expected, 1)) <= 0.1


def test_rules_fire_in_order_with_their_numbers(judge):
    p = judge.model_copy(deep=True)
    p.monthly_income = 30000  # expenses now exceed income
    twin = build_twin(p)
    out = findings(twin, None, None, has_completed_decision=False)
    assert out[0]["code"] == "spending_gap" and out[0]["params"]["shortfall"] > 0
    assert out[0]["route"] == ROUTES["spending_gap"]
    # a healthy twin with a completed decision gets the crash stress test
    healthy = judge.model_copy(deep=True)
    healthy.assets.cash = 2_000_000
    healthy.behaviour.high_risk_spending = 0
    ok = findings(build_twin(healthy), {"name": "g", "probability": 0.9}, None, True)
    assert [f["code"] for f in ok] == ["stress_test"]
    fresh = findings(build_twin(healthy), {"name": "g", "probability": 0.9}, None, False)
    assert fresh[0]["code"] == "no_decision"


def test_brief_never_praises_what_it_flags(judge):
    twin, dna, plan = context(judge)
    b = brief(twin, dna, [{"name": "g", "probability": 0.9, "primary": True}], None, 15000, True)
    flagged = {b["recommendation"]["pillar"], *(f["pillar"] for f in b["findings"])}
    assert not flagged & {s["key"] for s in b["strengths"]}


def test_atlas_endpoint(client, judge_json):
    r = client.post("/api/atlas/brief", json={"profile": judge_json})
    assert r.status_code == 200
    a = r.get_json()["atlas"]
    assert 0 <= a["health_index"]["score"] <= 100
    assert a["recommendation"]["route"].startswith("/")
    d = client.post("/api/dashboard", json={"profile": judge_json}).get_json()
    assert d["atlas"]["health_index"] == a["health_index"]
