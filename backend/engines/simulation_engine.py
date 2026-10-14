"""Monte Carlo simulation engine — 10,000 possible futures, never one constant return.

Scenario generator
------------------
Historical returns + current market regime + volatility → scenario generator:

* Equity and debt: **block bootstrap** of real monthly history (market/loader.py). Each path
  stitches random 6-month blocks of actual NIFTY 50 total returns; debt returns are drawn from
  the *same* months, so the cross-asset relationship of each historical period is preserved.
* Regime: deviations from the historical mean are scaled by the regime factor
  (calm 0.9 · normal 1.0 · volatile 1.25) and by an optional `vol_multiplier`.
* Gold: Student-t (df=5) draws with the parametric mean/vol in market/loader.py, lightly
  correlated with the same path's equity shocks.
* Inflation: one annual rate per path ~ N(mean, sd), used for real-value outputs.

Cash-flow model (monthly, vectorised across all paths)
------------------------------------------------------
portfolio_t = portfolio_{t-1} · (1 + r_p,t) + SIP_t            (monthly-rebalanced weights)
cash_t      = cash_{t-1} · (1 + r_cash) + income_t − expenses − EMI − SIP_t − one-off_t
If cash goes negative the shortfall is sold from the portfolio (forced liquidation).
SIP stops in job-loss months and spending falls to essentials only.
Goal corpus = portfolio + max(0, cash − starting cash), i.e. savings above the emergency
fund count toward the goal; the emergency fund itself does not.

Outputs
-------
Percentile bands P5/P25/P50/P75/P95 of goal corpus per month, ending-wealth distribution,
goal success probability, drawdown distribution (on the unit NAV, so contributions don't
mask losses), recovery time, probability of forced liquidation, and a few sample paths.
The same `seed` gives identical results; scenarios that share a seed use common random
numbers, so differences between them come from the scenario, not from noise.
"""

from __future__ import annotations

import contextvars
import copy
import time
from collections import OrderedDict
from dataclasses import dataclass, field

import numpy as np

from market import loader

BLOCK = 6

# Per-request tally of simulated paths (the Trust Center reports it)
_tally: contextvars.ContextVar[list | None] = contextvars.ContextVar("sim_tally", default=None)


def start_tally() -> list:
    t = [0, 0]  # [runs, paths]
    _tally.set(t)
    return t


@dataclass
class Crash:
    month: int = 0
    equity_drop: float = -0.30
    debt_change: float = 0.0
    gold_change: float = 0.05


@dataclass
class SimConfig:
    months: int
    weights: dict[str, float]  # equity / debt / gold, sums to 1
    start_portfolio: float
    start_cash: float
    monthly_sip: float
    monthly_income: float
    monthly_expenses: float
    monthly_emi: float = 0.0
    essential_expenses: float | None = None  # spend while unemployed (discretionary cut)
    target: float | None = None
    n_paths: int = 10_000
    seed: int = 42
    regime: str | None = None  # None → detected regime
    equity_return_shift_pct: float = 0.0  # annual, added to equity drift
    vol_multiplier: float = 1.0
    income_change_pct: float = 0.0  # permanent change from month 0
    inflation_pct: float | None = None  # override mean inflation
    crash: Crash | None = None
    job_loss_months: int = 0
    job_loss_start: int = 0
    one_off_expense: float = 0.0
    one_off_month: int = 0
    real_target: bool = False  # inflate target by each path's inflation
    max_loss_pct: float | None = None
    sample_paths: int = 24
    points: int = 61  # resolution of the percentile series
    density_bins: int = 0  # >0: also return the share of all paths in each wealth band over time
    extra: dict = field(default_factory=dict)


def _equity_debt(cfg: SimConfig, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    h = loader.history()
    n, t = cfg.n_paths, cfg.months
    nb = -(-t // BLOCK)
    starts = rng.integers(0, len(h.equity) - BLOCK + 1, size=(n, nb))
    idx = (starts[:, :, None] + np.arange(BLOCK)).reshape(n, nb * BLOCK)[:, :t]
    eq = h.equity[idx]
    debt = h.debt[idx]
    regime = cfg.regime or h.regime
    scale = loader.REGIME_SCALE.get(regime, 1.0) * cfg.vol_multiplier
    mu = h.equity.mean()
    eq = mu + (eq - mu) * scale + cfg.equity_return_shift_pct / 1200.0
    return eq, debt


def _gold(cfg: SimConfig, rng: np.random.Generator, eq: np.ndarray) -> np.ndarray:
    df = 5
    sd_m = loader.GOLD_ANNUAL_VOL_PCT / 100 / np.sqrt(12)
    mu_m = (1 + loader.GOLD_ANNUAL_MEAN_PCT / 100) ** (1 / 12) - 1
    z = rng.standard_t(df, size=eq.shape) * np.sqrt((df - 2) / df)
    e = (eq - eq.mean()) / (eq.std() + 1e-12)
    rho = loader.GOLD_EQUITY_CORR
    return mu_m + sd_m * (rho * e + np.sqrt(1 - rho**2) * z)


def _pct_series(arr: np.ndarray, points: int) -> dict:
    t = arr.shape[1] - 1
    cols = np.unique(np.linspace(0, t, min(points, t + 1)).round().astype(int))
    q = np.percentile(arr[:, cols], [5, 25, 50, 75, 95], axis=0)
    return {
        "month": cols.tolist(),
        "p5": q[0].round(0).tolist(),
        "p25": q[1].round(0).tolist(),
        "p50": q[2].round(0).tolist(),
        "p75": q[3].round(0).tolist(),
        "p95": q[4].round(0).tolist(),
    }


_CACHE: OrderedDict[str, dict] = OrderedDict()
_CACHE_SIZE = 128


def simulate(cfg: SimConfig) -> dict:
    """Cached wrapper: identical configs (same seed) return the stored result instantly."""
    key = repr(cfg)
    hit = _CACHE.get(key)
    tally = _tally.get()
    if hit is not None:
        _CACHE.move_to_end(key)
        if tally is not None:
            tally[0] += 1
            tally[1] += cfg.n_paths
        out = copy.deepcopy(hit)
        out["cached"] = True
        return out
    res = _simulate(cfg)
    _CACHE[key] = copy.deepcopy(res)
    if len(_CACHE) > _CACHE_SIZE:
        _CACHE.popitem(last=False)
    return res


def _simulate(cfg: SimConfig) -> dict:
    t0 = time.perf_counter()
    if cfg.months < 1 or cfg.months > 600:
        raise ValueError("months must be between 1 and 600")
    if cfg.n_paths < 100 or cfg.n_paths > 50_000:
        raise ValueError("n_paths must be between 100 and 50,000")
    tally = _tally.get()
    if tally is not None:
        tally[0] += 1
        tally[1] += cfg.n_paths
    w = {k: max(0.0, float(cfg.weights.get(k, 0.0))) for k in ("equity", "debt", "gold")}
    tot = sum(w.values()) or 1.0
    w = {k: v / tot for k, v in w.items()}

    rng = np.random.default_rng(cfg.seed)
    n, T = cfg.n_paths, cfg.months
    eq, debt = _equity_debt(cfg, rng)
    gold = _gold(cfg, rng, eq)
    infl_mean = loader.INFLATION_MEAN_PCT if cfg.inflation_pct is None else cfg.inflation_pct
    inflation = rng.normal(infl_mean, loader.INFLATION_SD_PCT, size=n) / 100

    r_p = w["equity"] * eq + w["debt"] * debt + w["gold"] * gold
    cash_r = (1 + loader.CASH_ANNUAL_PCT / 100) ** (1 / 12) - 1

    port = np.full(n, float(cfg.start_portfolio))
    cash = np.full(n, float(cfg.start_cash))
    nav = np.ones(n)
    peak = np.ones(n)
    max_dd = np.zeros(n)
    forced = np.zeros(n, dtype=bool)
    min_cash = cash.copy()
    trough_month = np.full(n, -1)
    recovered_month = np.full(n, -1)
    corpus = np.empty((n, T + 1))
    corpus[:, 0] = port + 0.0

    income = cfg.monthly_income * (1 + cfg.income_change_pct / 100)
    crash_r = 0.0
    if cfg.crash:
        c = cfg.crash
        crash_r = (
            w["equity"] * c.equity_drop + w["debt"] * c.debt_change + w["gold"] * c.gold_change
        )

    for m in range(T):
        r = r_p[:, m]
        if cfg.crash and m == cfg.crash.month:
            r = (1 + r) * (1 + crash_r) - 1
        port *= 1 + r
        nav *= 1 + r
        peak = np.maximum(peak, nav)
        dd = nav / peak - 1
        deeper = dd < max_dd
        max_dd = np.where(deeper, dd, max_dd)
        trough_month = np.where(deeper, m, trough_month)
        recovered_month = np.where(deeper, -1, recovered_month)
        newly_rec = (recovered_month < 0) & (trough_month >= 0) & (dd >= -1e-9)
        recovered_month = np.where(newly_rec, m, recovered_month)

        unemployed = cfg.job_loss_start <= m < cfg.job_loss_start + cfg.job_loss_months
        inc = 0.0 if unemployed else income
        sip = 0.0 if unemployed else cfg.monthly_sip
        base = cfg.monthly_expenses
        if unemployed and cfg.essential_expenses is not None:
            base = cfg.essential_expenses
        spend = base + cfg.monthly_emi
        if cfg.one_off_expense and m == cfg.one_off_month:
            spend += cfg.one_off_expense
        cash = cash * (1 + cash_r) + inc - spend - sip
        port += sip
        short = cash < 0
        if short.any():
            forced |= short
            port = np.where(short, port + cash, port)
            cash = np.where(short, 0.0, cash)
        port = np.maximum(port, 0.0)
        min_cash = np.minimum(min_cash, cash)
        corpus[:, m + 1] = port + np.maximum(0.0, cash - cfg.start_cash)

    ending = corpus[:, -1]
    years = T / 12
    real_factor = (1 + inflation) ** years
    target_by_path = None
    success = None
    shortfall_median = None
    if cfg.target:
        target_by_path = cfg.target * (real_factor if cfg.real_target else 1.0)
        success = float((ending >= target_by_path).mean())
        gap = target_by_path - ending
        miss = gap[gap > 0]
        shortfall_median = float(np.median(miss)) if miss.size else 0.0

    had_dd = max_dd < -0.05
    rec = np.where(recovered_month >= 0, recovered_month - trough_month, np.nan)
    rec_valid = rec[had_dd & ~np.isnan(rec)]
    unrecovered = float((had_dd & np.isnan(rec)).mean())

    pick = rng.choice(n, size=min(cfg.sample_paths, n), replace=False)
    cols = np.unique(np.linspace(0, T, min(cfg.points, T + 1)).round().astype(int))
    ending_q = np.percentile(ending, [5, 25, 50, 75, 95])

    result = {
        "n_paths": n,
        "months": T,
        "seed": cfg.seed,
        "regime": cfg.regime or loader.history().regime,
        "weights": {k: round(v, 4) for k, v in w.items()},
        "monthly_sip": round(cfg.monthly_sip),
        "target": cfg.target,
        "percentiles": _pct_series(corpus, cfg.points),
        "sample_paths": corpus[pick][:, cols].round(0).tolist(),
        "ending": {
            "p5": round(float(ending_q[0])),
            "p25": round(float(ending_q[1])),
            "p50": round(float(ending_q[2])),
            "p75": round(float(ending_q[3])),
            "p95": round(float(ending_q[4])),
            "mean": round(float(ending.mean())),
            "p50_real": round(float(np.median(ending / real_factor))),
        },
        "goal_success_probability": None if success is None else round(success, 4),
        "shortfall_median": None if shortfall_median is None else round(shortfall_median),
        "max_drawdown": {
            "p50": round(float(np.median(max_dd)), 4),
            "p95": round(float(np.percentile(max_dd, 5)), 4),  # 95th-worst
        },
        "prob_loss_beyond_limit": None
        if cfg.max_loss_pct is None
        else round(float((max_dd < -cfg.max_loss_pct / 100).mean()), 4),
        "recovery_months_median": None if rec_valid.size == 0 else float(np.median(rec_valid)),
        "prob_unrecovered": round(unrecovered, 4),
        "forced_liquidation_probability": round(float(forced.mean()), 4),
        "min_cash_p5": round(float(np.percentile(min_cash, 5))),
        "contributions_total": round(cfg.monthly_sip * T),
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1),
    }
    if cfg.density_bins > 0:
        result["density"] = _density(corpus[:, cols], cols, cfg.density_bins)
    return result


def _density(snap: np.ndarray, cols: np.ndarray, bins: int) -> dict:
    """Share of ALL simulated paths in each wealth band at each time point (each column sums
    to 1). The band edges run from 0 to the 99.5th percentile of the highest month, so a few
    extreme paths do not flatten the picture; paths above the top edge count in the top band."""
    hi = float(np.percentile(snap, 99.5, axis=0).max()) or 1.0
    edges = np.linspace(0.0, hi, bins + 1)
    idx = np.clip(np.searchsorted(edges, snap, side="right") - 1, 0, bins - 1)
    n = snap.shape[0]
    share = np.stack([np.bincount(idx[:, j], minlength=bins) / n for j in range(snap.shape[1])])
    return {
        "months": cols.tolist(),
        "edges": edges.round(0).tolist(),
        "share": share.round(4).tolist(),
    }


def summary(sim: dict) -> dict:
    """Small dict for agents/audit logs — no arrays."""
    return {
        "n_paths": sim["n_paths"],
        "goal_success_probability": sim["goal_success_probability"],
        "ending_p5": sim["ending"]["p5"],
        "ending_p50": sim["ending"]["p50"],
        "ending_p95": sim["ending"]["p95"],
        "max_drawdown_p95": sim["max_drawdown"]["p95"],
        "forced_liquidation_probability": sim["forced_liquidation_probability"],
        "recovery_months_median": sim["recovery_months_median"],
    }
