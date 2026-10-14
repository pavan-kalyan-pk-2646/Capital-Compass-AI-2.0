"""SQLAlchemy engine + session. MySQL 8 via DATABASE_URL; SQLite fallback for zero setup."""

from __future__ import annotations

import logging
from contextlib import contextmanager

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from config import settings

log = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


_url = settings().database_url
engine = create_engine(
    _url,
    pool_pre_ping=True,
    pool_recycle=1800,
    connect_args={"check_same_thread": False} if _url.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@contextmanager
def session_scope():
    s = SessionLocal()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


# Columns added after the first release. create_all() never alters an existing table, so an
# older local database gets them added here (nullable, so existing rows stay valid).
_ADDED_COLUMNS = {
    "decisions": [("guest_key", "VARCHAR(64)")],
    "financial_profiles": [("guest_key", "VARCHAR(64)")],
    "goals": [("guest_key", "VARCHAR(64)")],
}


def _migrate() -> None:
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    with engine.begin() as conn:
        for table, cols in _ADDED_COLUMNS.items():
            if table not in tables:
                continue
            have = {c["name"] for c in insp.get_columns(table)}
            for name, ddl in cols:
                if name not in have:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
                    conn.execute(text(f"CREATE INDEX ix_{table}_{name} ON {table} ({name})"))
                    log.info("Added column %s.%s", table, name)


def init_db() -> None:
    import models  # noqa: F401 — registers tables

    Base.metadata.create_all(engine)
    _migrate()
    log.info("Database ready: %s", settings().db_kind)
