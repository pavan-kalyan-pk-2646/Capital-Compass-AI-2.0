"""Runs decisions in background threads, fans events out to SSE listeners, persists results.

Events are kept in memory for the life of the process (so a late SSE subscriber replays
everything) and every finished node is written to `audit_trail`; agent opinions go to
`agent_logs`; the final state goes to `decisions.result`.
"""

from __future__ import annotations

import contextvars
import json
import logging
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime

from db.session import session_scope
from graph.build import run_decision
from models import AgentLog, AuditTrail, Decision

log = logging.getLogger(__name__)

KEEP_KEYS = (
    "decision_id",
    "decision_type",
    "command",
    "params",
    "route_reason",
    "profile",
    "user_profile",
    "twin",
    "goal_context",
    "goal_brief",
    "risk_dna",
    "market_data",
    "market_regime",
    "portfolio",
    "portfolio_health",
    "loan_request",
    "loan_analysis",
    "spending_analysis",
    "goal_survival",
    "crisis_scenario",
    "crisis_results",
    "simulation_config",
    "simulation_results",
    "plan_history",
    "reoptimization",
    "agent_opinions",
    "compliance",
    "debate",
    "committee_decision",
    "red_team",
    "weaknesses",
    "red_team_score",
    "critic_decision",
    "critic",
    "retry_count",
    "rounds",
    "recommendation_plan",
    "recommendation",
    "counterfactual",
    "explanation",
    "confidence",
    "trust",
    "audit_trail",
)


@dataclass
class Run:
    id: str
    events: list[dict] = field(default_factory=list)
    done: bool = False
    error: str | None = None
    cond: threading.Condition = field(default_factory=threading.Condition)


_runs: dict[str, Run] = {}
_lock = threading.Lock()


def _jsonable(obj):
    return json.loads(
        json.dumps(obj, default=lambda o: float(o) if hasattr(o, "__float__") else str(o))
    )


def get_run(decision_id: str) -> Run | None:
    return _runs.get(decision_id)


def start(
    profile: dict,
    decision_type: str | None,
    params: dict,
    command: str,
    user_id: int | None = None,
    sync: bool = False,
    guest_key: str | None = None,
) -> str:
    decision_id = str(uuid.uuid4())
    run = Run(decision_id)
    with _lock:
        _runs[decision_id] = run
        if len(_runs) > 200:  # keep memory bounded
            for k in list(_runs)[:50]:
                if _runs[k].done:
                    _runs.pop(k, None)
    with session_scope() as db:
        db.add(
            Decision(
                id=decision_id,
                user_id=user_id,
                guest_key=None if user_id else guest_key,
                type=decision_type or "auto",
                status="running",
                command=command or "",
                input_data=_jsonable(
                    {
                        "decision_type": decision_type,
                        "params": params,
                        "command": command,
                        "profile": profile,
                    }
                ),
            )
        )
    initial = {"decision_id": decision_id, "profile": profile, "params": params, "command": command}
    if decision_type:
        initial["decision_type"] = decision_type
    ctx = contextvars.copy_context()
    if sync:
        ctx.run(_execute, run, initial)
    else:
        threading.Thread(
            target=ctx.run,
            args=(_execute, run, initial),
            daemon=True,
            name=f"decision-{decision_id[:8]}",
        ).start()
    return decision_id


def _emit(run: Run, seq_box: list):
    def emit(event: dict):
        event = _jsonable(event)
        with run.cond:
            run.events.append(event)
            run.cond.notify_all()
        if event["status"] in ("done", "failed"):
            seq_box[0] += 1
            try:
                with session_scope() as db:
                    db.add(
                        AuditTrail(
                            decision_id=run.id,
                            seq=seq_box[0],
                            node_name=event["node"],
                            status=event["status"],
                            message=event["summary"][:4000],
                            duration_ms=int(event.get("duration_ms") or 0),
                            timestamp=datetime.fromisoformat(event["ts"]),
                        )
                    )
            except Exception:  # noqa: BLE001
                log.exception("audit write failed")

    return emit


def _execute(run: Run, initial: dict) -> None:
    seq = [0]
    try:
        final = run_decision(initial, emit=_emit(run, seq))
        result = _jsonable({k: final.get(k) for k in KEEP_KEYS if k in final})
        with session_scope() as db:
            row = db.get(Decision, run.id)
            row.status = "completed"
            row.type = final["decision_type"]
            row.result = result
            row.recommendation = result.get("recommendation")
            row.confidence = (result.get("confidence") or {}).get("score")
            for r in result.get("rounds", []):
                for o in r.get("opinions", []):
                    db.add(
                        AgentLog(
                            decision_id=run.id,
                            round=r["round"],
                            agent_name=o["agent"],
                            decision=o["decision"][:255],
                            stance=o["stance"],
                            reasoning_summary=" | ".join(o["reasoning"])[:4000],
                        )
                    )
                db.add(
                    AgentLog(
                        decision_id=run.id,
                        round=r["round"],
                        agent_name="Red Team",
                        decision=r["red_team"]["headline"][:255],
                        stance="attack",
                        reasoning_summary=" | ".join(
                            f"{t['name']}: {t['status']}" for t in r["red_team"]["tests"]
                        ),
                    )
                )
                db.add(
                    AgentLog(
                        decision_id=run.id,
                        round=r["round"],
                        agent_name="Critic",
                        decision=r["critic"]["verdict"],
                        stance=r["critic"]["verdict"].lower(),
                        reasoning_summary=" | ".join(r["critic"]["reasons"]),
                    )
                )
    except Exception as exc:  # noqa: BLE001
        log.exception("decision %s failed", run.id)
        run.error = str(exc)
        with session_scope() as db:
            row = db.get(Decision, run.id)
            if row:
                row.status = "failed"
                row.error = str(exc)[:2000]
    finally:
        with run.cond:
            run.done = True
            run.events.append(
                {
                    "node": "__end__",
                    "status": "failed" if run.error else "done",
                    "summary": run.error or "complete",
                    "payload": {},
                }
            )
            run.cond.notify_all()


def stream(decision_id: str, timeout_s: float = 120.0):
    """Generator of SSE strings: replays past events then follows live ones."""
    run = _runs.get(decision_id)
    if run is None:
        yield f"event: end\ndata: {json.dumps({'decision_id': decision_id, 'replay': True})}\n\n"
        return
    i = 0
    idle = 0.0
    while True:
        with run.cond:
            if i >= len(run.events) and not run.done:
                run.cond.wait(timeout=1.0)
            batch = run.events[i:]
            i = len(run.events)
            finished = run.done
        if not batch:
            if finished:
                return
            idle += 1.0
            if idle > timeout_s:
                return
            yield ": keep-alive\n\n"
            continue
        idle = 0.0
        for ev in batch:
            if ev["node"] == "__end__":
                yield f"event: end\ndata: {json.dumps(ev)}\n\n"
                return
            yield f"event: node\ndata: {json.dumps(ev)}\n\n"
