import { useEffect } from 'react'
import { Link } from 'react-router-dom'

import { Badge, Disclaimer, ErrorBox, Loading, Metric, Panel } from '@/components/ui'
import { DataBasis } from '@/components/atlas/DataBasis'
import { useAsync } from '@/hooks/useAsync'
import { inr, pct } from '@/lib/format'
import { api } from '@/services/api'
import type { DecisionEnvelope, MarketStats } from '@/services/types'
import { useApp } from '@/stores/app'

const KIND_TONE: Record<string, string> = {
  historical: 'blue',
  assumption: 'amber',
  user: 'brass',
  rag: 'green',
}
const KIND_LABEL: Record<string, string> = {
  historical: 'Historical data',
  assumption: 'Assumption',
  user: 'Your input',
  rag: 'Knowledge base',
}

export default function Trust() {
  const lastId = useApp((s) => s.lastDecisionId)
  const dec = useAsync((signal) => api<DecisionEnvelope>(`/api/decision/${lastId}`, { signal }))
  const market = useAsync((signal) => api<MarketStats>('/api/market', { signal }))
  const kb = useAsync((signal) =>
    api<{
      passages: { id: string; title: string; text: string; source: string }[]
    }>('/api/knowledge', { signal }),
  )

  const runMarket = market.run
  const runKb = kb.run
  const runDec = dec.run
  useEffect(() => {
    runMarket()
    runKb()
  }, [runMarket, runKb])
  useEffect(() => {
    if (lastId) runDec()
  }, [lastId, runDec])

  const res = dec.data?.status === 'completed' ? dec.data.result : null
  const trust = res?.trust
  const m = trust?.market ?? market.data
  const p = res?.profile

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Trust Center</h1>
          <p>What every recommendation is built on: the data, the assumptions, how many futures were simulated, which agents took part, what the Critic and Compliance concluded, and where the model stops.</p>
        </div>
      </div>

      <div className="panel" style={{ borderColor: 'var(--brass)' }}>
        <p>
          <strong>Capital Compass provides scenario-based financial decision support. Simulated outcomes are not guaranteed predictions and should not be interpreted as regulated personalized financial advice.</strong>{' '}
          <span className="text-2">
            Confidence scores are model-generated from the simulations; they are not certainty. You remain responsible for the final decision and may wish to consult a SEBI-registered investment adviser.
          </span>
        </p>
      </div>

      <DataBasis market={market.data ?? null} />

      {dec.error && dec.error.status !== 404 && <ErrorBox error={dec.error} onRetry={() => dec.run()} />}
      {!res && !dec.loading && (
        <div className="state mt">
          <h3>No completed decision to inspect yet</h3>
          <p>The methodology and data below apply to every decision. Run one to see its simulation count, critic review and compliance checks.</p>
          <Link className="btn primary mt" to="/committee?new=1">
            Run a decision
          </Link>
        </div>
      )}
      {dec.loading && !res && <Loading label="Loading the latest decision" height={120} />}

      {trust && res && (
        <div className="stack mt">
          <div className="kpis">
            <div>
              <Metric label="Confidence" value={trust.confidence.label} sub={`${pct(trust.confidence.score)}, ${trust.confidence.basis}`} />
            </div>
            <div>
              <Metric label="Simulated futures" value={trust.simulated_paths.toLocaleString('en-IN')} sub={`${trust.simulation_runs} runs of up to ${trust.paths_per_run.toLocaleString('en-IN')}`} />
            </div>
            <div>
              <Metric label="Agents used" value={trust.agents_used.length} sub="in this decision" />
            </div>
            <div>
              <Metric
                label="Critic review"
                value={trust.critic_review.verdict === 'ACCEPT' ? 'Passed' : trust.critic_review.verdict}
                tone="green"
                sub={`${trust.critic_review.rounds} round${trust.critic_review.rounds > 1 ? 's' : ''}${trust.critic_review.forced ? ', weaknesses flagged' : ''}`}
              />
            </div>
            <div>
              <Metric
                label="Compliance"
                value={trust.compliance_status === 'PASSED' ? 'Passed' : 'Failed'}
                tone={trust.compliance_status === 'PASSED' ? 'green' : 'red'}
                sub={`${trust.compliance_checks.length} rule checks`}
              />
            </div>
          </div>
          <p className="small text-2">
            For: “{dec.data?.command || `${res.decision_type} decision`}” — <Link to={`/committee?id=${res.decision_id}`}>open decision</Link>, <Link to="/audit">audit trail</Link>
          </p>

          <div className="grid g3">
            <Panel title="AI Committee" sub="Bull, Bear, Risk, Goal and Compliance agents">
              {(() => {
                const c = res.committee_decision
                return (
                  <div className="stack-sm">
                    <div className="row wrap">
                      <Badge tone={c.verdict.includes('REJECT') || c.verdict.includes('OPPOSE') ? 'red' : c.verdict.includes('CONDITION') ? 'amber' : 'green'}>
                        {c.verdict.charAt(0) + c.verdict.slice(1).toLowerCase()}
                      </Badge>
                      <span className="small text-2">
                        weighted support {Math.round(c.score * 100)}%{c.confidence != null ? ` · confidence ${Math.round(c.confidence * 100)}%` : ''}
                      </span>
                    </div>
                    {(c.unresolved_concerns ?? []).length > 0 && (
                      <>
                        <div className="tiny muted">Unresolved concerns</div>
                        <ul className="list amber small">
                          {c.unresolved_concerns!.slice(0, 3).map((u) => (
                            <li key={u}>{u}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )
              })()}
            </Panel>
            <Panel title="Red Team" sub="Seven attacks on the final plan">
              {(() => {
                const last = res.rounds[res.rounds.length - 1]
                const rt = last?.red_team
                if (!rt) return <p className="small muted">Not run for this decision.</p>
                const broken = rt.tests.filter((t) => t.status !== 'PASS').length
                return (
                  <div className="stack-sm">
                    <div className="row wrap">
                      <Badge tone={broken === 0 ? 'green' : rt.tests.some((t) => t.status === 'FAIL') ? 'red' : 'amber'}>
                        {broken} weakness{broken === 1 ? '' : 'es'} found
                      </Badge>
                      <span className="small text-2">robustness {rt.red_team_score}/100</span>
                    </div>
                    <div className="small">
                      {rt.tests.map((t) => (
                        <div key={t.key} className="row between">
                          <span className="text-2">{t.name}</span>
                          <Badge tone={t.status === 'PASS' ? 'green' : t.status === 'WARN' ? 'amber' : 'red'}>{t.status === 'PASS' ? 'held' : t.status === 'WARN' ? 'strained' : 'broke'}</Badge>
                        </div>
                      ))}
                    </div>
                    {rt.most_fragile && (
                      <p className="tiny text-2">
                        Most fragile assumption: {rt.most_fragile.name.toLowerCase()} — {rt.most_fragile.question}
                      </p>
                    )}
                  </div>
                )
              })()}
            </Panel>
            <Panel title="Critic" sub={`${res.rounds.length} review round${res.rounds.length === 1 ? '' : 's'}, maximum 3`}>
              <div className="stack-sm">
                {res.rounds.map((r) => (
                  <div key={r.round} className="inset">
                    <div className="tiny muted">Round {r.round}</div>
                    <Badge tone={r.critic.verdict === 'ACCEPT' ? (r.critic.forced ? 'amber' : 'green') : 'red'}>
                      {r.critic.outcome ?? (r.critic.verdict === 'ACCEPT' ? (r.critic.forced ? 'APPROVED WITH FLAGGED RISKS' : 'APPROVED') : 'REJECTED — RE-OPTIMIZATION REQUIRED')}
                    </Badge>
                    <div className="tiny text-2 mt-sm">{r.critic.reasons.slice(0, 2).join(' · ')}</div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <Panel title="Assumptions behind this decision" sub="Change any of these and the numbers change">
            <p className="small text-2">
              Base case: NIFTY 50 and Indian debt history 2000–2023 resampled in 6-month blocks, scaled to the {trust.market.regime.label} regime; gold {trust.market.gold.mean_pct}% ± {trust.market.gold.vol_pct}% and
              inflation {trust.market.inflation.mean_pct}% ± {trust.market.inflation.sd_pct}% are documented assumptions; your income, expenses and EMIs as entered on the Digital Twin.
            </p>
            {res.counterfactual.sensitivity.length > 0 && (
              <div className="table-wrap mt">
                <table className="table">
                  <thead>
                    <tr>
                      <th>If this assumption is wrong</th>
                      <th className="r">Goal success</th>
                      <th className="r">Impact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.counterfactual.sensitivity.map((x) => (
                      <tr key={x.assumption}>
                        <td className="text-2">{x.assumption}</td>
                        <td className="r num">{pct(x.goal_probability)}</td>
                        <td className={`r num ${x.impact < -0.1 ? 'red' : x.impact < 0 ? 'amber' : ''}`}>
                          {x.impact > 0 ? '+' : ''}
                          {Math.round(x.impact * 100)} pts
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <div className="grid g2">
            <Panel title="Data sources">
              <div className="stack-sm">
                {trust.data_sources.map((d) => (
                  <div key={d.name} className="row between" style={{ alignItems: 'flex-start' }}>
                    <div>
                      <div className="small">{d.name}</div>
                      <div className="tiny muted">{d.detail}</div>
                    </div>
                    <Badge tone={KIND_TONE[d.kind]}>{KIND_LABEL[d.kind] ?? d.kind}</Badge>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Your inputs used">
              {p && (
                <div className="table-wrap">
                  <table className="table">
                    <tbody>
                      <tr>
                        <td className="text-2">Age, dependents</td>
                        <td className="r">
                          {p.age}, {p.dependents}
                        </td>
                      </tr>
                      <tr>
                        <td className="text-2">Monthly income</td>
                        <td className="r num">{inr(p.monthly_income + p.other_income)}</td>
                      </tr>
                      <tr>
                        <td className="text-2">Monthly spending</td>
                        <td className="r num">{inr(p.essential_expenses + p.discretionary_expenses + p.behaviour.high_risk_spending)}</td>
                      </tr>
                      <tr>
                        <td className="text-2">Existing EMIs</td>
                        <td className="r num">{inr(p.liabilities.reduce((a, l) => a + l.emi, 0))}</td>
                      </tr>
                      <tr>
                        <td className="text-2">Savings and investments</td>
                        <td className="r num">{inr(p.assets.cash + p.assets.equity + p.assets.debt + p.assets.gold)}</td>
                      </tr>
                      <tr>
                        <td className="text-2">Maximum tolerated loss</td>
                        <td className="r num">{p.risk.max_tolerated_loss_pct}%</td>
                      </tr>
                      <tr>
                        <td className="text-2">Goals</td>
                        <td className="r">{p.goals.map((g) => g.name).join(', ') || '—'}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

          <Panel title="Compliance checks" sub="Rules from the local knowledge base, retrieved and cited by the Compliance Agent">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Check</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {trust.compliance_checks.map((c) => (
                    <tr key={c.rule}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <strong>{c.rule}</strong> <span className="text-2">{c.title}</span>
                      </td>
                      <td className="small text-2">{c.detail}</td>
                      <td>
                        <Badge tone={c.passed ? 'green' : 'red'}>{c.passed ? 'Passed' : 'Failed'}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 className="mt">Passages retrieved for this decision</h3>
            <div className="grid g2 mt-sm">
              {trust.citations.map((c) => (
                <div key={c.id} className="inset">
                  <div className="small">
                    <strong>{c.id}</strong> {c.title}
                  </div>
                  <p className="tiny text-2 mt-sm">{c.text}</p>
                  <div className="tiny muted mt-sm">{c.source}</div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Agents in this decision">
            <div className="row wrap">
              {trust.agents_used.map((a) => (
                <Badge key={a}>{a}</Badge>
              ))}
            </div>
            <p className="small text-2 mt">
              Agents argue about numbers; they never produce them. Every figure comes from a deterministic, unit-tested engine.{' '}
              {trust.llm_used ? 'A language model rephrased the summary paragraph.' : 'No language model was used — all text is generated from engine outputs.'}
            </p>
          </Panel>
        </div>
      )}

      <div className="grid g2 mt">
        <Panel title="Historical returns" sub="Local data, no live feed or API key">
          {!m && market.loading && <Loading label="Loading" height={140} />}
          <ErrorBox error={market.error} onRetry={() => market.run()} />
          {m && (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  <tr>
                    <td className="text-2">NIFTY 50 period</td>
                    <td className="r">
                      {m.equity.period.replace('→', 'to')} ({m.equity.months} months)
                    </td>
                  </tr>
                  <tr>
                    <td className="text-2">NIFTY 50 total return</td>
                    <td className="r num">{m.equity.cagr_pct.toFixed(2)}% a year</td>
                  </tr>
                  <tr>
                    <td className="text-2">Volatility</td>
                    <td className="r num">{m.equity.vol_pct.toFixed(1)}% a year</td>
                  </tr>
                  <tr>
                    <td className="text-2">Worst month / worst 12 months</td>
                    <td className="r num">
                      {m.equity.worst_month_pct.toFixed(1)}% / {m.equity.worst_12m_pct.toFixed(1)}%
                    </td>
                  </tr>
                  <tr>
                    <td className="text-2">Deepest drawdown</td>
                    <td className="r num">{m.equity.max_drawdown_pct.toFixed(1)}%</td>
                  </tr>
                  <tr>
                    <td className="text-2">Indian debt return</td>
                    <td className="r num">{m.debt.cagr_pct.toFixed(2)}% a year</td>
                  </tr>
                  <tr>
                    <td className="text-2">Gold (assumption)</td>
                    <td className="r num">
                      {m.gold.mean_pct}% mean, {m.gold.vol_pct}% volatility
                    </td>
                  </tr>
                  <tr>
                    <td className="text-2">Inflation (assumption)</td>
                    <td className="r num">
                      {m.inflation.mean_pct}% ± {m.inflation.sd_pct}%
                    </td>
                  </tr>
                  <tr>
                    <td className="text-2">Market regime</td>
                    <td className="r">
                      {m.regime.label}, {m.regime.trailing_12m_vol_pct.toFixed(1)}% trailing volatility ({m.regime.percentile_vs_history.toFixed(0)}th percentile, to {m.regime.as_of})
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="How the simulation works">
          <ul className="list">
            <li>Each future stitches random 6-month blocks of real NIFTY 50 history; debt returns come from the same months, so crisis periods stay intact.</li>
            <li>Volatility is scaled to the detected market regime (calm 0.9×, normal 1×, volatile 1.25×).</li>
            <li>Gold uses fat-tailed draws around a documented assumption; inflation is drawn per future.</li>
            <li>Salary, expenses, EMIs and monthly investments flow through every month; if cash runs out, investments are sold.</li>
            <li>10,000 futures per run, fixed seed, so the same inputs always give the same answer.</li>
          </ul>
        </Panel>
      </div>

      <Panel title="Limitations" className="mt">
        <ul className="list amber">
          {(
            trust?.limitations ?? [
              'Market history ends in December 2023; the regime is detected from that window.',
              'Gold returns, inflation and the holdings correlation model are assumptions.',
              'Taxes, fund expense ratios and exit loads are not modelled.',
              'Equity is simulated as the NIFTY 50 index; individual funds will differ.',
              'Capital Compass provides scenario-based financial decision support. Simulated outcomes are not guaranteed predictions and should not be interpreted as regulated personalized financial advice.',
            ]
          ).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </Panel>

      {kb.data && (
        <Panel title="Compliance knowledge base" sub={`${kb.data.passages.length} rules the Compliance Agent retrieves from`} className="mt">
          <div className="grid g3">
            {kb.data.passages.map((pp) => (
              <div key={pp.id} className="inset">
                <div className="small">
                  <strong>{pp.id}</strong> {pp.title}
                </div>
                <p className="tiny text-2 mt-sm">{pp.text}</p>
              </div>
            ))}
          </div>
        </Panel>
      )}
      <Disclaimer />
    </div>
  )
}
