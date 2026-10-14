/**
 * Live diagram of the LangGraph decision pipeline (backend/graph/build.py).
 * Nodes light up as SSE events arrive; the Critic → Re-optimiser → Simulation loop is drawn
 * explicitly, and the five committee agents show their stance.
 */
import type { NodeEvent, Opinion } from '@/services/types'

type Status = 'pending' | 'running' | 'done' | 'reject' | 'skipped'

interface N {
  id: string
  label: string
  x: number
  y: number
}

const W = 112
const H = 36
// Row A: understand + route
const A = 110
const NODES: N[] = [
  { id: 'profile_parser', label: 'Profile parser', x: 20, y: A },
  { id: 'financial_twin', label: 'Digital Twin', x: 150, y: A },
  { id: 'supervisor', label: 'Supervisor AI', x: 280, y: A },
  { id: 'risk_dna', label: 'Risk DNA', x: 420, y: A - 52 },
  { id: 'goal_agent', label: 'Goal Agent', x: 420, y: A },
  { id: 'market_agent', label: 'Market Agent', x: 420, y: A + 52 },
  { id: 'decision_router', label: 'Decision Router', x: 560, y: A },
  { id: 'investment', label: 'Investment', x: 700, y: A - 78 },
  { id: 'loan', label: 'Loan', x: 700, y: A - 26 },
  { id: 'spending', label: 'Spending', x: 700, y: A + 26 },
  { id: 'crisis', label: 'Crisis', x: 700, y: A + 78 },
  { id: 'portfolio_doctor', label: 'Portfolio Doctor', x: 850, y: A },
  // Row B: simulate, challenge, explain
  { id: 'simulation_engine', label: 'Simulation 10k', x: 20, y: 300 },
  { id: 'crisis_engine', label: 'Crisis War Room', x: 150, y: 300 },
  { id: 'financial_committee', label: 'AI Committee', x: 280, y: 300 },
  { id: 'debate', label: 'Debate', x: 410, y: 300 },
  { id: 'red_team', label: 'Red Team', x: 530, y: 300 },
  { id: 'critic', label: 'Critic', x: 650, y: 300 },
  { id: 're_optimize', label: 'Re-optimiser', x: 650, y: 390 },
  { id: 'counterfactual', label: 'Counterfactual', x: 780, y: 300 },
  { id: 'explanation', label: 'Explanation', x: 910, y: 300 },
  { id: 'trust_center', label: 'Trust Center', x: 1040, y: 300 },
]
const POS = Object.fromEntries(NODES.map((n) => [n.id, n]))

const EDGES: [string, string][] = [
  ['profile_parser', 'financial_twin'],
  ['financial_twin', 'supervisor'],
  ['supervisor', 'risk_dna'],
  ['supervisor', 'goal_agent'],
  ['supervisor', 'market_agent'],
  ['risk_dna', 'decision_router'],
  ['goal_agent', 'decision_router'],
  ['market_agent', 'decision_router'],
  ['decision_router', 'investment'],
  ['decision_router', 'loan'],
  ['decision_router', 'spending'],
  ['decision_router', 'crisis'],
  ['investment', 'portfolio_doctor'],
  ['loan', 'portfolio_doctor'],
  ['spending', 'portfolio_doctor'],
  ['crisis', 'portfolio_doctor'],
  ['portfolio_doctor', 'simulation_engine'],
  ['simulation_engine', 'crisis_engine'],
  ['crisis_engine', 'financial_committee'],
  ['financial_committee', 'debate'],
  ['debate', 'red_team'],
  ['red_team', 'critic'],
  ['critic', 're_optimize'],
  ['re_optimize', 'simulation_engine'],
  ['critic', 'counterfactual'],
  ['counterfactual', 'explanation'],
  ['explanation', 'trust_center'],
]

const ROUTES = ['investment', 'loan', 'spending', 'crisis']
const AGENTS = [
  { key: 'Bull', c: '#c9a24a' },
  { key: 'Bear', c: '#f0566a' },
  { key: 'Risk', c: '#6fa8ff' },
  { key: 'Goal', c: '#3ccb8f' },
  { key: 'Compliance', c: '#a99bf0' },
]
const STANCE_FILL: Record<string, string> = { support: '#3ccb8f', conditional: '#e8a33d', oppose: '#f0566a' }

function edgePath(a: N, b: N): string {
  const ax = a.x + W
  const ay = a.y + H / 2
  const bx = b.x
  const by = b.y + H / 2
  if (a.id === 'portfolio_doctor') {
    // drop from the end of row A to the start of row B
    const x1 = a.x + W / 2
    const y1 = a.y + H
    return `M${x1} ${y1} C ${x1} ${y1 + 90}, ${b.x + W / 2} ${b.y - 90}, ${b.x + W / 2} ${b.y}`
  }
  if (a.id === 'critic' && b.id === 're_optimize') return `M${a.x + W / 2} ${a.y + H} L${b.x + W / 2} ${b.y}`
  if (a.id === 're_optimize') {
    // the retry loop back to the simulation engine
    const y = b.y + H + 70
    return `M${a.x} ${a.y + H / 2} C ${a.x - 60} ${a.y + H / 2}, ${a.x - 60} ${y}, ${a.x - 120} ${y} L ${b.x + W / 2 + 40} ${y} C ${b.x + W / 2} ${y}, ${b.x + W / 2} ${y - 20}, ${b.x + W / 2} ${b.y + H}`
  }
  const mx = (ax + bx) / 2
  return `M${ax} ${ay} C ${mx} ${ay}, ${mx} ${by}, ${bx} ${by}`
}

export interface GraphState {
  status: Record<string, Status>
  counts: Record<string, number>
  rejected: number
}

/** Derive node states from live SSE events. */
export function graphFromEvents(events: NodeEvent[], finished: boolean): GraphState {
  const status: Record<string, Status> = {}
  const counts: Record<string, number> = {}
  let rejected = 0
  for (const e of events) {
    if (!POS[e.node]) continue
    if (e.status === 'running') {
      status[e.node] = status[e.node] === 'reject' ? 'reject' : 'running'
    } else if (e.status === 'done') {
      counts[e.node] = (counts[e.node] ?? 0) + 1
      const verdict = (e.payload as { verdict?: string }).verdict
      if (e.node === 'critic' && verdict === 'REJECT') {
        rejected += 1
        status[e.node] = 'reject'
      } else status[e.node] = 'done'
    } else status[e.node] = 'reject'
  }
  return finish(status, counts, rejected, finished)
}

/** Derive node states from a stored audit trail. */
export function graphFromAudit(trail: { node_name: string; message: string }[]): GraphState {
  const status: Record<string, Status> = {}
  const counts: Record<string, number> = {}
  let rejected = 0
  for (const t of trail) {
    if (!POS[t.node_name]) continue
    counts[t.node_name] = (counts[t.node_name] ?? 0) + 1
    status[t.node_name] = 'done'
    if (t.node_name === 'critic' && t.message.startsWith('REJECT')) rejected += 1
  }
  return finish(status, counts, rejected, true)
}

function finish(status: Record<string, Status>, counts: Record<string, number>, rejected: number, finished: boolean): GraphState {
  const routed = ROUTES.find((r) => status[r])
  if (routed) for (const r of ROUTES) if (r !== routed && !status[r]) status[r] = 'skipped'
  if (finished && !status.re_optimize) status.re_optimize = 'skipped'
  return { status, counts, rejected }
}

const STROKE: Record<Status, string> = {
  pending: '#2d3f5e',
  running: '#e3c37a',
  done: '#3ccb8f',
  reject: '#f0566a',
  skipped: '#22314a',
}

export function AgentGraph({ graph, opinions, height }: { graph: GraphState; opinions?: Opinion[]; height?: number }) {
  const st = (id: string): Status => graph.status[id] ?? 'pending'
  const stance = Object.fromEntries((opinions ?? []).map((o) => [o.agent, o.stance]))
  const committee = POS.financial_committee!
  return (
    <div className="agent-graph" style={{ overflowX: 'auto' }}>
      <svg viewBox="0 0 1170 460" width="100%" style={{ minWidth: 760, height, display: 'block' }} role="img" aria-label="LangGraph agent pipeline">
        <defs>
          <marker id="ag-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="#5d6b84" />
          </marker>
          <marker id="ag-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="#3ccb8f" />
          </marker>
          <marker id="ag-arrow-loop" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="#e3c37a" />
          </marker>
        </defs>

        <text x="20" y="14" fill="#8d9ab0" fontSize="12">
          Understand and route
        </text>
        <text x="300" y="282" fill="#8d9ab0" fontSize="12">
          Simulate, challenge, explain
        </text>

        {EDGES.map(([a, b]) => {
          const na = POS[a]!
          const nb = POS[b]!
          const sa = st(a)
          const sb = st(b)
          const loop = a === 're_optimize' || (a === 'critic' && b === 're_optimize')
          const used = (sa === 'done' || sa === 'reject') && (sb === 'done' || sb === 'reject' || sb === 'running')
          const skipped = sa === 'skipped' || sb === 'skipped'
          const color = loop && used ? '#e3c37a' : used ? '#3ccb8f' : '#2d3f5e'
          return (
            <path
              key={a + b}
              d={edgePath(na, nb)}
              fill="none"
              stroke={color}
              strokeWidth={used ? 1.8 : 1.2}
              strokeDasharray={skipped ? '3 5' : loop && !used ? '5 4' : undefined}
              opacity={skipped ? 0.35 : 1}
              markerEnd={`url(#${loop && used ? 'ag-arrow-loop' : used ? 'ag-arrow-on' : 'ag-arrow'})`}
            />
          )
        })}

        {graph.rejected > 0 && (
          <text x={POS.simulation_engine!.x + W / 2 + 60} y={POS.simulation_engine!.y + H + 96} fill="#e3c37a" fontSize="12">
            Critic rejected → re-optimise → simulate again (×{graph.rejected})
          </text>
        )}

        {NODES.map((n) => {
          const s = st(n.id)
          const count = graph.counts[n.id] ?? 0
          return (
            <g key={n.id} className={s === 'running' ? 'ag-running' : undefined} opacity={s === 'skipped' ? 0.35 : 1}>
              <rect x={n.x} y={n.y} width={W} height={H} rx={9} fill={s === 'pending' || s === 'skipped' ? '#0d1627' : s === 'reject' ? 'rgba(240,86,106,0.14)' : s === 'running' ? 'rgba(201,162,74,0.16)' : 'rgba(60,203,143,0.1)'} stroke={STROKE[s]} strokeWidth={s === 'pending' ? 1 : 1.6} />
              <text x={n.x + W / 2} y={n.y + H / 2 + 1} textAnchor="middle" dominantBaseline="middle" fill={s === 'pending' || s === 'skipped' ? '#8d9ab0' : '#e8ecf3'} fontSize="12.5" fontWeight={500}>
                {n.label}
              </text>
              {count > 1 && (
                <g>
                  <circle cx={n.x + W - 2} cy={n.y + 2} r={9} fill="#c9a24a" />
                  <text x={n.x + W - 2} y={n.y + 3} textAnchor="middle" dominantBaseline="middle" fill="#1a1406" fontSize="10.5" fontWeight={700}>
                    ×{count}
                  </text>
                </g>
              )}
            </g>
          )
        })}

        {/* the five committee agents */}
        {AGENTS.map((a, i) => {
          const cx = committee.x + 4 + i * 26
          const cy = committee.y + H + 26
          const s = stance[a.key]
          return (
            <g key={a.key}>
              <line x1={committee.x + W / 2} y1={committee.y + H} x2={cx + 9} y2={cy - 9} stroke="#2d3f5e" />
              <circle cx={cx + 9} cy={cy} r={10} fill={s ? STANCE_FILL[s] : '#0d1627'} stroke={a.c} strokeWidth={2} />
              <text x={cx + 9} y={cy + 1} textAnchor="middle" dominantBaseline="middle" fontSize="9.5" fontWeight={700} fill={s ? '#0a1220' : a.c}>
                {a.key[0]}
              </text>
              <text x={cx + 9} y={cy + 22} textAnchor="middle" fontSize="9.5" fill="#8d9ab0">
                {a.key === 'Compliance' ? 'Comp.' : a.key}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="row wrap small text-2" style={{ gap: 14, marginTop: 6 }}>
        <span className="row" style={{ gap: 6 }}>
          <span className="dot" style={{ color: '#3ccb8f' }} /> Completed
        </span>
        <span className="row" style={{ gap: 6 }}>
          <span className="dot" style={{ color: '#e3c37a' }} /> Running / retry loop
        </span>
        <span className="row" style={{ gap: 6 }}>
          <span className="dot" style={{ color: '#f0566a' }} /> Critic rejected
        </span>
        <span className="row" style={{ gap: 6 }}>
          <span className="dot" style={{ color: '#5d6b84' }} /> Not taken
        </span>
        <span>Agent dots: green supports, amber conditional, red opposes</span>
      </div>
    </div>
  )
}
