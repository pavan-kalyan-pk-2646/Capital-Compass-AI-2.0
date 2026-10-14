"""Shared shape for every committee agent's output. Agents read engine numbers only."""

from __future__ import annotations


def opinion(
    agent: str,
    role: str,
    stance: str,
    confidence: float,
    key_concern: str,
    reasoning: list[str],
    decision: str,
) -> dict:
    return {
        "agent": agent,
        "role": role,
        "stance": stance,  # support | conditional | oppose
        "confidence": round(max(0.05, min(confidence, 0.99)), 2),
        "key_concern": key_concern,
        "reasoning": reasoning,
        "decision": decision,
    }


def pct(x: float | None) -> str:
    return "n/a" if x is None else f"{x:.0%}"
