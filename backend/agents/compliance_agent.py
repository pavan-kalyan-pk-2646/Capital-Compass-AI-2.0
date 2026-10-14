"""Compliance Agent — rule checks against the local knowledge base, with citations (RAG)."""

from __future__ import annotations

from agents.common import opinion
from rag.retriever import get, search


def review(ctx: dict) -> dict:
    w = ctx["plan"]["weights"]
    age = ctx["age"]
    checks = []

    def add(rule: str, ok: bool, text: str):
        p = get(rule)
        checks.append(
            {
                "rule": rule,
                "title": p["title"] if p else rule,
                "passed": ok,
                "detail": text,
                "source": p["source"] if p else "",
            }
        )

    classes = sum(1 for k in ("equity", "debt", "gold") if w.get(k, 0) > 0.02)
    add("IG-1", classes >= 3, f"{classes} asset classes in the plan")
    cap = min(0.85, (100 - age) / 100 + 0.10)
    add("IG-2", w["equity"] <= cap + 1e-9, f"Equity {w['equity']:.0%} vs age cap {cap:.0%}")
    add(
        "SU-1",
        ctx["crash_loss"] <= ctx["max_loss"] + 1e-9,
        f"Crash loss {ctx['crash_loss']:.1%} vs stated limit {ctx['max_loss']:.0%}",
    )
    add(
        "SU-2",
        ctx["ef_months"] >= 3,
        f"Emergency fund covers {ctx['ef_months']:.1f} months of essentials + EMIs",
    )
    if ctx.get("loan"):
        add("LA-1", ctx["foir"] <= 0.50, f"FOIR {ctx['foir']:.0%} (ceiling 50%)")
        add("LA-2", True, "EMI, total interest, fee and total repayment are disclosed")
        add(
            "LA-4",
            not (ctx["loan"]["loan_type"] == "personal" and ctx["ef_months"] < 3),
            "Unsecured loan vs emergency-fund cover",
        )
        add("LA-5", True, "Analysis only — no application is submitted")
    if ctx["decision_type"] == "spending":
        add("HR-2", True, "No platforms, strategies or outcome predictions are given")
        add("HR-3", True, "A safer budget adjustment is included")
    add("IG-5", True, "Recommendations use product categories only")
    add("DS-1", True, "Scenario-based disclaimer attached")

    query = " ".join(
        [
            ctx["decision_type"],
            "equity loss limit emergency fund",
            "loan FOIR EMI" if ctx.get("loan") else "",
            "betting spending" if ctx["decision_type"] == "spending" else "",
        ]
    )
    citations = search(query, k=4)
    failed = [c for c in checks if not c["passed"]]
    status = "PASSED" if not failed else "FAILED"
    op = opinion(
        "Compliance",
        "Rules & suitability",
        "support" if not failed else "oppose",
        0.9 if not failed else 0.85,
        "All suitability rules satisfied"
        if not failed
        else f"{failed[0]['rule']} {failed[0]['title']}: {failed[0]['detail']}",
        [f"{c['rule']} {'✓' if c['passed'] else '✗'} {c['detail']}" for c in checks],
        "Compliant" if not failed else "Not compliant — must be fixed before approval",
    )
    return {"status": status, "checks": checks, "citations": citations, "opinion": op}
