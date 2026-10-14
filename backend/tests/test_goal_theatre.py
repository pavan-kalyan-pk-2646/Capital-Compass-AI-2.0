"""Goal Survival Theatre data: the same simulations as the base response, more of them shown."""

from api.common import context
from engines import goal_engine


def test_theatre_matches_the_base_simulation(judge):
    twin, dna, plan = context(judge)
    base = goal_engine.survival(judge, twin, plan, target=2_500_000, years=5, monthly_sip=15000)
    th = goal_engine.theatre(judge, twin, plan, base, paths=120)
    by = {s["scenario"]: s for s in th["scenarios"]}
    # the four shared scenarios give exactly the probabilities and endings of the base response
    for s in base["scenarios"]:
        assert by[s["scenario"]]["success_probability"] == s["success_probability"]
        assert by[s["scenario"]]["ending"]["p50"] == s["ending_p50"]
    assert by["normal"]["percentiles"] == base["simulation"]["percentiles"]
    assert len(by["normal"]["sample_paths"]) == 120 and len(by["crash"]["sample_paths"]) == 48
    assert th["n_paths"] == 10_000


def test_density_covers_every_path_and_shocks_behave(judge):
    twin, dna, plan = context(judge)
    base = goal_engine.survival(judge, twin, plan, target=2_500_000, years=5, monthly_sip=15000)
    th = goal_engine.theatre(judge, twin, plan, base, paths=60)
    by = {s["scenario"]: s for s in th["scenarios"]}
    d = by["normal"]["density"]
    assert all(abs(sum(col) - 1) < 1e-3 for col in d["share"])
    assert len(d["edges"]) == 37 and len(d["share"]) == len(d["months"])
    # inflation re-prices the target upward; a job loss cannot help the goal
    assert by["inflation"]["target"] > by["normal"]["target"]
    assert by["job_loss"]["success_probability"] <= by["normal"]["success_probability"]
    # SIP below the requirement → a real optimized run at the required SIP
    opt = th["optimized"]
    assert opt and opt["monthly_sip"] == base["required_monthly_sip"]
    assert opt["success_probability"] >= by["normal"]["success_probability"]


def test_endpoint_is_opt_in(client, judge_json):
    plain = client.post("/api/goals/survival", json={"profile": judge_json}).get_json()
    assert "theatre" not in plain
    body = {"profile": judge_json, "theatre": True, "paths": 60}
    r = client.post("/api/goals/survival", json=body)
    th = r.get_json()["theatre"]
    assert r.status_code == 200 and len(th["scenarios"]) == 7 and th["risk_dna"]
