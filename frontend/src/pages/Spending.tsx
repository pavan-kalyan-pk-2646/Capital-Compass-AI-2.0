import { useEffect, useState } from 'react'

import { ProbBars } from '@/charts/charts'
import { RunDecision } from '@/components/RunDecision'
import { Badge, Disclaimer, ErrorBox, Loading, Metric, MoneyInput, NeedsTwin, Panel, Spinner } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { inr, inrShort, months, pct } from '@/lib/format'
import { analyze } from '@/services/api'
import type { SpendingResult } from '@/services/types'
import { useApp } from '@/stores/app'

const LEVEL_TONE: Record<string, string> = { LOW: 'green', ELEVATED: 'amber', HIGH: 'red', CRITICAL: 'red' }

export default function Spending() {
  const profile = useApp((s) => s.profile)
  const [spend, setSpend] = useState(profile?.behaviour.high_risk_spending || 8000)
  const a = useAsync((signal) => analyze<SpendingResult>('/api/spending/analyze', { monthly_spend: spend }, signal))

  useEffect(() => {
    if (profile) a.run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  if (!profile)
    return (
      <div className="page">
        <h1>High-risk spending</h1>
        <div className="mt">
          <NeedsTwin what="The High-Risk Spending Analyzer" />
        </div>
      </div>
    )

  const d = a.data
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>High-risk spending</h1>
          <p>What does regular betting or speculative spending do to your cash flow, emergency fund and goal? This is consequence analysis only — Capital Compass never recommends platforms or strategies and never predicts outcomes.</p>
        </div>
      </div>
      <div className="grid g-side">
        <Panel title="Monthly amount">
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              a.run()
            }}
          >
            <MoneyInput label="High-risk spending per month" value={spend} min={0} max={10000000} onChange={setSpend} />
            <button className="btn primary" disabled={a.loading}>
              {a.loading && <Spinner />} Analyse the consequences
            </button>
          </form>
        </Panel>
        <div className="stack">
          <ErrorBox error={a.error} onRetry={() => a.run()} />
          {!d && a.loading && <Loading label="Simulating with and without the spending…" height={320} />}
          {d && (
            <>
              <div className="kpis k4">
                <div>
                  <Metric label="Financial risk" value={<Badge tone={LEVEL_TONE[d.risk_level]}>{d.risk_level.toLowerCase()}</Badge>} sub={`${pct(d.share_of_income, 1)} of income`} />
                </div>
                <div>
                  <Metric label="Cost per year" value={inr(d.annual_cost)} />
                </div>
                <div>
                  <Metric label="If invested for 5 years" value={inrShort(d.five_year_opportunity_cost)} sub="at your plan’s expected return" />
                </div>
                <div>
                  <Metric label="Monthly surplus" value={`${inr(d.surplus_with)}`} tone={d.surplus_with < 0 ? 'red' : ''} sub={`${inr(d.surplus_without)} without it`} />
                </div>
              </div>
              <div className="grid g2">
                <Panel title="Goal impact" sub="10,000 futures each">
                  <ProbBars
                    items={[
                      { label: 'Spending continues', value: d.goal_probability_with, note: `Median ${inrShort(d.ending_p50_with)}` },
                      { label: 'Spending halved, half invested', value: d.goal_probability_halved },
                      { label: 'Fully redirected to the goal', value: d.goal_probability_redirected, note: `Median ${inrShort(d.ending_p50_redirected)}` },
                    ]}
                  />
                  <div className="inset small mt">
                    Months to rebuild a 6-month emergency fund: {months(d.ef_rebuild_months_with)} with the spending, {months(d.ef_rebuild_months_without)} without.
                  </div>
                </Panel>
                <Panel title="Safer budget adjustment">
                  <ol className="stack-sm" style={{ paddingLeft: 18, margin: 0 }}>
                    {d.budget_adjustment.map((b) => (
                      <li key={b.month} className="small">
                        <strong>{b.month}:</strong> <span className="text-2">{b.action}</span>
                      </li>
                    ))}
                  </ol>
                  {d.alerts.length > 0 && (
                    <ul className="list red mt">
                      {d.alerts.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  )}
                  <p className="small text-2 mt">{d.support_note}</p>
                </Panel>
              </div>
              <Panel title="Get the committee’s review" sub={d.scope_note}>
                <RunDecision type="spending" params={{ monthly_spend: spend }} command={`I spend ${inr(spend)}/month on betting`} />
              </Panel>
            </>
          )}
        </div>
      </div>
      <Disclaimer />
    </div>
  )
}
