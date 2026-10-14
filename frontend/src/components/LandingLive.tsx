/**
 * Live panels for the landing story. Everything shown comes from the real engines running on
 * the bundled sample profile (labelled as such), or from the latest stored decision.
 * Loaded lazily so the cinematic intro does not pay for charts.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { FanChart } from '@/charts/charts'
import { inr, inrShort, months, pct } from '@/lib/format'
import { api } from '@/services/api'
import type { DecisionEnvelope, DecisionSummary, GoalSurvival, Profile, Snapshot } from '@/services/types'

let judge: Promise<Profile> | null = null
function judgeProfile(): Promise<Profile> {
  judge ??= api<{ profile: Profile }>('/api/demo/judge-profile').then((r) => r.profile)
  return judge
}

function useLive<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    fn()
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return { data, failed }
}

function Offline({ what }: { what: string }) {
  return <p className="small muted">The {what} could not be loaded right now. Start the backend to see it computed live.</p>
}

/** Section 3: the sample Financial Digital Twin, computed by the twin engine. */
export function TwinPreview() {
  const { data, failed } = useLive(async () => {
    const profile = await judgeProfile()
    const snap = await api<Snapshot>('/api/twin/create', { body: { profile, save: false } })
    return { profile, snap }
  })
  if (failed) return <Offline what="sample twin" />
  if (!data) return <div className="skeleton" style={{ height: 260 }} />
  const { profile: p, snap } = data
  const t = snap.twin
  const rows: [string, string, string][] = [
    ['Income', inr(t.monthly_income), 'per month, take-home'],
    ['Expenses', inr(t.monthly_expenses), `${inr(t.essential_expenses)} essential`],
    ['Assets', inrShort(t.total_assets), `${inrShort(t.liquid_assets)} liquid`],
    ['Liabilities', inrShort(t.total_liabilities), `${inr(t.monthly_emi)}/month in EMIs`],
    ['Goal', snap.goal?.target ? inrShort(snap.goal.target) : '—', snap.goal?.target ? `${snap.goal.name}, ${Math.round(snap.goal.months / 12)} years` : 'none set'],
    ['Risk', snap.risk_dna.label, `${p.risk.max_tolerated_loss_pct}% maximum tolerated loss`],
    ['Liquidity', months(t.emergency_fund_months), 'emergency fund'],
    ['Behaviour', p.behaviour.credit_card_behaviour === 'full' ? 'Pays cards in full' : 'Carries card balances', p.behaviour.investment_frequency === 'monthly_sip' ? 'invests monthly' : 'irregular investing'],
  ]
  return (
    <div className="lv-twin">
      <div className="lv-twin-head">
        <span className="lv-tag">Live from the twin engine · sample profile</span>
        <strong>
          {p.name}, {p.age}
        </strong>
        <span className="small text-2">
          Net worth {inrShort(t.net_worth)} · surplus {inr(t.monthly_surplus)}/month · financial health {Math.round(t.health_score)}/100
        </span>
      </div>
      <dl className="lv-twin-grid">
        {rows.map(([k, v, s]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>
              <span className="num">{v}</span>
              <small>{s}</small>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** Section 4: 10,000 futures for the sample goal, simulated by the real engine. */
export function FuturesPreview() {
  const { data, failed } = useLive(async () => {
    const profile = await judgeProfile()
    return api<GoalSurvival>('/api/goals/survival', { body: { profile } })
  })
  if (failed) return <Offline what="simulation" />
  if (!data) return <div className="skeleton" style={{ height: 320 }} />
  const normal = data.scenarios[0]?.success_probability ?? null
  return (
    <div className="lv-futures">
      <div className="row between wrap" style={{ gap: 8 }}>
        <span className="lv-tag">Live: {data.simulation.n_paths.toLocaleString('en-IN')} simulated futures · sample profile</span>
        <span className="small text-2">
          Goal {inrShort(data.target_amount)} in {Math.round(data.months / 12)} years
        </span>
      </div>
      <FanChart p={data.simulation.percentiles} target={data.target_amount} height={260} />
      <div className="lv-scen">
        {data.scenarios.map((s) => (
          <div key={s.scenario}>
            <span className="small text-2">{s.label}</span>
            <strong className={`num ${s.success_probability != null && s.success_probability >= 0.75 ? 'green' : s.success_probability != null && s.success_probability >= 0.5 ? 'amber' : 'red'}`}>
              {pct(s.success_probability)}
            </strong>
          </div>
        ))}
      </div>
      <p className="tiny muted">Probability of reaching the goal in each kind of market ({pct(normal)} in normal markets). Simulated outcomes, not predictions.</p>
    </div>
  )
}

/** Section 7: the most recent stored decision that the Critic changed, if there is one. */
export function CriticPreview() {
  const { data, failed } = useLive(async () => {
    const list = await api<{ decisions: DecisionSummary[] }>('/api/decisions?limit=20')
    const d = list.decisions.find((x) => x.status === 'completed' && (x.verdict_label ?? '').includes('MODIFICATIONS'))
    if (!d) return null
    return api<DecisionEnvelope>(`/api/decision/${d.decision_id}`)
  })
  const r = data?.result
  const c = r?.explanation.comparison
  if (failed || !r || !c) {
    return (
      <p className="small text-2">
        Run the <Link to="/committee?new=1">flagship decision</Link> and the plan the Critic rejected, the changes it forced and the plan it approved will be shown here side by side.
      </p>
    )
  }
  const rounds = r.rounds.length
  return (
    <div className="lv-critic">
      <span className="lv-tag">From your latest re-optimised decision · “{data?.command || r.decision_type}”</span>
      <div className="lv-critic-grid">
        <div>
          <span className="small text-2">Goal success</span>
          <strong className="num">
            {pct(c.before.goal_success_probability)} → <em>{pct(c.after.goal_success_probability)}</em>
          </strong>
        </div>
        <div>
          <span className="small text-2">Financial resilience</span>
          <strong className="num">
            {Math.round(c.before.financial_resilience)} → <em>{Math.round(c.after.financial_resilience)}</em>
          </strong>
        </div>
        <div>
          <span className="small text-2">Debt stress</span>
          <strong>
            {c.before.debt_stress_band.toLowerCase()} → <em>{c.after.debt_stress_band.toLowerCase()}</em>
          </strong>
        </div>
      </div>
      <p className="small text-2">
        Rejected in round 1, approved in round {rounds}. {(r.explanation.major_changes ?? []).slice(0, 2).join('; ')}.
      </p>
      <Link className="btn sm" to={`/committee?id=${r.decision_id}#final`}>
        Open that decision
      </Link>
    </div>
  )
}
