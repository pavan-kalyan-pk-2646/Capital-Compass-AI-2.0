import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { useDemoStep } from '@/components/DemoGuide'
import { AgentGraph, graphFromAudit, graphFromEvents } from '@/components/AgentGraph'
import { Icon } from '@/components/icons'
import { Badge, Disclaimer, ErrorBox, Metric, MoneyInput, NeedsTwin, NumInput, Panel, Seg, SelectField, Spinner, StanceBadge, StatusBadge } from '@/components/ui'
import { inr, inrShort, pct, probTone } from '@/lib/format'
import { api, ApiError } from '@/services/api'
import type { CommitteeDecision, DecisionEnvelope, DecisionResult, Fragile, NodeEvent, Opinion, Plan, RedTeamTest, Round } from '@/services/types'
import { useApp } from '@/stores/app'
import { currentNode, OPS } from '@/lib/ops'
import { BeforeAfter } from '@/components/atlas/BeforeAfter'
import { Challenge } from '@/components/atlas/Challenge'
import { DataTag } from '@/components/atlas/DataTag'
import { verdictKind, WarRoom } from '@/components/atlas/WarRoom'
import { useLanguage } from '@/components/LanguageContext'
import './committee.css'

const AGENT_COLOR: Record<string, string> = { Bull: '#c9a24a', Bear: '#f0566a', Risk: '#6fa8ff', Goal: '#3ccb8f', Compliance: '#a99bf0' }
const TYPES = [
  { value: 'loan', label: 'Loan' },
  { value: 'investment', label: 'Investment' },
  { value: 'goal', label: 'Goal' },
  { value: 'crisis', label: 'Crisis' },
  { value: 'spending', label: 'Spending' },
] as const
type DType = (typeof TYPES)[number]['value']
const CRISES = [
  { value: 'market_crash', label: 'Market crash (NIFTY −30%)' },
  { value: 'job_loss', label: 'Job loss' },
  { value: 'crash_job_loss', label: 'Crash + income loss' },
  { value: 'inflation_spike', label: 'Inflation spike' },
  { value: 'rate_hike', label: 'Interest-rate shock' },
  { value: 'medical_emergency', label: 'Medical emergency' },
]

export const FLAGSHIP = {
  decision_type: 'loan',
  command: 'Can I take a ₹5 lakh personal loan?',
  params: { loan_type: 'personal', amount: 500000, annual_rate_pct: 14, tenure_months: 60, processing_fee_pct: 1, crisis: 'market_crash' },
}

// ---------- live round reconstruction from SSE events ----------
interface LiveRound {
  opinions?: Opinion[]
  debate?: Round['debate']
  committee?: CommitteeDecision
  tests?: RedTeamTest[]
  score?: number
  critic?: { verdict: string; reasons: string[] }
  changes?: string[]
}
function liveRounds(events: NodeEvent[]): LiveRound[] {
  const rounds: LiveRound[] = []
  let cur: LiveRound | null = null
  for (const e of events) {
    if (e.status !== 'done') continue
    const p = e.payload as Record<string, unknown>
    if (e.node === 'financial_committee') {
      cur = { opinions: p.opinions as Opinion[] }
      rounds.push(cur)
    } else if (cur && e.node === 'debate') {
      cur.debate = p.turns as Round['debate']
      cur.committee = p.decision as Round['committee']
    } else if (cur && e.node === 'red_team') {
      cur.tests = p.tests as RedTeamTest[]
      cur.score = p.score as number
    } else if (cur && e.node === 'critic') {
      cur.critic = { verdict: p.verdict as string, reasons: p.reasons as string[] }
    } else if (cur && e.node === 're_optimize') {
      cur.changes = p.changes as string[]
    }
  }
  return rounds
}

export default function Committee() {
  const profile = useApp((s) => s.profile)
  const lastId = useApp((s) => s.lastDecisionId)
  const setDecision = useApp((s) => s.setDecision)
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const id = sp.get('id')

  const fresh = sp.get('new') === '1'
  useEffect(() => {
    if (!id && !fresh && lastId) nav(`/committee?id=${lastId}${window.location.hash}`, { replace: true })
  }, [id, fresh, lastId, nav])

  const start = useCallback(
    async (body: Record<string, unknown>) => {
      const r = await api<{ decision_id: string }>('/api/decision/run', { body: { profile: useApp.getState().profile, ...body } })
      setDecision(r.decision_id)
      nav(`/committee?id=${r.decision_id}`)
    },
    [nav, setDecision],
  )

  const demoRan = useRef(false)
  useDemoStep([11], () => {
    if (demoRan.current) return
    demoRan.current = true
    start(FLAGSHIP).catch(() => undefined)
  })

  if (!profile)
    return (
      <div className="page">
        <h1>AI Financial Committee</h1>
        <div className="mt">
          <NeedsTwin what="The AI Committee" />
        </div>
      </div>
    )

  return id ? <DecisionView key={id} id={id} onNew={() => nav('/committee?new=1')} /> : <StartDecision onStart={start} />
}

function StartDecision({ onStart }: { onStart: (b: Record<string, unknown>) => Promise<void> }) {
  const [type, setType] = useState<DType>('loan')
  const [amount, setAmount] = useState(500000)
  const [tenure, setTenure] = useState(60)
  const [target, setTarget] = useState(2500000)
  const [years, setYears] = useState(5)
  const [scenario, setScenario] = useState('market_crash')
  const [spend, setSpend] = useState(8000)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<ApiError | null>(null)

  async function go(body: Record<string, unknown>) {
    setBusy(true)
    setErr(null)
    try {
      await onStart(body)
    } catch (e) {
      setErr(e as ApiError)
      setBusy(false)
    }
  }

  const params: Record<string, unknown> =
    type === 'loan'
      ? { loan_type: 'personal', amount, tenure_months: tenure, annual_rate_pct: 14, processing_fee_pct: 1, crisis: scenario }
      : type === 'goal'
        ? { target, years, crisis: scenario }
        : type === 'crisis'
          ? { scenario }
          : type === 'spending'
            ? { monthly_spend: spend, crisis: scenario }
            : { crisis: scenario }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>AI Financial Committee</h1>
          <p>Put a decision in front of the committee. It is simulated, stress-tested, debated by five agents, attacked by the Red Team and judged by the Critic — and re-optimised if it breaks.</p>
        </div>
      </div>
      <div className="grid g2">
        <Panel title="The flagship question" sub="The judge-profile walkthrough: a ₹5 lakh personal loan with a NIFTY −30% crash">
          <button className="btn primary" disabled={busy} onClick={() => go(FLAGSHIP)}>
            {busy ? <Spinner /> : <Icon name="play" size={14} />} Run the flagship decision
          </button>
        </Panel>
        <Panel title="Your own question">
          <div className="stack">
            <Seg<DType> label="Decision type" value={type} onChange={setType} options={TYPES.map((t) => ({ value: t.value, label: t.label }))} />
            {type === 'loan' && (
              <div className="grid g2">
                <MoneyInput label="Loan amount" value={amount} min={1000} max={100000000} onChange={setAmount} />
                <NumInput label="Tenure" suffix="months" value={tenure} min={6} max={360} onChange={(v) => setTenure(Math.round(v))} />
              </div>
            )}
            {type === 'goal' && (
              <div className="grid g2">
                <MoneyInput label="Target" value={target} min={10000} max={1e10} onChange={setTarget} />
                <NumInput label="Years" value={years} min={0.5} max={40} step={0.5} onChange={setYears} />
              </div>
            )}
            {type === 'spending' && <MoneyInput label="High-risk spending / month" value={spend} min={0} max={1e7} onChange={setSpend} />}
            <SelectField label={type === 'crisis' ? 'Crisis to plan for' : 'Crisis to test against'} value={scenario} onChange={setScenario} options={CRISES} />
            <button className="btn" disabled={busy} onClick={() => go({ decision_type: type, params, command: '' })}>
              {busy && <Spinner />} Send to the committee
            </button>
          </div>
        </Panel>
      </div>
      <ErrorBox error={err} />
    </div>
  )
}

function DecisionView({ id, onNew }: { id: string; onNew: () => void }) {
  const [env, setEnv] = useState<DecisionEnvelope | null>(null)
  const [events, setEvents] = useState<NodeEvent[]>([])
  const [shown, setShown] = useState(0)
  const [live, setLive] = useState(false)
  const [ended, setEnded] = useState(false)
  const [err, setErr] = useState<ApiError | null>(null)
  const [round, setRound] = useState<number | null>(null)

  const loadResult = useCallback(async () => {
    try {
      const e = await api<DecisionEnvelope>(`/api/decision/${id}`)
      setEnv(e)
      return e
    } catch (e) {
      setErr(e as ApiError)
      return null
    }
  }, [id])

  useEffect(() => {
    let es: EventSource | null = null
    let cancelled = false
    loadResult().then((e) => {
      if (!e || cancelled) return
      if (e.status === 'running') {
        setLive(true)
        es = new EventSource(e.stream_url ?? `/api/decision/${id}/stream`)
        es.addEventListener('node', (m) => setEvents((ev) => [...ev, JSON.parse((m as MessageEvent).data) as NodeEvent]))
        es.addEventListener('end', () => {
          es?.close()
          setEnded(true)
        })
        es.onerror = () => {
          es?.close()
          setEnded(true)
        }
      } else {
        const evs = (e.events ?? []) as NodeEvent[]
        setEvents(evs)
        setShown(evs.length)
        setEnded(true)
      }
    })
    return () => {
      cancelled = true
      es?.close()
    }
  }, [id, loadResult])

  // reveal live events one by one so each stage is visible
  useEffect(() => {
    if (shown >= events.length) return
    const t = setTimeout(() => setShown((s) => s + 1), live ? 40 : 0)
    return () => clearTimeout(t)
  }, [shown, events.length, live])

  const caughtUp = ended && shown >= events.length
  useEffect(() => {
    if (caughtUp && live) loadResult()
  }, [caughtUp, live, loadResult])

  const loc = useLocation()
  const resultReady = env?.status === 'completed' && caughtUp
  useEffect(() => {
    if (!resultReady || !loc.hash) return
    const t = setTimeout(() => document.getElementById(loc.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
    return () => clearTimeout(t)
  }, [resultReady, loc.hash])

  const visible = events.slice(0, shown)
  const cur = currentNode(visible)
  const liveOp = cur ? (OPS[cur] ?? 'Working…') : visible.length ? 'Waiting for the next node…' : 'Starting the pipeline…'
  const res = env?.status === 'completed' && caughtUp ? env.result : null
  const rounds: (LiveRound | Round)[] = res ? res.rounds : liveRounds(visible)
  const activeRound = round ?? rounds.length - 1
  const r = rounds[activeRound]
  const failed = env?.status === 'failed'

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>AI Financial Committee</h1>
          <p>{env?.command ? `“${env.command}”` : env ? `${env.type} decision` : 'Loading decision…'}</p>
        </div>
        <div className="row wrap no-print">
          {res && (
            <a className="btn primary" href="#final">
              See the final decision
            </a>
          )}
          {res && (
            <button className="btn" onClick={() => window.print()}>
              <Icon name="print" size={15} /> Export report
            </button>
          )}
          <button className="btn" onClick={onNew}>
            New decision
          </button>
        </div>
      </div>
      <ErrorBox error={err} />
      {failed && <ErrorBox error={`This decision failed: ${env?.error ?? 'unknown error'}`} />}

      <WarRoom events={visible} res={res} current={cur} />

      <Panel title="Agent graph" sub="The LangGraph pipeline behind this decision, lighting up as each agent finishes">
        <AgentGraph
          graph={visible.length || !res ? graphFromEvents(visible, caughtUp) : graphFromAudit(res.audit_trail.map((t) => ({ node_name: t.node_name, message: t.message })))}
          opinions={rounds[rounds.length - 1]?.opinions}
        />
      </Panel>

      <div className="committee-layout mt">
        <aside className="pipeline" aria-label="Decision pipeline progress">
          <div className="row between">
            <h3>Pipeline</h3>
            {!caughtUp ? (
              <span className="row small text-2" role="status">
                <Spinner /> {liveOp}
              </span>
            ) : (
              <Badge tone={failed ? 'red' : 'green'}>{failed ? 'failed' : 'complete'}</Badge>
            )}
          </div>
          <ol className="pipe-list">
            {visible
              .filter((e, i, arr) => e.status !== 'running' || !arr.slice(i + 1).some((x) => x.node === e.node && x.status !== 'running'))
              .map((e, i) => (
                <li key={i} className={`pipe-${e.status} ${e.node === 'critic' && (e.payload as { verdict?: string }).verdict === 'REJECT' ? 'pipe-reject' : ''}`}>
                  <span className="pipe-dot" />
                  <div>
                    <div className="pipe-label">
                      {e.label ?? e.node}
                      {e.duration_ms ? <span className="tiny muted"> {e.duration_ms} ms</span> : null}
                    </div>
                    {e.status !== 'running' && <div className="pipe-sum">{e.summary}</div>}
                  </div>
                </li>
              ))}
            {!caughtUp && visible.length === 0 && (
              <li className="pipe-running">
                <span className="pipe-dot" />
                <div className="pipe-label">Starting…</div>
              </li>
            )}
          </ol>
        </aside>

        <div className="stack" style={{ minWidth: 0 }}>
          {rounds.length > 1 && (
            <Seg
              label="Committee round"
              value={String(activeRound)}
              onChange={(v) => setRound(Number(v))}
              options={rounds.map((_, i) => ({ value: String(i), label: i === 0 ? 'Round 1 — original plan' : `Round ${i + 1} — re-optimised` }))}
            />
          )}

          {r?.opinions ? (
            <Panel title="Committee opinions" sub="Five agents read the same simulation, crisis and Risk DNA numbers">
              <div className="agents" id="committee">
                {r.opinions.map((o) => (
                  <AgentCard key={o.agent} o={o} />
                ))}
              </div>
            </Panel>
          ) : (
            <Panel title="Committee opinions">
              <div className="row text-2">
                <Spinner /> {caughtUp ? 'Loading the committee…' : `${liveOp} The committee meets after the simulation and crisis test.`}
              </div>
            </Panel>
          )}

          {r?.debate && (
            <Panel id="debate" title="Debate" sub="Agents challenge each other before the committee votes">
              <div className="debate">
                {r.debate.map((t, i) => (
                  <div key={i} className="turn" style={{ borderColor: AGENT_COLOR[t.speaker] }}>
                    <div className="small">
                      <strong style={{ color: AGENT_COLOR[t.speaker] }}>{t.speaker}</strong>
                      {t.to && <span className="muted"> replying to {t.to}</span>}
                    </div>
                    <p className="small text-2">{t.text}</p>
                  </div>
                ))}
              </div>
              {r.committee && <CommitteeVerdict c={r.committee} />}
            </Panel>
          )}

          {r && 'tests' in r && r.tests ? (
            <RedTeamBoard tests={r.tests} score={r.score ?? 0} />
          ) : r && 'red_team' in r ? (
            <RedTeamBoard tests={r.red_team.tests} score={r.red_team.red_team_score} fragile={r.red_team.most_fragile} />
          ) : null}

          {rounds.some((x) => x.critic) && <CriticTimeline rounds={rounds} reopt={res?.reoptimization} />}

          {res && <FinalDecision res={res} createdAt={env?.created_at} />}
          {!res && caughtUp && !failed && env?.status === 'running' && (
            <div className="row text-2">
              <Spinner /> Finishing up…
            </div>
          )}
        </div>
      </div>
      {res && <Disclaimer />}
    </div>
  )
}

function AgentCard({ o }: { o: Opinion }) {
  const [open, setOpen] = useState(false)
  return (
    <article className="agent" style={{ borderTopColor: AGENT_COLOR[o.agent] }}>
      <h3 style={{ color: AGENT_COLOR[o.agent] }}>{o.agent}</h3>
      <div className="tiny muted">{o.role}</div>
      <div className="mt-sm">
        <StanceBadge stance={o.stance} />
      </div>
      <div className="small mt">
        <div className="muted tiny">Key concern</div>
        {o.key_concern}
      </div>
      <div className="small mt-sm">
        <div className="muted tiny">Decision</div>
        <strong>{o.decision}</strong>
      </div>
      <button className="btn sm ghost mt-sm" style={{ padding: '4px 0' }} onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Hide reasoning' : `Reasoning (${o.reasoning.length})`}
      </button>
      {open && (
        <ul className="list mt-sm">
          {o.reasoning.map((x) => (
            <li key={x} className="tiny">
              {x}
            </li>
          ))}
        </ul>
      )}
      <div className="tiny muted mt-sm">Confidence {pct(o.confidence)}</div>
    </article>
  )
}

const SEV_TONE: Record<string, string> = { High: 'red', Medium: 'amber', Low: 'blue' }

function RedTeamBoard({ tests, score, fragile }: { tests: RedTeamTest[]; score: number; fragile?: Fragile | null }) {
  const found = tests.filter((t) => t.status !== 'PASS')
  const counts = ['High', 'Medium', 'Low'].map((sv) => [sv, found.filter((t) => (t.severity ?? (t.status === 'FAIL' ? (t.critical ? 'High' : 'Medium') : 'Low')) === sv).length] as const)
  return (
    <section id="redteam" className="redteam">
      <div className="redteam-head">
        <div>
          <div className="small red">Red Team attack</div>
          <div className="redteam-count">{found.length === 0 ? 'No weaknesses found' : `${found.length} weakness${found.length > 1 ? 'es' : ''} found`}</div>
          <div className="row wrap mt-sm">
            {counts
              .filter(([, n]) => n > 0)
              .map(([sv, n]) => (
                <Badge key={sv} tone={SEV_TONE[sv]}>
                  {n} {sv.toLowerCase()} severity
                </Badge>
              ))}
          </div>
        </div>
        <div className="redteam-score">
          <span className="small text-2">Robustness</span>
          <strong className={score >= 55 ? 'green' : 'red'}>{score}</strong>
          <span className="tiny muted">out of 100</span>
        </div>
      </div>
      <div className="attacks mt">
        {tests.map((t) => (
          <div key={t.key} className={`attack attack-${t.status.toLowerCase()}`}>
            <div className="row between" style={{ alignItems: 'flex-start' }}>
              <strong className="small">{t.question ?? t.name}</strong>
              <StatusBadge status={t.status} />
            </div>
            <p className="tiny text-2 mt-sm">{t.detail}</p>
            <div className="row between tiny muted mt-sm">
              <span>
                {t.name}
                {t.critical ? ', critical' : ''}
              </span>
              {t.status !== 'PASS' && t.severity && t.severity !== 'None' && <span className={SEV_TONE[t.severity]}>{t.severity} severity</span>}
            </div>
          </div>
        ))}
      </div>
      {fragile && (
        <div className="inset mt small">
          <span className="text-2">Most fragile assumption: </span>
          <strong>{fragile.question}</strong> <span className="text-2">{fragile.detail}</span>
        </div>
      )}
    </section>
  )
}

function CommitteeVerdict({ c }: { c: CommitteeDecision }) {
  const tone = c.verdict === 'APPROVE' ? 'green' : c.verdict === 'REJECT' ? 'red' : 'amber'
  return (
    <div className="inset mt">
      <div className="row between wrap">
        <div>
          <div className="small text-2">Committee decision</div>
          <div className={`committee-word ${tone}`}>{c.verdict.charAt(0) + c.verdict.slice(1).toLowerCase()}</div>
        </div>
        <div className="row" style={{ gap: 20 }}>
          <Metric label="Weighted support" value={pct(c.score)} />
          {c.confidence !== undefined && <Metric label="Committee confidence" value={pct(c.confidence)} />}
        </div>
      </div>
      <div className="grid g2 mt">
        <div>
          <div className="small text-2">Major arguments</div>
          <ul className="list green mt-sm">
            {(c.major_arguments ?? []).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="small text-2">Unresolved concerns</div>
          {(c.unresolved_concerns ?? c.conditions).length ? (
            <ul className="list red mt-sm">
              {(c.unresolved_concerns ?? c.conditions).map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="small text-2 mt-sm">None — every agent supports the plan.</p>
          )}
        </div>
      </div>
      {c.compliance_veto && <p className="small red mt">Compliance vetoed this plan.</p>}
    </div>
  )
}

function criticLabel(c: { verdict: string; forced?: boolean; outcome?: string }) {
  if (c.outcome) return c.outcome.charAt(0) + c.outcome.slice(1).toLowerCase().replace('—', '—')
  if (c.verdict === 'REJECT') return 'Rejected — re-optimization required'
  return c.forced ? 'Approved with flagged risks' : 'Approved'
}

function CriticTimeline({ rounds, reopt }: { rounds: (LiveRound | Round)[]; reopt?: DecisionResult['reoptimization'] }) {
  const n = rounds.filter((r) => r.critic).length
  return (
    <section id="critic" className="critic-wrap">
      {n > 1 && (
        <ol className="iteration" aria-label="Critic iterations">
          {rounds.map((r, i) =>
            r.critic ? (
              <li key={i} className={r.critic.verdict === 'REJECT' ? 'red' : 'green'}>
                Round {i + 1}: {r.critic.verdict === 'REJECT' ? 'rejected' : 'approved'}
                {r.critic.verdict === 'REJECT' && i < rounds.length - 1 && <span className="muted"> → re-optimise → simulate → committee → Red Team → Critic</span>}
              </li>
            ) : null,
          )}
        </ol>
      )}
      {rounds.map((r, i) =>
        r.critic ? (
          <div key={i} className={`verdict ${r.critic.verdict === 'REJECT' ? 'v-reject' : 'v-accept'}`}>
            <div className="verdict-head">
              <span className="small">Critic verdict, round {i + 1}</span>
              <span className="verdict-word">{criticLabel(r.critic)}</span>
            </div>
            <ul className={`list ${r.critic.verdict === 'REJECT' ? 'red' : 'green'}`}>
              {r.critic.reasons.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            {r.critic.verdict === 'REJECT' && ('changes' in r ? r.changes : i === 0 ? reopt?.changes : undefined) && (
              <div className="inset mt">
                <div className="small text-2">Re-optimiser changed</div>
                <ul className="list mt-sm">
                  {(('changes' in r && r.changes) || reopt?.changes || []).map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : null,
      )}
    </section>
  )
}

function planRows(p: Plan) {
  return [
    ['Equity / debt / gold', `${pct(p.weights.equity)} / ${pct(p.weights.debt)} / ${pct(p.weights.gold)}`],
    ['Monthly investment', inr(p.monthly_sip)],
    ['Emergency-fund top-up', p.ef_topup ? `${inr(p.ef_topup)}/mo` : '—'],
    ['Loan', p.loan ? `${inrShort(p.loan.amount)} over ${p.loan.tenure_months} months` : '—'],
    ['EMI', p.loan ? inr(p.loan.emi) : '—'],
    ['Total interest', p.loan ? inrShort(p.loan.total_interest) : '—'],
    ['High-risk spending redirected', p.spending_cut ? pct(p.spending_cut) : '—'],
  ]
}

function Delta({ label, before, after, better, sub }: { label: string; before: string; after: string; better: boolean | null; sub?: string }) {
  const same = before === after
  return (
    <div className="delta">
      <div className="metric-label">{label}</div>
      <div className="delta-row num">
        {!same && <span className="delta-before">{before}</span>}
        {!same && <span className="delta-arrow">→</span>}
        <span className={`delta-after ${same ? '' : better === null ? '' : better ? 'green' : 'red'}`}>{after}</span>
      </div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  )
}

const BAND_LABEL: Record<string, string> = { LOW: 'Low', MODERATE: 'Moderate', 'MODERATE-HIGH': 'Moderate-high', HIGH: 'High' }
const BAND_RANK: Record<string, number> = { LOW: 0, MODERATE: 1, 'MODERATE-HIGH': 2, HIGH: 3 }

function FinalDecision({ res, createdAt }: { res: DecisionResult; createdAt?: string }) {
  const { t } = useLanguage()
  const rec = res.recommendation
  const exp = res.explanation
  const cf = res.counterfactual
  const first = res.rounds[0]!
  const last = res.rounds[res.rounds.length - 1]!
  const before = planRows(exp.old_vs_new.before)
  const after = planRows(exp.old_vs_new.after)
  const cmp = exp.comparison
  const verdict = exp.verdict ?? rec.status
  const vtone = verdict.includes('FLAGGED') ? 'amber' : verdict.includes('MODIFICATIONS') ? 'brass' : 'green'
  const higher = exp.why_not_that.find((w) => w.option.startsWith('Higher'))
  const lower = exp.why_not_that.find((w) => w.option.startsWith('Lower'))

  return (
    <>
      <section className="final" id="final">
        <div className="final-head">
          <div>
            <div className="small brass">Capital Compass decision</div>
            <div className={`final-verdict ${vtone}`}>{verdict.charAt(0) + verdict.slice(1).toLowerCase()}</div>
            <p className="final-title">{rec.action}</p>
          </div>
          <div className="final-conf">
            <span className="small text-2">Confidence</span>
            <strong>{rec.confidence.label}</strong>
            <span className="tiny muted">{pct(rec.confidence.score)}, model-generated</span>
          </div>
        </div>
        <div className="final-actions">
          <Challenge decisionId={res.decision_id} />
        </div>

        {cmp && (
          <div className="deltas mt">
            <Delta
              label="Goal success"
              before={pct(cmp.before.goal_success_probability)}
              after={pct(cmp.after.goal_success_probability)}
              better={(cmp.after.goal_success_probability ?? 0) >= (cmp.before.goal_success_probability ?? 0)}
              sub={`${res.simulation_results.n_paths.toLocaleString('en-IN')} simulated futures`}
            />
            <Delta
              label="Financial resilience"
              before={`${Math.round(cmp.before.financial_resilience)}`}
              after={`${Math.round(cmp.after.financial_resilience)}`}
              better={cmp.after.financial_resilience >= cmp.before.financial_resilience}
              sub="Risk DNA score out of 100"
            />
            <Delta
              label="Debt stress"
              before={BAND_LABEL[cmp.before.debt_stress_band] ?? cmp.before.debt_stress_band}
              after={BAND_LABEL[cmp.after.debt_stress_band] ?? cmp.after.debt_stress_band}
              better={(BAND_RANK[cmp.after.debt_stress_band] ?? 0) <= (BAND_RANK[cmp.before.debt_stress_band] ?? 0)}
              sub={`EMIs ${pct(cmp.before.foir)} → ${pct(cmp.after.foir)} of income`}
            />
            <Delta
              label="Loss in a NIFTY −30% crash"
              before={pct(cmp.before.crash_loss, 1)}
              after={pct(cmp.after.crash_loss, 1)}
              better={cmp.after.crash_loss <= cmp.before.crash_loss}
              sub={`limit ${res.profile.risk.max_tolerated_loss_pct}%`}
            />
          </div>
        )}

        {cmp && res.rounds.length > 1 && (
          <div className="mt" data-i18n>
            <h3>{t('ba.title')}</h3>
            <p className="small text-2 mt-sm">{t('ba.sub')}</p>
            <BeforeAfter before={cmp.before} after={cmp.after} planBefore={exp.old_vs_new.before} planAfter={exp.old_vs_new.after} />
          </div>
        )}

        {exp.major_changes && exp.major_changes.length > 0 && (
          <div className="mt">
            <h3>Major changes</h3>
            <ul className="list mt-sm">
              {exp.major_changes.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <Receipt res={res} createdAt={createdAt} />

      <div className="grid g2" id="why">
        <Panel title="Why this decision?">
          <ul className="list green">
            {exp.why_this.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          {exp.constraints_that_changed_it.length > 0 && (
            <>
              <h3 className="mt">Constraints that changed the recommendation</h3>
              <ul className="list red mt-sm">
                {exp.constraints_that_changed_it.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </>
          )}
        </Panel>
        <Panel title="Why not higher or lower risk?">
          <div className="stack-sm">
            {[higher, lower].filter(Boolean).map((w) => (
              <div key={w!.option} className="inset">
                <strong className="small">{w!.option}</strong>
                <p className="small text-2 mt-sm">{w!.text}</p>
              </div>
            ))}
          </div>
          <table className="table mt">
            <thead>
              <tr>
                <th />
                <th className="r">Lower risk</th>
                <th className="r">Chosen</th>
                <th className="r">Higher risk</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-2">Equity</td>
                <td className="r num">{pct(cf.lower_risk.plan.weights.equity)}</td>
                <td className="r num brass">{pct(cf.chosen.plan.weights.equity)}</td>
                <td className="r num">{pct(cf.higher_risk.plan.weights.equity)}</td>
              </tr>
              <tr>
                <td className="text-2">Goal success</td>
                <td className="r num">{pct(cf.lower_risk.goal_success_probability)}</td>
                <td className="r num brass">{pct(cf.chosen.goal_success_probability)}</td>
                <td className="r num">{pct(cf.higher_risk.goal_success_probability)}</td>
              </tr>
              <tr>
                <td className="text-2">Crash loss</td>
                <td className="r num">{pct(cf.lower_risk.crash_loss, 1)}</td>
                <td className="r num brass">{pct(cf.chosen.crash_loss, 1)}</td>
                <td className="r num">{pct(cf.higher_risk.crash_loss, 1)}</td>
              </tr>
            </tbody>
          </table>
        </Panel>
      </div>

      <div className="grid g3">
        <Panel title="What could make this fail?">
          {exp.what_could_fail && exp.what_could_fail.length ? (
            <ul className="list red">
              {exp.what_could_fail.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="small text-2">No single assumption moves goal success by more than 5 points.</p>
          )}
        </Panel>
        <Panel title="What did the Red Team find?">
          <p className="small text-2">
            On the original plan: {exp.red_team_found_count ?? first.red_team.weaknesses.length} weakness{(exp.red_team_found_count ?? 0) === 1 ? '' : 'es'}.
          </p>
          <div className="stack-sm mt-sm">
            {(exp.red_team_found ?? first.red_team.weaknesses).map((w) => (
              <div key={w.name} className="row" style={{ alignItems: 'flex-start' }}>
                {w.severity && <Badge tone={SEV_TONE[w.severity]}>{w.severity}</Badge>}
                <span className="small">{w.question ?? w.name}</span>
              </div>
            ))}
          </div>
          {exp.most_fragile && (
            <p className="small text-2 mt">
              Most fragile: <strong className="text-2">{exp.most_fragile.name}</strong>
            </p>
          )}
        </Panel>
        <Panel title="Why did the Critic approve it?">
          <ul className="list green">
            {(exp.why_critic_approved ?? res.critic.reasons).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          {res.rounds.length > 1 && (
            <p className="small text-2 mt">
              Approved on round {res.rounds.length}, after {res.rounds.length - 1} rejection{res.rounds.length > 2 ? 's' : ''}.
            </p>
          )}
        </Panel>
      </div>

      <Panel title="Old vs new decision" sub={exp.old_vs_new.changed ? 'What the Critic rejected next to what it approved' : 'The first proposal was approved unchanged'}>
        <div id="compare" className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th />
                <th className="r">{exp.old_vs_new.changed ? 'Rejected plan' : 'Plan'}</th>
                {exp.old_vs_new.changed && <th className="r">Approved plan</th>}
              </tr>
            </thead>
            <tbody>
              {before.map((row, i) => (
                <tr key={row[0]}>
                  <td className="text-2">{row[0]}</td>
                  <td className="r num">{row[1]}</td>
                  {exp.old_vs_new.changed && <td className={`r num ${after[i]![1] !== row[1] ? 'brass' : ''}`}>{after[i]![1]}</td>}
                </tr>
              ))}
              <tr>
                <td className="text-2">Goal success</td>
                <td className={`r num ${probTone(first.goal_probability)}`}>{pct(first.goal_probability)}</td>
                {exp.old_vs_new.changed && <td className={`r num ${probTone(last.goal_probability)}`}>{pct(last.goal_probability)}</td>}
              </tr>
              <tr>
                <td className="text-2">Red Team robustness</td>
                <td className="r num">{first.red_team.red_team_score}/100</td>
                {exp.old_vs_new.changed && <td className="r num">{last.red_team.red_team_score}/100</td>}
              </tr>
              <tr>
                <td className="text-2">Critic</td>
                <td className={`r ${first.critic.verdict === 'REJECT' ? 'red' : 'green'}`}>{first.critic.verdict === 'REJECT' ? 'Rejected' : 'Approved'}</td>
                {exp.old_vs_new.changed && <td className="r green">Approved</td>}
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      {cf.sensitivity.length > 0 && (
        <Panel title="Assumptions that matter most" sub="Change in goal success if one assumption moves against you">
          <div className="stack-sm">
            {cf.sensitivity.map((s) => (
              <div key={s.assumption} className="dna-row" style={{ gridTemplateColumns: '220px 1fr 70px' }}>
                <span className="text-2 small">{s.assumption}</span>
                <div className="bar" style={{ height: 8 }}>
                  <i style={{ width: `${Math.min(100, Math.abs(s.impact) * 100)}%`, background: 'var(--red)' }} />
                </div>
                <span className="num small" style={{ textAlign: 'right' }}>
                  {(s.impact * 100).toFixed(0)} pts
                </span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <p className="small text-2">{exp.summary}</p>
      <div className="row wrap no-print">
        <Link className="btn" to="/trust">
          <Icon name="trust" size={15} /> Trust Center
        </Link>
        <Link className="btn" to="/audit">
          <Icon name="audit" size={15} /> Audit trail
        </Link>
      </div>
    </>
  )
}

/** Capital Compass decision receipt: every line is read from the stored decision. */
function Receipt({ res, createdAt }: { res: DecisionResult; createdAt?: string }) {
  const { t } = useLanguage()
  const rec = res.recommendation
  const exp = res.explanation
  const verdict = exp.verdict ?? rec.status
  const kind = verdictKind(verdict)
  const risk = exp.most_fragile?.name ?? res.rounds[0]?.red_team.most_fragile?.name
  const asOf = res.trust?.market?.regime?.as_of ?? '—'
  return (
    <section className={`receipt receipt-${kind.toLowerCase()}`} data-i18n aria-labelledby="rc-h">
      <div className="receipt-head">
        <h2 id="rc-h">{t('rc.title')}</h2>
        <span className="receipt-id">#{res.decision_id.slice(0, 8)}</span>
      </div>
      <dl className="receipt-lines">
        <dt>{t('rc.decision')}</dt>
        <dd>
          <strong className="receipt-verdict">{t(`rc.${kind}`).toUpperCase()}</strong> <span className="tiny muted">{verdict}</span>
        </dd>
        <dt>{t('rc.goal')}</dt>
        <dd>
          {pct(rec.goal_probability)} <DataTag source="simulated" />
        </dd>
        <dt>{t('rc.sim')}</dt>
        <dd>{t('rc.simV', { n: res.simulation_results.n_paths.toLocaleString('en-IN') })}</dd>
        <dt>{t('rc.risk')}</dt>
        <dd>{risk ?? t('rc.riskNone')}</dd>
        <dt>{t('rc.protection')}</dt>
        <dd>{t('rc.protectionV', { months: (exp.comparison?.after.emergency_fund_months ?? res.twin.twin.emergency_fund_months).toFixed(1) })}</dd>
        <dt>{t('rc.action')}</dt>
        <dd className="receipt-action-v">{rec.action}</dd>
        <dt>{t('rc.basis')}</dt>
        <dd className="small text-2">{t('rc.basisV', { asOf, n: res.simulation_results.n_paths.toLocaleString('en-IN') })}</dd>
        <dt>{t('rc.time')}</dt>
        <dd>{new Date(createdAt ?? Date.now()).toLocaleString()}</dd>
      </dl>
      <Link className="btn sm" to={`/audit?id=${res.decision_id}`}>
        {t('rc.audit')}
      </Link>
    </section>
  )
}
