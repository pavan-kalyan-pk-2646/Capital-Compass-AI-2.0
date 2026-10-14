"""Investment decision engine — portfolio generation from the Digital Twin and Risk DNA.

Equity weight
-------------
appetite   = 0.55 · GrowthAppetite + 0.45 · TimeHorizon            (0–100)
equity     = 0.25 + 0.55 · appetite / 100
           − 0.15 · max(0, LiquidityNeed − 50) / 50                 (cash-hungry profiles)
           − 0.05 if the market regime is volatile
clamped to [0.15, min(0.85, (100 − age) / 100 + 0.10)]
gold       = 0.10 (0.05 when equity < 0.30)
debt       = 1 − equity − gold

Monthly investment
------------------
ef_gap      = max(0, 6 · (essential + EMI) − cash)
ef_topup    = min(0.30 · surplus, ef_gap / 12)       (rebuild the emergency fund within a year)
investable  = surplus − ef_topup
SIP         = min(max(1.15 · required SIP, current SIP), 0.90 · investable)
              (15% safety margin over the plan-rate requirement; 10% of surplus stays liquid)

The engine *proposes*; it does not check the user's loss limit. That is deliberately left to
the Red Team so the challenge step is independent of the proposal step.
"""

from __future__ import annotations

from engines.digital_twin import EF_TARGET_MONTHS, Twin
from engines.finance_math import clamp, required_monthly_sip
from engines.plan import Plan, crash_loss, goal_context, run
from engines.risk_engine import RiskDNA
from market import loader
from schemas.profile import ProfileInput
from utils.inr import inr

SIP_BUFFER = 0.90

INSTRUMENTS = {
    "equity": [
        ("Large-cap / NIFTY 50 index fund", 0.60),
        ("Flexi-cap or mid-cap fund", 0.30),
        ("Small-cap fund", 0.10),
    ],
    "debt": [("Short-duration debt fund / PPF / FD ladder", 1.0)],
    "gold": [("Gold ETF or Sovereign Gold Bond", 1.0)],
}


def equity_weight(p: ProfileInput, dna: RiskDNA, regime: str) -> float:
    appetite = 0.55 * dna.score("growth_appetite") + 0.45 * dna.score("time_horizon")
    eq = 0.25 + 0.55 * appetite / 100
    eq -= 0.15 * max(0.0, dna.score("liquidity_need") - 50) / 50
    if regime == "volatile":
        eq -= 0.05
    cap = min(0.85, (100 - p.age) / 100 + 0.10)
    return round(clamp(eq, 0.15, cap), 2)


def weights_for(equity: float) -> dict[str, float]:
    equity = round(clamp(equity, 0.0, 0.95), 4)
    gold = 0.05 if equity < 0.30 else 0.10
    return {"equity": equity, "debt": round(1 - equity - gold, 4), "gold": gold}


def expected_return(weights: dict[str, float]) -> float:
    er = loader.expected_annual_returns()
    return sum(weights[k] * er[k] for k in weights)


def expected_vol(weights: dict[str, float]) -> float:
    v = loader.annual_vols()
    rho = loader.GOLD_EQUITY_CORR
    we, wd, wg = weights["equity"], weights["debt"], weights["gold"]
    var = (we * v["equity"]) ** 2 + (wd * v["debt"]) ** 2 + (wg * v["gold"]) ** 2
    var += 2 * we * wg * v["equity"] * v["gold"] * rho
    return var**0.5


def plan_sip(
    p: ProfileInput, twin: Twin, weights: dict, extra_emi: float = 0.0, freed: float = 0.0
) -> tuple:
    """Return (sip, ef_topup, required_sip, affordable). `freed` = spending redirected."""
    gc = goal_context(p, twin)
    surplus = twin.monthly_surplus - extra_emi + freed
    ef_gap = max(
        0.0,
        EF_TARGET_MONTHS * (twin.essential_expenses + twin.monthly_emi + extra_emi)
        - float(p.assets.cash),
    )
    ef_topup = min(0.30 * max(surplus, 0.0), ef_gap / 12) if surplus > 0 else 0.0
    investable = max(0.0, surplus - ef_topup)
    required = 0.0
    if gc["target"]:
        required = required_monthly_sip(
            gc["target"], gc["start_corpus"], expected_return(weights), gc["months"]
        )
    wanted = max(required * 1.15, float(p.behaviour.current_monthly_investment))
    affordable = SIP_BUFFER * investable
    return min(wanted, affordable), ef_topup, required, affordable


def generate_plan(p: ProfileInput, twin: Twin, dna: RiskDNA, regime: str | None = None) -> Plan:
    regime = regime or loader.history().regime
    w = weights_for(equity_weight(p, dna, regime))
    sip, ef_topup, required, affordable = plan_sip(p, twin, w)
    notes = [
        f"Equity {w['equity']:.0%} from growth appetite {dna.score('growth_appetite'):.0f} and "
        f"time horizon {dna.score('time_horizon'):.0f} (Risk DNA)",
    ]
    if ef_topup > 0:
        notes.append(f"{inr(ef_topup)}/mo rebuilds the emergency fund toward 6 months")
    if required > affordable:
        notes.append(f"Goal needs {inr(required)}/mo but only {inr(affordable)}/mo is affordable")
    return Plan(
        weights=w,
        monthly_sip=round(sip),
        ef_topup=round(ef_topup),
        label="Proposed plan",
        notes=notes,
    )


def breakdown(plan: Plan, amount: float) -> list[dict]:
    rows = []
    for cls, w in plan.weights.items():
        for name, share in INSTRUMENTS[cls]:
            if cls == "equity" and name.startswith("Small") and w < 0.5:
                continue
            rows.append(
                {
                    "asset_class": cls,
                    "instrument": name,
                    "weight": 0.0,
                    "amount": 0.0,
                    "_raw": w * share,
                }
            )
    tot = {}
    for r in rows:
        tot[r["asset_class"]] = tot.get(r["asset_class"], 0) + r["_raw"]
    for r in rows:
        r["weight"] = round(
            r.pop("_raw") / tot[r["asset_class"]] * plan.weights[r["asset_class"]], 4
        )
        r["amount"] = round(r["weight"] * amount)
    return rows


def evaluate(p: ProfileInput, twin: Twin, plan: Plan, n_paths: int = 10_000, seed: int = 42):
    sim = run(p, twin, plan, n_paths=n_paths, seed=seed)
    return {
        "plan": plan.to_dict(),
        "expected_return_pct": round(expected_return(plan.weights), 2),
        "expected_vol_pct": round(expected_vol(plan.weights), 2),
        "crash_loss_pct": round(crash_loss(plan.weights) * 100, 2),
        "goal_success_probability": sim["goal_success_probability"],
        "ending_p5": sim["ending"]["p5"],
        "ending_p50": sim["ending"]["p50"],
        "ending_p95": sim["ending"]["p95"],
        "max_drawdown_p95": sim["max_drawdown"]["p95"],
        "prob_loss_beyond_limit": sim["prob_loss_beyond_limit"],
        "sim": sim,
    }


def alternatives(p: ProfileInput, twin: Twin, plan: Plan, seed: int = 42) -> list[dict]:
    """Lower-risk and higher-risk variants of the plan, simulated with the same seed."""
    out = []
    for label, delta in (("Lower risk", -0.20), ("Higher risk", +0.20)):
        w = weights_for(clamp(plan.equity + delta, 0.10, 0.90))
        alt = plan.with_(weights=w, label=label, notes=[])
        ev = evaluate(p, twin, alt, n_paths=10_000, seed=seed)
        ev.pop("sim")
        out.append(ev)
    return out


def analyze(p: ProfileInput, twin: Twin, dna: RiskDNA) -> dict:
    plan = generate_plan(p, twin, dna)
    ev = evaluate(p, twin, plan)
    gc = goal_context(p, twin)
    _, _, required, affordable = plan_sip(p, twin, plan.weights)
    return {
        **ev,
        "allocation": breakdown(plan, gc["start_corpus"]),
        "goal": {
            **gc,
            "required_monthly_sip": round(required),
            "affordable_sip": round(affordable),
        },
        "alternatives": alternatives(p, twin, plan),
        "regime": loader.history().regime,
    }
