"""ORM models — the MySQL data model from the architecture (§24).

Money columns are DECIMAL(14,2). JSON columns hold engine outputs for exact replay.
db/schema.sql contains the equivalent MySQL DDL.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from db.session import Base

Money = Numeric(14, 2)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), default="")
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class FinancialProfile(Base):
    __tablename__ = "financial_profiles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    guest_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(80), default="Investor")
    age: Mapped[int] = mapped_column(Integer)
    income: Mapped[float] = mapped_column(Money)
    expenses: Mapped[float] = mapped_column(Money)
    investment: Mapped[float] = mapped_column(Money, default=0)
    savings: Mapped[float] = mapped_column(Money, default=0)
    emergency_fund: Mapped[float] = mapped_column(Money, default=0)
    stability: Mapped[str] = mapped_column(String(32))
    risk: Mapped[float] = mapped_column(Numeric(5, 2))  # max tolerated loss %
    data: Mapped[dict] = mapped_column(JSON)  # full ProfileInput for exact round-trip
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class Asset(Base):
    __tablename__ = "assets"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    profile_id: Mapped[int] = mapped_column(
        ForeignKey("financial_profiles.id", ondelete="CASCADE"), index=True
    )
    type: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(80))
    value: Mapped[float] = mapped_column(Money)
    risk: Mapped[str] = mapped_column(String(16))
    liquidity: Mapped[str] = mapped_column(String(16))


class Liability(Base):
    __tablename__ = "liabilities"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    profile_id: Mapped[int] = mapped_column(
        ForeignKey("financial_profiles.id", ondelete="CASCADE"), index=True
    )
    type: Mapped[str] = mapped_column(String(32))
    principal: Mapped[float] = mapped_column(Money)
    interest_rate: Mapped[float] = mapped_column(Numeric(6, 3))
    tenure: Mapped[int] = mapped_column(Integer)
    emi: Mapped[float] = mapped_column(Money)
    remaining_amount: Mapped[float] = mapped_column(Money)


class Goal(Base):
    __tablename__ = "goals"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    guest_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    profile_id: Mapped[int | None] = mapped_column(
        ForeignKey("financial_profiles.id", ondelete="CASCADE"), index=True, nullable=True
    )
    name: Mapped[str] = mapped_column(String(80))
    target_amount: Mapped[float] = mapped_column(Money)
    current_amount: Mapped[float] = mapped_column(Money, default=0)
    target_date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    priority: Mapped[str] = mapped_column(String(16))


class Loan(Base):
    __tablename__ = "loans"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    type: Mapped[str] = mapped_column(String(32))
    amount: Mapped[float] = mapped_column(Money)
    interest_rate: Mapped[float] = mapped_column(Numeric(6, 3))
    tenure: Mapped[int] = mapped_column(Integer)
    fee: Mapped[float] = mapped_column(Money)
    emi: Mapped[float] = mapped_column(Money)
    total_interest: Mapped[float] = mapped_column(Money)
    risk_score: Mapped[float] = mapped_column(Numeric(5, 1))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Portfolio(Base):
    __tablename__ = "portfolios"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(80))
    total_value: Mapped[float] = mapped_column(Money)
    risk_score: Mapped[float] = mapped_column(Numeric(6, 2))
    health_score: Mapped[float] = mapped_column(Numeric(5, 1))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class PortfolioHolding(Base):
    __tablename__ = "portfolio_holdings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    portfolio_id: Mapped[int] = mapped_column(
        ForeignKey("portfolios.id", ondelete="CASCADE"), index=True
    )
    asset: Mapped[str] = mapped_column(String(80))
    type: Mapped[str] = mapped_column(String(32))
    sector: Mapped[str] = mapped_column(String(40))
    value: Mapped[float] = mapped_column(Money)
    weight: Mapped[float] = mapped_column(Numeric(7, 4))


class Simulation(Base):
    __tablename__ = "simulations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    type: Mapped[str] = mapped_column(String(32))
    parameters: Mapped[dict] = mapped_column(JSON)
    results: Mapped[dict] = mapped_column(JSON)
    scenario_count: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Decision(Base):
    __tablename__ = "decisions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    guest_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    type: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), default="running")
    command: Mapped[str] = mapped_column(Text, default="")
    input_data: Mapped[dict] = mapped_column(JSON)
    recommendation: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Numeric(5, 4), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AgentLog(Base):
    __tablename__ = "agent_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    decision_id: Mapped[str] = mapped_column(
        ForeignKey("decisions.id", ondelete="CASCADE"), index=True
    )
    round: Mapped[int] = mapped_column(Integer, default=1)
    agent_name: Mapped[str] = mapped_column(String(40))
    decision: Mapped[str] = mapped_column(String(255))
    stance: Mapped[str] = mapped_column(String(16))
    reasoning_summary: Mapped[str] = mapped_column(Text)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AuditTrail(Base):
    __tablename__ = "audit_trail"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    decision_id: Mapped[str] = mapped_column(
        ForeignKey("decisions.id", ondelete="CASCADE"), index=True
    )
    seq: Mapped[int] = mapped_column(Integer)
    node_name: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(16))
    message: Mapped[str] = mapped_column(Text)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
