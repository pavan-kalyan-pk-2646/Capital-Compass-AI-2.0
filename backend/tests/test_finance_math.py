import pytest

from engines.finance_math import emi, fv_annuity, fv_lump_sum, required_monthly_sip


def test_emi_hand_computed():
    # ₹5,00,000 at 14% for 36 months → ₹17,088.81 (bank calculators: ₹17,089)
    assert emi(500_000, 14, 36) == pytest.approx(17_088.81, abs=0.05)


def test_emi_flagship_loan():
    # ₹5,00,000 at 14% for 60 months → ₹11,634.13
    assert emi(500_000, 14, 60) == pytest.approx(11_634.13, abs=0.05)


def test_emi_zero_rate():
    assert emi(120_000, 0, 12) == 10_000


def test_fv_and_required_sip_roundtrip():
    sip = required_monthly_sip(2_500_000, 380_000, 10, 60)
    total = fv_lump_sum(380_000, 10, 60) + fv_annuity(sip, 10, 60)
    assert total == pytest.approx(2_500_000, rel=1e-9)


def test_required_sip_zero_when_corpus_enough():
    assert required_monthly_sip(100_000, 200_000, 8, 60) == 0
