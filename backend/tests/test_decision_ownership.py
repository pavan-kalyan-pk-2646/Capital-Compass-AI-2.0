"""Knowing an ID must never expose another person's decision, audit, stream or profile."""

import uuid

from app import app


def _token(client, email, name="Owner"):
    r = client.post(
        "/api/auth/register", json={"email": email, "password": "longpassword", "name": name}
    )
    assert r.status_code in (200, 201), r.get_json()
    return r.get_json()["token"]


def _ids(client, headers):
    rows = client.get("/api/decisions", headers=headers).get_json()["decisions"]
    return [d["decision_id"] for d in rows]


def _run(client, judge_json, headers=None):
    r = client.post(
        "/api/decision/run",
        json={"profile": judge_json, "decision_type": "investment", "sync": True},
        headers=headers or {},
    )
    assert r.status_code == 202, r.get_json()
    return r.get_json()["decision_id"]


def _guest():
    return {"X-Guest-Key": str(uuid.uuid4())}


def _routes_404(c, did, h):
    assert c.get(f"/api/decision/{did}", headers=h).status_code == 404
    assert c.get(f"/api/decision/{did}/audit", headers=h).status_code == 404
    assert c.get(f"/api/decision/{did}/stream", headers=h).status_code == 404
    assert c.post(f"/api/decision/{did}/break", headers=h).status_code == 404
    assert did not in _ids(c, h)


def test_signed_in_decisions_are_private(judge_json):
    c = app.test_client()
    a = {"Authorization": f"Bearer {_token(c, f'owner-{uuid.uuid4().hex[:8]}@cc.test')}"}
    b = {"Authorization": f"Bearer {_token(c, f'other-{uuid.uuid4().hex[:8]}@cc.test')}"}
    did = _run(c, judge_json, a)
    assert c.get(f"/api/decision/{did}", headers=a).status_code == 200
    assert c.get(f"/api/decision/{did}/audit", headers=a).status_code == 200
    brk = c.post(f"/api/decision/{did}/break", headers=a)
    assert brk.status_code == 200 and brk.get_json()["attack"]["headline"]
    assert did in _ids(c, a)
    for h in (b, _guest(), {}):
        _routes_404(c, did, h)


def test_guest_decisions_are_private_to_that_guest(judge_json):
    c = app.test_client()
    g1, g2 = _guest(), _guest()
    did = _run(c, judge_json, g1)
    assert c.get(f"/api/decision/{did}", headers=g1).status_code == 200
    assert did in _ids(c, g1)
    # another guest, a keyless stranger and a signed-in user see nothing
    tok = {"Authorization": f"Bearer {_token(c, f'u-{uuid.uuid4().hex[:8]}@cc.test')}"}
    for h in (g2, {}, tok):
        _routes_404(c, did, h)
    # a keyless caller cannot list anyone's guest decisions
    assert c.get("/api/decisions").get_json()["decisions"] == []


def test_stream_tickets_are_bound_to_decision_and_owner(judge_json):
    c = app.test_client()
    a = {"Authorization": f"Bearer {_token(c, f's-{uuid.uuid4().hex[:8]}@cc.test')}"}
    g = _guest()
    did = _run(c, judge_json, a)
    gid = _run(c, judge_json, g)
    for d, h in ((did, a), (gid, g)):
        url = c.get(f"/api/decision/{d}", headers=h).get_json()["stream_url"]
        assert "ticket=" in url
        r = c.get(url)  # EventSource sends no headers: the ticket alone opens the stream
        assert r.status_code == 200 and r.mimetype == "text/event-stream"
        r.close()
    ticket = c.get(f"/api/decision/{did}", headers=a).get_json()["stream_url"].split("ticket=")[1]
    assert c.get(f"/api/decision/{gid}/stream?ticket={ticket}").status_code == 404
    assert c.get(f"/api/decision/{did}/stream?ticket=forged").status_code == 404


def test_profiles_and_goals_are_owner_only(judge_json):
    c = app.test_client()
    g1, g2 = _guest(), _guest()
    pid = c.post("/api/twin/create", json={"profile": judge_json}, headers=g1).get_json()[
        "profile_id"
    ]
    assert c.get(f"/api/profile?id={pid}", headers=g1).status_code == 200
    # strangers can neither read, overwrite nor attach goals to it
    tok = {"Authorization": f"Bearer {_token(c, f'p-{uuid.uuid4().hex[:8]}@cc.test')}"}
    for h in (g2, {}, tok):
        assert c.get(f"/api/profile?id={pid}", headers=h).status_code == 404
        r = c.put(f"/api/profile?id={pid}", json={"profile": judge_json}, headers=h)
        assert r.status_code == 404
        goal = {"name": "x", "target_amount": 1000, "years": 1}
        r = c.post("/api/goals", json={"profile_id": pid, "goal": goal}, headers=h)
        assert r.status_code == 404
    # the guest who built it can sign in from the same browser and keep it
    claim = {**g1, "Authorization": f"Bearer {_token(c, f'c-{uuid.uuid4().hex[:8]}@cc.test')}"}
    r = c.put(f"/api/profile?id={pid}", json={"profile": judge_json}, headers=claim)
    assert r.status_code == 200
    # after the claim it belongs to that account, not to the guest key any more
    assert c.get(f"/api/profile?id={pid}", headers=claim).status_code == 200
    assert c.get(f"/api/profile?id={pid}", headers=g1).status_code == 404


def test_reoptimize_is_owner_only_and_uses_the_engines(judge_json):
    c = app.test_client()
    g = _guest()
    r = c.post(
        "/api/decision/run",
        json={
            "profile": judge_json,
            "decision_type": "loan",
            "params": {"amount": 500000, "loan_type": "personal", "crisis": "market_crash"},
            "sync": True,
        },
        headers=g,
    )
    did = r.get_json()["decision_id"]
    assert c.post(f"/api/decision/{did}/reoptimize", headers=_guest()).status_code == 404
    res = c.post(f"/api/decision/{did}/reoptimize", headers=g)
    assert res.status_code == 200
    body = res.get_json()
    for side in ("original", "optimized"):
        h = body[side]["health"]
        assert 0 <= h["financial_resilience"] <= 100 and "crash_loss" in h
        assert 0 <= body[side]["red_team_score"] <= 100
    assert body["changes"] and body["searched"] >= body["feasible"] >= 0
    # the stored decision is untouched
    stored = c.get(f"/api/decision/{did}", headers=g).get_json()["result"]["recommendation_plan"]
    assert stored == body["original"]["plan"]


def test_stream_ticket_does_not_reveal_the_guest_key(judge_json):
    import base64

    c = app.test_client()
    g = _guest()
    did = _run(c, judge_json, g)
    url = c.get(f"/api/decision/{did}", headers=g).get_json()["stream_url"]
    payload = url.split("ticket=")[1].split(".")[0]
    decoded = base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
    assert g["X-Guest-Key"].encode() not in decoded
    r = c.get(url)
    assert r.status_code == 200
    r.close()


def test_short_guest_keys_and_odd_auth_headers_are_refused(judge_json):
    c = app.test_client()
    short = {"X-Guest-Key": "aaaaaaaaaaaaaaaa"}  # 16 chars: guessable, not accepted as an identity
    assert c.get("/api/decisions", headers=short).get_json()["decisions"] == []
    basic = {"Authorization": "Basic Zm9vOmJhcg=="}
    assert c.get("/api/decisions", headers=basic).status_code == 401
