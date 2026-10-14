"""Atlas: the Capital Health Index and the next-action guidance, from existing engine outputs.

Nothing here invents a number. Every input is a metric another engine already computed:
the Digital Twin (`build_twin`), Risk DNA (`compute_risk_dna`), the Command Center goal
simulations (4,000 paths per goal) and the holdings health check (`/api/dashboard`).

Capital Health Index (0–100) = weighted mean of five pillars, each 0–100:

    Liquidity   (0.20)  min(emergency_fund_months, 6) / 6 × 100          Twin sub-score
    Debt        (0.20)  (1 − EMI/income ÷ 0.50) × 100, clamped 0–100        Twin sub-score
    Goals       (0.25)  primary-goal success probability × 100            Goal simulation
    Growth      (0.15)  min(1, current monthly investment ÷ monthly
                        investment the primary goal needs) × 100          Risk DNA requirement
                        — with no goal requirement: the savings-rate sub-score (30% = 100)
    Resilience  (0.20)  Risk DNA "Financial Resilience" dimension         Risk DNA

A pillar with no data (no goal set) is left out and the remaining weights are renormalised;
the response says so. Bands: ≥80 strong, ≥60 stable, ≥40 stretched, else fragile.

Next action: ordered threshold rules over the same metrics. The first rule that fires is the
recommendation; the others are listed as further findings. Each finding is a code plus the
numbers that triggered it, so the interface can phrase it in any language without the server
writing free text. Rules (first match wins):

    1. spending_gap        monthly surplus < 0
    2. emergency_low       emergency fund < 3 months of essentials + EMIs
    3. debt_high           EMIs > 40% of income
    4. debt_rising         EMIs > 30% of income
    5. high_risk_spending  any high-risk spending in the budget
    6. goal_at_risk        primary goal success < 50%
    7. emergency_build     emergency fund < 6 months
    8. portfolio_skew      one asset class > 60% of holdings, or equity > 15 pts off plan
    9. goal_watch          primary goal success < 75%
   10. no_decision         nothing above, and no completed decision yet
   11. stress_test         everything above is within range: test the plan against a crash
"""

from __future__ import annotations

from typing import Any

from engines.digital_twin import EF_TARGET_MONTHS, Twin, health_band
from engines.finance_math import clamp
from engines.risk_engine import RiskDNA

WEIGHTS = {"liquidity": 0.20, "debt": 0.20, "goals": 0.25, "growth": 0.15, "resilience": 0.20}

# Where each recommendation sends the user. Every route is a real page of the app.
ROUTES = {
    "spending_gap": "/twin",
    "emergency_low": "/crisis?scenario=job_loss",
    "debt_high": "/loan",
    "debt_rising": "/loan",
    "high_risk_spending": "/spending",
    "goal_at_risk": "/goals",
    "emergency_build": "/crisis?scenario=job_loss",
    "portfolio_skew": "/portfolio",
    "goal_watch": "/goals",
    "no_decision": "/committee",
    "stress_test": "/crisis?scenario=market_crash",
}


def _pillar(key: str, score: float | None, source: str, basis: dict[str, Any]) -> dict:
    return {
        "key": key,
        "score": None if score is None else round(clamp(score), 1),
        "weight": WEIGHTS[key],
        "source": source,
        "basis": basis,
    }


def capital_health_index(
    twin: Twin, dna: RiskDNA, primary_goal_probability: float | None, monthly_investment: float
) -> dict:
    required = float(dna.required_monthly_sip or 0.0)
    if required > 0:
        growth = min(1.0, monthly_investment / required) * 100
        growth_basis = {
            "monthly_investment": round(monthly_investment),
            "required": round(required),
        }
    else:
        growth = twin.sub_scores["savings_rate"]
        growth_basis = {"savings_rate": round(twin.savings_rate, 4), "target": 0.30}
    pillars = [
        _pillar(
            "liquidity",
            twin.sub_scores["emergency_fund"],
            "calculated",
            {"months": round(min(twin.emergency_fund_months, 99.0), 2), "target": EF_TARGET_MONTHS},
        ),
        _pillar("debt", twin.sub_scores["debt"], "calculated", {"dti": round(twin.dti, 4)}),
        _pillar(
            "goals",
            None if primary_goal_probability is None else primary_goal_probability * 100,
            "simulated",
            {"probability": primary_goal_probability},
        ),
        _pillar("growth", growth, "calculated", growth_basis),
        _pillar(
            "resilience",
            dna.score("financial_resilience"),
            "calculated",
            {"risk_dna_dimension": "financial_resilience"},
        ),
    ]
    scored = [p for p in pillars if p["score"] is not None]
    total_w = sum(p["weight"] for p in scored)
    index = sum(p["score"] * p["weight"] for p in scored) / total_w if total_w else 0.0
    return {
        "score": round(index, 1),
        "band": health_band(index),
        "pillars": pillars,
        "renormalised": len(scored) < len(pillars),
        "formula": "Weighted mean of the pillars that have data; weights "
        + ", ".join(f"{k} {int(w * 100)}%" for k, w in WEIGHTS.items()),
    }


# The Capital Health Index pillar each finding is about.
PILLAR_OF = {
    "spending_gap": "growth",
    "emergency_low": "liquidity",
    "debt_high": "debt",
    "debt_rising": "debt",
    "high_risk_spending": "growth",
    "goal_at_risk": "goals",
    "emergency_build": "liquidity",
    "portfolio_skew": "growth",
    "goal_watch": "goals",
    "no_decision": None,
    "stress_test": None,
}


def _finding(code: str, severity: str, **params: Any) -> dict:
    return {
        "code": code,
        "severity": severity,
        "route": ROUTES[code],
        "pillar": PILLAR_OF[code],
        "params": params,
    }


def findings(
    twin: Twin,
    primary_goal: dict | None,
    portfolio: dict | None,
    has_completed_decision: bool,
) -> list[dict]:
    """Every rule that fires, most urgent first (see the module docstring for the order)."""
    out: list[dict] = []
    ef = min(twin.emergency_fund_months, 99.0)
    if twin.monthly_surplus < 0:
        out.append(_finding("spending_gap", "red", shortfall=round(-twin.monthly_surplus)))
    if ef < 3:
        out.append(_finding("emergency_low", "red", months=round(ef, 1)))
    if twin.dti > 0.40:
        out.append(_finding("debt_high", "red", dti=round(twin.dti, 4)))
    elif twin.dti > 0.30:
        out.append(_finding("debt_rising", "amber", dti=round(twin.dti, 4)))
    if twin.high_risk_spending > 0:
        out.append(
            _finding("high_risk_spending", "amber", amount=round(twin.high_risk_spending))
        )
    prob = primary_goal.get("probability") if primary_goal else None
    if prob is not None and prob < 0.5:
        out.append(_finding("goal_at_risk", "red", goal=primary_goal["name"], probability=prob))
    if 3 <= ef < EF_TARGET_MONTHS:
        out.append(_finding("emergency_build", "amber", months=round(ef, 1)))
    if portfolio:
        off = abs(portfolio["equity_share"] - portfolio["target_equity"])
        if portfolio["largest_share"] > 0.6 or off > 0.15:
            out.append(
                _finding(
                    "portfolio_skew",
                    "amber",
                    largest_class=portfolio["largest_class"],
                    largest_share=portfolio["largest_share"],
                    equity_share=portfolio["equity_share"],
                    target_equity=portfolio["target_equity"],
                )
            )
    if prob is not None and 0.5 <= prob < 0.75:
        out.append(_finding("goal_watch", "amber", goal=primary_goal["name"], probability=prob))
    if not out and not has_completed_decision:
        out.append(_finding("no_decision", "blue"))
    if not out:
        out.append(_finding("stress_test", "blue"))
    return out


def strengths(index: dict, found: list[dict]) -> list[dict]:
    """Pillars at 80+ that no finding is about — what Atlas can honestly say is working."""
    flagged = {f["pillar"] for f in found}
    good = [
        p
        for p in index["pillars"]
        if p["score"] is not None and p["score"] >= 80 and p["key"] not in flagged
    ]
    return sorted(good, key=lambda p: -p["score"])


def brief(
    twin: Twin,
    dna: RiskDNA,
    goals: list[dict],
    portfolio: dict | None,
    monthly_investment: float,
    has_completed_decision: bool,
) -> dict:
    primary = next((g for g in goals if g.get("primary")), goals[0] if goals else None)
    index = capital_health_index(
        twin, dna, primary.get("probability") if primary else None, monthly_investment
    )
    found = findings(twin, primary, portfolio, has_completed_decision)
    return {
        "health_index": index,
        "recommendation": found[0],
        "findings": found[1:],
        "strengths": strengths(index, found),
        "progress": {
            "twin": True,
            "risk": True,
            "goals": bool(goals),
            "portfolio": portfolio is not None,
        },
    }
