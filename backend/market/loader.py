"""Local market data — no network, no API keys.

Sources (all committed in market/data/):
  nifty50_daily.csv        NIFTY 50 daily OHLC + dividend yield, 2000-01 → 2024-01
  bond_annual_returns.csv  Indian debt annual returns, 2000 → 2023

Derived series (loaded once, cached):
  equity monthly TOTAL return = month-end price return + dividend yield / 12
  debt monthly return         = (1 + annual return of that calendar year)^(1/12) − 1
                                (only annual data exists, so it is spread evenly in the year)
  gold                        = parametric assumption (see GOLD_* below; no local history)
  cash                        = CASH_ANNUAL_PCT savings-account rate

Market regime: realised volatility of the last 12 months of equity returns, ranked against
every rolling 12-month window in history. <33rd percentile calm, >67th volatile.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

DATA_DIR = Path(__file__).resolve().parent / "data"

GOLD_ANNUAL_MEAN_PCT = 10.0  # long-run INR gold return assumption
GOLD_ANNUAL_VOL_PCT = 14.0
GOLD_EQUITY_CORR = -0.05
CASH_ANNUAL_PCT = 3.5
INFLATION_MEAN_PCT = 5.5
INFLATION_SD_PCT = 1.2

REGIME_SCALE = {"calm": 0.9, "normal": 1.0, "volatile": 1.25}


@dataclass(frozen=True)
class MarketHistory:
    months: list[str]  # YYYY-MM
    equity: np.ndarray  # monthly total returns
    debt: np.ndarray  # monthly returns aligned to `months`
    regime: str
    regime_vol_pct: float  # trailing 12m annualised vol
    regime_percentile: float
    as_of: str


def _load_equity() -> pd.DataFrame:
    df = pd.read_csv(DATA_DIR / "nifty50_daily.csv", parse_dates=["Date"])
    df["Close"] = pd.to_numeric(df["Close"], errors="coerce")
    df = df.sort_values("Date").dropna(subset=["Close"])
    df["ym"] = df["Date"].dt.to_period("M")
    counts = df.groupby("ym").size()
    full = counts[counts >= 15].index  # drop the partial final month
    m = df[df["ym"].isin(full)].groupby("ym").last()
    m["price_ret"] = m["Close"].pct_change()
    dy = pd.to_numeric(m["Div Yield %"], errors="coerce")
    m["div_ret"] = dy.fillna(dy.median()) / 100 / 12
    m["total"] = m["price_ret"] + m["div_ret"]
    return m.dropna(subset=["total"])


def _load_debt_annual() -> dict[int, float]:
    b = pd.read_csv(DATA_DIR / "bond_annual_returns.csv")
    return {int(y): float(r) for y, r in zip(b["Year"], b["Return"], strict=True)}


@lru_cache(maxsize=1)
def history() -> MarketHistory:
    eq = _load_equity()
    debt_annual = _load_debt_annual()
    fallback = float(np.mean(list(debt_annual.values())))
    years = [p.year for p in eq.index]
    debt = np.array([(1 + debt_annual.get(y, fallback)) ** (1 / 12) - 1 for y in years])
    equity = eq["total"].to_numpy(dtype=float)

    roll = pd.Series(equity).rolling(12).std().dropna().to_numpy() * np.sqrt(12)
    current = float(roll[-1])
    pct = float((roll < current).mean() * 100)
    regime = "calm" if pct < 33 else "volatile" if pct > 67 else "normal"

    return MarketHistory(
        months=[str(p) for p in eq.index],
        equity=equity,
        debt=debt,
        regime=regime,
        regime_vol_pct=round(current * 100, 2),
        regime_percentile=round(pct, 1),
        as_of=str(eq.index[-1]),
    )


def _max_drawdown(returns: np.ndarray) -> float:
    nav = np.cumprod(1 + returns)
    peak = np.maximum.accumulate(nav)
    return float((nav / peak - 1).min())


@lru_cache(maxsize=1)
def stats() -> dict:
    """Headline statistics shown in the Trust Center and used for expected returns."""
    h = history()
    n = len(h.equity)
    eq_cagr = float(np.prod(1 + h.equity) ** (12 / n) - 1)
    debt_cagr = float(np.prod(1 + h.debt) ** (12 / n) - 1)
    worst12 = float(min(np.prod(1 + h.equity[i : i + 12]) - 1 for i in range(n - 11)))
    return {
        "equity": {
            "source": "NIFTY 50 daily closes + dividend yield (local CSV)",
            "period": f"{h.months[0]} → {h.months[-1]}",
            "months": n,
            "cagr_pct": round(eq_cagr * 100, 2),
            "vol_pct": round(float(np.std(h.equity) * np.sqrt(12) * 100), 2),
            "worst_month_pct": round(float(h.equity.min() * 100), 2),
            "worst_12m_pct": round(worst12 * 100, 2),
            "max_drawdown_pct": round(_max_drawdown(h.equity) * 100, 2),
        },
        "debt": {
            "source": "Indian debt annual returns 2000–2023 (local CSV), spread monthly",
            "cagr_pct": round(debt_cagr * 100, 2),
        },
        "gold": {
            "source": "Parametric assumption (no local gold history)",
            "mean_pct": GOLD_ANNUAL_MEAN_PCT,
            "vol_pct": GOLD_ANNUAL_VOL_PCT,
            "equity_correlation": GOLD_EQUITY_CORR,
        },
        "cash": {"source": "Savings-account rate assumption", "rate_pct": CASH_ANNUAL_PCT},
        "inflation": {
            "source": "Assumption: annual CPI drawn per path",
            "mean_pct": INFLATION_MEAN_PCT,
            "sd_pct": INFLATION_SD_PCT,
        },
        "regime": {
            "label": h.regime,
            "trailing_12m_vol_pct": h.regime_vol_pct,
            "percentile_vs_history": h.regime_percentile,
            "as_of": h.as_of,
            "vol_scale": REGIME_SCALE[h.regime],
        },
    }


def expected_annual_returns() -> dict[str, float]:
    s = stats()
    return {
        "equity": s["equity"]["cagr_pct"],
        "debt": s["debt"]["cagr_pct"],
        "gold": GOLD_ANNUAL_MEAN_PCT,
        "cash": CASH_ANNUAL_PCT,
    }


def annual_vols() -> dict[str, float]:
    h = history()
    return {
        "equity": float(np.std(h.equity) * np.sqrt(12) * 100),
        "debt": float(np.std(h.debt) * np.sqrt(12) * 100),
        "gold": GOLD_ANNUAL_VOL_PCT,
        "cash": 0.0,
    }
