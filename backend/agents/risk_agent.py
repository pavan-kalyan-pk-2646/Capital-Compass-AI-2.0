"""Risk Agent — Risk DNA narrative and the committee's constraint checker."""

from __future__ import annotations

from agents.common import opinion


def dna_summary(dna: dict) -> str:
    s = dna["scores"]
    top = max(s, key=s.get)
    low = min(s, key=s.get)
    names = {d["key"]: d["label"] for d in dna["dimensions"]}
    return (
        f"{dna['label']} profile ({dna['profile_score']:.0f}/100). Strongest: "
        f"{names[top]} {s[top]:.0f}; weakest: {names[low]} {s[low]:.0f}"
    )


def opine(ctx: dict) -> dict:
    limit = ctx["max_loss"]
    breaches, warnings = [], []
    if ctx["crash_loss"] > limit + 1e-9:
        breaches.append(f"crash loss {ctx['crash_loss']:.1%} > {limit:.0%} limit")
    if ctx["ef_months"] < 4:
        breaches.append(f"emergency fund {ctx['ef_months']:.1f} months < 4")
    elif ctx["ef_months"] < 6:
        warnings.append(f"emergency fund {ctx['ef_months']:.1f} months (target 6)")
    if ctx["foir"] > 0.50:
        breaches.append(f"FOIR {ctx['foir']:.0%} > 50%")
    elif ctx["foir"] > 0.40:
        warnings.append(f"FOIR {ctx['foir']:.0%} above 40% comfort")
    if ctx["forced_liquidation_probability"] > 0.10:
        warnings.append(f"forced selling in {ctx['forced_liquidation_probability']:.0%} of futures")
    reasons = (
        [ctx["dna_summary"]]
        + [f"Breach: {b}" for b in breaches]
        + [f"Watch: {w}" for w in warnings]
    )
    if breaches:
        return opinion(
            "Risk",
            "Constraint guardian",
            "oppose",
            0.85,
            breaches[0].capitalize(),
            reasons,
            "Oppose until every hard limit holds",
        )
    if warnings:
        return opinion(
            "Risk",
            "Constraint guardian",
            "conditional",
            0.7,
            warnings[0].capitalize(),
            reasons,
            "Approve with the listed safeguards",
        )
    return opinion(
        "Risk",
        "Constraint guardian",
        "support",
        0.8,
        "All hard limits hold",
        reasons,
        "Approve: risk is inside your Risk DNA",
    )
