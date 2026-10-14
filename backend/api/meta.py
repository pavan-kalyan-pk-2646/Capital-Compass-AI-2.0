"""Health, market data, knowledge base and demo data."""

from __future__ import annotations

from flask import Blueprint
from sqlalchemy import text

from api.common import ok
from config import settings
from db.session import engine
from demo import judge_profile, sample_portfolio_csv
from market import loader
from rag.retriever import passages

bp = Blueprint("meta", __name__)


@bp.get("/api/health")
def health():
    db_ok = True
    try:
        with engine.connect() as c:
            c.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001
        db_ok = False
    s = settings()
    return ok(
        {
            "status": "ok" if db_ok else "degraded",
            "database": s.db_kind,
            "database_ok": db_ok,
            "llm": s.llm_provider,
            "simulations": s.mc_simulations,
            "external_api_keys_required": False,
        }
    )


@bp.get("/api/market")
def market():
    return ok(loader.stats())


@bp.get("/api/knowledge")
def knowledge():
    return ok(
        {
            "passages": [
                {"id": p.id, "title": p.title, "text": p.text, "source": p.source}
                for p in passages()
            ]
        }
    )


@bp.get("/api/demo/judge-profile")
def demo_profile():
    return ok({"profile": judge_profile().model_dump(mode="json")})


@bp.get("/api/demo/sample-portfolio")
def demo_portfolio():
    return ok({"csv": sample_portfolio_csv(), "filename": "portfolio.csv"})
