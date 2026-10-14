import { useEffect } from 'react'
import { Link } from 'react-router-dom'

import { Donut, FanChart, Legendish } from '@/charts/charts'
import { useDemoStep } from '@/components/DemoGuide'
import { RunDecision } from '@/components/RunDecision'
import { Badge, Disclaimer, ErrorBox, Loading, Metric, NeedsTwin, Panel, Spinner, StatusBadge } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { inr, inrShort, pct, probTone } from '@/lib/format'
import { analyze } from '@/services/api'
import type { InvestmentResult, PlanEval, RedTeamTest } from '@/services/types'
import { useApp } from '@/stores/app'

interface OptimizeResult {
  before: PlanEval & { red_team: { tests: RedTeamTest[]; red_team_score: number } }
  after: PlanEval & { red_team: { tests: RedTeamTest[]; red_team_score: number } }
  changes: string[]
  note: string
  searched: number
}

/** The investment flow, stage by stage. Each stage shows the real output it produced on this page, or where it runs. */
function StageStrip({ d, opt, dna, limit }: { d: InvestmentResult; opt: OptimizeResult | null; dna: string | undefined; limit: number }) {
  const rt = opt?.after.red_team
  const stages: { t: string; out: string; done: boolean; to?: string }[] = [
    { t: 'Risk DNA', out: dna ? `${dna} profile` : 'From your twin', done: !!dna, to: '/twin#risk-dna' },
    { t: 'Goal analysis', out: d.goal.target ? `Needs ${inr(d.goal.required_monthly_sip)}/mo` : 'No goal set', done: true },
    { t: 'Market intelligence', out: `${d.regime} regime`, done: true },
    { t: 'Portfolio generation', out: `${pct(d.plan.weights.equity)} equity · ${inr(d.plan.monthly_sip)}/mo`, done: true },
    { t: 'Portfolio Doctor', out: 'Checks what you hold today', done: false, to: '/portfolio' },
    { t: 'Simulation', out: `${d.sim.n_paths.toLocaleString('en-IN')} futures · goal ${pct(d.goal_success_probability)}`, done: true },
    { t: 'Stress testing', out: `Crash loss ${d.crash_loss_pct.toFixed(1)}% vs ${limit}% limit`, done: true },
    { t: 'Red Team', out: rt ? `${rt.tests.filter((x) => x.status !== 'PASS').length} weaknesses · ${rt.red_team_score}/100` : 'Run “Stress-test and optimise”', done: !!rt },
    { t: 'AI Committee', out: 'Run the committee below', done: false, to: '#verdict' },
    { t: 'Critic', out: 'Accepts or forces a re-optimisation', done: false, to: '#verdict' },
    { t: 'Final portfolio', out: opt ? 'Re-optimised plan ready' : 'After the Critic', done: false, to: '#verdict' },
  ]
  return (
    <ol className="inv-stages" aria-label="How this plan is built">
      {stages.map((s, i) => (
        <li key={s.t} className={s.done ? 'done' : ''}>
          <span className="inv-n">{i + 1}</span>
          <strong>{s.to ? <Link to={s.to}>{s.t}</Link> : s.t}</strong>
          <span className="tiny text-2">{s.out}</span>
        </li>
      ))}
    </ol>
  )
}

export default function Investment() {
  const profile = useApp((s) => s.profile)
  const snapshot = useApp((s) => s.snapshot)
  const inv = useAsync((signal) => analyze<InvestmentResult>('/api/investment/analyze', {}, signal))
  const opt = useAsync((signal) => analyze<OptimizeResult>('/api/investment/optimize', {}, signal))

  const runInv = inv.run
  const resetOpt = opt.reset
  useEffect(() => {
    if (profile) {
      runInv()
      resetOpt()
    }
  }, [profile, runInv, resetOpt])
  useDemoStep([2], () => inv.run())

  if (!profile)
    return (
      <div className="page">
        <h1>Investment decision</h1>
        <div className="mt">
          <NeedsTwin what="The Investment Engine" />
        </div>
      </div>
    )

  const d = inv.data
  const limit = profile.risk.max_tolerated_loss_pct
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Investment decision</h1>
          <p>The Investment Engine turns your Risk DNA and goal into an allocation and a monthly investment, then simulates it 10,000 times. The Red Team checks it against your {limit}% loss limit.</p>
        </div>
        <button className="btn" onClick={() => inv.run()} disabled={inv.loading}>
          {inv.loading && <Spinner />} Re-run analysis
        </button>
      </div>
      <ErrorBox error={inv.error} onRetry={() => inv.run()} />
      {!d && inv.loading && <Loading label="Generating portfolio and simulating 10,000 futures…" height={360} />}
      {d && (
        <div className="stack">
          <StageStrip d={d} opt={opt.data} dna={snapshot?.risk_dna.label} limit={limit} />
          <div className="kpis">
            <div>
              <Metric label="Monthly investment" value={inr(d.plan.monthly_sip)} sub={d.plan.ef_topup ? `+ ${inr(d.plan.ef_topup)} to emergency fund` : 'Emergency fund on target'} />
            </div>
            <div>
              <Metric label="Expected return" value={`${d.expected_return_pct.toFixed(1)}%`} sub={`${d.expected_vol_pct.toFixed(1)}% volatility a year`} />
            </div>
            <div>
              <Metric label="Crash loss (NIFTY −30%)" value={`${d.crash_loss_pct.toFixed(1)}%`} tone={d.crash_loss_pct > limit ? 'red' : 'green'} sub={`Your limit ${limit}%`} />
            </div>
            <div>
              <Metric
                label="Goal success"
                value={pct(d.goal_success_probability)}
                tone={probTone(d.goal_success_probability)}
                sub={d.goal.target ? `${inrShort(d.goal.target)} in ${Math.round(d.goal.months / 12)} years` : 'No goal set'}
              />
            </div>
            <div>
              <Metric label="Median outcome" value={inrShort(d.ending_p50)} sub={`Worst 5%: ${inrShort(d.ending_p5)}`} />
            </div>
          </div>

          <div className="grid g-side">
            <Panel title="Recommended allocation" sub={`Of ${inrShort(d.goal.start_corpus)} invested today`}>
              <Donut data={(['equity', 'debt', 'gold'] as const).map((k) => ({ key: k, name: k[0]!.toUpperCase() + k.slice(1), value: d.plan.weights[k] }))} center={`${pct(d.plan.weights.equity)} equity`} />
              <div className="mt">
                <Legendish items={(['equity', 'debt', 'gold'] as const).map((k) => ({ key: k, label: k[0]!.toUpperCase() + k.slice(1), value: pct(d.plan.weights[k]) }))} />
              </div>
              <table className="table mt">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="r">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {d.allocation.map((a) => (
                    <tr key={a.instrument}>
                      <td className="small">{a.instrument}</td>
                      <td className="r num small">{pct(a.weight)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="list mt">
                {d.plan.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </Panel>
            <Panel title="10,000 simulated futures" sub={`Goal corpus by month — ${d.sim.regime} regime, ${d.sim.elapsed_ms.toFixed(0)} ms`}>
              <FanChart p={d.sim.percentiles} target={d.goal.target} height={320} />
              <div className="grid g3 mt">
                <Metric label="Worst 5% drawdown" value={pct(Math.abs(d.max_drawdown_p95))} />
                <Metric label={`Futures falling > ${limit}%`} value={pct(d.prob_loss_beyond_limit)} tone={(d.prob_loss_beyond_limit ?? 0) > 0.25 ? 'amber' : ''} />
                <Metric label="Required investment" value={inr(d.goal.required_monthly_sip)} sub={`Affordable ${inr(d.goal.affordable_sip)}`} />
              </div>
            </Panel>
          </div>

          <Panel title="Alternative options" sub="Same investment amount, same 10,000 market paths — only the risk level changes">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Option</th>
                    <th className="r">Equity</th>
                    <th className="r">Goal success</th>
                    <th className="r">Median</th>
                    <th className="r">Worst 5%</th>
                    <th className="r">Crash loss</th>
                  </tr>
                </thead>
                <tbody>
                  {[d.alternatives[0]!, { ...d, plan: { ...d.plan, label: 'Recommended' } } as PlanEval, d.alternatives[1]!].map((a) => (
                    <tr key={a.plan.label} style={a.plan.label === 'Recommended' ? { background: 'var(--brass-dim)' } : undefined}>
                      <td>{a.plan.label}</td>
                      <td className="r num">{pct(a.plan.weights.equity)}</td>
                      <td className={`r num ${probTone(a.goal_success_probability)}`}>{pct(a.goal_success_probability)}</td>
                      <td className="r num">{inrShort(a.ending_p50)}</td>
                      <td className="r num">{inrShort(a.ending_p5)}</td>
                      <td className={`r num ${a.crash_loss_pct > limit ? 'red' : ''}`}>{a.crash_loss_pct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="grid g2">
            <Panel title="Stress-test and optimise" sub="Run the seven Red Team attacks on this plan and let the re-optimiser fix what breaks">
              {!opt.data && (
                <button className="btn" onClick={() => opt.run()} disabled={opt.loading}>
                  {opt.loading && <Spinner />} Stress-test this plan
                </button>
              )}
              <ErrorBox error={opt.error} onRetry={() => opt.run()} />
              {opt.data && (
                <div className="stack">
                  <div className="grid g2">
                    {(['before', 'after'] as const).map((k) => (
                      <div key={k} className="inset">
                        <div className="row between">
                          <strong>{k === 'before' ? 'As proposed' : 'Optimised'}</strong>
                          <Badge tone={opt.data![k].red_team.red_team_score >= 55 ? 'green' : 'red'}>{opt.data![k].red_team.red_team_score}/100</Badge>
                        </div>
                        <div className="small text-2 mt-sm">
                          {pct(opt.data![k].plan.weights.equity)} equity, {inr(opt.data![k].plan.monthly_sip)}/mo
                        </div>
                        <div className="stack-sm mt">
                          {opt.data![k].red_team.tests.map((t) => (
                            <div key={t.key} className="row between small">
                              <span>{t.name}</span>
                              <StatusBadge status={t.status} />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <ul className="list">
                    {opt.data.changes.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                  <p className="tiny muted">
                    {opt.data.note}. {opt.data.searched} candidate plans searched.
                  </p>
                </div>
              )}
            </Panel>
            <Panel id="verdict" title="Get the committee’s verdict" sub="Runs the full pipeline: crisis test, five agents, debate, Red Team, Critic and explanation">
              <RunDecision type="investment" params={{}} command="Is my investment plan robust?" />
            </Panel>
          </div>
        </div>
      )}
      <Disclaimer />
    </div>
  )
}
