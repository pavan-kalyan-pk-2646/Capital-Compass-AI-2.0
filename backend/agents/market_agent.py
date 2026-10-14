"""Market Agent — market intelligence from local history (no live feed, no key)."""

from __future__ import annotations

from market import loader


def brief() -> dict:
    s = loader.stats()
    r = s["regime"]
    return {
        "regime": r["label"],
        "regime_percentile": r["percentile_vs_history"],
        "trailing_vol_pct": r["trailing_12m_vol_pct"],
        "as_of": r["as_of"],
        "equity_cagr_pct": s["equity"]["cagr_pct"],
        "equity_vol_pct": s["equity"]["vol_pct"],
        "equity_months": s["equity"]["months"],
        "equity_max_drawdown_pct": s["equity"]["max_drawdown_pct"],
        "debt_cagr_pct": s["debt"]["cagr_pct"],
        "summary": (
            f"{r['label'].title()} regime: trailing 12-month NIFTY volatility "
            f"{r['trailing_12m_vol_pct']:.1f}% ({r['percentile_vs_history']:.0f}th "
            f"percentile since 2000, data to {r['as_of']}). Long-run equity "
            f"{s['equity']['cagr_pct']:.1f}%/yr, debt {s['debt']['cagr_pct']:.1f}%/yr."
        ),
    }
