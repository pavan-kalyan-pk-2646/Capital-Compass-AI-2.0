/**
 * Agent architecture — the decision pipeline as a living system.
 *
 * Every state shown here comes from real node events streamed by the backend
 * (graph/runner.py → SSE) or stored with a past decision. Nothing is animated on a timer:
 * a node pulses only while the backend reports it running, connectors carry a flow only
 * into the node that is executing, and each card shows that node's real output.
 * "Replay" re-plays a stored run's events in order and says so on screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { Icon } from '@/components/icons'
import { Disclaimer, ErrorBox, Panel, SelectField, Spinner } from '@/components/ui'
import { loadJudgeProfile } from '@/hooks/useTwin'
import { inrShort, pct, timeAgo } from '@/lib/format'
import { OPS } from '@/lib/ops'
import { api, ApiError } from '@/services/api'
import type { DecisionEnvelope, DecisionSummary, NodeEvent, Opinion, RedTeamTest } from '@/services/types'
import { useApp } from '@/stores/app'
import './architecture.css'

type St = 'waiting' | 'running' | 'done' | 'failed' | 'rejected' | 'approved' | 'skipped'

const ROUTES = [
  { id: 'investment', label: 'Investment Engine' },
  { id: 'loan', label: 'Loan Simulator' },
  { id: 'spending', label: 'Spending Analyzer' },
  { id: 'crisis', label: 'Crisis Planner' },
]
const AGENT_COLORS: Record<string, string> = { Bull: 'var(--brass)', Bear: 'var(--red)', Risk: 'var(--blue)', Goal: 'var(--green)', Compliance: 'var(--lavender)' }

const RUNS: { value: string; label: string; body: Record<string, unknown> }[] = [
  {
    value: 'loan',
    label: 'Flagship: ₹5 lakh personal loan + NIFTY −30% crash',
    body: {
      decision_type: 'loan',
      command: 'Can I take a ₹5 lakh personal loan?',
      params: { loan_type: 'personal', amount: 500000, annual_rate_pct: 14, tenure_months: 60, processing_fee_pct: 1, crisis: 'market_crash' },
    },
  },
  { value: 'investment', label: 'Is my investment plan robust?', body: { decision_type: 'investment', command: 'Is my investment plan robust?', params: {} } },
  { value: 'goal', label: 'Can I reach my primary goal?', body: { decision_type: 'goal', command: 'Can I reach my primary goal?', params: {} } },
  { value: 'crisis', label: 'What if I lose my job for six months?', body: { decision_type: 'crisis', command: 'What if I lose my job for six months?', params: { scenario: 'job_loss', job_loss_months: 6 } } },
  { value: 'spending', label: 'I spend ₹8,000/month on betting', body: { decision_type: 'spending', command: 'I spend ₹8,000/month on betting', params: { monthly_amount: 8000 } } },
]

interface NodeView {
  st: St
  last?: NodeEvent
  runs: number
  ms: number
}

/** Fold the event stream into per-node state. */
function fold(events: NodeEvent[], finished: boolean) {
  const v: Record<string, NodeView> = {}
  const critic: NodeEvent[] = []
  const reopt: NodeEvent[] = []
  let current: string | null = null
  for (const e of events) {
    const n = (v[e.node] ??= { st: 'waiting', runs: 0, ms: 0 })
    if (e.status === 'running') {
      n.st = 'running'
      current = e.node
    } else if (e.status === 'failed') {
      n.st = 'failed'
      n.last = e
      current = null
    } else {
      n.runs += 1
      n.ms += e.duration_ms ?? 0
      n.last = e
      if (e.node === 'critic') {
        critic.push(e)
        n.st = (e.payload as { verdict?: string }).verdict === 'REJECT' ? 'rejected' : 'approved'
      } else n.st = 'done'
      if (e.node === 're_optimize') reopt.push(e)
      if (current === e.node) current = null
    }
  }
  const routed = ROUTES.find((r) => v[r.id])
  if (routed) for (const r of ROUTES) if (!v[r.id]) v[r.id] = { st: 'skipped', runs: 0, ms: 0 }
  if (finished && !v.re_optimize) v.re_optimize = { st: 'skipped', runs: 0, ms: 0 }
  return { v, critic, reopt, current }
}

function stOf(v: Record<string, NodeView>, id: string): St {
  return v[id]?.st ?? 'waiting'
}
function payload<T>(v: Record<string, NodeView>, id: string): T | null {
  return (v[id]?.last?.payload as T | undefined) ?? null
}

const ST_LABEL: Record<St, string> = { waiting: 'Waiting', running: 'Running', done: 'Complete', failed: 'Failed', rejected: 'Rejected', approved: 'Approved', skipped: 'Not taken' }

function StatusPill({ st }: { st: St }) {
  return (
    <span className={`ax-pill ${st}`}>
      {st === 'running' ? (
        <span className="ax-spin" aria-hidden="true" />
      ) : st === 'done' || st === 'approved' ? (
        <Icon name="check" size={12} />
      ) : st === 'rejected' || st === 'failed' ? (
        <Icon name="x" size={12} />
      ) : null}
      {ST_LABEL[st]}
    </span>
  )
}

function Node({ id, title, role, v, children, wide }: { id: string; title: string; role: string; v: Record<string, NodeView>; children?: React.ReactNode; wide?: boolean }) {
  const n = v[id]
  const st = stOf(v, id)
  return (
    <div id={`node-${id}`} className={`ax-node ${st} ${wide ? 'wide' : ''}`} aria-live={st === 'running' ? 'polite' : undefined}>
      <div className="ax-node-head">
        <div>
          <div className="ax-node-title">
            {title}
            {n && n.runs > 1 && <span className="ax-runs">×{n.runs}</span>}
          </div>
          <div className="ax-node-role">
            {role} · <code>{id}</code>
          </div>
        </div>
        <div className="ax-head-r">
          {n && n.ms > 0 && <span className="ax-ms">{n.ms} ms</span>}
          <StatusPill st={st} />
        </div>
      </div>
      {(st === 'done' || st === 'approved' || st === 'rejected' || st === 'failed') && <div className="ax-node-out">{children ?? <p>{n?.last?.summary}</p>}</div>}
    </div>
  )
}

/** Connector between two stages; carries a flow only while the downstream stage is executing. */
function Flow({ from, to, v, label }: { from: string[]; to: string; v: Record<string, NodeView>; label?: string }) {
  const up = from.some((f) => ['done', 'approved', 'rejected'].includes(stOf(v, f)))
  const down = to === '__final' ? (up ? 'done' : 'waiting') : stOf(v, to)
  const cls = down === 'running' ? 'flowing' : up && down !== 'waiting' ? 'used' : ''
  return (
    <div className={`ax-flow ${cls}`} aria-hidden="true">
      <span className="ax-line" />
      {label && <span className="ax-flow-label">{label}</span>}
    </div>
  )
}

export default function Architecture() {
  const profile = useApp((s) => s.profile)
  const lastId = useApp((s) => s.lastDecisionId)
  const setDecision = useApp((s) => s.setDecision)
  const [id, setId] = useState<string | null>(lastId)
  const [env, setEnv] = useState<DecisionEnvelope | null>(null)
  const [events, setEvents] = useState<NodeEvent[]>([])
  const [live, setLive] = useState(false)
  const [ended, setEnded] = useState(false)
  const [replaying, setReplaying] = useState(false)
  const [err, setErr] = useState<ApiError | string | null>(null)
  const [run, setRun] = useState(RUNS[0]!.value)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<DecisionSummary[]>([])
  const timers = useRef<number[]>([])

  const clearTimers = () => {
    timers.current.forEach((t) => clearTimeout(t))
    timers.current = []
  }

  useEffect(() => {
    api<{ decisions: DecisionSummary[] }>('/api/decisions?limit=12')
      .then((r) => setHistory(r.decisions))
      .catch(() => setHistory([]))
  }, [id])

  // load a decision: stream it if it is still running, otherwise show its stored events
  useEffect(() => {
    if (!id) return
    let es: EventSource | null = null
    let cancelled = false
    clearTimers()
    setReplaying(false)
    setEvents([])
    setEnded(false)
    setErr(null)
    api<DecisionEnvelope>(`/api/decision/${id}`)
      .then((e) => {
        if (cancelled) return
        setEnv(e)
        if (e.status === 'running') {
          setLive(true)
          es = new EventSource(e.stream_url ?? `/api/decision/${id}/stream`)
          es.addEventListener('node', (m) => setEvents((ev) => [...ev, JSON.parse((m as MessageEvent).data) as NodeEvent]))
          const done = () => {
            es?.close()
            setEnded(true)
            api<DecisionEnvelope>(`/api/decision/${id}`)
              .then((r) => !cancelled && setEnv(r))
              .catch(() => undefined)
          }
          es.addEventListener('end', done)
          es.onerror = done
        } else {
          setLive(false)
          setEvents((e.events ?? []) as NodeEvent[])
          setEnded(true)
        }
      })
      .catch((e: ApiError) => {
        if (cancelled) return
        if (e.status === 404) {
          setId(null)
          setEnv(null)
        } else setErr(e)
      })
    return () => {
      cancelled = true
      es?.close()
    }
  }, [id])

  useEffect(() => clearTimers, [])

  // deep links such as /architecture#node-critic scroll once the stored run has rendered
  const loc = useLocation()
  const loaded = events.length > 0 && ended
  useEffect(() => {
    if (!loaded || !loc.hash) return
    const t = setTimeout(() => document.getElementById(loc.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200)
    return () => clearTimeout(t)
  }, [loaded, loc.hash])

  const start = useCallback(async () => {
    setBusy(true)
    setErr(null)
    try {
      let p = useApp.getState().profile
      if (!p) {
        await loadJudgeProfile()
        p = useApp.getState().profile
      }
      const r = await api<{ decision_id: string }>('/api/decision/run', { body: { profile: p, ...RUNS.find((x) => x.value === run)!.body } })
      setDecision(r.decision_id)
      setId(r.decision_id)
    } catch (e) {
      setErr(e as ApiError)
    } finally {
      setBusy(false)
    }
  }, [run, setDecision])

  /** Re-play a stored run event by event, in recorded order, slowed so each stage is readable. */
  const replay = useCallback(() => {
    const all = (env?.events ?? []) as NodeEvent[]
    if (!all.length) return
    clearTimers()
    setReplaying(true)
    setEnded(false)
    setEvents([])
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let t = 0
    all.forEach((e, i) => {
      t += reduced ? 0 : e.status === 'running' ? 160 : Math.min(700, 220 + (e.duration_ms ?? 0) * 0.6)
      timers.current.push(
        window.setTimeout(() => {
          setEvents((ev) => [...ev, e])
          if (i === all.length - 1) {
            setEnded(true)
            setReplaying(false)
          }
        }, t),
      )
    })
  }, [env])

  const { v, critic, reopt, current } = useMemo(() => fold(events, ended), [events, ended])
  const res = env?.status === 'completed' && ended && !replaying ? env.result : null
  const opinions = payload<{ opinions: Opinion[] }>(v, 'financial_committee')?.opinions ?? []
  const tests = payload<{ tests: RedTeamTest[]; score: number }>(v, 'red_team')
  const sim = payload<{ summary: { n_paths: number; goal_success_probability: number | null; ending_p5: number; ending_p50: number; ending_p95: number; max_drawdown_p95: number } }>(v, 'simulation_engine')?.summary
  const debate = payload<{ decision: { verdict: string; score: number } }>(v, 'debate')?.decision
  const routed = ROUTES.find((r) => v[r.id] && v[r.id]!.st !== 'skipped')
  const running = live && !ended
  const finalSt: St = !ended ? 'waiting' : env?.status === 'failed' ? 'failed' : critic.length ? 'approved' : events.length ? 'done' : 'waiting'
  const totalMs = events.reduce((s, e) => s + (e.status === 'done' ? (e.duration_ms ?? 0) : 0), 0)

  return (
    <div className="page ax">
      <div className="page-head">
        <div>
          <h1>Agent architecture</h1>
          <p>Watch a decision move through the real LangGraph pipeline. Each node lights up only while the backend is executing it, and shows what it actually produced.</p>
        </div>
      </div>

      <div className="ax-honest">
        <strong>What this system is:</strong> a multi-agent decision orchestration system combining specialized financial reasoning engines, simulations, structured agent deliberation, adversarial testing and optional AI
        language capabilities. Agents are deterministic reasoning components over engine outputs; no number is invented by a language model.
      </div>

      <div className="ax-controls panel">
        <div className="ax-run">
          <SelectField label="Decision to run" value={run} options={RUNS.map((r) => ({ value: r.value, label: r.label }))} onChange={setRun} />
          <button className="btn primary" onClick={start} disabled={busy || running}>
            {busy || running ? <Spinner /> : <Icon name="play" size={14} />} {running ? 'Running…' : 'Run it live'}
          </button>
        </div>
        <div className="ax-run">
          <SelectField
            label="Or open a stored decision"
            value={id ?? ''}
            options={[
              { value: '', label: history.length ? 'Choose a decision…' : 'No stored decisions yet' },
              ...history.map((d) => ({ value: d.decision_id, label: `${d.command || d.type} · ${timeAgo(d.created_at)}` })),
            ]}
            onChange={(x) => x && setId(x)}
          />
          <button className="btn" onClick={replay} disabled={!env?.events?.length || running || replaying}>
            <Icon name="refresh" size={14} /> Replay
          </button>
        </div>
        {!profile && <p className="tiny muted">No Digital Twin yet — running a decision loads the sample profile (age 28, ₹80,000/month, ₹25 L goal in 5 years).</p>}
      </div>
      <ErrorBox error={err} onRetry={id ? () => setId(id) : undefined} />

      <div className="ax-status" role="status">
        {running || replaying ? (
          <>
            <span className="ax-spin" aria-hidden="true" />
            <strong>{current ? (OPS[current] ?? 'Working…') : 'Waiting for the next node…'}</strong>
            {replaying && <span className="tiny muted">Replay of a stored run, slowed for readability. Recorded durations are shown on each node.</span>}
          </>
        ) : events.length ? (
          <>
            <Icon name="check" size={16} />
            <strong>{env?.status === 'failed' ? 'The run failed' : `Run complete: ${events.filter((e) => e.status === 'done').length} node executions in ${(totalMs / 1000).toFixed(1)} s of compute`}</strong>
            {env && (
              <span className="tiny muted">
                “{env.command || env.type}” · {timeAgo(env.created_at)}
              </span>
            )}
          </>
        ) : (
          <span className="muted">Run a decision to watch the agents execute.</span>
        )}
      </div>

      <div className="ax-grid">
        <div className="ax-flowchart">
          <div className="ax-entry">
            <span className="ax-entry-k">User decision</span>
            <span className="ax-entry-q">{env ? `“${env.command || env.type}”` : 'Waiting for a question'}</span>
          </div>
          <Flow from={['__start']} to="profile_parser" v={v} />
          <div className="ax-row two">
            <Node id="profile_parser" title="Profile engine" role="Validates the profile" v={v} />
            <Node id="financial_twin" title="Financial Digital Twin" role="Net worth, cash flow, resilience" v={v} />
          </div>
          <Flow from={['financial_twin']} to="supervisor" v={v} />
          <Node id="supervisor" title="Supervisor AI" role="Classifies the decision" v={v} wide>
            <p>
              Decision type: <strong>{payload<{ decision_type: string }>(v, 'supervisor')?.decision_type}</strong>
            </p>
            <p className="tiny text-2">{v.supervisor?.last?.summary}</p>
          </Node>
          <Flow from={['supervisor']} to="risk_dna" v={v} label="runs in parallel" />
          <div className="ax-row three">
            <Node id="risk_dna" title="Risk agent" role="8-dimension Risk DNA" v={v}>
              <p>
                Risk profile: <strong>{payload<{ label: string }>(v, 'risk_dna')?.label}</strong>
              </p>
              <p className="tiny text-2">{v.risk_dna?.last?.summary}</p>
            </Node>
            <Node id="goal_agent" title="Goal agent" role="Required investment vs. capacity" v={v} />
            <Node id="market_agent" title="Market agent" role="Regime from local NIFTY history" v={v}>
              <p>
                Regime: <strong>{payload<{ regime: string }>(v, 'market_agent')?.regime}</strong>
              </p>
              <p className="tiny text-2">{v.market_agent?.last?.summary}</p>
            </Node>
          </div>
          <Flow from={['risk_dna', 'goal_agent', 'market_agent']} to="decision_router" v={v} />
          <Node id="decision_router" title="Decision router" role="Picks one financial engine" v={v} wide />
          <Flow from={['decision_router']} to={routed?.id ?? 'investment'} v={v} />
          {routed ? (
            <>
              <Node id={routed.id} title={routed.label} role="Financial engine chosen by the router" v={v} wide />
              <p className="ax-skipped">
                Not taken:{' '}
                {ROUTES.filter((r) => r.id !== routed.id)
                  .map((r) => r.label)
                  .join(' · ')}
              </p>
            </>
          ) : (
            <div className="ax-row four">
              {ROUTES.map((r) => (
                <Node key={r.id} id={r.id} title={r.label} role="Financial engine" v={v} />
              ))}
            </div>
          )}
          <Flow from={ROUTES.map((r) => r.id)} to="portfolio_doctor" v={v} />
          <Node id="portfolio_doctor" title="Portfolio Doctor" role="Checks the proposed mix" v={v} wide />
          <Flow from={['portfolio_doctor', 're_optimize']} to="simulation_engine" v={v} label={v.re_optimize?.runs ? 'and again after each re-optimisation' : undefined} />
          <Node id="simulation_engine" title="Simulation engine" role="10,000 block-bootstrapped futures" v={v} wide>
            {sim && (
              <div className="ax-sim">
                <div className="ax-sim-k">
                  <span>{sim.n_paths.toLocaleString('en-IN')} futures</span>
                  <span>
                    Goal success <strong>{pct(sim.goal_success_probability)}</strong>
                  </span>
                </div>
                <div className="ax-range" aria-label={`Ending wealth from ${inrShort(sim.ending_p5)} (P5) to ${inrShort(sim.ending_p95)} (P95), median ${inrShort(sim.ending_p50)}`}>
                  <span className="ax-range-bar" />
                  <span className="ax-range-mid" style={{ left: `${Math.max(4, Math.min(96, ((sim.ending_p50 - sim.ending_p5) / Math.max(1, sim.ending_p95 - sim.ending_p5)) * 100))}%` }} />
                </div>
                <div className="ax-sim-k tiny text-2">
                  <span>P5 {inrShort(sim.ending_p5)}</span>
                  <span>median {inrShort(sim.ending_p50)}</span>
                  <span>P95 {inrShort(sim.ending_p95)}</span>
                </div>
              </div>
            )}
          </Node>
          <Flow from={['simulation_engine']} to="crisis_engine" v={v} />
          <Node id="crisis_engine" title="Crisis War Room" role="Applies the stress scenario" v={v} wide />
          <Flow from={['crisis_engine']} to="financial_committee" v={v} />
          <Node id="financial_committee" title="AI Committee" role="Five structured agents read the same numbers" v={v} wide>
            <div className="ax-agents">
              {opinions.map((o) => (
                <div key={o.agent} className={`ax-agent ${o.stance}`} style={{ '--ac': AGENT_COLORS[o.agent] } as React.CSSProperties}>
                  <div className="ax-agent-name">{o.agent}</div>
                  <div className="ax-agent-stance">{o.stance}</div>
                  <div className="tiny text-2">{o.key_concern}</div>
                  <div className="tiny muted">confidence {pct(o.confidence)}</div>
                </div>
              ))}
            </div>
          </Node>
          <Flow from={['financial_committee']} to="debate" v={v} />
          <Node id="debate" title="Debate" role="Agents answer each other, then vote" v={v} wide>
            {debate && (
              <p>
                Committee verdict: <strong>{debate.verdict.charAt(0) + debate.verdict.slice(1).toLowerCase()}</strong> · weighted support {pct(debate.score)}
              </p>
            )}
          </Node>
          <Flow from={['debate']} to="red_team" v={v} />
          <Node id="red_team" title="Red Team" role="Tries to break the plan" v={v} wide>
            {tests && (
              <>
                <p>
                  <strong>
                    {tests.tests.filter((t) => t.status !== 'PASS').length} weakness{tests.tests.filter((t) => t.status !== 'PASS').length === 1 ? '' : 'es'} found
                  </strong>{' '}
                  · robustness {tests.score}/100
                </p>
                <div className="ax-tests">
                  {tests.tests.map((t) => (
                    <span key={t.key} className={`ax-test ${t.status}`}>
                      {t.name.replace(/ test$/i, '')}
                      <b>{t.status === 'PASS' ? 'held' : t.status === 'WARN' ? 'strained' : 'broke'}</b>
                    </span>
                  ))}
                </div>
              </>
            )}
          </Node>
          <Flow from={['red_team']} to="critic" v={v} />
          <Node id="critic" title="Critic" role="Accepts, or sends the plan back" v={v} wide>
            <ol className="ax-loop">
              {critic.map((c, i) => {
                const p = c.payload as { verdict: string; reasons: string[] }
                const r = reopt[i]
                return (
                  <li key={i}>
                    <div className={`ax-round ${p.verdict === 'REJECT' ? 'rej' : 'acc'}`}>
                      <span className="tiny muted">Round {i + 1}</span>
                      <strong>{p.verdict === 'REJECT' ? 'Rejected — re-optimization required' : 'Approved'}</strong>
                      <span className="tiny text-2">{p.reasons.slice(0, 2).join(' · ')}</span>
                    </div>
                    {r && (
                      <div className="ax-reopt">
                        <span className="tiny muted">Re-optimiser</span>
                        <span className="tiny text-2">{r.summary}</span>
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          </Node>
          <Flow from={['critic']} to="counterfactual" v={v} />
          <div className="ax-row three">
            <Node id="counterfactual" title="Counterfactual" role="Why not riskier or safer" v={v} />
            <Node id="explanation" title="Explanation" role="Why this decision" v={v} />
            <Node id="trust_center" title="Trust Center" role="Data, confidence, limits" v={v} />
          </div>
          <Flow from={['trust_center']} to="__final" v={v} />
          <div className={`ax-final ${finalSt}`}>
            <span className="ax-entry-k">Final decision</span>
            {res ? (
              <>
                <strong className="ax-final-verdict">{res.explanation.verdict ?? res.recommendation.status}</strong>
                <span className="text-2">{res.explanation.action}</span>
                <Link className="btn sm" to={`/committee?id=${env?.decision_id}#final`}>
                  Open the full decision <Icon name="arrow" size={14} />
                </Link>
              </>
            ) : (
              <span className="muted">{running || replaying ? 'Pending' : env?.status === 'failed' ? env.error : 'Appears when the pipeline finishes'}</span>
            )}
          </div>
        </div>

        <aside className="ax-side">
          <Panel title="Execution log" sub="Real node events, in order">
            {events.length ? (
              <ol className="ax-log">
                {events
                  .filter((e) => e.status !== 'running')
                  .map((e, i) => (
                    <li key={i} className={e.status === 'failed' ? 'failed' : e.node === 'critic' && (e.payload as { verdict?: string }).verdict === 'REJECT' ? 'rej' : ''}>
                      <span className="ax-log-n">{e.label ?? e.node}</span>
                      <span className="ax-log-ms">{e.duration_ms ?? 0} ms</span>
                      <span className="ax-log-s">{e.summary}</span>
                    </li>
                  ))}
              </ol>
            ) : (
              <p className="small muted">Empty until a decision runs.</p>
            )}
          </Panel>
          <Panel title="Reading the states">
            <ul className="ax-legend">
              {(['waiting', 'running', 'done', 'rejected', 'approved', 'skipped', 'failed'] as St[]).map((s) => (
                <li key={s}>
                  <StatusPill st={s} />
                  <span className="tiny text-2">
                    {
                      {
                        waiting: 'Not reached yet',
                        running: 'The backend is executing this node now',
                        done: 'Finished; its real output is shown',
                        rejected: 'The Critic sent the plan back',
                        approved: 'The Critic accepted the plan',
                        skipped: 'The router chose a different engine',
                        failed: 'An error stopped the run',
                      }[s]
                    }
                  </span>
                </li>
              ))}
            </ul>
            <p className="tiny muted mt-sm">
              The full graph and its audit record: <Link to="/audit">Audit trail</Link> · <Link to="/how-it-works">How it works</Link>
            </p>
          </Panel>
        </aside>
      </div>
      <Disclaimer />
    </div>
  )
}
