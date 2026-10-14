"""What-If Lab: the preview is arithmetic on the changed inputs; the saved twin is untouched."""

from api.common import context
from engines import whatif_lab as lab
from engines.finance_math import emi


def test_no_changes_means_the_same_numbers(judge):
    twin, dna, plan = context(judge)
    q, new = lab.apply_changes(judge, plan, {})
    assert lab.preview(q, new) == lab.preview(judge, plan)


def test_loan_and_sip_flow_through_the_formulas(judge):
    twin, dna, plan = context(judge)
    base = lab.preview(judge, plan)
    q, new = lab.apply_changes(judge, plan, {"loan_amount": 500000, "loan_rate": 14, "sip": 0})
    pv = lab.preview(q, new)
    assert pv["new_emi"] == round(emi(500000, 14, 60))
    assert pv["foir"] > base["foir"]
    # surplus after plan = twin surplus − new EMI − SIP (SIP is now zero)
    assert pv["surplus_after_plan"] == round(twin.monthly_surplus - emi(500000, 14, 60))
    assert pv["goal_corpus"] < base["goal_corpus"]


def test_expenses_keep_high_risk_spend_and_cash_sets_cover(judge):
    twin, dna, plan = context(judge)
    more = {"expenses": twin.monthly_expenses + 10000, "emergency_fund": 0}
    q, new = lab.apply_changes(judge, plan, more)
    assert q.behaviour.high_risk_spending == judge.behaviour.high_risk_spending
    assert abs(lab.current_values(q, new)["expenses"] - (twin.monthly_expenses + 10000)) <= 1
    assert lab.preview(q, new)["emergency_months"] == 0
    assert judge.assets.cash > 0  # the original is not modified


def test_endpoint_preview_and_full_run(client, judge_json):
    r = client.post("/api/whatif/lab", json={"profile": judge_json, "changes": {"equity": 0.3}})
    assert r.status_code == 200 and "simulation" not in r.get_json()
    r = client.post(
        "/api/whatif/lab",
        json={"profile": judge_json, "changes": {"equity": 0.3}, "simulate": True},
    )
    s = r.get_json()["simulation"]
    assert s["n_paths"] == 10000 and 0 <= s["goal_success_probability"] <= 1
    bad = client.post("/api/whatif/lab", json={"profile": judge_json, "changes": {"equity": 2}})
    assert bad.status_code == 422
