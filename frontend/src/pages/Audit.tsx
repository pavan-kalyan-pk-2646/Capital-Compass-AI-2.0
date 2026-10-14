import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { AgentGraph, graphFromAudit } from '@/components/AgentGraph'
import { Badge, Disclaimer, ErrorBox, Loading, Panel, StanceBadge } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { clockTime, parseUtc, timeAgo, verdictTone } from '@/lib/format'
import { api } from '@/services/api'
import type { AuditResponse, DecisionSummary, Opinion } from '@/services/types'
import { useApp } from '@/stores/app'

/** Architecture audit stages and the graph nodes that implement each one. */
const STAGES: { label: string; nodes: string[] }[] = [
  {
    label: 'Profile',
    nodes: ['profile_parser', 'financial_twin', 'risk_dna', 'goal_agent'],
  },
  { label: 'Market data', nodes: ['market_agent'] },
  {
    label: 'Strategy',
    nodes: ['supervisor', 'decision_router', 'investment', 'loan', 'spending', 'crisis', 'portfolio_doctor'],
  },
  { label: 'Simulation', nodes: ['simulation_engine', 'crisis_engine'] },
  { label: 'Compliance', nodes: ['financial_committee', 'debate'] },
  { label: 'Red Team', nodes: ['red_team'] },
  { label: 'Critic', nodes: ['critic', 're_optimize'] },
  {
    label: 'Explanation',
    nodes: ['counterfactual', 'explanation', 'trust_center'],
  },
]
const LABEL: Record<string, string> = {
  profile_parser: 'Financial Profile Engine',
  financial_twin: 'Financial Digital Twin',
  supervisor: 'Supervisor AI',
  risk_dna: 'Risk DNA',
  goal_agent: 'Goal Agent',
  market_agent: 'Market Agent',
  decision_router: 'Decision Router',
  investment: 'Investment Engine',
  loan: 'Loan Decision Simulator',
  spending: 'High-Risk Spending Analyzer',
  crisis: 'Crisis Engine',
  portfolio_doctor: 'Portfolio Doctor',
  simulation_engine: 'Simulation Engine',
  crisis_engine: 'Crisis War Room',
  financial_committee: 'AI Financial Committee',
  debate: 'Committee Debate',
  red_team: 'Red Team',
  critic: 'Critic',
  re_optimize: 'Re-optimiser',
  counterfactual: 'Counterfactual Explanation',
  explanation: 'Explanation Agent',
  trust_center: 'Trust Center',
}

export default function Audit() {
  const lastId = useApp((s) => s.lastDecisionId)
  const [sp] = useSearchParams()
  const [sel, setSel] = useState<string | null>(sp.get('id') || lastId)
  const list = useAsync((signal) =>
    api<{ decisions: DecisionSummary[] }>('/api/decisions?limit=30', {
      signal,
    }),
  )
  const audit = useAsync((signal) => api<AuditResponse>(`/api/decision/${sel}/audit`, { signal }))

  const runList = list.run
  const runAudit = audit.run
  useEffect(() => {
    runList()
  }, [runList])
  useEffect(() => {
    if (!sel && list.data?.decisions[0]) setSel(list.data.decisions[0].decision_id)
  }, [sel, list.data])
  useEffect(() => {
    if (sel) runAudit()
  }, [sel, runAudit])

  const a = audit.data
  const seen = new Set(a?.audit_trail.map((t) => t.node_name))
  const total = a?.audit_trail.reduce((s, t) => s + t.duration_ms, 0) ?? 0

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Decision audit trail</h1>
          <p>Every decision is stored node by node: what ran, in what order, what it concluded and how long it took. Agent opinions are logged per committee round.</p>
        </div>
      </div>
      {a && (
        <div style={{ marginBottom: 16 }}>
          <Panel title="Agent graph" sub="Which agents and engines ran for this decision; ×2 marks nodes that ran again after a Critic rejection">
            <AgentGraph
              graph={graphFromAudit(a.audit_trail)}
              opinions={(() => {
                const last = Math.max(0, ...a.agent_logs.map((l) => l.round))
                return a.agent_logs.filter((l) => l.round === last && ['support', 'conditional', 'oppose'].includes(l.stance)).map((l) => ({ agent: l.agent, stance: l.stance }) as Opinion)
              })()}
            />
          </Panel>
        </div>
      )}
      <div className="grid g-side">
        <Panel title="Decisions">
          <ErrorBox error={list.error} onRetry={() => list.run()} />
          {list.loading && !list.data && <Loading label="Loading history" height={120} />}
          {list.data && list.data.decisions.length === 0 && (
            <div className="small text-2">
              No decisions yet. <Link to="/committee?new=1">Run one in the AI Committee</Link>.
            </div>
          )}
          <div className="stack-sm">
            {list.data?.decisions.map((d) => (
              <button
                key={d.decision_id}
                className="btn"
                style={{
                  justifyContent: 'space-between',
                  textAlign: 'left',
                  borderColor: sel === d.decision_id ? 'var(--brass)' : undefined,
                  whiteSpace: 'normal',
                }}
                onClick={() => setSel(d.decision_id)}
              >
                <span>
                  <span className="small">{d.command || `${d.type} decision`}</span>
                  <span className="tiny muted" style={{ display: 'block' }}>
                    {d.type}, {timeAgo(d.created_at)}
                  </span>
                </span>
                <Badge tone={d.status === 'completed' ? verdictTone(d.verdict) : d.status === 'failed' ? 'red' : 'blue'}>
                  {d.status === 'completed' ? (d.verdict?.includes('RE-OPT') ? 're-optimised' : d.verdict?.includes('FLAG') ? 'flagged' : 'accepted') : d.status}
                </Badge>
              </button>
            ))}
          </div>
        </Panel>
        <div className="stack">
          <ErrorBox error={audit.error} onRetry={() => audit.run()} />
          {!sel && !list.loading && (
            <div className="state">
              <h3>Nothing to audit yet</h3>
              <p>Run a decision and every stage of it will be recorded here.</p>
            </div>
          )}
          {audit.loading && !a && <Loading label="Loading audit trail" />}
          {a && (
            <>
              <Panel
                title={a.command || `${a.type} decision`}
                sub={`Decision ${a.decision_id.slice(0, 8)}, ${parseUtc(a.created_at).toLocaleString('en-IN')}, ${a.audit_trail.length} steps in ${(total / 1000).toFixed(1)} s`}
                action={
                  <Link className="btn sm" to={`/committee?id=${a.decision_id}`}>
                    Open decision
                  </Link>
                }
              >
                <ol className="row wrap" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 6 }}>
                  {STAGES.map((s, i) => {
                    const done = s.nodes.some((n) => seen.has(n))
                    return (
                      <li key={s.label} className="row" style={{ gap: 6 }}>
                        <Badge tone={done ? 'green' : ''}>{s.label}</Badge>
                        {i < STAGES.length - 1 && <span className="muted">→</span>}
                      </li>
                    )
                  })}
                </ol>
              </Panel>
              <Panel title="Node by node">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Timestamp</th>
                        <th>Node</th>
                        <th>Status</th>
                        <th>Summary</th>
                        <th className="r">Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.audit_trail.map((t) => (
                        <tr key={t.seq}>
                          <td className="muted num">{t.seq}</td>
                          <td className="num small muted" style={{ whiteSpace: 'nowrap' }}>
                            <time dateTime={t.timestamp}>{clockTime(t.timestamp)}</time>
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <span className={t.node_name === 'critic' && t.message.startsWith('REJECT') ? 'red' : t.node_name === 're_optimize' ? 'brass' : ''}>{LABEL[t.node_name] ?? t.node_name}</span>
                          </td>
                          <td>
                            <Badge tone={t.status === 'failed' ? 'red' : t.node_name === 'critic' && t.message.startsWith('REJECT') ? 'amber' : 'green'}>
                              {t.status === 'failed' ? 'failed' : t.node_name === 'critic' && t.message.startsWith('REJECT') ? 'rejected' : 'completed'}
                            </Badge>
                          </td>
                          <td className="small text-2">{t.message}</td>
                          <td className="r num small muted">{t.duration_ms} ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
              <Panel title="Agent log" sub="Every agent’s stance and decision, per committee round">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Round</th>
                        <th>Agent</th>
                        <th>Stance</th>
                        <th>Decision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.agent_logs.map((l, i) => (
                        <tr key={i}>
                          <td className="num muted">{l.round}</td>
                          <td>{l.agent}</td>
                          <td>
                            {['support', 'conditional', 'oppose'].includes(l.stance) ? (
                              <StanceBadge stance={l.stance} />
                            ) : (
                              <Badge tone={l.stance === 'reject' ? 'red' : l.stance === 'accept' ? 'green' : 'blue'}>{l.stance}</Badge>
                            )}
                          </td>
                          <td className="small text-2" title={l.reasoning}>
                            {l.decision}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {a.agent_logs.length === 0 && <p className="small muted">{a.status === 'running' ? 'Agents are still deliberating.' : 'No agent log for this decision.'}</p>}
              </Panel>
            </>
          )}
        </div>
      </div>
      <Disclaimer />
    </div>
  )
}
