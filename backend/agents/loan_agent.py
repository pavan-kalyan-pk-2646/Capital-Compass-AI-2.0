"""Loan Agent — narrates the loan analysis for the router stage."""

from __future__ import annotations

from utils.inr import inr, inr_short


def brief(a: dict) -> str:
    return (
        f"{inr_short(a['loan']['amount'])} {a['loan']['loan_type']} loan at "
        f"{a['loan']['annual_rate_pct']:g}% for {a['loan']['tenure_months']} months: EMI "
        f"{inr(a['emi'])}, total interest {inr_short(a['total_interest'])}, FOIR "
        f"{a['foir_before']:.0%} → {a['foir_after']:.0%}, debt stress "
        f"{a['debt_stress_score']:.0f}/100 ({a['risk_band']}). Verdict: "
        f"{a['recommendation']}"
    )
