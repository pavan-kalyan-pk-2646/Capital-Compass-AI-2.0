"""Decision pipeline endpoints: run, read, audit, live stream, history, NL command."""

from __future__ import annotations

from flask import Blueprint, Response, request, stream_with_context
from sqlalchemy import select

from agents.red_team import attack as red_team
from agents.supervisor import parse_command
from api.common import (
    ApiError,
    body,
    current_guest_key,
    current_user_id,
    guest_key_hash,
    ok,
    owns,
    profile_from,
    stream_ticket_owner,
    stream_url,
)
from db.session import session_scope
from engines.decision_engine import critic_rules, plan_health, reoptimize
from engines.digital_twin import build_twin
from engines.plan import Plan
from graph import runner
from models import AgentLog, AuditTrail, Decision

bp = Blueprint("decisions", __name__)
TYPES = ("investment", "loan", "goal", "crisis", "spending")


@bp.post("/api/decision/run")
def decision_run():
    data = body()
    p = profile_from(data)
    dtype = data.get("decision_type") or None
    if dtype is not None and dtype not in TYPES:
        raise ApiError(f"decision_type must be one of {', '.join(TYPES)}", 422)
    command = str(data.get("command") or "")[:300]
    params = data.get("params") or {}
    if not isinstance(params, dict):
        raise ApiError("params must be an object", 422)
    if not dtype and not command:
        raise ApiError("Pass a decision_type or a command", 422)
    if command and not dtype:
        parsed = parse_command(command)
        if parsed["decision_type"] in (None, "explain"):
            raise ApiError(parsed["reason"], 422)
    uid = current_user_id()
    gk = None if uid else current_guest_key()
    did = runner.start(
        p.model_dump(mode="json"),
        dtype,
        params,
        command,
        uid,
        sync=bool(data.get("sync")),
        guest_key=gk,
    )
    return ok({"decision_id": did, "stream_url": stream_url(did, uid, gk)}, 202)


def _row(did: str, owner: tuple[int | None, str | None] | None = None) -> Decision:
    """Load a decision only for its owner: the signed-in user, or the guest whose browser
    key created it. Anyone else gets the same 404 as for a decision that does not exist."""
    uid, gk = owner if owner is not None else (current_user_id(), current_guest_key())
    with session_scope() as db:
        row = db.get(Decision, did)
        if not row or not owns(row.user_id, row.guest_key, uid, gk):
            raise ApiError("Decision not found", 404)
        return row


@bp.get("/api/decision/<did>")
def decision_get(did: str):
    row = _row(did)
    run = runner.get_run(did)
    return ok(
        {
            "decision_id": row.id,
            "type": row.type,
            "status": row.status,
            "command": row.command,
            "created_at": row.created_at.isoformat(),
            "error": row.error,
            "result": row.result,
            "events": run.events if run else None,
            "stream_url": stream_url(row.id, row.user_id, row.guest_key),
        }
    )


@bp.get("/api/decision/<did>/audit")
def decision_audit(did: str):
    row = _row(did)
    with session_scope() as db:
        trail = db.scalars(
            select(AuditTrail).where(AuditTrail.decision_id == did).order_by(AuditTrail.seq)
        ).all()
        logs = db.scalars(
            select(AgentLog)
            .where(AgentLog.decision_id == did)
            .order_by(AgentLog.round, AgentLog.id)
        ).all()
        return ok(
            {
                "decision_id": did,
                "type": row.type,
                "status": row.status,
                "command": row.command,
                "created_at": row.created_at.isoformat(),
                "audit_trail": [
                    {
                        "seq": t.seq,
                        "node_name": t.node_name,
                        "status": t.status,
                        "message": t.message,
                        "duration_ms": t.duration_ms,
                        "timestamp": t.timestamp.isoformat(),
                    }
                    for t in trail
                ],
                "agent_logs": [
                    {
                        "round": a.round,
                        "agent": a.agent_name,
                        "stance": a.stance,
                        "decision": a.decision,
                        "reasoning": a.reasoning_summary,
                        "timestamp": a.timestamp.isoformat(),
                    }
                    for a in logs
                ],
            }
        )


@bp.post("/api/decision/<did>/break")
def decision_break(did: str):
    """Run the existing Red Team engine against the stored final plan.

    The stored decision is not modified.
    """
    profile, twin, plan = _stored_plan(did)
    attack = red_team(profile, twin, plan)
    return ok({"decision_id": did, "attack": attack})


def _stored_plan(did: str):
    row = _row(did)
    result = row.result or {}
    raw_profile = result.get("profile")
    raw_plan = result.get("recommendation_plan")
    if not raw_profile or not raw_plan:
        raise ApiError("Decision does not contain a reusable final plan", 409)
    profile = profile_from({"profile": raw_profile})
    return profile, build_twin(profile), Plan.from_dict(raw_plan)


@bp.post("/api/decision/<did>/reoptimize")
def decision_reoptimize(did: str):
    """Challenge → re-optimize: attack the stored final plan with the Red Team, apply the
    Critic's rules, run the existing re-optimizer against the weaknesses found, and attack the
    result again. Returns both plans with `plan_health` before and after. The stored decision
    is not modified; this is a what-if on top of it.
    """
    profile, twin, plan = _stored_plan(did)
    before_rt = red_team(profile, twin, plan)
    before = plan_health(profile, twin, plan)
    reasons = critic_rules(profile, before["goal_success_probability"], before_rt)
    found = reoptimize(profile, twin, plan, before_rt["weaknesses"])
    new_plan = found["plan"]
    after_rt = red_team(profile, twin, new_plan)
    return ok(
        {
            "decision_id": did,
            "critic_reasons": reasons,
            "changes": found["changes"],
            "note": found["note"],
            "searched": found["searched"],
            "feasible": found["feasible"],
            "original": {
                "plan": plan.to_dict(),
                "health": before,
                "red_team_score": before_rt["red_team_score"],
                "weaknesses": before_rt["weaknesses"],
            },
            "optimized": {
                "plan": new_plan.to_dict(),
                "health": plan_health(profile, twin, new_plan),
                "red_team_score": after_rt["red_team_score"],
                "weaknesses": after_rt["weaknesses"],
            },
        }
    )


@bp.get("/api/decision/<did>/stream")
def decision_stream(did: str):
    ticket = request.args.get("ticket")
    if ticket:
        owner = stream_ticket_owner(did, ticket)
        if owner is None:
            raise ApiError("Decision not found", 404)
        uid, gkh = owner
        with session_scope() as db:
            row = db.get(Decision, did)
            ok_user = row is not None and uid is not None and row.user_id == uid
            ok_guest = (
                row is not None
                and uid is None
                and row.user_id is None
                and row.guest_key is not None
                and guest_key_hash(row.guest_key) == gkh
            )
            if not (ok_user or ok_guest):
                raise ApiError("Decision not found", 404)
    else:
        _row(did)
    return Response(
        stream_with_context(runner.stream(did)),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _risk_level(score):
    if score is None:
        return None
    return "Low" if score >= 75 else "Moderate" if score >= 55 else "High"


@bp.get("/api/decisions")
def decision_list():
    uid = current_user_id()
    gk = current_guest_key()
    limit = min(request.args.get("limit", 25, type=int), 100)
    if not uid and not gk:
        return ok({"decisions": []})
    with session_scope() as db:
        q = select(Decision).order_by(Decision.created_at.desc()).limit(limit)
        if uid:
            q = q.where(Decision.user_id == uid)
        else:
            q = q.where(Decision.user_id.is_(None), Decision.guest_key == gk)
        rows = db.scalars(q).all()
        return ok(
            {
                "decisions": [
                    {
                        "decision_id": r.id,
                        "type": r.type,
                        "status": r.status,
                        "command": r.command,
                        "created_at": r.created_at.isoformat(),
                        "verdict": (r.recommendation or {}).get("status"),
                        "headline": (r.recommendation or {}).get("action"),
                        "goal_probability": (r.recommendation or {}).get("goal_probability"),
                        "risk_level": _risk_level((r.recommendation or {}).get("red_team_score")),
                        "verdict_label": ((r.result or {}).get("explanation") or {}).get("verdict"),
                        "confidence": float(r.confidence) if r.confidence is not None else None,
                    }
                    for r in rows
                ]
            }
        )


@bp.post("/api/command")
def command():
    """Natural-language command → which engine, with which parameters (or an explanation)."""
    data = body()
    text = str(data.get("text") or "")[:300]
    parsed = parse_command(text)
    if parsed["decision_type"] == "explain":
        did = data.get("decision_id")
        if not did:
            return ok({**parsed, "answer": None, "message": "Run a decision first, then ask why."})
        row = _row(did)
        res = row.result or {}
        exp = res.get("explanation") or {}
        rounds = res.get("rounds") or []
        rejected = [r for r in rounds if r["critic"]["verdict"] == "REJECT"]
        return ok(
            {
                **parsed,
                "answer": {
                    "rejections": [
                        {"round": r["round"], "reasons": r["critic"]["reasons"]} for r in rejected
                    ],
                    "why_this": exp.get("why_this", []),
                    "why_not_that": exp.get("why_not_that", []),
                    "changes": (res.get("reoptimization") or {}).get("changes", []),
                },
            }
        )
    return ok(parsed)
