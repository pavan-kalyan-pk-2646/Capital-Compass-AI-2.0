"""Sign-up validation, login, and what happens to an expired or forged session."""

import time
import uuid
from unittest import mock

from app import app


def _email():
    return f"user-{uuid.uuid4().hex[:10]}@cc.test"


def test_register_validates_each_field():
    c = app.test_client()
    cases = [
        ({"name": " ", "email": _email(), "password": "longpassword"}, "name"),
        ({"name": "Asha", "email": "not-an-email", "password": "longpassword"}, "email"),
        ({"name": "Asha", "email": _email(), "password": "short"}, "password"),
    ]
    for body, field in cases:
        r = c.post("/api/auth/register", json=body)
        assert r.status_code == 422
        assert r.get_json()["details"][0]["field"] == field


def test_duplicate_email_and_wrong_password():
    c = app.test_client()
    e = _email()
    body = {"name": "Ravi Kumar", "email": e, "password": "pw12345678"}
    ok = c.post("/api/auth/register", json=body)
    assert ok.status_code == 201
    assert "password" not in str(ok.get_json()) and "hash" not in str(ok.get_json())
    again = {"name": "Ravi", "email": e.upper(), "password": "x" * 9}
    dup = c.post("/api/auth/register", json=again)
    assert dup.status_code == 409 and dup.get_json()["details"][0]["field"] == "email"
    bad = c.post("/api/auth/login", json={"email": e, "password": "wrong-password"})
    assert bad.status_code == 401
    good = c.post("/api/auth/login", json={"email": e, "password": "pw12345678"})
    assert good.status_code == 200 and good.get_json()["user"]["name"] == "Ravi Kumar"


def test_expired_or_forged_token_is_rejected_not_downgraded_to_guest():
    c = app.test_client()
    e = _email()
    with mock.patch("itsdangerous.timed.time.time", return_value=time.time() - 8 * 24 * 3600):
        old = c.post("/api/auth/register", json={"name": "Old", "email": e, "password": "x" * 10})
    tok = old.get_json()["token"]
    r = c.get("/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 401 and "expired" in r.get_json()["error"]
    r = c.get("/api/decisions", headers={"Authorization": "Bearer forged.token.value"})
    assert r.status_code == 401
    # no token at all is still a normal guest
    assert c.get("/api/decisions").status_code == 200


def test_new_account_has_no_saved_twin_yet():
    c = app.test_client()
    body = {"name": "New", "email": _email(), "password": "x" * 10}
    tok = c.post("/api/auth/register", json=body).get_json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    r = c.get("/api/profile?optional=1", headers=h)
    assert r.status_code == 200 and r.get_json()["profile"] is None
    assert c.get("/api/profile", headers=h).status_code == 404
