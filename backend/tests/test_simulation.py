import time

from engines.simulation_engine import Crash, SimConfig, simulate
from market import loader


def cfg(**kw):
    base = dict(
        months=60,
        weights={"equity": 0.5, "debt": 0.4, "gold": 0.1},
        start_portfolio=380_000,
        start_cash=220_000,
        monthly_sip=24_000,
        monthly_income=80_000,
        monthly_expenses=44_000,
        monthly_emi=8_000,
        essential_expenses=30_000,
        target=2_500_000,
        max_loss_pct=15,
    )
    base.update(kw)
    return SimConfig(**base)


def test_market_history_is_real_and_local():
    h = loader.history()
    assert len(h.equity) > 250
    assert h.equity.std() > 0.03  # monthly returns vary — not a constant


def test_ten_thousand_paths_fast_and_percentiles_ordered():
    t0 = time.perf_counter()
    r = simulate(cfg())
    assert time.perf_counter() - t0 < 1.5
    assert r["n_paths"] == 10_000
    p = r["percentiles"]
    for i in range(len(p["month"])):
        assert p["p5"][i] <= p["p25"][i] <= p["p50"][i] <= p["p75"][i] <= p["p95"][i]
    assert 0 <= r["goal_success_probability"] <= 1


def test_paths_differ_not_constant_return():
    r = simulate(cfg())
    assert r["ending"]["p95"] - r["ending"]["p5"] > 100_000


def test_seed_reproducible():
    a = simulate(cfg(seed=7))
    b = simulate(cfg(seed=7))
    assert a["goal_success_probability"] == b["goal_success_probability"]
    assert a["ending"] == b["ending"]


def test_crash_and_job_loss_hurt():
    base = simulate(cfg())
    crash = simulate(cfg(crash=Crash()))
    both = simulate(cfg(crash=Crash(), job_loss_months=6))
    assert crash["ending"]["p50"] < base["ending"]["p50"]
    assert both["goal_success_probability"] <= crash["goal_success_probability"]


def test_unaffordable_sip_forces_liquidation():
    r = simulate(cfg(monthly_sip=60_000))
    assert r["forced_liquidation_probability"] > 0.9
