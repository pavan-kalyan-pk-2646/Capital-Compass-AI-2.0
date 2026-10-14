"""Goal Survival engine.

required SIP  = shortfall after growing today's corpus, spread over the months (finance_math)
probability   = share of 10,000 simulated futures where the goal corpus ≥ target, under:
  normal          the bootstrap as-is
  bear            equity drift −6 %/yr and volatility ×1.25 for the whole horizon
  crash           NIFTY −30 % in month 1 (gold +5 %), then normal markets
  crash_job_loss  the crash plus 6 months without salary (SIP pauses, cash pays the bills)
All four use the same seed, so the differences come from the scenario alone.
"""

from __future__ import annotations

from engines.digital_twin import Twin
from engines.finance_math import required_monthly_sip
from engines.plan import Plan, goal_context, run
from engines.portfolio_engine import expected_return
from engines.simulation_engine import Crash
from schemas.profile import ProfileInput

SCENARIOS = {
    "normal": {},
    "bear": {"equity_return_shift_pct": -6.0, "vol_multiplier": 1.25},
    "crash": {"crash": Crash()},
    "crash_job_loss": {"crash": Crash(), "job_loss_months": 6},
}

LABELS = {
    "normal": "Normal market",
    "bear": "Bear market",
    "crash": "Market crash (NIFTY −30%)",
    "crash_job_loss": "Crash + 6-month job loss",
}


def survival(
    p: ProfileInput,
    twin: Twin,
    plan: Plan,
    *,
    target: float | None = None,
    years: float | None = None,
    monthly_sip: float | None = None,
    current_corpus: float | None = None,
    expected_return_pct: float | None = None,
    seed: int = 42,
) -> dict:
    """`current_corpus` replaces today's invested amount; `expected_return_pct` is the user's
    own return assumption: it sets the required SIP and shifts simulated equity drift so the
    portfolio's long-run return matches it (the spread of outcomes still comes from history)."""
    gc = goal_context(p, twin)
    if current_corpus is not None:
        gc = {**gc, "start_corpus": float(current_corpus)}
    target = target if target is not None else gc["target"]
    months = round(years * 12) if years else gc["months"]
    if not target:
        raise ValueError("A goal target is required for goal survival")
    if monthly_sip is not None:
        plan = plan.with_(monthly_sip=float(monthly_sip))
    hist_ret = expected_return(plan.weights)
    exp_ret = hist_ret if expected_return_pct is None else float(expected_return_pct)
    required = required_monthly_sip(target, gc["start_corpus"], exp_ret, months)
    extra: dict = {"start_portfolio": gc["start_corpus"]}
    if expected_return_pct is not None and plan.weights.get("equity", 0) > 0.05:
        extra["equity_return_shift_pct"] = (exp_ret - hist_ret) / plan.weights["equity"]

    scenarios = []
    normal_sim = None
    for key, ov in SCENARIOS.items():
        ov2 = {**extra, **ov}
        if "equity_return_shift_pct" in ov and "equity_return_shift_pct" in extra:
            ov2["equity_return_shift_pct"] = (
                ov["equity_return_shift_pct"] + extra["equity_return_shift_pct"]
            )
        sim = run(p, twin, plan, months=months, target=target, seed=seed, **ov2)
        if key == "normal":
            normal_sim = sim
        scenarios.append(
            {
                "scenario": key,
                "label": LABELS[key],
                "success_probability": sim["goal_success_probability"],
                "ending_p50": sim["ending"]["p50"],
                "ending_p5": sim["ending"]["p5"],
                "ending_p95": sim["ending"]["p95"],
                "shortfall_risk": None
                if sim["goal_success_probability"] is None
                else round(1 - sim["goal_success_probability"], 4),
                "shortfall_median": sim.get("shortfall_median"),
                "forced_liquidation_probability": sim["forced_liquidation_probability"],
            }
        )
    return {
        "goal_name": gc["name"],
        "target_amount": target,
        "months": months,
        "start_corpus": gc["start_corpus"],
        "expected_return_pct": round(exp_ret, 2),
        "historical_return_pct": round(hist_ret, 2),
        "return_assumption": "user" if expected_return_pct is not None else "history",
        "ending_wealth": normal_sim["ending"] if normal_sim else None,
        "shortfall_risk": None
        if not normal_sim or normal_sim["goal_success_probability"] is None
        else round(1 - normal_sim["goal_success_probability"], 4),
        "shortfall_median": normal_sim.get("shortfall_median") if normal_sim else None,
        "required_monthly_sip": round(required),
        "current_monthly_sip": round(plan.monthly_sip),
        "sip_gap": round(max(0.0, required - plan.monthly_sip)),
        "scenarios": scenarios,
        "simulation": normal_sim,
        "plan": plan.to_dict(),
    }


# ---------- Goal Survival Theatre ----------
# Extra shocks shown only in the theatre. Each reuses an existing, documented model:
#   job_loss        6 months without salary (SIP pauses, cash pays essentials + EMIs)
#   inflation       inflation 5 pts above the 5.5% base; the target is re-priced by the excess
#                   inflation (decision_engine.excess_inflation_multiplier), as in the Red Team
#   rate_shock      floating-rate and new-loan EMIs re-priced at +2.5 pts
#                   (decision_engine.total_emi_after_shock), as in the Red Team
THEATRE_LABELS = {
    **LABELS,
    "job_loss": "6-month job loss",
    "inflation": "Inflation shock (+5 pts)",
    "rate_shock": "Interest-rate shock (+2.5 pts)",
}
THEATRE_ORDER = ["normal", "bear", "crash", "job_loss", "inflation", "rate_shock", "crash_job_loss"]


def _scene(key: str, sim: dict, target: float, required: float) -> dict:
    return {
        "scenario": key,
        "label": THEATRE_LABELS[key],
        "target": round(target),
        "required_monthly_sip": round(required),
        "success_probability": sim["goal_success_probability"],
        "ending": sim["ending"],
        "shortfall_median": sim.get("shortfall_median"),
        "max_drawdown": sim["max_drawdown"],
        "recovery_months_median": sim["recovery_months_median"],
        "prob_unrecovered": sim["prob_unrecovered"],
        "forced_liquidation_probability": sim["forced_liquidation_probability"],
        "percentiles": sim["percentiles"],
        "sample_paths": sim["sample_paths"],
        "density": sim.get("density"),
    }


def theatre(
    p: ProfileInput,
    twin: Twin,
    plan: Plan,
    base: dict,
    *,
    expected_return_pct: float | None = None,
    paths: int = 240,
    density_bins: int = 36,
    seed: int = 42,
) -> dict:
    """Everything the 3D Goal Survival Theatre draws, from the same simulations as `survival`.

    `base` is the result of `survival(...)` for the same inputs. The visual layer gets more of
    the already-simulated paths (`paths` sampled from the 10,000 for the normal market, fewer for
    each shock) and the share of ALL paths in each wealth band over time. The simulation count
    itself is unchanged. `optimized` re-runs the normal market with the SIP set to the required
    SIP, so the before/after compares two real runs.
    """
    from engines.decision_engine import excess_inflation_multiplier, total_emi_after_shock

    target = float(base["target_amount"])
    months = int(base["months"])
    start = float(base["start_corpus"])
    sip = float(base["current_monthly_sip"])
    plan = plan.with_(monthly_sip=sip)
    hist_ret = expected_return(plan.weights)
    exp_ret = hist_ret if expected_return_pct is None else float(expected_return_pct)
    extra: dict = {"start_portfolio": start}
    if expected_return_pct is not None and plan.weights.get("equity", 0) > 0.05:
        extra["equity_return_shift_pct"] = (exp_ret - hist_ret) / plan.weights["equity"]
    stress_paths = max(40, round(paths * 0.4))
    infl_target = target * excess_inflation_multiplier(5.0, months)
    shocked_emi = total_emi_after_shock(p, plan) - (plan.loan.emi if plan.loan else 0.0)
    specs = {
        "normal": ({}, target),
        "bear": (SCENARIOS["bear"], target),
        "crash": (SCENARIOS["crash"], target),
        "crash_job_loss": (SCENARIOS["crash_job_loss"], target),
        "job_loss": ({"job_loss_months": 6}, target),
        "inflation": ({"inflation_pct": 10.5}, infl_target),
        "rate_shock": ({"monthly_emi": max(twin.monthly_emi, shocked_emi)}, target),
    }
    scenes = []
    for key in THEATRE_ORDER:
        ov, tgt = specs[key]
        ov2 = {**extra, **ov}
        if "equity_return_shift_pct" in ov and "equity_return_shift_pct" in extra:
            ov2["equity_return_shift_pct"] = (
                ov["equity_return_shift_pct"] + extra["equity_return_shift_pct"]
            )
        sim = run(
            p,
            twin,
            plan,
            months=months,
            target=tgt,
            seed=seed,
            sample_paths=paths if key == "normal" else stress_paths,
            density_bins=density_bins,
            **ov2,
        )
        required = required_monthly_sip(tgt, start, exp_ret, months)
        scenes.append(_scene(key, sim, tgt, required))

    optimized = None
    if base["sip_gap"] > 0:
        req = float(base["required_monthly_sip"])
        sim = run(
            p,
            twin,
            plan.with_(monthly_sip=req),
            months=months,
            target=target,
            seed=seed,
            sample_paths=stress_paths,
            **extra,
        )
        optimized = {
            "monthly_sip": round(req),
            "success_probability": sim["goal_success_probability"],
            "ending": sim["ending"],
            "shortfall_median": sim.get("shortfall_median"),
            "max_drawdown": sim["max_drawdown"],
            "percentiles": sim["percentiles"],
            "sample_paths": sim["sample_paths"],
        }
    return {
        "months": months,
        "target": target,
        "start_corpus": start,
        "expected_return_pct": round(exp_ret, 2),
        "paths_sampled": paths,
        "n_paths": base["simulation"]["n_paths"],
        "scenarios": scenes,
        "optimized": optimized,
    }
