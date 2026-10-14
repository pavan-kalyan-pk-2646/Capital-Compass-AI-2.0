from graph.build import run_decision


def test_flagship_graph_rejects_then_accepts(judge_json):
    events = []
    s = run_decision(
        {
            "decision_id": "t",
            "profile": judge_json,
            "command": "Can I take a ₹5 lakh personal loan?",
            "params": {"crisis": "market_crash"},
        },
        emit=events.append,
    )
    verdicts = [r["critic"]["verdict"] for r in s["rounds"]]
    assert verdicts[0] == "REJECT" and verdicts[-1] == "ACCEPT"
    assert len(s["rounds"]) <= 3  # retry cap = 2
    assert len(s["agent_opinions"]) == 5
    assert s["trust"]["simulated_paths"] >= 100_000
    done = {e["node"] for e in events if e["status"] == "done"}
    for n in (
        "profile_parser",
        "financial_twin",
        "supervisor",
        "risk_dna",
        "goal_agent",
        "market_agent",
        "decision_router",
        "loan",
        "portfolio_doctor",
        "simulation_engine",
        "crisis_engine",
        "financial_committee",
        "debate",
        "red_team",
        "critic",
        "re_optimize",
        "counterfactual",
        "explanation",
        "trust_center",
    ):
        assert n in done, n


def test_each_decision_type_completes(judge_json):
    for dtype, params in [
        ("investment", {}),
        ("goal", {"target": 2_000_000, "years": 5}),
        ("crisis", {"scenario": "job_loss"}),
        ("spending", {"monthly_spend": 8000}),
    ]:
        s = run_decision(
            {
                "decision_id": dtype,
                "profile": judge_json,
                "decision_type": dtype,
                "params": params,
                "command": "",
            }
        )
        assert s["recommendation"]["status"].startswith("ACCEPTED"), dtype


def test_api_endpoints(client, judge_json):
    assert client.get("/api/health").json["external_api_keys_required"] is False
    body = {"profile": judge_json}
    for path, extra in [
        ("/api/twin/create", {}),
        ("/api/investment/analyze", {}),
        ("/api/loan/analyze", {"loan": {"amount": 500000}}),
        ("/api/loan/stress-test", {"loan": {"amount": 500000}}),
        ("/api/loan/simulate", {"loan": {"amount": 500000}}),
        ("/api/goals/survival", {}),
        ("/api/crisis/simulate", {"scenario": "rate_hike"}),
        ("/api/simulation/what-if", {"futures": [{"name": "A"}]}),
        ("/api/spending/analyze", {"monthly_spend": 5000}),
    ]:
        r = client.post(path, json={**body, **extra})
        assert r.status_code == 200, (path, r.json)
        assert "disclaimer" in r.json


def test_decision_run_audit_and_stream(client, judge_json):
    r = client.post(
        "/api/decision/run",
        json={
            "profile": judge_json,
            "decision_type": "loan",
            "params": {"amount": 500000},
            "sync": True,
        },
    )
    assert r.status_code == 202
    did = r.json["decision_id"]
    d = client.get(f"/api/decision/{did}").json
    assert d["status"] == "completed"
    audit = client.get(f"/api/decision/{did}/audit").json
    assert len(audit["audit_trail"]) >= 20 and audit["agent_logs"]
    stream = client.get(f"/api/decision/{did}/stream").data.decode()
    assert "event: node" in stream and "event: end" in stream
    ans = client.post(
        "/api/command", json={"text": "Why did you reject my plan?", "decision_id": did}
    ).json
    assert ans["decision_type"] == "explain"


def test_validation_errors(client, judge_json):
    assert (
        client.post("/api/twin/create", json={"profile": {**judge_json, "age": 5}}).status_code
        == 422
    )
    assert (
        client.post(
            "/api/loan/analyze", json={"profile": judge_json, "loan": {"amount": -1}}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/crisis/simulate", json={"profile": judge_json, "scenario": "aliens"}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/investment/analyze", data="nope", content_type="application/json"
        ).status_code
        == 400
    )
    assert client.get("/api/decision/does-not-exist").status_code == 404


def test_auth_flow(client):
    r = client.post(
        "/api/auth/register",
        json={"name": "Asha Rao", "email": "a@b.co", "password": "longpassword"},
    )
    assert r.status_code == 201 and r.json["user"]["name"] == "Asha Rao"
    tok = r.json["token"]
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {tok}"}).status_code == 200
    assert (
        client.post(
            "/api/auth/login", json={"email": "a@b.co", "password": "wrongpass1"}
        ).status_code
        == 401
    )


def test_dashboard_and_final_decision_fields(client, judge_json):
    d = client.post("/api/dashboard", json={"profile": judge_json}).json
    assert d["goals"] and 0 <= d["goals"][0]["probability"] <= 1
    assert 0 <= d["portfolio"]["health_score"] <= 100
    r = client.post(
        "/api/decision/run",
        json={
            "profile": judge_json,
            "decision_type": "loan",
            "params": {"amount": 500000},
            "sync": True,
        },
    )
    res = client.get(f"/api/decision/{r.json['decision_id']}").json["result"]
    e = res["explanation"]
    assert e["verdict"] == "APPROVED WITH MODIFICATIONS"
    assert (
        e["comparison"]["after"]["goal_success_probability"]
        > e["comparison"]["before"]["goal_success_probability"]
    )
    assert e["red_team_found_count"] >= 1 and e["most_fragile"]["question"]
    assert res["rounds"][0]["critic"]["outcome"].startswith("REJECTED")


def test_goal_survival_overrides(client, judge_json):
    r = client.post(
        "/api/goals/survival",
        json={"profile": judge_json, "current_corpus": 500000, "expected_return_pct": 9},
    ).json
    assert r["return_assumption"] == "user" and r["start_corpus"] == 500000
    assert 0 <= r["shortfall_risk"] <= 1 and r["ending_wealth"]["p50"] > 0
