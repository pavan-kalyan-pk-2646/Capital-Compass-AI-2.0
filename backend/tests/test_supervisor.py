import pytest

from agents.supervisor import parse_command


@pytest.mark.parametrize(
    "text,dtype",
    [
        ("I want to invest ₹20,000/month.", "investment"),
        ("I want a ₹5 lakh personal loan.", "loan"),
        ("I spend ₹8,000/month on betting.", "spending"),
        ("What if I lose my job?", "crisis"),
        ("Can I reach ₹25 lakh in five years?", "goal"),
        ("Why did you reject my plan?", "explain"),
    ],
)
def test_routes(text, dtype):
    assert parse_command(text)["decision_type"] == dtype


def test_params():
    p = parse_command("Can I take a ₹5 lakh personal loan at 14% for 5 years?")["params"]
    assert p == {
        "amount": 500000.0,
        "loan_type": "personal",
        "annual_rate_pct": 14.0,
        "tenure_months": 60,
    }
    g = parse_command("Can I reach ₹25 lakh in five years?")["params"]
    assert g == {"target": 2_500_000.0, "years": 5.0}
