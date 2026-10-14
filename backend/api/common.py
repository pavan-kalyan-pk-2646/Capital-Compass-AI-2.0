"""Shared API helpers: JSON parsing, validation errors, auth token, persistence helpers."""

from __future__ import annotations

import hashlib
import logging
import re
from typing import Any

from flask import current_app, jsonify, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel, ValidationError

from engines.digital_twin import build_twin
from engines.plan import Plan
from engines.portfolio_engine import generate_plan
from engines.risk_engine import compute_risk_dna
from schemas.profile import ProfileInput

log = logging.getLogger(__name__)

DISCLAIMER = (
    "Capital Compass provides scenario-based financial decision support. Simulated outcomes "
    "are not guaranteed predictions and should not be interpreted as regulated personalized "
    "financial advice."
)


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400, details: Any = None):
        super().__init__(message)
        self.message, self.status, self.details = message, status, details


def body() -> dict:
    data = request.get_json(silent=True)
    if data is None:
        if request.data:
            raise ApiError("Request body must be valid JSON", 400)
        return {}
    if not isinstance(data, dict):
        raise ApiError("Request body must be a JSON object", 400)
    return data


def validate(model: type[BaseModel], data: Any, where: str = "body"):
    try:
        return model.model_validate(data)
    except ValidationError as exc:
        details = [
            {"field": ".".join(str(x) for x in e["loc"]), "message": e["msg"]} for e in exc.errors()
        ]
        raise ApiError(f"Invalid {where}", 422, details) from exc


def profile_from(data: dict) -> ProfileInput:
    if "profile" not in data:
        raise ApiError("Missing 'profile' — create your Financial Digital Twin first", 422)
    return validate(ProfileInput, data["profile"], "profile")


def num(
    data: dict,
    key: str,
    default: float | None = None,
    lo: float | None = None,
    hi: float | None = None,
) -> float:
    v = data.get(key, default)
    if v is None:
        raise ApiError(f"Missing '{key}'", 422)
    try:
        v = float(v)
    except (TypeError, ValueError) as exc:
        raise ApiError(f"'{key}' must be a number", 422) from exc
    if v != v or v in (float("inf"), float("-inf")):
        raise ApiError(f"'{key}' must be finite", 422)
    if lo is not None and v < lo:
        raise ApiError(f"'{key}' must be ≥ {lo:g}", 422)
    if hi is not None and v > hi:
        raise ApiError(f"'{key}' must be ≤ {hi:g}", 422)
    return v


def context(p: ProfileInput, plan_dict: dict | None = None):
    """(twin, risk_dna, plan) — the plan from the request, else freshly generated."""
    twin = build_twin(p)
    dna = compute_risk_dna(p, twin)
    plan = Plan.from_dict(plan_dict) if plan_dict else generate_plan(p, twin, dna)
    return twin, dna, plan


def ok(payload: Any, status: int = 200):
    if isinstance(payload, dict) and "disclaimer" not in payload:
        payload = {**payload, "disclaimer": DISCLAIMER}
    return jsonify(payload), status


# ---------- auth tokens (optional; the app works as a guest) ----------
def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="cc-auth")


SESSION_SECONDS = 60 * 60 * 24 * 7  # a sign-in lasts 7 days


def make_token(user_id: int) -> str:
    return _serializer().dumps({"uid": user_id})


def current_user_id() -> int | None:
    h = request.headers.get("Authorization", "")
    if not h:
        return None
    if not h.startswith("Bearer "):
        # A request that claims an identity in any other form is refused, not treated as a guest.
        raise ApiError("Unsupported authorization. Sign in again.", 401)
    try:
        return int(_serializer().loads(h[7:], max_age=SESSION_SECONDS)["uid"])
    except SignatureExpired as e:
        # A request that claims an identity must not silently fall back to guest access.
        raise ApiError("Your session has expired. Sign in again.", 401) from e
    except (BadSignature, KeyError, ValueError, TypeError) as e:
        raise ApiError("Your sign-in is no longer valid. Sign in again.", 401) from e


_GUEST_KEY = re.compile(r"^[A-Za-z0-9-]{32,64}$")  # a UUID or longer: not guessable


def current_guest_key() -> str | None:
    """Random per-browser key (X-Guest-Key header) that scopes a guest's own data.

    Guests have no account, so this key is what keeps one guest's decisions and profiles
    away from every other guest. It is never accepted in place of a signed-in user.
    """
    k = request.headers.get("X-Guest-Key", "").strip()
    return k if _GUEST_KEY.match(k) else None


def owns(
    row_user_id: int | None, row_guest_key: str | None, uid: int | None, gk: str | None
) -> bool:
    """Ownership rule shared by every endpoint that loads a stored resource by ID."""
    if uid is not None:
        return row_user_id == uid
    return row_user_id is None and gk is not None and row_guest_key == gk


def guest_key_hash(gk: str) -> str:
    """One-way fingerprint of a guest key. Tickets carry this, never the key itself: a signed
    ticket is readable by anyone who sees the URL (logs, history), so it must not grant more
    than the one stream it was issued for."""
    return hashlib.sha256(gk.encode()).hexdigest()


def stream_url(did: str, uid: int | None, gk: str | None = None) -> str:
    """SSE URL for a decision. EventSource cannot send headers, so the URL carries a
    short-lived ticket bound to this decision and to the owner (user, or a guest-key hash)."""
    payload = {"did": did, "uid": uid, "gkh": guest_key_hash(gk) if gk else None}
    ticket = _serializer().dumps(payload, salt="cc-stream")
    return f"/api/decision/{did}/stream?ticket={ticket}"


def stream_ticket_owner(did: str, ticket: str) -> tuple[int | None, str | None] | None:
    """(uid, guest_key_hash) of a valid ticket for this decision (15 minutes), else None."""
    try:
        data = _serializer().loads(ticket, salt="cc-stream", max_age=15 * 60)
    except (BadSignature, SignatureExpired):
        return None
    if not isinstance(data, dict) or data.get("did") != did:
        return None
    uid, gkh = data.get("uid"), data.get("gkh")
    if uid is not None and not isinstance(uid, int):
        return None
    if gkh is not None and not isinstance(gkh, str):
        return None
    if uid is None and gkh is None:
        return None
    return uid, gkh


def log_simulation(kind: str, params: dict, sim: dict | None, count: int | None = None) -> None:
    """Persist a run summary to `simulations`. Never breaks the response."""
    from db.session import session_scope
    from engines.simulation_engine import summary
    from models import Simulation

    try:
        with session_scope() as db:
            db.add(
                Simulation(
                    user_id=current_user_id(),
                    type=kind,
                    parameters=params,
                    results=summary(sim) if sim else {},
                    scenario_count=count or (sim or {}).get("n_paths", 0),
                )
            )
    except Exception:  # noqa: BLE001
        log.exception("could not log simulation")
