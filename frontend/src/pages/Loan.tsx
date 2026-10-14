import { useEffect, useState } from 'react'

import { AmortChart, FanChart } from '@/charts/charts'
import { useDemoStep } from '@/components/DemoGuide'
import { RunDecision } from '@/components/RunDecision'
import { Badge, Disclaimer, ErrorBox, Loading, Metric, MoneyInput, NeedsTwin, Panel, Seg, Slider, Spinner } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { inr, inrShort, months, pct, probTone } from '@/lib/format'
import { analyze } from '@/services/api'
import type { LoanResult } from '@/services/types'
import { useApp } from '@/stores/app'

const RATES: Record<string, number> = { personal: 14, education: 10, home: 8.75, vehicle: 9.5 }
const MAX_TENURE: Record<string, number> = { personal: 84, education: 180, home: 360, vehicle: 84 }
const BAND_TONE: Record<string, string> = { LOW: 'green', MODERATE: 'amber', 'MODERATE-HIGH': 'red', HIGH: 'red' }
const VERDICT_TONE: Record<string, string> = { AFFORDABLE: 'green', 'AFFORDABLE WITH CAUTION': 'amber', RECONSIDER: 'red', 'NOT ADVISABLE': 'red' }

type LoanType = 'personal' | 'education' | 'home' | 'vehicle'

export default function Loan() {
  const profile = useApp((s) => s.profile)
  const [type, setType] = useState<LoanType>('personal')
  const [amount, setAmount] = useState(500000)
  const [rate, setRate] = useState(14)
  const [tenure, setTenure] = useState(60)
  const [fee, setFee] = useState(1)
  const loan = useAsync((signal) =>
    analyze<LoanResult>('/api/loan/analyze', { loan: { loan_type: type, amount, annual_rate_pct: rate, tenure_months: tenure, processing_fee_pct: fee } }, signal),
  )

  const runLoan = loan.run
  useEffect(() => {
    if (!profile) return
    const t = setTimeout(() => runLoan(), 350)
    return () => clearTimeout(t)
  }, [profile, type, amount, rate, tenure, fee, runLoan])

  useDemoStep([5], () => {
    setType('personal')
    setAmount(500000)
    setRate(14)
    setTenure(60)
    setFee(1)
  })

  if (!profile)
    return (
      <div className="page">
        <h1>Loan Decision Simulator</h1>
        <div className="mt">
          <NeedsTwin what="The Loan Decision Simulator" />
        </div>
      </div>
    )

  const d = loan.data
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Loan Decision Simulator</h1>
          <p>What happens to your financial future if you take this loan? EMI and cost, affordability, debt stress, and what it does to your goal across 10,000 futures. Analysis only — nothing is submitted to any lender.</p>
        </div>
      </div>
      <div className="grid g-side">
        <Panel title="The loan you’re considering">
          <div className="stack">
            <Seg<LoanType>
              label="Loan type"
              value={type}
              onChange={(v) => {
                setType(v)
                setRate(RATES[v]!)
                setTenure((t) => Math.min(t, MAX_TENURE[v]!))
              }}
              options={[
                { value: 'personal', label: 'Personal' },
                { value: 'education', label: 'Education' },
                { value: 'home', label: 'Home' },
                { value: 'vehicle', label: 'Vehicle' },
              ]}
            />
            <MoneyInput label="Loan amount" value={amount} min={1000} max={100000000} onChange={setAmount} hint={inrShort(amount)} />
            <Slider label="Interest rate" value={rate} min={1} max={30} step={0.25} onChange={setRate} format={(v) => `${v.toFixed(2)}% a year`} />
            <Slider label="Tenure" value={tenure} min={6} max={MAX_TENURE[type]!} step={6} onChange={setTenure} format={(v) => `${v} months (${(v / 12).toFixed(1)} yrs)`} />
            <Slider label="Processing fee" value={fee} min={0} max={5} step={0.25} onChange={setFee} format={(v) => `${v.toFixed(2)}% (${inr((amount * v) / 100)})`} />
            <div className="inset small text-2">
              Uses your twin: income {inr(profile.monthly_income + profile.other_income)}, existing EMIs {inr(profile.liabilities.reduce((a, l) => a + l.emi, 0))}, savings {inrShort(profile.assets.cash)} cash.
            </div>
            {loan.loading && (
              <div className="row small text-2">
                <Spinner /> Re-simulating…
              </div>
            )}
          </div>
        </Panel>

        <div className="stack">
          <ErrorBox error={loan.error} onRetry={() => loan.run()} />
          {!d && loan.loading && <Loading label="Running the loan through 10,000 futures…" height={420} />}
          {d && (
            <>
              <Panel>
                <div className="row between wrap">
                  <div>
                    <div className="metric-label">Verdict</div>
                    <div className="row mt-sm wrap">
                      <h2 style={{ fontSize: 24 }} className={VERDICT_TONE[d.recommendation] ?? ''}>
                        {d.recommendation.charAt(0) + d.recommendation.slice(1).toLowerCase()}
                      </h2>
                      <Badge tone={BAND_TONE[d.risk_band]}>Loan risk: {d.risk_band.toLowerCase()}</Badge>
                    </div>
                  </div>
                  <div style={{ minWidth: 200 }}>
                    <div className="row between small">
                      <span className="text-2">Debt stress</span>
                      <span className="num">{d.debt_stress_score.toFixed(0)}/100</span>
                    </div>
                    <div className="bar mt-sm" style={{ height: 8 }}>
                      <i style={{ width: `${d.debt_stress_score}%`, background: d.debt_stress_score >= 55 ? 'var(--red)' : d.debt_stress_score >= 35 ? 'var(--amber)' : 'var(--green)' }} />
                    </div>
                  </div>
                </div>
                {d.concerns.length > 0 && (
                  <div className="mt">
                    <div className="small text-2">Primary concerns</div>
                    <ul className="list red mt-sm">
                      {d.concerns.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </Panel>

              <div className="kpis">
                <div>
                  <Metric label="Monthly EMI" value={inr(d.emi)} />
                </div>
                <div>
                  <Metric label="Total interest" value={inrShort(d.total_interest)} />
                </div>
                <div>
                  <Metric label="Total repayment" value={inrShort(d.total_repayment)} sub={`incl. ${inr(d.processing_fee)} fee`} />
                </div>
                <div>
                  <Metric label="EMIs to income" value={`${pct(d.foir_before)} → ${pct(d.foir_after)}`} tone={d.foir_after > 0.4 ? 'red' : ''} sub="40% comfort, 50% ceiling" />
                </div>
                <div>
                  <Metric label="Surplus after EMIs" value={inr(d.surplus_after)} tone={d.surplus_after < 0 ? 'red' : ''} sub={`was ${inr(d.surplus_before)}`} />
                </div>
              </div>

              <Panel title="Impact on your future" sub="Same 10,000 market paths with and without the loan" className="">
                <div id="impact" className="grid g3" style={{ scrollMarginTop: 90 }}>
                  <Metric label="Goal success" value={`${pct(d.goal_probability_before)} → ${pct(d.goal_probability_after)}`} tone={probTone(d.goal_probability_after)} sub="before → with this loan" />
                  <Metric label="Monthly investment" value={`${inr(d.sip_before)} → ${inr(d.sip_after)}`} sub="what the post-EMI surplus allows" />
                  <Metric label="Financial resilience" value={`${Math.round(d.resilience_before)} → ${Math.round(d.resilience_after)}`} tone={d.resilience_after < d.resilience_before - 10 ? 'red' : ''} sub="Risk DNA score" />
                </div>
                <div className="mt">
                  <FanChart p={d.percentiles_after} compare={d.percentiles_before} compareLabel="Median without loan" label="Median with loan" target={profile.goals[0]?.target_amount} />
                </div>
                <div className="grid g2 mt">
                  <div className="inset small">
                    <div className="row between">
                      <span className="text-2">Emergency fund cover</span>
                      <span className="num">
                        {months(d.emergency_fund_months_before)} → {months(d.emergency_fund_months_after)}
                      </span>
                    </div>
                  </div>
                  <div className="inset small">
                    <div className="row between">
                      <span className="text-2">Liquidity</span>
                      <span className="num">
                        {inr(d.liquidity_impact.monthly_cash_flow_change)}/mo, fee {inr(d.liquidity_impact.fee_paid)}
                      </span>
                    </div>
                  </div>
                </div>
              </Panel>

              <Panel id="stress" title="Stress tests">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Scenario</th>
                        <th>Result</th>
                        <th>What happens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.stress_tests.map((s) => (
                        <tr key={s.scenario}>
                          <td>{s.label}</td>
                          <td>
                            <Badge tone={s.passed ? 'green' : 'red'}>{s.passed ? 'Holds' : 'Breaks'}</Badge>
                          </td>
                          <td className="small text-2">{s.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <div className="grid g2">
                <Panel title="Repayment by year">
                  <AmortChart rows={d.amortization} />
                </Panel>
                <Panel title="Safer options">
                  {d.safer_alternatives.length ? (
                    <ul className="list green">
                      {d.safer_alternatives.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="small text-2">This loan sits inside your comfort limits as entered.</p>
                  )}
                  <p className="small text-2 mt">Largest loan at this rate and tenure that keeps EMIs under 40% of income: {inrShort(d.max_affordable_amount)}.</p>
                  <div className="mt">
                    <RunDecision type="loan" params={{ loan_type: type, amount, annual_rate_pct: rate, tenure_months: tenure, processing_fee_pct: fee, crisis: 'market_crash' }} command={`Can I take a ${inrShort(amount)} ${type} loan?`} label="Challenge this loan in the AI Committee" />
                  </div>
                </Panel>
              </div>
            </>
          )}
        </div>
      </div>
      <Disclaimer />
    </div>
  )
}
