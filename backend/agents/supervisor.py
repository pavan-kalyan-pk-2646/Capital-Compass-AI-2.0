"""Supervisor — understands what the user is trying to decide and routes it.

Natural-language commands are parsed with deterministic rules (no API key needed):
  "I want to invest ₹20,000/month"        → investment  {monthly_sip: 20000}
  "I want a ₹5 lakh personal loan"         → loan        {amount: 500000, loan_type: personal}
  "I spend ₹8,000/month on betting"        → spending    {monthly_spend: 8000}
  "What if I lose my job for six months?"  → crisis      {scenario: job_loss, months: 6}
  "Can I reach ₹25 lakh in five years?"    → goal        {target: 2500000, years: 5}
  "Why did you reject my plan?"            → explain     (answered from the last decision)
"""

from __future__ import annotations

import re

WORD_NUM = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "twelve": 12,
    "fifteen": 15,
    "twenty": 20,
    "a": 1,
    "an": 1,
}
UNIT = {
    "k": 1e3,
    "thousand": 1e3,
    "l": 1e5,
    "lakh": 1e5,
    "lakhs": 1e5,
    "lac": 1e5,
    "lacs": 1e5,
    "cr": 1e7,
    "crore": 1e7,
    "crores": 1e7,
    "m": 1e6,
    "million": 1e6,
}

_AMOUNT = re.compile(
    r"(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|l|crores?|cr|million|m)?\b",
    re.I,
)
_YEARS = re.compile(r"(\d+|" + "|".join(WORD_NUM) + r")\s*(?:years?|yrs?)", re.I)
_MONTHS = re.compile(r"(\d+|" + "|".join(WORD_NUM) + r")\s*months?", re.I)
_RATE = re.compile(r"(\d+(?:\.\d+)?)\s*%")

LOAN_TYPES = {
    "personal": "personal",
    "education": "education",
    "student": "education",
    "home": "home",
    "house": "home",
    "housing": "home",
    "car": "vehicle",
    "vehicle": "vehicle",
    "bike": "vehicle",
}


def _num(tok: str) -> float:
    tok = tok.lower()
    return float(WORD_NUM[tok]) if tok in WORD_NUM else float(tok)


def amounts(text: str) -> list[float]:
    out = []
    for m in _AMOUNT.finditer(text):
        raw, unit = m.group(1), (m.group(2) or "").lower()
        try:
            v = float(raw.replace(",", ""))
        except ValueError:
            continue
        # skip numbers that are clearly years/months/percentages
        tail = text[m.end() : m.end() + 8].lower()
        if not unit and (tail.lstrip().startswith(("year", "yr", "month", "%")) or v < 100):
            continue
        out.append(v * UNIT.get(unit, 1))
    return out


def parse_command(text: str) -> dict:
    t = (text or "").strip()
    low = t.lower()
    if not t:
        return {"decision_type": None, "params": {}, "reason": "Empty command"}
    amts = amounts(t)
    years = _YEARS.search(low)
    months = _MONTHS.search(low)
    params: dict = {}

    if re.search(r"\bwhy\b.*\b(reject|chose|choose|recommend|this|not)\b", low):
        return {
            "decision_type": "explain",
            "params": {},
            "reason": "Question about a previous decision → Critic + Counterfactual",
        }

    if re.search(r"\b(bet|betting|gambl\w*|casino|lottery|fantasy|satta|speculat\w*)\b", low):
        if amts:
            params["monthly_spend"] = amts[0]
        return {
            "decision_type": "spending",
            "params": params,
            "reason": "High-risk spending mentioned → High-Risk Spending Analyzer",
        }

    if re.search(r"\b(loan|borrow|emi|mortgage|finance my)\b", low):
        if amts:
            params["amount"] = amts[0]
        for k, v in LOAN_TYPES.items():
            if re.search(rf"\b{k}\b", low):
                params["loan_type"] = v
                break
        r = _RATE.search(low)
        if r:
            params["annual_rate_pct"] = float(r.group(1))
        if years:
            params["tenure_months"] = int(_num(years.group(1)) * 12)
        elif months:
            params["tenure_months"] = int(_num(months.group(1)))
        return {
            "decision_type": "loan",
            "params": params,
            "reason": "Borrowing mentioned → Loan Decision Simulator",
        }

    crisis = None
    if re.search(r"\b(lose|lost|losing)\b.*\bjob\b|\bjob loss\b|\blaid off\b|\bunemploy", low):
        crisis = "job_loss"
        if re.search(r"\bcrash|\bfall|\bcrisis", low):
            crisis = "crash_job_loss"
    elif re.search(r"\bcrash|\bmarket (fall|falls|drop|drops)|\bnifty\b.*-?\d+%|\brecession", low):
        crisis = "market_crash"
    elif re.search(r"\binflation\b", low):
        crisis = "inflation_spike"
    elif re.search(r"\b(interest|rate)s? (rise|hike|shock|go up)|\brate hike", low):
        crisis = "rate_hike"
    elif re.search(r"\b(medical|hospital|surgery|emergency)\b", low):
        crisis = "medical_emergency"
    if crisis:
        params["scenario"] = crisis
        if months and crisis in ("job_loss", "crash_job_loss"):
            params["job_loss_months"] = int(_num(months.group(1)))
        if crisis == "medical_emergency" and amts:
            params["medical_cost"] = amts[0]
        return {
            "decision_type": "crisis",
            "params": params,
            "reason": f"Adverse event mentioned → Crisis Engine ({crisis.replace('_', ' ')})",
        }

    if re.search(r"\b(reach|goal|target|save for|achieve|accumulate|corpus)\b", low):
        if amts:
            params["target"] = max(amts)
        if years:
            params["years"] = _num(years.group(1))
        return {
            "decision_type": "goal",
            "params": params,
            "reason": "Target amount and deadline → Goal Survival Engine",
        }

    if re.search(r"\b(invest|sip|portfolio|allocat\w*|mutual fund|stocks?)\b", low):
        if amts:
            params["monthly_sip"] = amts[0]
        return {
            "decision_type": "investment",
            "params": params,
            "reason": "Investing mentioned → Investment Engine",
        }

    return {
        "decision_type": None,
        "params": {},
        "reason": "Could not tell which decision this is. Try mentioning a loan, an "
        "investment, a goal, a crisis or high-risk spending.",
    }


def route_summary(decision_type: str, params: dict) -> str:
    names = {
        "investment": "Investment Engine",
        "loan": "Loan Decision Simulator",
        "goal": "Goal Survival Engine (via Investment Engine)",
        "crisis": "Emergency / Crisis Engine",
        "spending": "High-Risk Spending Analyzer",
    }
    return f"Routed to {names.get(decision_type, decision_type)}"
