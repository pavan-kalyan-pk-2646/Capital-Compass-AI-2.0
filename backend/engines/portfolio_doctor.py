"""Portfolio Doctor — diagnose an existing portfolio and prescribe a rebalancing plan.

Input: holdings (symbol, asset_class, sector, value) from portfolio.csv or manual entry.

Scores (0–100, higher is healthier)
  diversification = (1 − HHI) / (1 − 1/n) · 100 over holdings           (HHI = Σ w²)
  concentration   = 100 − 4 · max(0, largest holding % − 10) − 2 · max(0, top sector % − 25)
  sector          = 100 − 3 · max(0, top equity sector share of equity − 30%)
  liquidity       = share of value in cash/debt/listed equity/gold (real estate & other are
                    illiquid) vs the Risk-DNA liquidity need
  risk            = 100 − 3 · |portfolio vol − target vol|, target vol from the recommended plan
  goal_alignment  = 100 − 2 · |equity share − recommended equity share| (in % points)
health = 0.20·div + 0.20·conc + 0.15·sector + 0.15·liquidity + 0.15·risk + 0.15·goal

Correlation model (no per-security history is stored locally, so a documented class/sector
model is used): same equity sector 0.85, different equity sectors 0.65, equity–debt 0.10,
equity–gold −0.05, debt–gold 0.10, anything–cash 0.
"""

from __future__ import annotations

import csv
import io

import numpy as np

from engines.finance_math import clamp
from engines.plan import Plan, run
from engines.portfolio_engine import expected_vol, weights_for
from market import loader
from schemas.profile import ProfileInput

CLASSES = ("equity", "debt", "gold", "cash", "real_estate", "other")
LIQUID = {"equity", "debt", "gold", "cash"}
CLASS_ALIASES = {
    "stock": "equity",
    "stocks": "equity",
    "equity": "equity",
    "mf": "equity",
    "equity_mf": "equity",
    "etf": "equity",
    "shares": "equity",
    "bond": "debt",
    "bonds": "debt",
    "debt": "debt",
    "fd": "debt",
    "ppf": "debt",
    "gold": "gold",
    "sgb": "gold",
    "cash": "cash",
    "savings": "cash",
    "real_estate": "real_estate",
    "property": "real_estate",
    "realestate": "real_estate",
    "other": "other",
    "crypto": "other",
}
MAX_HOLDING = 0.15
MAX_SECTOR = 0.30


class CsvError(ValueError):
    pass


def parse_csv(text: str) -> list[dict]:
    """Accepts headers symbol/name, asset_class/type, sector, value (or quantity × price)."""
    if not text or not text.strip():
        raise CsvError("The CSV file is empty")
    if len(text) > 500_000:
        raise CsvError("CSV is too large (max 500 KB)")
    reader = csv.DictReader(io.StringIO(text.strip()))
    if not reader.fieldnames:
        raise CsvError("CSV has no header row")
    cols = {c.strip().lower(): c for c in reader.fieldnames if c}
    sym = cols.get("symbol") or cols.get("name") or cols.get("asset") or cols.get("holding")
    cls = cols.get("asset_class") or cols.get("type") or cols.get("class")
    val = cols.get("value") or cols.get("amount") or cols.get("market_value")
    qty, price = cols.get("quantity") or cols.get("qty"), cols.get("price")
    if not sym or not cls or not (val or (qty and price)):
        raise CsvError(
            "CSV needs columns: symbol, asset_class, value (or quantity and price); "
            "sector is optional"
        )
    rows = []
    for i, r in enumerate(reader, start=2):
        name = (r.get(sym) or "").strip()
        if not name:
            continue
        raw_cls = (r.get(cls) or "").strip().lower().replace(" ", "_")
        ac = CLASS_ALIASES.get(raw_cls)
        if not ac:
            raise CsvError(
                f"Row {i}: unknown asset class '{r.get(cls)}' "
                f"(use equity, debt, gold, cash, real_estate or other)"
            )
        try:
            if val and (r.get(val) or "").strip():
                value = float(str(r.get(val)).replace(",", "").replace("₹", ""))
            else:
                value = float(str(r.get(qty)).replace(",", "")) * float(
                    str(r.get(price)).replace(",", "").replace("₹", "")
                )
        except (TypeError, ValueError) as exc:
            raise CsvError(f"Row {i}: value is not a number") from exc
        if value < 0 or value > 1e11:
            raise CsvError(f"Row {i}: value out of range")
        sector = (r.get(cols.get("sector", ""), "") or "").strip() or (
            "diversified" if ac == "equity" else ac
        )
        rows.append(
            {
                "symbol": name[:40],
                "asset_class": ac,
                "sector": sector[:40],
                "value": round(value, 2),
            }
        )
    if not rows:
        raise CsvError("No holdings found in the CSV")
    if len(rows) > 200:
        raise CsvError("Too many holdings (max 200)")
    return rows


def _corr(a: dict, b: dict) -> float:
    if a is b:
        return 1.0
    ca, cb = a["asset_class"], b["asset_class"]
    if "cash" in (ca, cb):
        return 0.0
    if ca == cb == "equity":
        return 0.85 if a["sector"].lower() == b["sector"].lower() else 0.65
    pair = {ca, cb}
    if pair == {"equity", "debt"}:
        return 0.10
    if pair == {"equity", "gold"}:
        return -0.05
    if pair == {"debt", "gold"}:
        return 0.10
    if ca == cb:
        return 0.70
    return 0.10


CLASS_VOL = {
    "equity": None,
    "debt": None,
    "gold": None,
    "cash": 0.0,
    "real_estate": 12.0,
    "other": 40.0,
}


def diagnose(
    p: ProfileInput, holdings: list[dict], target_plan: Plan, liquidity_need: float, seed: int = 42
) -> dict:
    if not holdings:
        raise CsvError("Add at least one holding")
    total = sum(h["value"] for h in holdings)
    if total <= 0:
        raise CsvError("Total portfolio value must be positive")
    vols = loader.annual_vols()
    hs = []
    for h in holdings:
        vol = (
            vols.get(h["asset_class"])
            if CLASS_VOL[h["asset_class"]] is None
            else CLASS_VOL[h["asset_class"]]
        )
        hs.append({**h, "weight": h["value"] / total, "vol": vol})
    w = np.array([h["weight"] for h in hs])
    n = len(hs)
    hhi = float((w**2).sum())
    div = clamp((1 - hhi) / (1 - 1 / n) * 100) if n > 1 else 0.0

    by_class = {c: 0.0 for c in CLASSES}
    for h in hs:
        by_class[h["asset_class"]] += h["weight"]
    eq_total = by_class["equity"]
    sectors: dict[str, float] = {}
    for h in hs:
        if h["asset_class"] == "equity":
            sectors[h["sector"]] = sectors.get(h["sector"], 0) + h["weight"]
    top_holding = max(hs, key=lambda h: h["weight"])
    top_sector, top_sector_w = max(sectors.items(), key=lambda kv: kv[1]) if sectors else ("—", 0.0)
    top_sector_share = top_sector_w / eq_total if eq_total > 0 else 0.0

    conc = clamp(
        100 - 4 * max(0, top_holding["weight"] * 100 - 10) - 2 * max(0, top_sector_w * 100 - 25)
    )
    sector_score = clamp(100 - 3 * max(0, top_sector_share * 100 - 30)) if eq_total > 0 else 100
    liquid = sum(h["weight"] for h in hs if h["asset_class"] in LIQUID)
    need = 0.6 + 0.4 * liquidity_need / 100  # liquid share wanted
    liq_score = clamp(liquid / need * 100)

    corr = np.array([[_corr(a, b) for b in hs] for a in hs])
    sig = np.array([h["vol"] for h in hs])
    cov = corr * np.outer(sig, sig)
    port_vol = float(np.sqrt(w @ cov @ w))
    target_vol = expected_vol(target_plan.weights)
    risk_score = clamp(100 - 3 * abs(port_vol - target_vol))
    goal_score = clamp(100 - 2 * abs(eq_total - target_plan.equity) * 100)

    health = (
        0.20 * div
        + 0.20 * conc
        + 0.15 * sector_score
        + 0.15 * liq_score
        + 0.15 * risk_score
        + 0.15 * goal_score
    )

    issues = []
    if top_holding["weight"] > MAX_HOLDING:
        issues.append(
            {
                "type": "concentration",
                "severity": "high" if top_holding["weight"] > 0.25 else "medium",
                "text": f"{top_holding['symbol']} is {top_holding['weight']:.0%} of the "
                f"portfolio (limit {MAX_HOLDING:.0%})",
            }
        )
    if top_sector_w > MAX_SECTOR:
        issues.append(
            {
                "type": "sector",
                "severity": "medium",
                "text": f"{top_sector} sector is {top_sector_w:.0%} of the portfolio "
                f"(limit {MAX_SECTOR:.0%})",
            }
        )
    high_corr = [
        (hs[i]["symbol"], hs[j]["symbol"])
        for i in range(n)
        for j in range(i + 1, n)
        if corr[i, j] >= 0.85 and hs[i]["weight"] + hs[j]["weight"] > 0.25
    ]
    if high_corr:
        a, b = high_corr[0]
        issues.append(
            {
                "type": "correlation",
                "severity": "medium",
                "text": f"{a} and {b} move together (same sector) and together exceed "
                "25% of the portfolio",
            }
        )
    if port_vol > target_vol + 3:
        issues.append(
            {
                "type": "risk",
                "severity": "high" if port_vol > target_vol + 8 else "medium",
                "text": f"Estimated volatility {port_vol:.1f}% vs {target_vol:.1f}% "
                "suited to your Risk DNA",
            }
        )
    if liquid < need:
        issues.append(
            {
                "type": "liquidity",
                "severity": "medium",
                "text": f"Only {liquid:.0%} is liquid; your liquidity need suggests {need:.0%}",
            }
        )
    if abs(eq_total - target_plan.equity) > 0.10:
        direction = "above" if eq_total > target_plan.equity else "below"
        issues.append(
            {
                "type": "goal_mismatch",
                "severity": "medium",
                "text": f"Equity is {eq_total:.0%}, {direction} the {target_plan.equity:.0%} "
                "your goal plan needs",
            }
        )
    if n < 3 or sum(1 for c in ("equity", "debt", "gold") if by_class[c] > 0.02) < 3:
        issues.append(
            {
                "type": "diversification",
                "severity": "low",
                "text": "Fewer than three asset classes — add debt and gold for balance",
            }
        )

    # Treatment: move each class to the plan's weights; trim single names / sectors to limits
    investable_total = total * (by_class["equity"] + by_class["debt"] + by_class["gold"])
    target_vals = {
        c: investable_total * target_plan.weights.get(c, 0) for c in ("equity", "debt", "gold")
    }
    trades = []
    for c in ("equity", "debt", "gold"):
        cur = total * by_class[c]
        delta = target_vals[c] - cur
        if abs(delta) > total * 0.01:
            trades.append(
                {
                    "action": "BUY" if delta > 0 else "SELL",
                    "target": c.title(),
                    "amount": round(abs(delta)),
                    "reason": f"Move {c} from {by_class[c]:.0%} toward "
                    f"{target_plan.weights.get(c, 0):.0%} of investable assets",
                }
            )
    for h in hs:
        if h["weight"] > MAX_HOLDING and h["asset_class"] == "equity":
            excess = (h["weight"] - MAX_HOLDING) * total
            trades.append(
                {
                    "action": "TRIM",
                    "target": h["symbol"],
                    "amount": round(excess),
                    "reason": f"Cap single holding at {MAX_HOLDING:.0%}; move proceeds "
                    "to a diversified index fund",
                }
            )

    # Goal check: simulate the current mix vs the prescribed mix with the same SIP
    cur_inv = by_class["equity"] + by_class["debt"] + by_class["gold"]
    if cur_inv > 0:
        cur_w = {c: by_class[c] / cur_inv for c in ("equity", "debt", "gold")}
    else:
        cur_w = weights_for(0.0)
    from engines.digital_twin import build_twin

    twin = build_twin(p)
    sim_cur = run(p, twin, target_plan.with_(weights=cur_w), seed=seed)
    sim_tgt = run(p, twin, target_plan, seed=seed)

    after_weights = {
        c: round(target_plan.weights.get(c, 0) * (cur_inv), 4) for c in ("equity", "debt", "gold")
    }
    for c in ("cash", "real_estate", "other"):
        after_weights[c] = round(by_class[c], 4)

    return {
        "total_value": round(total),
        "holdings": [
            {k: (round(v, 4) if isinstance(v, float) else v) for k, v in h.items()} for h in hs
        ],
        "health_score": round(health, 1),
        "health_label": "HEALTHY"
        if health >= 75
        else "NEEDS ATTENTION"
        if health >= 55
        else "AT RISK",
        "sub_scores": {
            "diversification": round(div, 1),
            "concentration": round(conc, 1),
            "sector_exposure": round(sector_score, 1),
            "liquidity": round(liq_score, 1),
            "risk": round(risk_score, 1),
            "goal_alignment": round(goal_score, 1),
        },
        "hhi": round(hhi, 4),
        "by_class": {k: round(v, 4) for k, v in by_class.items()},
        "sectors": {k: round(v, 4) for k, v in sorted(sectors.items(), key=lambda kv: -kv[1])},
        "portfolio_vol_pct": round(port_vol, 2),
        "target_vol_pct": round(target_vol, 2),
        "correlation": corr.round(2).tolist(),
        "symbols": [h["symbol"] for h in hs],
        "issues": issues,
        "treatment": trades,
        "allocation_before": {k: round(v, 4) for k, v in by_class.items()},
        "allocation_after": after_weights,
        "goal_probability_current": sim_cur["goal_success_probability"],
        "goal_probability_prescribed": sim_tgt["goal_success_probability"],
        "target_weights": target_plan.weights,
    }
