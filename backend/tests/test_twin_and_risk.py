from engines.digital_twin import build_twin
from engines.risk_engine import compute_risk_dna


def test_twin_judge(judge):
    t = build_twin(judge)
    assert t.monthly_income == 80_000
    assert t.monthly_expenses == 44_000
    assert t.monthly_emi == 8_000
    assert t.monthly_surplus == 28_000
    assert round(t.emergency_fund_months, 2) == round(220_000 / 38_000, 2)
    assert t.dti == 0.1
    assert t.health_band in {"STRONG", "STABLE", "STRETCHED", "FRAGILE"}


def test_twin_new_loan_reduces_surplus(judge):
    base = build_twin(judge)
    after = build_twin(judge, extra_monthly_emi=11_634)
    assert after.monthly_surplus == base.monthly_surplus - 11_634
    assert after.emergency_fund_months < base.emergency_fund_months


def test_risk_dna_eight_dimensions_in_range(judge):
    dna = compute_risk_dna(judge, build_twin(judge))
    assert len(dna.dimensions) == 8
    assert all(0 <= d.score <= 100 for d in dna.dimensions)
    assert dna.label in {"Conservative", "Moderate", "Growth", "Aggressive"}


def test_risk_dna_responds_to_inputs(judge):
    low = judge.model_copy(deep=True)
    low.risk.max_tolerated_loss_pct = 5
    a = compute_risk_dna(judge, build_twin(judge)).score("loss_tolerance")
    b = compute_risk_dna(low, build_twin(low)).score("loss_tolerance")
    assert b < a
