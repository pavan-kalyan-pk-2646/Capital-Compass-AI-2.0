"""Closed-form finance primitives shared by every engine. Pure, deterministic."""


def monthly_rate(annual_pct: float) -> float:
    """Nominal annual % → monthly decimal rate: r = annual / 12 / 100."""
    return annual_pct / 1200.0


def emi(principal: float, annual_pct: float, months: int) -> float:
    """Equated monthly instalment.

    EMI = P · r · (1+r)^n / ((1+r)^n − 1),   r = monthly rate, n = months.
    Zero-rate loans degrade to P / n.
    """
    if months <= 0:
        raise ValueError("months must be positive")
    r = monthly_rate(annual_pct)
    if r == 0:
        return principal / months
    growth = (1 + r) ** months
    return principal * r * growth / (growth - 1)


def fv_lump_sum(present_value: float, annual_pct: float, months: int) -> float:
    """FV = PV · (1+r)^n with monthly compounding."""
    return present_value * (1 + monthly_rate(annual_pct)) ** months


def fv_annuity(payment: float, annual_pct: float, months: int) -> float:
    """FV of an ordinary annuity (SIP paid at month end).

    FV = PMT · ((1+r)^n − 1) / r
    """
    r = monthly_rate(annual_pct)
    if r == 0:
        return payment * months
    return payment * ((1 + r) ** months - 1) / r


def required_monthly_sip(
    target: float, current_corpus: float, annual_pct: float, months: int
) -> float:
    """Monthly SIP that grows `current_corpus` + contributions to `target`.

    SIP = max(0, target − FV(corpus)) / (((1+r)^n − 1) / r)
    """
    if months <= 0:
        return max(0.0, target - current_corpus)
    shortfall = target - fv_lump_sum(current_corpus, annual_pct, months)
    if shortfall <= 0:
        return 0.0
    return shortfall / fv_annuity(1.0, annual_pct, months)


def clamp(x: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, x))
