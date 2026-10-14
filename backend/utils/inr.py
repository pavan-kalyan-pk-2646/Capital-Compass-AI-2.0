"""Indian currency formatting: ₹5,00,000 · ₹25 L · ₹1.2 Cr."""

from __future__ import annotations


def _group(n: int) -> str:
    s = str(abs(n))
    if len(s) <= 3:
        return s
    head, tail = s[:-3], s[-3:]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return ",".join(parts) + "," + tail


def inr(value: float) -> str:
    """Full Indian grouping, no decimals: inr(500000) → '₹5,00,000'."""
    n = round(value)
    return ("−" if n < 0 else "") + "₹" + _group(n)


def inr_short(value: float) -> str:
    """Compact lakh/crore form: 2500000 → '₹25 L', 12000000 → '₹1.2 Cr'."""
    sign = "−" if value < 0 else ""
    v = abs(value)
    if v >= 1e7:
        return f"{sign}₹{v / 1e7:.2f}".rstrip("0").rstrip(".") + " Cr"
    if v >= 1e5:
        return f"{sign}₹{v / 1e5:.2f}".rstrip("0").rstrip(".") + " L"
    return sign + inr(v)


def pct(x: float, digits: int = 1) -> str:
    return f"{x * 100:.{digits}f}%"
