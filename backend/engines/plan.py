"""The shared `Plan` every decision produces, and the bridge from Plan → simulation.

A plan is what the Red Team attacks and the Critic judges: an allocation, a monthly
investment, an emergency-fund top-up and (for loan decisions) the loan terms.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field, replace

from engines.digital_twin import Twin
from engines.finance_math import emi as emi_fn
from engines.risk_engine import primary_goal
from engines.simulation_engine import Crash, SimConfig, simulate
from schemas.profile import ProfileInput

DEFAULT_HORIZON_MONTHS = 60


@dataclass(frozen=True)
class LoanTerms:
    loan_type: str
    amount: float
    annual_rate_pct: float
    tenure_months: int
    processing_fee_pct: float = 0.0

    @property
    def emi(self) -> float:
        return emi_fn(self.amount, self.annual_rate_pct, self.tenure_months)

    @property
    def total_interest(self) -> float:
        return self.emi * self.tenure_months - self.amount

    @property
    def fee(self) -> float:
        return self.amount * self.processing_fee_pct / 100

    def to_dict(self) -> dict:
        d = asdict(self)
        d.update(
            emi=round(self.emi, 2),
            total_interest=round(self.total_interest, 2),
            fee=round(self.fee, 2),
        )
        return d


@dataclass(frozen=True)
class Plan:
    weights: dict[str, float]
    monthly_sip: float
    ef_topup: float = 0.0
    loan: LoanTerms | None = None
    spending_cut: float = 0.0  # share of high-risk spending redirected (spending decisions)
    label: str = "Proposed plan"
    notes: list[str] = field(default_factory=list)

    @property
    def equity(self) -> float:
        return self.weights.get("equity", 0.0)

    def with_(self, **kw) -> Plan:
        return replace(self, **kw)

    def to_dict(self) -> dict:
        return {
            "label": self.label,
            "weights": {k: round(v, 4) for k, v in self.weights.items()},
            "monthly_sip": round(self.monthly_sip),
            "ef_topup": round(self.ef_topup),
            "loan": self.loan.to_dict() if self.loan else None,
            "spending_cut": round(self.spending_cut, 2),
            "notes": list(self.notes),
        }

    @staticmethod
    def from_dict(d: dict) -> Plan:
        loan = d.get("loan")
        return Plan(
            weights=dict(d["weights"]),
            monthly_sip=float(d["monthly_sip"]),
            ef_topup=float(d.get("ef_topup", 0)),
            loan=LoanTerms(
                loan_type=loan["loan_type"],
                amount=float(loan["amount"]),
                annual_rate_pct=float(loan["annual_rate_pct"]),
                tenure_months=int(loan["tenure_months"]),
                processing_fee_pct=float(loan.get("processing_fee_pct", 0)),
            )
            if loan
            else None,
            spending_cut=float(d.get("spending_cut", 0)),
            label=d.get("label", "Plan"),
            notes=list(d.get("notes", [])),
        )


def goal_context(p: ProfileInput, twin: Twin) -> dict:
    g = primary_goal(p.goals)
    if g is None:
        return {
            "name": "Wealth after 5 years",
            "target": None,
            "months": DEFAULT_HORIZON_MONTHS,
            "start_corpus": twin.investable_assets,
        }
    return {
        "name": g.name,
        "target": float(g.target_amount),
        "months": max(1, round(g.years * 12)),
        "start_corpus": max(twin.investable_assets, float(g.current_amount)),
    }


def sim_config(
    p: ProfileInput,
    twin: Twin,
    plan: Plan,
    *,
    n_paths: int = 10_000,
    seed: int = 42,
    months: int | None = None,
    target: float | None = ...,  # type: ignore[assignment]
    **overrides,
) -> SimConfig:
    """Build a SimConfig from the profile + plan. `twin` must NOT include the plan's loan."""
    gc = goal_context(p, twin)
    loan_emi = plan.loan.emi if plan.loan else 0.0
    cfg = SimConfig(
        months=months or gc["months"],
        weights=plan.weights,
        start_portfolio=gc["start_corpus"],
        start_cash=float(p.assets.cash),
        monthly_sip=plan.monthly_sip,
        monthly_income=twin.monthly_income,
        monthly_expenses=twin.monthly_expenses - twin.high_risk_spending * plan.spending_cut,
        monthly_emi=twin.monthly_emi + loan_emi,
        essential_expenses=twin.essential_expenses,
        target=gc["target"] if target is ... else target,
        n_paths=n_paths,
        seed=seed,
        max_loss_pct=p.risk.max_tolerated_loss_pct,
    )
    for k, v in overrides.items():
        setattr(cfg, k, v)
    return cfg


def run(p: ProfileInput, twin: Twin, plan: Plan, **kw) -> dict:
    return simulate(sim_config(p, twin, plan, **kw))


def crash_loss(weights: dict[str, float], equity_drop: float = -0.30) -> float:
    """Instant portfolio loss for a NIFTY shock (gold +5%, debt flat). Positive = loss."""
    c = Crash(equity_drop=equity_drop)
    r = (
        weights.get("equity", 0) * c.equity_drop
        + weights.get("debt", 0) * c.debt_change
        + weights.get("gold", 0) * c.gold_change
    )
    return -r
