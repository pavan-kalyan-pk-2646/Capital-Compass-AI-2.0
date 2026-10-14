"""Optional accounts (bcrypt + signed bearer token). The product works fully as a guest."""

from __future__ import annotations

import re

import bcrypt
from flask import Blueprint
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from api.common import ApiError, body, current_user_id, make_token, ok
from db.session import session_scope
from models import User

bp = Blueprint("auth", __name__)
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _field(field: str, message: str, status: int = 422) -> ApiError:
    """An error the sign-in form can show next to the field it belongs to."""
    return ApiError(message, status, [{"field": field, "message": message}])


def _creds(data: dict) -> tuple[str, str]:
    email = str(data.get("email") or "").strip().lower()
    pw = str(data.get("password") or "")
    if not EMAIL.match(email) or len(email) > 254:
        raise _field("email", "Enter a valid email address")
    if not 8 <= len(pw) <= 128:
        raise _field("password", "Password must be 8–128 characters")
    return email, pw


@bp.post("/api/auth/register")
def register():
    data = body()
    name = " ".join(str(data.get("name") or "").split())
    if not 1 <= len(name) <= 80:
        raise _field("name", "Enter your full name (up to 80 characters)")
    email, pw = _creds(data)
    try:
        with session_scope() as db:
            if db.scalar(select(User).where(User.email == email)):
                raise _field("email", "That email is already registered", 409)
            u = User(
                name=name,
                email=email,
                password_hash=bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode(),
            )
            db.add(u)
            db.flush()
            user = {"id": u.id, "name": u.name, "email": u.email}
    except IntegrityError as e:  # two registrations for the same email at the same moment
        raise _field("email", "That email is already registered", 409) from e
    return ok({"token": make_token(user["id"]), "user": user}, 201)


@bp.post("/api/auth/login")
def login():
    email, pw = _creds(body())
    with session_scope() as db:
        u = db.scalar(select(User).where(User.email == email))
        if not u or not bcrypt.checkpw(pw.encode(), u.password_hash.encode()):
            # One message for both cases, so the form never reveals which emails exist.
            raise ApiError("Email or password is incorrect", 401)
        return ok(
            {"token": make_token(u.id), "user": {"id": u.id, "name": u.name, "email": u.email}}
        )


@bp.get("/api/auth/me")
def me():
    uid = current_user_id()
    if not uid:
        raise ApiError("Not signed in", 401)
    with session_scope() as db:
        u = db.get(User, uid)
        if not u:
            raise ApiError("Not signed in", 401)
        return ok({"user": {"id": u.id, "name": u.name, "email": u.email}})
