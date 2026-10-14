import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { FanChart } from '@/charts/charts'
import { useDemoStep } from '@/components/DemoGuide'
import { Icon } from '@/components/icons'
import { RunDecision } from '@/components/RunDecision'
import { Disclaimer, ErrorBox, Loading, Metric, NeedsTwin, Panel, Slider, Spinner } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { inr, inrShort, months, pct } from '@/lib/format'
import { analyze } from '@/services/api'
import type { CrisisResult } from '@/services/types'
import { useApp } from '@/stores/app'
import './crisis.css'

const SCENARIOS = [
  { key: 'market_crash', title: 'Market crash', text: 'NIFTY 50 falls 30% overnight' },
  { key: 'job_loss', title: 'Job loss', text: 'Salary stops; spending drops to essentials' },
  { key: 'inflation_spike', title: 'Inflation', text: 'Inflation runs 5 points higher' },
  { key: 'rate_hike', title: 'Interest-rate shock', text: 'Floating loans re-price 2.5% higher' },
  { key: 'medical_emergency', title: 'Medical emergency', text: 'A one-off hospital bill' },
  { key: 'crash_job_loss', title: 'Crash + income loss', text: 'Both at once' },
]

export default function Crisis() {
  const profile = useApp((s) => s.profile)
  const [sp] = useSearchParams()
  const asked = sp.get('scenario')
  const [scenario, setScenario] = useState(asked && ['market_crash', 'job_loss', 'inflation_spike', 'rate_hike', 'medical_emergency', 'crash_job_loss'].includes(asked) ? asked : 'market_crash')
  const [severity, setSeverity] = useState(1)
  const [jobMonths, setJobMonths] = useState(6)
  const [medical, setMedical] = useState(300000)
  const c = useAsync((signal) => analyze<CrisisResult>('/api/crisis/simulate', { scenario, severity, job_loss_months: jobMonths, medical_cost: medical }, signal))

  const runCrisis = c.run
  useEffect(() => {
    if (!profile) return
    const t = setTimeout(() => runCrisis(), 300)
    return () => clearTimeout(t)
  }, [profile, scenario, severity, jobMonths, medical, runCrisis])
  useDemoStep([9], () => {
    setScenario('market_crash')
    setSeverity(1)
  })

  if (!profile)
    return (
      <div className="page">
        <h1>Crisis War Room</h1>
        <div className="mt">
          <NeedsTwin what="The Crisis War Room" />
        </div>
      </div>
    )

  const d = c.data
  const sevPct = Math.round(severity * 100)
  return (
    <div className="page warroom">
      <div className="page-head">
        <div>
          <h1>Crisis War Room</h1>
          <p>Hit your Digital Twin with a bad event and see what breaks first: the portfolio, the goal, or the cash to pay the bills.</p>
        </div>
      </div>
      <div className="crisis-grid" role="radiogroup" aria-label="Crisis scenario">
        {SCENARIOS.map((s) => (
          <button key={s.key} role="radio" aria-checked={scenario === s.key} className={`crisis-card ${scenario === s.key ? 'on' : ''}`} onClick={() => setScenario(s.key)}>
            <Icon name="crisis" size={16} />
            <strong>{s.title}</strong>
            <span>{s.text}</span>
          </button>
        ))}
      </div>

      <div className="grid g-side mt">
        <Panel title="Severity">
          <div className="stack">
            <Slider label="Shock size" value={severity} min={0.5} max={2} step={0.25} onChange={setSeverity} format={() => `${sevPct}% of the standard shock`} />
            {(scenario === 'job_loss' || scenario === 'crash_job_loss') && <Slider label="Months without salary" value={jobMonths} min={1} max={18} step={1} onChange={setJobMonths} format={(v) => `${Math.round(v * severity)} months`} />}
            {scenario === 'medical_emergency' && <Slider label="Hospital bill" value={medical} min={50000} max={2000000} step={50000} onChange={setMedical} format={(v) => inrShort(v * severity)} />}
            <div className="small text-2">
              {scenario === 'market_crash' || scenario === 'crash_job_loss' ? `NIFTY 50 −${Math.round(30 * severity)}%, gold +5%, debt flat. ` : ''}
              {scenario === 'inflation_spike' ? `Inflation at ${(5.5 + 5 * severity).toFixed(1)}% a year for the whole horizon. ` : ''}
              {scenario === 'rate_hike' ? `Floating-rate loans re-price ${(2.5 * severity).toFixed(1)} points higher. ` : ''}
              Shocks are applied to the same 10,000 simulated futures as your baseline.
            </div>
            {c.loading && (
              <div className="row small text-2">
                <Spinner /> Simulating the shock…
              </div>
            )}
          </div>
        </Panel>
        <div className="stack">
          <ErrorBox error={c.error} onRetry={() => c.run()} />
          {!d && c.loading && <Loading label="Running the crisis through 20,000 futures…" height={380} />}
          {d && (
            <>
              <div id="impact" className={`severity sev-${d.severity_label.toLowerCase()}`}>
                <div>
                  <div className="small">Severity</div>
                  <div className="sev-word">{d.severity_label.charAt(0) + d.severity_label.slice(1).toLowerCase()}</div>
                </div>
                <div className="sev-facts">
                  <span>{d.label}</span>
                  <span>
                    Goal success {pct(d.goal_probability_before)} → <strong>{pct(d.goal_probability_after)}</strong>
                  </span>
                </div>
              </div>
              <div className="kpis">
                <div>
                  <Metric label="Portfolio impact" value={d.portfolio_loss_pct > 0 ? `−${pct(d.portfolio_loss_pct, 1)}` : '0%'} tone={d.portfolio_loss_pct * 100 > profile.risk.max_tolerated_loss_pct ? 'red' : ''} sub={`${inrShort(d.portfolio_before)} → ${inrShort(d.portfolio_after)}`} />
                </div>
                <div>
                  <Metric label="Goal impact" value={`${pct(d.goal_probability_after)}`} tone={(d.goal_probability_after ?? 1) < 0.5 ? 'red' : ''} sub={`was ${pct(d.goal_probability_before)}`} />
                </div>
                <div>
                  <Metric label="Emergency fund lasts" value={months(d.emergency_fund_survival_months)} tone={d.emergency_fund_survival_months < 3 ? 'red' : d.emergency_fund_survival_months < 6 ? 'amber' : ''} sub={`at ${inr(d.monthly_burn)}/mo burn`} />
                </div>
                <div>
                  <Metric label="Recovery time" value={d.recovery_months ? `${Math.round(d.recovery_months)} mo` : '—'} sub={d.recovery_months ? 'median, back to the pre-crash peak' : 'no market drawdown in this scenario'} />
                </div>
                <div>
                  <Metric label="Forced selling" value={pct(d.forced_liquidation_probability)} tone={d.forced_liquidation_probability > 0.25 ? 'red' : ''} sub="futures that must sell investments for cash" />
                </div>
              </div>
              <div className="grid g-wide">
                <Panel title="Before and after the shock" sub="Median without the crisis (dashed) vs the shocked futures">
                  <FanChart p={d.percentiles_after} compare={d.percentiles_before} compareLabel="Median without crisis" label="Median after shock" tone="red" target={profile.goals[0]?.target_amount} />
                </Panel>
                <Panel title="State before vs after">
                  <table className="table">
                    <tbody>
                      <tr>
                        <td className="text-2">Investments</td>
                        <td className="r num">{inrShort(d.portfolio_before)}</td>
                        <td className="r num">{inrShort(d.portfolio_after)}</td>
                      </tr>
                      <tr>
                        <td className="text-2">Liquid money</td>
                        <td className="r num">{inrShort(d.liquidity_before)}</td>
                        <td className="r num">{inrShort(d.liquidity_after)}</td>
                      </tr>
                      <tr>
                        <td className="text-2">EMIs / month</td>
                        <td className="r num">{inr(d.emi_before)}</td>
                        <td className={`r num ${d.emi_affordable ? '' : 'red'}`}>{inr(d.emi_after)}</td>
                      </tr>
                      <tr>
                        <td className="text-2">Median at goal date</td>
                        <td className="r num">{inrShort(d.ending_p50_before)}</td>
                        <td className="r num">{inrShort(d.ending_p50_after)}</td>
                      </tr>
                      {d.real_purchasing_power !== null && (
                        <tr>
                          <td className="text-2">Purchasing power of the goal</td>
                          <td className="r num">100%</td>
                          <td className="r num red">{pct(d.real_purchasing_power)}</td>
                        </tr>
                      )}
                      {Object.entries(d.asset_impacts)
                        .filter(([, v]) => v !== 0)
                        .map(([k, v]) => (
                          <tr key={k}>
                            <td className="text-2">{k.charAt(0).toUpperCase() + k.slice(1)} move</td>
                            <td />
                            <td className={`r num ${v < 0 ? 'red' : 'green'}`}>{inr(v)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  <div className="tiny muted mt-sm">Columns: before, after</div>
                </Panel>
              </div>
              <Panel title="Recommended response">
                <ul className="list">
                  {d.recommended_response.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                {d.recommended_response.length === 0 && <p className="small text-2">Your twin absorbs this shock without changes.</p>}
                <div className="mt">
                  <RunDecision type="crisis" params={{ scenario, severity, job_loss_months: jobMonths, medical_cost: medical }} command={`What if ${SCENARIOS.find((s) => s.key === scenario)!.title.toLowerCase()} hits?`} label="Build a resilience plan with the AI Committee" />
                </div>
              </Panel>
            </>
          )}
        </div>
      </div>
      <Disclaimer />
    </div>
  )
}
