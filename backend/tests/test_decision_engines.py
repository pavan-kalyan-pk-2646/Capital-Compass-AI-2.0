from engines import (
    crisis_engine,
    decision_engine,
    goal_engine,
    loan_engine,
    portfolio_doctor,
    spending_engine,
)
from engines import portfolio_engine as pe
from engines.digital_twin import build_twin
from engines.plan import LoanTerms, Plan, crash_loss, run
from engines.risk_engine import compute_risk_dna


def setup(judge):
    t = build_twin(judge)
    d = compute_risk_dna(judge, t)
    return t, d, pe.generate_plan(judge, t, d)


def test_plan_weights_sum_to_one(judge):
    _, _, plan = setup(judge)
    assert abs(sum(plan.weights.values()) - 1) < 1e-9
    assert 0.15 <= plan.equity <= 0.85


def test_loan_analysis_flagship(judge):
    t, _, plan = setup(judge)
    a = loan_engine.analyze(judge, t, plan, LoanTerms("personal", 500_000, 14, 60, 1))
    assert abs(a["emi"] - 11_634.13) < 0.05
    assert a["foir_after"] > a["foir_before"]
    assert a["goal_probability_after"] < a["goal_probability_before"]
    assert len(a["stress_tests"]) == 4
    assert a["recommendation"] in {
        "AFFORDABLE",
        "AFFORDABLE WITH CAUTION",
        "RECONSIDER",
        "NOT ADVISABLE",
    }


def test_goal_survival_scenarios_ordered(judge):
    t, _, plan = setup(judge)
    g = goal_engine.survival(judge, t, plan)
    p = {s["scenario"]: s["success_probability"] for s in g["scenarios"]}
    assert p["crash_job_loss"] <= p["crash"] <= p["normal"]


def test_crisis_all_kinds(judge):
    t, _, plan = setup(judge)
    for kind in crisis_engine.KINDS:
        c = crisis_engine.simulate_crisis(judge, t, plan, kind)
        assert c["severity_label"] in {"LOW", "MODERATE", "HIGH", "SEVERE"}
    crash = crisis_engine.simulate_crisis(judge, t, plan, "market_crash")
    assert crash["portfolio_after"] < crash["portfolio_before"]


def test_red_team_crash_test_matches_formula(judge):
    t, _, plan = setup(judge)
    rt = decision_engine.red_team(judge, t, plan)
    crash = next(x for x in rt["tests"] if x["key"] == "crash")
    assert abs(crash["metric"] - crash_loss(plan.weights)) < 1e-9
    assert len(rt["tests"]) == 7
    assert 0 <= rt["red_team_score"] <= 100


def test_reoptimize_fixes_fragile_loan_plan(judge):
    t, _, plan = setup(judge)
    a = loan_engine.analyze(judge, t, plan, LoanTerms("personal", 500_000, 14, 60, 1))
    fragile = Plan.from_dict(a["plan_with_loan"])
    rt = decision_engine.red_team(judge, t, fragile)
    gp = run(judge, t, fragile)["goal_success_probability"]
    assert decision_engine.critic_rules(judge, gp, rt)  # it is rejected
    r = decision_engine.reoptimize(judge, t, fragile, rt["weaknesses"])
    new = r["plan"]
    assert crash_loss(new.weights) <= judge.risk.max_tolerated_loss_pct / 100 + 1e-9
    rt2 = decision_engine.red_team(judge, t, new)
    gp2 = run(judge, t, new)["goal_success_probability"]
    assert decision_engine.critic_rules(judge, gp2, rt2) == []  # and the fix is accepted


def test_portfolio_doctor_csv(judge):
    t, d, plan = setup(judge)
    from demo import sample_portfolio_csv

    rows = portfolio_doctor.parse_csv(sample_portfolio_csv())
    r = portfolio_doctor.diagnose(judge, rows, plan, d.score("liquidity_need"))
    assert 0 <= r["health_score"] <= 100
    assert any(i["type"] == "concentration" for i in r["issues"])


def test_portfolio_doctor_bad_csv():
    import pytest

    with pytest.raises(portfolio_doctor.CsvError):
        portfolio_doctor.parse_csv("foo,bar\n1,2")
    with pytest.raises(portfolio_doctor.CsvError):
        portfolio_doctor.parse_csv("symbol,asset_class,value\nX,crypto-ish,abc")


def test_spending_redirect_improves_goal(judge):
    t, _, plan = setup(judge)
    s = spending_engine.analyze(judge, t, plan, 8_000)
    assert s["goal_probability_redirected"] >= s["goal_probability_with"]
    assert s["budget_adjustment"]


def test_red_team_liquidity_crisis(judge):
    t, _, plan = setup(judge)
    tests = decision_engine.red_team(judge, t, plan)["tests"]
    ok = next(x for x in tests if x["key"] == "liquidity")
    assert ok["status"] == "PASS" and ok["metric"] >= 1.0
    poor = judge.model_copy(deep=True)
    poor.assets.cash = 10_000
    poor.assets.debt = 0
    tests = decision_engine.red_team(poor, build_twin(poor), plan)["tests"]
    bad = next(x for x in tests if x["key"] == "liquidity")
    assert bad["status"] == "FAIL" and "would be sold" in bad["detail"]
