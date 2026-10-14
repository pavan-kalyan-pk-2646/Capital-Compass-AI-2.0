import type { NodeEvent } from '@/services/types'

/** Present-progressive labels for the operation the backend is executing right now. */
export const OPS: Record<string, string> = {
  profile_parser: 'Reading the financial profile…',
  financial_twin: 'Building the Financial Digital Twin…',
  supervisor: 'Supervisor reading the question…',
  risk_dna: 'Running risk analysis…',
  goal_agent: 'Evaluating goal survival…',
  market_agent: 'Reading the market regime…',
  decision_router: 'Routing the decision…',
  investment: 'Generating the investment plan…',
  loan: 'Simulating the loan…',
  spending: 'Analysing high-risk spending…',
  crisis: 'Preparing the crisis plan…',
  portfolio_doctor: 'Portfolio Doctor checking the mix…',
  simulation_engine: 'Simulating 10,000 futures…',
  crisis_engine: 'Stress-testing against the crisis…',
  financial_committee: 'Committee deliberation…',
  debate: 'Agents debating…',
  red_team: 'Red Team stress test…',
  critic: 'Critic evaluation…',
  re_optimize: 'Re-optimising the plan…',
  counterfactual: 'Testing the alternatives…',
  explanation: 'Explaining the result…',
  trust_center: 'Recording the trust report…',
}

/** The node the backend is executing right now: its last `running` event has no later `done`. */
export function currentNode(events: NodeEvent[]): string | null {
  let cur: string | null = null
  for (const e of events) {
    if (e.status === 'running') cur = e.node
    else if (e.node === cur) cur = null
  }
  return cur
}
