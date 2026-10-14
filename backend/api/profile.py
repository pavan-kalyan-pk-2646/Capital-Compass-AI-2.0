"""Profile + Financial Digital Twin endpoints."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from flask import Blueprint, request
from sqlalchemy import select

from api.common import (
    ApiError,
    body,
    current_guest_key,
    current_user_id,
    log_simulation,
    num,
    ok,
    owns,
    profile_from,
    validate,
)
from db.session import session_scope
from engines.digital_twin import build_twin, twin_payload
from engines.plan import goal_context, run
from engines.portfolio_engine import generate_plan
from engines.risk_engine import compute_risk_dna
from models import Asset, FinancialProfile
from models import Goal as GoalRow
from models import Liability as LiabilityRow
from schemas.profile import Goal, ProfileInput

bp = Blueprint("profile", __name__)

ASSET_META = {
    "cash": ("low", "high"),
    "equity": ("high", "high"),
    "debt": ("low", "medium"),
    "gold": ("medium", "medium"),
    "real_estate": ("medium", "low"),
    "other": ("high", "low"),
}


def _can_write(row: FinancialProfile, uid: int | None, gk: str | None) -> bool:
    """Owner may write. A guest who signs in may also claim the profile they built as a guest
    in the same browser (same guest key); no one can take over anyone else's profile."""
    if owns(row.user_id, row.guest_key, uid, gk):
        return True
    return uid is not None and row.user_id is None and gk is not None and row.guest_key == gk


def _save(p: ProfileInput, profile_id: int | None, user_id: int | None) -> int:
    gk = None if user_id else current_guest_key()
    claim_key = current_guest_key()
    with session_scope() as db:
        row = db.get(FinancialProfile, profile_id) if profile_id else None
        if profile_id and (not row or not _can_write(row, user_id, claim_key)):
            raise ApiError("Profile not found", 404)
        twin = build_twin(p)
        fields = dict(
            user_id=user_id,
            guest_key=gk,
            name=p.name,
            age=p.age,
            income=p.monthly_income + p.other_income,
            expenses=twin.monthly_expenses,
            investment=p.behaviour.current_monthly_investment,
            savings=float(p.assets.cash + p.assets.equity + p.assets.debt + p.assets.gold),
            emergency_fund=p.assets.cash,
            stability=p.employment,
            risk=p.risk.max_tolerated_loss_pct,
            data=p.model_dump(mode="json"),
        )
        if row:
            for k, v in fields.items():
                setattr(row, k, v)
            for model in (Asset, LiabilityRow, GoalRow):
                for r in db.scalars(select(model).where(model.profile_id == row.id)):
                    db.delete(r)
        else:
            row = FinancialProfile(**fields)
            db.add(row)
        db.flush()
        for k, (risk, liq) in ASSET_META.items():
            v = getattr(p.assets, k)
            if v:
                db.add(
                    Asset(
                        user_id=row.user_id,
                        profile_id=row.id,
                        type=k,
                        name=k.replace("_", " ").title(),
                        value=v,
                        risk=risk,
                        liquidity=liq,
                    )
                )
        for li in p.liabilities:
            db.add(
                LiabilityRow(
                    user_id=row.user_id,
                    profile_id=row.id,
                    type=li.type,
                    principal=li.outstanding,
                    interest_rate=li.annual_rate_pct,
                    tenure=li.remaining_months,
                    emi=li.emi,
                    remaining_amount=li.outstanding,
                )
            )
        now = datetime.now(timezone.utc)
        for g in p.goals:
            db.add(
                GoalRow(
                    user_id=row.user_id,
                    guest_key=row.guest_key,
                    profile_id=row.id,
                    name=g.name,
                    target_amount=g.target_amount,
                    current_amount=g.current_amount,
                    target_date=now + timedelta(days=round(g.years * 365.25)),
                    priority=g.priority,
                )
            )
        return row.id


def _snapshot(p: ProfileInput) -> dict:
    twin = build_twin(p)
    dna = compute_risk_dna(p, twin)
    return {**twin_payload(p, twin), "risk_dna": dna.to_dict(), "goal": goal_context(p, twin)}


@bp.post("/api/profile")
def create_profile():
    data = body()
    p = validate(ProfileInput, data.get("profile", data), "profile")
    pid = _save(p, None, current_user_id())
    return ok({"id": pid, "profile": p.model_dump(mode="json"), **_snapshot(p)}, 201)


@bp.get("/api/profile")
def get_profile():
    pid = request.args.get("id", type=int)
    uid = current_user_id()
    with session_scope() as db:
        if pid:
            row = db.get(FinancialProfile, pid)
        elif uid:
            row = db.scalars(
                select(FinancialProfile)
                .where(FinancialProfile.user_id == uid)
                .order_by(FinancialProfile.updated_at.desc())
            ).first()
        else:
            raise ApiError("Pass ?id= or sign in", 400)
        if not pid and not row and request.args.get("optional") == "1":
            # "Does this account have a saved twin yet?" is a normal question, not an error.
            return ok({"id": None, "profile": None})
        if not row or not owns(row.user_id, row.guest_key, uid, current_guest_key()):
            raise ApiError("Profile not found", 404)
        p = ProfileInput.model_validate(row.data)
        return ok({"id": row.id, "profile": row.data, **_snapshot(p)})


@bp.put("/api/profile")
def update_profile():
    data = body()
    pid = request.args.get("id", type=int) or data.get("id")
    if not pid:
        raise ApiError("Missing profile id", 422)
    p = validate(ProfileInput, data.get("profile", data), "profile")
    _save(p, int(pid), current_user_id())
    return ok({"id": int(pid), "profile": p.model_dump(mode="json"), **_snapshot(p)})


@bp.post("/api/twin/create")
def twin_create():
    data = body()
    p = profile_from(data)
    pid = None
    if data.get("save", True):
        pid = _save(p, data.get("profile_id"), current_user_id())
    return ok({"profile_id": pid, **_snapshot(p)})


@bp.get("/api/twin")
def twin_get():
    return get_profile()


@bp.post("/api/twin/simulate")
def twin_simulate():
    """Project the twin forward under its default plan (10,000 paths)."""
    data = body()
    p = profile_from(data)
    years = num(data, "years", 5, 1, 30)
    twin = build_twin(p)
    dna = compute_risk_dna(p, twin)
    plan = generate_plan(p, twin, dna)
    sim = run(p, twin, plan, months=round(years * 12))
    log_simulation("twin_projection", {"years": years}, sim)
    return ok({"plan": plan.to_dict(), "simulation": sim})


@bp.post("/api/goals")
def save_goal():
    data = body()
    g = validate(Goal, data.get("goal", data), "goal")
    uid, gk = current_user_id(), current_guest_key()
    pid = data.get("profile_id")
    with session_scope() as db:
        if pid is not None:
            prof = db.get(FinancialProfile, pid) if isinstance(pid, int) else None
            if not prof or not owns(prof.user_id, prof.guest_key, uid, gk):
                raise ApiError("Profile not found", 404)
        row = GoalRow(
            user_id=uid,
            guest_key=None if uid else gk,
            profile_id=pid,
            name=g.name,
            target_amount=g.target_amount,
            current_amount=g.current_amount,
            target_date=datetime.now(timezone.utc) + timedelta(days=round(g.years * 365.25)),
            priority=g.priority,
        )
        db.add(row)
        db.flush()
        return ok({"id": row.id, "goal": g.model_dump()}, 201)
