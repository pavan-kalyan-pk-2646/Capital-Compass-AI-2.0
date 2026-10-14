import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { AtlasRecommends, HealthIndex, StatusStrip } from '@/components/atlas/CommandPanels'
import { Challenge } from '@/components/atlas/Challenge'
import { DataTag } from '@/components/atlas/DataTag'
import { WhatIfLab } from '@/components/atlas/WhatIfLab'
import { Icon } from '@/components/icons'
import { useLanguage } from '@/components/LanguageContext'
import { FlowMap, HealthBadge, RiskDNAView } from '@/components/TwinViews'
import { Badge, Bar, Disclaimer, ErrorBox, Metric, NeedsTwin, Panel, Spinner } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { useTwin } from '@/hooks/useTwin'
import { clockTime, inr, inrShort, months, pct, probTone, shortDate, timeAgo, verdictTone } from '@/lib/format'
import { analyze, api, ApiError } from '@/services/api'
import type { AuditResponse, DashboardData, DecisionEnvelope, DecisionSummary, MarketStats, Twin } from '@/services/types'
import { useApp } from '@/stores/app'
import './dashboard.css'

const QUICK = [
  {
    label: 'Can I take a ₹5 lakh personal loan?',
    type: 'loan',
    params: { amount: 500000, loan_type: 'personal' },
  },
  { label: 'Is my investment plan robust?', type: 'investment', params: {} },
  {
    label: 'What if I lose my job for 6 months?',
    type: 'crisis',
    params: { scenario: 'job_loss', job_loss_months: 6 },
  },
]

/** The agents whose work the Command Center reports, in pipeline order. */
const ACTIVITY: { node: string; label: string }[] = [
  { node: 'supervisor', label: 'Supervisor' },
  { node: 'risk_dna', label: 'Risk agent' },
  { node: 'goal_agent', label: 'Goal agent' },
  { node: 'market_agent', label: 'Market agent' },
  { node: 'financial_committee', label: 'Financial Committee' },
  { node: 'red_team', label: 'Red Team' },
  { node: 'critic', label: 'Critic' },
]

const SUB_LABELS: Record<string, string> = {
  diversification: 'Diversification',
  concentration: 'Concentration',
  liquidity: 'Liquidity',
  risk: 'Risk fit',
  goal_alignment: 'Goal alignment',
}

const CLASS_LABELS: Record<string, string> = {
  equity: 'equity',
  debt: 'debt',
  gold: 'gold',
  cash: 'cash',
  real_estate: 'real estate',
  other: 'other assets',
}

function scoreTone(v: number) {
  return v >= 75 ? 'green' : v >= 50 ? 'amber' : 'red'
}
function riskTone(level: string | null | undefined) {
  return level === 'Low' ? 'green' : level === 'Moderate' ? 'amber' : level === 'High' ? 'red' : ''
}
interface Alert {
  tone: 'red' | 'amber' | 'blue'
  title: string
  detail: string
  to: string
  action: string
}

/** Alerts are threshold checks on real twin, goal, portfolio and decision data. Nothing else. */
function buildAlerts(t: Twin | undefined, board: DashboardData | null, latest: DecisionEnvelope | null, market: MarketStats | null): Alert[] {
  const out: Alert[] = []
  if (t) {
    if (t.emergency_fund_months < 3)
      out.push({
        tone: 'red',
        title: 'Emergency fund under 3 months',
        detail: `Cash covers ${t.emergency_fund_months.toFixed(1)} months of essentials and EMIs. A job loss would force selling investments.`,
        to: '/crisis?scenario=job_loss',
        action: 'Test a job loss',
      })
    else if (t.emergency_fund_months < 6)
      out.push({
        tone: 'amber',
        title: 'Emergency fund below the 6-month target',
        detail: `Cash covers ${t.emergency_fund_months.toFixed(1)} months of essentials and EMIs.`,
        to: '/crisis?scenario=job_loss',
        action: 'Test a job loss',
      })
    if (t.dti > 0.4)
      out.push({ tone: 'red', title: 'EMIs above 40% of income', detail: `EMIs take ${Math.round(t.dti * 100)}% of income, above what lenders usually accept.`, to: '/loan', action: 'Open the loan simulator' })
    else if (t.dti > 0.3)
      out.push({ tone: 'amber', title: 'EMIs above 30% of income', detail: `EMIs take ${Math.round(t.dti * 100)}% of income; a new loan would be tight.`, to: '/loan', action: 'Open the loan simulator' })
    if (t.monthly_surplus < 0) out.push({ tone: 'red', title: 'Spending more than you earn', detail: `Monthly shortfall of ${inr(-t.monthly_surplus)}.`, to: '/twin', action: 'Review the twin' })
    if (t.high_risk_spending > 0)
      out.push({ tone: 'amber', title: 'High-risk spending in the budget', detail: `${inr(t.high_risk_spending)} a month goes to high-risk spending.`, to: '/spending', action: 'See the consequences' })
  }
  for (const g of board?.goals ?? []) {
    if (g.probability == null) continue
    if (g.probability < 0.5)
      out.push({
        tone: 'red',
        title: `${g.name}: less than an even chance`,
        detail: `${Math.round(g.probability * 100)}% of simulated futures reach ${inrShort(g.target)} by the deadline.`,
        to: '/goals',
        action: 'Test goal survival',
      })
    else if (g.probability < 0.75)
      out.push({ tone: 'amber', title: `${g.name}: ${Math.round(g.probability * 100)}% chance`, detail: `One in four or more simulated futures miss ${inrShort(g.target)}.`, to: '/goals', action: 'Test goal survival' })
  }
  const pf = board?.portfolio
  if (pf) {
    if (pf.largest_share > 0.6)
      out.push({
        tone: 'amber',
        title: 'Concentrated holdings',
        detail: `${Math.round(pf.largest_share * 100)}% of what you hold is in one asset class (${pf.largest_class.replace('_', ' ')}).`,
        to: '/portfolio',
        action: 'Run the Portfolio Doctor',
      })
    if (Math.abs(pf.equity_share - pf.target_equity) > 0.15)
      out.push({
        tone: 'amber',
        title: 'Equity off target',
        detail: `Equity is ${Math.round(pf.equity_share * 100)}% of market investments against a plan target of ${Math.round(pf.target_equity * 100)}%.`,
        to: '/investment',
        action: 'See the plan',
      })
  }
  const v = latest?.result?.explanation.verdict
  if (latest?.status === 'completed' && v?.includes('FLAGGED'))
    out.push({
      tone: 'amber',
      title: 'Latest decision approved with flagged risks',
      detail: 'The Critic ran out of retries; open the decision to see what is still weak.',
      to: `/committee?id=${latest.decision_id}#final`,
      action: 'Open the decision',
    })
  if (market?.regime.label === 'volatile')
    out.push({
      tone: 'blue',
      title: 'Volatile market regime',
      detail: `Trailing 12-month volatility is ${market.regime.trailing_12m_vol_pct.toFixed(1)}%; simulations are scaled up accordingly.`,
      to: '/crisis?scenario=market_crash',
      action: 'Test a crash',
    })
  const rank = { red: 0, amber: 1, blue: 2 }
  return out.sort((a, b) => rank[a.tone] - rank[b.tone])
}

export default function Dashboard() {
  const { profile, snapshot, error } = useTwin()
  const lastId = useApp((s) => s.lastDecisionId)
  const setDecision = useApp((s) => s.setDecision)
  const nav = useNavigate()
  const recent = useAsync((signal) => api<{ decisions: DecisionSummary[] }>('/api/decisions?limit=6', { signal }))
  const market = useAsync((signal) => api<MarketStats>('/api/market', { signal }))
  const latest = useAsync((signal) => api<DecisionEnvelope>(`/api/decision/${lastId}`, { signal }))
  const audit = useAsync((signal) => api<AuditResponse>(`/api/decision/${lastId}/audit`, { signal }))
  const board = useAsync((signal) => analyze<DashboardData>('/api/dashboard', {}, signal))
  const { t: tr } = useLanguage()
  const [starting, setStarting] = useState<string | null>(null)
  const [startErr, setStartErr] = useState<ApiError | null>(null)

  const runRecent = recent.run
  const runMarket = market.run
  const runLatest = latest.run
  const runAudit = audit.run
  const runBoard = board.run
  useEffect(() => {
    runRecent()
    runMarket()
  }, [runRecent, runMarket])
  useEffect(() => {
    if (lastId) runLatest()
  }, [lastId, runLatest])
  const latestStatus = latest.data?.status
  useEffect(() => {
    if (lastId && latestStatus && latestStatus !== 'running') runAudit()
  }, [lastId, latestStatus, runAudit])
  useEffect(() => {
    if (profile) runBoard()
  }, [profile, runBoard])

  if (!profile)
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <h1>Command center</h1>
            <p>Your financial state, the decisions you are weighing, and how they held up under stress.</p>
          </div>
        </div>
        <NeedsTwin what="The command center" />
      </div>
    )

  async function quick(q: (typeof QUICK)[number]) {
    setStarting(q.label)
    setStartErr(null)
    try {
      const r = await api<{ decision_id: string }>('/api/decision/run', {
        body: {
          profile,
          decision_type: q.type,
          params: q.params,
          command: q.label,
        },
      })
      setDecision(r.decision_id)
      nav(`/committee?id=${r.decision_id}`)
    } catch (e) {
      setStartErr(e as ApiError)
    } finally {
      setStarting(null)
    }
  }

  const t = snapshot?.twin
  const res = latest.data?.result
  const goals = board.data?.goals ?? []
  const pf = board.data?.portfolio
  const alerts = buildAlerts(t, board.data ?? null, latest.data ?? null, market.data ?? null)

  // Latest record per agent from the stored audit trail (Red Team and Critic can run more than once)
  const trail = audit.data?.audit_trail ?? []
  const activity = ACTIVITY.map((a) => {
    const rows = trail.filter((r) => r.node_name === a.node)
    return { ...a, last: rows[rows.length - 1], runs: rows.length }
  })

  return (
    <div className="page">
      <div className="page-head" data-i18n>
        <div>
          <p className="cc-eyebrow">ATLAS · {profile.name}</p>
          <h1>{tr('cc.title')}</h1>
          <p>{tr('cc.sub')}</p>
        </div>
        <div className="row wrap">
          <Link className="btn" to="/atlas">
            <Icon name="compass" size={15} /> {tr('cc.map')}
          </Link>
          <Link className="btn primary" to="/committee">
            <Icon name="committee" size={16} /> {tr('cc.runDecision')}
          </Link>
        </div>
      </div>
      <ErrorBox error={error} />

      {board.data?.atlas ? (
        <div className="cc-hero">
          <AtlasRecommends brief={board.data.atlas} />
          <HealthIndex brief={board.data.atlas} />
        </div>
      ) : board.error ? (
        <ErrorBox error={board.error} onRetry={() => board.run()} />
      ) : (
        <div className="cc-hero">
          <div className="skeleton" style={{ height: 300 }} />
          <div className="skeleton" style={{ height: 300 }} />
        </div>
      )}

      <h2 className="section-label mt" data-i18n>
        {tr('cc.status')}
      </h2>
      {snapshot ? <StatusStrip snap={snapshot} board={board.data ?? null} /> : <div className="skeleton" style={{ height: 120 }} />}

      <h2 className="section-label mt" data-i18n>
        {tr('cc.twin')}
      </h2>
      {t ? (
        <div className="kpis k4">
          <div>
            <Metric label="Financial resilience" value={`${Math.round(t.health_score)}/100`} sub={<HealthBadge band={t.health_band} />} />
          </div>
          <div>
            <Metric label="Net worth" value={inrShort(t.net_worth)} sub={`${inrShort(t.total_assets)} assets`} />
          </div>
          <div>
            <Metric label="Monthly income" value={inr(t.monthly_income)} sub="take-home" />
          </div>
          <div>
            <Metric label="Monthly expenses" value={inr(t.monthly_expenses)} sub={`${inr(t.essential_expenses)} essential`} />
          </div>
          <div>
            <Metric label="Monthly savings" value={inr(t.monthly_surplus)} tone={t.monthly_surplus < 0 ? 'red' : ''} sub={`${pct(t.savings_rate)} of income, after EMIs`} />
          </div>
          <div>
            <Metric label="Emergency fund" value={months(t.emergency_fund_months)} tone={t.emergency_fund_months < 3 ? 'red' : t.emergency_fund_months < 6 ? 'amber' : ''} sub="of essentials + EMIs · target 6" />
          </div>
          <div>
            <Metric label="Debt outstanding" value={inrShort(t.total_liabilities)} sub={`${inr(t.monthly_emi)}/mo in EMIs`} />
          </div>
          <div>
            <Metric label="EMIs to income" value={pct(t.dti)} tone={t.dti > 0.4 ? 'red' : t.dti > 0.3 ? 'amber' : ''} sub="lenders’ comfort ≤ 40%" />
          </div>
        </div>
      ) : (
        <div className="skeleton" style={{ height: 196 }} />
      )}

      {t && (
        <Panel title="Alerts" className="mt" sub="Threshold checks on your twin, goals, holdings and latest decision">
          {alerts.length ? (
            <ul className="alerts">
              {alerts.map((a) => (
                <li key={a.title} className={a.tone}>
                  <div>
                    <strong>{a.title}</strong>
                    <span>{a.detail}</span>
                  </div>
                  <Link className="btn sm" to={a.to}>
                    {a.action}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small text-2">No alerts. Nothing in your twin, goals or holdings crosses a threshold right now.</p>
          )}
        </Panel>
      )}

      <div className="grid g-wide mt">
        <Panel
          title="Latest decision"
          action={
            res && (
              <Link className="btn sm" to={`/committee?id=${lastId}#final`}>
                Open the decision
              </Link>
            )
          }
        >
          {latest.loading && !res && (
            <div className="row">
              <Spinner /> Loading the latest decision…
            </div>
          )}
          {latest.data?.status === 'running' && (
            <div className="row">
              <Spinner /> A decision is still running. <Link to={`/committee?id=${lastId}`}>Watch it live</Link>
            </div>
          )}
          {res ? (
            <div className="stack">
              <div className="row wrap">
                <Badge tone={verdictTone(res.recommendation.status)}>{res.explanation.verdict ?? res.recommendation.status}</Badge>
                <span className="small muted">
                  {res.decision_type} decision {latest.data && timeAgo(latest.data.created_at)}
                </span>
              </div>
              {latest.data?.command && <p className="text-2">“{latest.data.command}”</p>}
              <p style={{ fontSize: 16 }}>{res.explanation.action}</p>
              <div className="grid g3">
                <Metric label="Goal success" value={pct(res.recommendation.goal_probability)} tone={probTone(res.recommendation.goal_probability)} />
                <Metric label="Robustness" value={`${res.recommendation.red_team_score}/100`} />
                <Metric label="Confidence" value={res.recommendation.confidence.label} sub="model-generated, scenario-based" />
              </div>
              {lastId && <Challenge decisionId={lastId} />}
            </div>
          ) : (
            !latest.loading &&
            latest.data?.status !== 'running' && (
              <div className="stack">
                <p className="text-2">No decision yet. Pick a question — each one runs the full pipeline: simulation, crisis test, AI committee, Red Team and Critic.</p>
                <div className="stack-sm">
                  {QUICK.map((q) => (
                    <button key={q.label} className="btn" style={{ justifyContent: 'flex-start' }} disabled={!!starting} onClick={() => quick(q)}>
                      {starting === q.label ? <Spinner /> : <Icon name="arrow" size={15} />} {q.label}
                    </button>
                  ))}
                </div>
                <ErrorBox error={startErr} />
              </div>
            )
          )}
          {latest.error && latest.error.status !== 404 && <ErrorBox error={latest.error} onRetry={() => latest.run()} />}
        </Panel>
        <Panel
          title="Risk DNA"
          action={
            <Link className="btn sm ghost" to="/twin">
              Edit twin
            </Link>
          }
        >
          {snapshot ? <RiskDNAView dna={snapshot.risk_dna} compact /> : <div className="skeleton" style={{ height: 240 }} />}
        </Panel>
      </div>

      <div className="mt">
        <WhatIfLab />
      </div>

      <Panel
        title="Active goals"
        className="mt"
        sub="Probabilities from 4,000 simulated futures per goal, using your planned monthly investment"
        action={
          <Link className="btn sm ghost" to="/goals">
            Test goal survival
          </Link>
        }
      >
        {board.loading && !board.data ? (
          <div className="skeleton" style={{ height: 90 }} />
        ) : board.error ? (
          <ErrorBox error={board.error} onRetry={() => board.run()} />
        ) : goals.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Goal</th>
                  <th className="r">Target</th>
                  <th className="r">Current</th>
                  <th className="r">Remaining</th>
                  <th>Progress</th>
                  <th>Deadline</th>
                  <th className="r">Probability</th>
                </tr>
              </thead>
              <tbody>
                {goals.map((g) => (
                  <tr key={g.name + g.target}>
                    <td>
                      {g.name} {g.primary && <Badge tone="blue">primary</Badge>}
                      <div className="tiny muted">{g.priority} priority</div>
                    </td>
                    <td className="r num">{inrShort(g.target)}</td>
                    <td className="r num">{inrShort(g.current)}</td>
                    <td className="r num">{inrShort(g.remaining)}</td>
                    <td className="goal-prog">
                      <Bar value={g.target ? (g.current / g.target) * 100 : 0} tone="blue" />
                      <div className="tiny muted">{pct(g.target ? g.current / g.target : 0)} funded</div>
                    </td>
                    <td className="text-2">
                      {shortDate(g.deadline)}
                      <div className="tiny muted">{g.years} yrs</div>
                    </td>
                    <td className={`r num ${probTone(g.probability)}`} title={g.basis}>
                      {pct(g.probability)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="small muted">No goals yet. Add one on the Digital Twin page to see its probability of success.</p>
        )}
      </Panel>

      <div className="grid g2 mt">
        <Panel
          title="Portfolio"
          sub="What you hold today, by asset class"
          action={
            <Link className="btn sm ghost" to="/portfolio">
              Run the Portfolio Doctor
            </Link>
          }
        >
          {board.loading && !board.data ? (
            <div className="skeleton" style={{ height: 220 }} />
          ) : pf ? (
            <div className="stack">
              <div className="grid g3">
                <Metric label="Total value" value={inrShort(pf.total_value)} sub={`${inrShort(pf.investable_value)} in markets`} />
                <Metric label="Portfolio health" value={`${Math.round(pf.health_score)}/100`} tone={scoreTone(pf.health_score)} />
                <Metric label="Expected volatility" value={`${pf.portfolio_vol_pct.toFixed(1)}%`} sub={`plan target ${pf.target_vol_pct.toFixed(1)}%`} />
              </div>
              <div className="score-rows">
                {Object.entries(pf.sub_scores).map(([k, v]) => (
                  <div className="score-row" key={k}>
                    <span className="text-2">{SUB_LABELS[k] ?? k}</span>
                    <Bar value={v} tone={scoreTone(v)} />
                    <span className="num">{Math.round(v)}</span>
                  </div>
                ))}
              </div>
              <p className="small text-2">
                Largest holding: {CLASS_LABELS[pf.largest_class] ?? pf.largest_class} at {pct(pf.largest_share)}. Equity is {pct(pf.equity_share)} of market investments against a plan target of {pct(pf.target_equity)}.
              </p>
            </div>
          ) : board.error ? (
            <ErrorBox error={board.error} onRetry={() => board.run()} />
          ) : (
            <p className="small muted">No assets recorded. Add them on the Digital Twin page.</p>
          )}
        </Panel>

        <Panel
          title="AI activity"
          sub={audit.data ? `From the stored audit trail of the latest decision · ${timeAgo(audit.data.created_at)}` : 'What each agent did in the latest decision'}
          action={
            lastId &&
            audit.data && (
              <Link className="btn sm ghost" to={`/audit?id=${lastId}`}>
                Full audit
              </Link>
            )
          }
        >
          {!lastId ? (
            <p className="small muted">The agents have not run yet. Run a decision and each agent’s work is recorded here.</p>
          ) : audit.loading && !audit.data ? (
            <div className="skeleton" style={{ height: 220 }} />
          ) : audit.error ? (
            audit.error.status === 404 ? (
              <p className="small muted">The latest decision is no longer stored. Run a new one.</p>
            ) : (
              <ErrorBox error={audit.error} onRetry={() => audit.run()} />
            )
          ) : latestStatus === 'running' ? (
            <div className="row small">
              <Spinner /> Agents are working. <Link to={`/committee?id=${lastId}`}>Watch live</Link>
            </div>
          ) : (
            <ul className="activity">
              {activity.map((a) => (
                <li key={a.node}>
                  <span className={`dot ${a.last ? (a.last.status === 'failed' ? 'failed' : '') : 'idle'}`} />
                  <div>
                    <div className="who">
                      {a.label} {a.runs > 1 && <span className="tiny muted">×{a.runs}</span>}
                    </div>
                    <div className="what">{a.last ? a.last.message : 'Not needed for this decision.'}</div>
                  </div>
                  {a.last && <time dateTime={a.last.timestamp}>{clockTime(a.last.timestamp)}</time>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Recent AI decisions"
        className="mt"
        action={
          <Link className="btn sm ghost" to="/audit">
            Audit trail
          </Link>
        }
      >
        {recent.data && recent.data.decisions.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Decision</th>
                  <th>Recommendation</th>
                  <th className="r">Confidence</th>
                  <th>Risk level</th>
                  <th className="r">Goal success</th>
                  <th className="r">Date</th>
                </tr>
              </thead>
              <tbody>
                {recent.data.decisions.map((d) => (
                  <tr key={d.decision_id}>
                    <td>
                      <Link to={`/committee?id=${d.decision_id}`}>{d.command || `${d.type} decision`}</Link>
                      <div className="tiny muted">{d.type}</div>
                    </td>
                    <td>
                      {d.status === 'completed' ? (
                        <Badge tone={verdictTone(d.verdict)}>{d.verdict_label ?? (d.verdict ?? '').toLowerCase()}</Badge>
                      ) : (
                        <Badge tone={d.status === 'failed' ? 'red' : 'blue'}>{d.status}</Badge>
                      )}
                    </td>
                    <td className="r num">{d.confidence != null ? pct(d.confidence) : '—'}</td>
                    <td>{d.risk_level ? <Badge tone={riskTone(d.risk_level)}>{d.risk_level}</Badge> : <span className="muted">—</span>}</td>
                    <td className={`r num ${probTone(d.goal_probability)}`}>{pct(d.goal_probability)}</td>
                    <td className="r muted" title={d.created_at}>
                      {shortDate(d.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : recent.error ? (
          <ErrorBox error={recent.error} onRetry={() => recent.run()} />
        ) : (
          <p className="small muted">Decisions you run appear here with their recommendation, confidence and risk level.</p>
        )}
      </Panel>

      <div className="grid g-wide mt">
        <Panel title="Cash flow" sub="Where each month’s income goes">
          {snapshot ? <FlowMap s={snapshot} /> : <div className="skeleton" style={{ height: 260 }} />}
        </Panel>
        <Panel title="Market regime" sub="Sets how volatile the simulated futures are" action={market.data && <DataTag source="historical" note={tr('tag.asOf', { date: market.data.regime.as_of })} />}>
          {market.data ? (
            <div className="stack-sm small">
              <div className="row between">
                <span className="text-2">Regime</span>
                <Badge tone={market.data.regime.label === 'volatile' ? 'red' : market.data.regime.label === 'calm' ? 'green' : 'blue'}>{market.data.regime.label}</Badge>
              </div>
              <div className="row between">
                <span className="text-2">Trailing 12-month volatility</span>
                <span className="num">{market.data.regime.trailing_12m_vol_pct.toFixed(1)}%</span>
              </div>
              <div className="row between">
                <span className="text-2">NIFTY 50 long-run return</span>
                <span className="num">{market.data.equity.cagr_pct.toFixed(1)}% a year</span>
              </div>
              <div className="tiny muted" data-i18n>
                {tr('tag.asOf', { date: market.data.regime.as_of })}
              </div>
            </div>
          ) : market.error ? (
            <ErrorBox error={market.error} onRetry={() => market.run()} />
          ) : (
            <div className="skeleton" style={{ height: 90 }} />
          )}
        </Panel>
      </div>
      <Disclaimer />
    </div>
  )
}
