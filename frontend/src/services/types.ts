/** API contracts — mirror backend/schemas/profile.py and the engine payloads. */

export type Employment = 'salaried_stable' | 'salaried_variable' | 'self_employed' | 'gig'
export type Experience = 'none' | 'beginner' | 'intermediate' | 'advanced'
export type Reaction = 'sell_all' | 'sell_some' | 'hold' | 'buy_more'
export type LiabilityType = 'personal' | 'education' | 'home' | 'vehicle' | 'credit_card' | 'other'
export type GoalType = 'home' | 'education' | 'retirement' | 'wealth' | 'emergency' | 'travel' | 'vehicle' | 'other'
export type Priority = 'high' | 'medium' | 'low'

export interface Assets {
  cash: number
  equity: number
  debt: number
  gold: number
  real_estate: number
  other: number
}
export interface Liability {
  type: LiabilityType
  name: string
  outstanding: number
  emi: number
  annual_rate_pct: number
  remaining_months: number
  floating_rate: boolean
}
export interface Goal {
  name: string
  goal_type: GoalType
  target_amount: number
  current_amount: number
  years: number
  priority: Priority
}
export interface Profile {
  name: string
  age: number
  dependents: number
  employment: Employment
  monthly_income: number
  other_income: number
  essential_expenses: number
  discretionary_expenses: number
  assets: Assets
  liabilities: Liability[]
  goals: Goal[]
  risk: { max_tolerated_loss_pct: number; experience: Experience; reaction_to_20pct_drop: Reaction }
  behaviour: {
    investment_frequency: 'none' | 'irregular' | 'monthly_sip' | 'lump_sum'
    current_monthly_investment: number
    high_risk_spending: number
    credit_card_behaviour: 'full' | 'partial' | 'minimum' | 'none'
  }
}

export interface Twin {
  total_assets: number
  liquid_assets: number
  investable_assets: number
  total_liabilities: number
  net_worth: number
  monthly_income: number
  monthly_expenses: number
  essential_expenses: number
  high_risk_spending: number
  monthly_emi: number
  monthly_surplus: number
  savings_rate: number
  emergency_fund_months: number
  dti: number
  liquidity_ratio: number
  health_score: number
  health_band: 'STRONG' | 'STABLE' | 'STRETCHED' | 'FRAGILE'
  sub_scores: { emergency_fund: number; savings_rate: number; debt: number }
}
export interface RiskDimension {
  key: string
  label: string
  score: number
  explanation: string
}
export interface RiskDNA {
  dimensions: RiskDimension[]
  scores: Record<string, number>
  profile_score: number
  label: string
  capped_by_max_loss: boolean
  required_monthly_sip: number
}
export interface GoalContext {
  name: string
  target: number | null
  months: number
  start_corpus: number
}
export interface Snapshot {
  twin: Twin
  flows: Record<string, number>
  balance: { assets: Record<string, number>; liabilities: Record<string, number> }
  risk_dna: RiskDNA
  goal: GoalContext
  profile_id?: number | null
}

export interface Weights {
  equity: number
  debt: number
  gold: number
}
export interface LoanTerms {
  loan_type: string
  amount: number
  annual_rate_pct: number
  tenure_months: number
  processing_fee_pct: number
  emi: number
  total_interest: number
  fee: number
}
export interface Plan {
  label: string
  weights: Weights
  monthly_sip: number
  ef_topup: number
  loan: LoanTerms | null
  spending_cut: number
  notes: string[]
}
export interface Percentiles {
  month: number[]
  p5: number[]
  p25: number[]
  p50: number[]
  p75: number[]
  p95: number[]
}
export interface Simulation {
  n_paths: number
  months: number
  seed: number
  regime: string
  weights: Weights
  target: number | null
  percentiles: Percentiles
  sample_paths: number[][]
  ending: { p5: number; p25: number; p50: number; p75: number; p95: number; mean: number; p50_real: number }
  goal_success_probability: number | null
  max_drawdown: { p50: number; p95: number }
  prob_loss_beyond_limit: number | null
  recovery_months_median: number | null
  forced_liquidation_probability: number
  elapsed_ms: number
}
export interface PlanEval {
  plan: Plan
  expected_return_pct: number
  expected_vol_pct: number
  crash_loss_pct: number
  goal_success_probability: number | null
  ending_p5: number
  ending_p50: number
  ending_p95: number
  max_drawdown_p95: number
  prob_loss_beyond_limit: number | null
}
export interface InvestmentResult extends PlanEval {
  sim: Simulation
  allocation: { asset_class: string; instrument: string; weight: number; amount: number }[]
  goal: GoalContext & { required_monthly_sip: number; affordable_sip: number }
  alternatives: PlanEval[]
  regime: string
}

export interface StressTest {
  scenario: string
  label: string
  monthly_surplus: number
  emergency_fund_months: number | null
  goal_success_probability?: number | null
  forced_liquidation_probability?: number
  passed: boolean
  detail: string
}
export interface LoanResult {
  loan: LoanTerms
  emi: number
  total_interest: number
  processing_fee: number
  total_repayment: number
  foir_before: number
  foir_after: number
  surplus_before: number
  surplus_after: number
  liquidity_impact: { monthly_cash_flow_change: number; fee_paid: number }
  emergency_fund_months_before: number
  emergency_fund_months_after: number
  debt_stress_score: number
  risk_band: 'LOW' | 'MODERATE' | 'MODERATE-HIGH' | 'HIGH'
  goal_probability_before: number | null
  goal_probability_after: number | null
  sip_before: number
  sip_after: number
  resilience_before: number
  resilience_after: number
  stress_tests: StressTest[]
  concerns: string[]
  safer_alternatives: string[]
  max_affordable_amount: number
  recommendation: string
  amortization: { year: number; interest: number; principal: number; balance: number }[]
  percentiles_before: Percentiles
  percentiles_after: Percentiles
}

export interface GoalSurvival {
  historical_return_pct?: number
  return_assumption?: 'user' | 'history'
  ending_wealth?: Simulation['ending'] | null
  shortfall_risk?: number | null
  shortfall_median?: number | null
  goal_name: string
  target_amount: number
  months: number
  start_corpus: number
  expected_return_pct: number
  required_monthly_sip: number
  current_monthly_sip: number
  sip_gap: number
  scenarios: {
    scenario: string
    label: string
    success_probability: number | null
    ending_p50: number
    ending_p5: number
    ending_p95?: number
    shortfall_risk?: number | null
    shortfall_median?: number | null
    forced_liquidation_probability: number
  }[]
  simulation: Simulation
  plan: Plan
  /** Present only when the request asked for `theatre: true`. */
  theatre?: GoalTheatreData
}

/** Share of ALL simulated paths in each wealth band at each time point (columns sum to 1). */
export interface PathDensity {
  months: number[]
  edges: number[]
  share: number[][]
}
export interface TheatreScenario {
  scenario: 'normal' | 'bear' | 'crash' | 'job_loss' | 'inflation' | 'rate_shock' | 'crash_job_loss'
  label: string
  target: number
  required_monthly_sip: number
  success_probability: number | null
  ending: Simulation['ending']
  shortfall_median: number | null
  max_drawdown: { p50: number; p95: number }
  recovery_months_median: number | null
  prob_unrecovered: number
  forced_liquidation_probability: number
  percentiles: Percentiles
  sample_paths: number[][]
  density: PathDensity | null
}
export interface GoalTheatreData {
  months: number
  target: number
  start_corpus: number
  expected_return_pct: number
  paths_sampled: number
  n_paths: number
  scenarios: TheatreScenario[]
  optimized: {
    monthly_sip: number
    success_probability: number | null
    ending: Simulation['ending']
    shortfall_median: number | null
    max_drawdown: { p50: number; p95: number }
    percentiles: Percentiles
    sample_paths: number[][]
  } | null
  risk_dna: RiskDimension[]
}

export interface CrisisResult {
  scenario: string
  label: string
  severity: number
  severity_label: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE'
  portfolio_before: number
  portfolio_after: number
  portfolio_loss_pct: number
  asset_impacts: Record<string, number>
  goal_probability_before: number | null
  goal_probability_after: number | null
  emergency_fund_survival_months: number
  job_loss_months: number
  monthly_burn: number
  emi_before: number
  emi_after: number
  emi_affordable: boolean
  real_purchasing_power: number | null
  recovery_months: number | null
  liquidity_before: number
  liquidity_after: number
  forced_liquidation_probability: number
  ending_p50_before: number
  ending_p50_after: number
  recommended_response: string[]
  percentiles_before: Percentiles
  percentiles_after: Percentiles
  crash_loss_cap?: number
  plan_crash_loss?: number
}

export interface WhatIfFuture {
  name: string
  inputs: {
    market_return_pct: number
    inflation_pct: number
    income_change_pct: number
    monthly_investment: number
    interest_rate_change_pct: number
    years: number
  }
  goal_target: number | null
  goal_success_probability: number | null
  ending: Simulation['ending']
  max_drawdown_p95: number
  liquidity_risk: number
  min_cash_p5: number
  debt_stress_foir: number | null
  recovery_months_median: number | null
  percentiles: Percentiles
}

export interface Holding {
  symbol: string
  asset_class: string
  sector: string
  value: number
  weight?: number
}
export interface DoctorResult {
  total_value: number
  holdings: Holding[]
  health_score: number
  health_label: string
  sub_scores: Record<string, number>
  hhi: number
  by_class: Record<string, number>
  sectors: Record<string, number>
  portfolio_vol_pct: number
  target_vol_pct: number
  correlation: number[][]
  symbols: string[]
  issues: { type: string; severity: string; text: string }[]
  treatment: { action: string; target: string; amount: number; reason: string }[]
  allocation_before: Record<string, number>
  allocation_after: Record<string, number>
  goal_probability_current: number | null
  goal_probability_prescribed: number | null
  target_weights: Weights
}

export interface SpendingResult {
  monthly_spend: number
  share_of_income: number
  annual_cost: number
  five_year_opportunity_cost: number
  opportunity_text: string
  risk_level: string
  surplus_with: number
  surplus_without: number
  ef_rebuild_months_with: number | null
  ef_rebuild_months_without: number | null
  goal_probability_with: number | null
  goal_probability_halved: number | null
  goal_probability_redirected: number | null
  ending_p50_with: number
  ending_p50_redirected: number
  alerts: string[]
  budget_adjustment: { month: string; action: string }[]
  scope_note: string
  support_note: string
}

export interface Opinion {
  agent: 'Bull' | 'Bear' | 'Risk' | 'Goal' | 'Compliance'
  role: string
  stance: 'support' | 'conditional' | 'oppose'
  confidence: number
  key_concern: string
  reasoning: string[]
  decision: string
}
export interface RedTeamTest {
  key: string
  name: string
  critical: boolean
  status: 'PASS' | 'WARN' | 'FAIL'
  metric: number
  threshold: number
  detail: string
  question?: string
  severity?: 'High' | 'Medium' | 'Low' | 'None'
}
export interface Weakness {
  test: string
  name: string
  question?: string
  status: string
  severity?: 'High' | 'Medium' | 'Low'
  critical: boolean
  detail: string
}
export interface Fragile {
  test: string
  name: string
  question: string
  detail: string
}
export interface CommitteeDecision {
  verdict: string
  score: number
  votes: Record<string, string>
  summary: string
  conditions: string[]
  unresolved_concerns?: string[]
  major_arguments?: string[]
  confidence?: number
  compliance_veto?: boolean
}
export interface PlanHealth {
  goal_success_probability: number | null
  financial_resilience: number
  debt_stress_score: number
  debt_stress_band: string
  foir: number
  emergency_fund_months: number
  crash_loss: number
  ending_p50: number
  /** Added with Atlas; absent on decisions stored before it. */
  monthly_left_after_plan?: number
  monthly_sip?: number
  loan_emi?: number
  equity?: number
}
export interface Round {
  round: number
  plan: Plan
  goal_probability: number | null
  ending_p50: number
  red_team: { tests: RedTeamTest[]; red_team_score: number; weaknesses: Weakness[]; headline: string; most_fragile?: Fragile }
  committee: CommitteeDecision
  opinions: Opinion[]
  debate: { speaker: string; to: string | null; text: string; stance: string }[]
  critic: { verdict: 'ACCEPT' | 'REJECT'; forced: boolean; reasons: string[]; outcome?: string }
}
export interface NodeEvent {
  node: string
  label?: string
  status: 'running' | 'done' | 'failed'
  ts?: string
  summary: string
  payload: Record<string, unknown>
  duration_ms?: number
}
export interface DecisionResult {
  decision_id: string
  decision_type: string
  command: string
  params: Record<string, unknown>
  route_reason: string
  profile: Profile
  twin: Snapshot
  goal_context: GoalContext
  goal_brief: string
  risk_dna: RiskDNA
  market_data: Record<string, number | string>
  loan_analysis?: LoanResult
  spending_analysis?: SpendingResult
  goal_survival?: Omit<GoalSurvival, 'simulation'>
  crisis_results?: CrisisResult
  portfolio_health?: Record<string, unknown>
  simulation_results: Simulation
  plan_history: Plan[]
  reoptimization?: { changes: string[]; note: string; searched: number; feasible: number }
  agent_opinions: Opinion[]
  compliance: {
    status: string
    checks: { rule: string; title: string; passed: boolean; detail: string; source: string }[]
    citations: { id: string; title: string; text: string; source: string }[]
  }
  debate: Round['debate']
  committee_decision: Round['committee']
  rounds: Round[]
  critic: Round['critic']
  recommendation_plan: Plan
  recommendation: {
    status: string
    plan: Plan
    goal_probability: number | null
    confidence: { score: number; label: string; basis: string; signals?: Record<string, number> }
    red_team_score: number
    headline: string
    action: string
  }
  counterfactual: {
    chosen: CfRow
    higher_risk: CfRow
    lower_risk: CfRow
    sensitivity: { assumption: string; goal_probability: number; impact: number }[]
  }
  explanation: {
    headline: string
    action: string
    summary: string
    llm_used: boolean
    why_this: string[]
    why_not_that: { option: string; text: string }[]
    constraints_that_changed_it: string[]
    key_assumptions: string[]
    risks: string[]
    old_vs_new: { changed: boolean; before: Plan; after: Plan }
    verdict?: string
    major_changes?: string[]
    what_could_fail?: string[]
    red_team_found?: Weakness[]
    red_team_found_count?: number
    most_fragile?: Fragile | null
    why_critic_approved?: string[]
    comparison?: { before: PlanHealth; after: PlanHealth }
  }
  trust: Trust
  audit_trail: { node_name: string; label: string; status: string; message: string; timestamp: string; duration_ms: number }[]
}
export interface CfRow {
  plan: Plan
  goal_success_probability: number | null
  ending_p5: number
  ending_p50: number
  crash_loss: number
  max_drawdown_p95: number
  forced_liquidation_probability: number
}
export interface Trust {
  data_sources: { name: string; detail: string; kind: string }[]
  market: MarketStats
  simulation_runs: number
  simulated_paths: number
  paths_per_run: number
  agents_used: string[]
  critic_review: { verdict: string; rounds: number; forced: boolean }
  compliance_status: string
  compliance_checks: DecisionResult['compliance']['checks']
  citations: DecisionResult['compliance']['citations']
  confidence: { score: number; label: string; basis: string; signals?: Record<string, number> }
  limitations: string[]
  llm_used: boolean
}
export interface MarketStats {
  equity: { source: string; period: string; months: number; cagr_pct: number; vol_pct: number; worst_month_pct: number; worst_12m_pct: number; max_drawdown_pct: number }
  debt: { source: string; cagr_pct: number }
  gold: { source: string; mean_pct: number; vol_pct: number; equity_correlation: number }
  cash: { source: string; rate_pct: number }
  inflation: { source: string; mean_pct: number; sd_pct: number }
  regime: { label: string; trailing_12m_vol_pct: number; percentile_vs_history: number; as_of: string; vol_scale: number }
}
export interface DecisionSummary {
  decision_id: string
  type: string
  status: string
  command: string
  created_at: string
  verdict: string | null
  headline: string | null
  goal_probability: number | null
  confidence: number | null
  risk_level?: string | null
  verdict_label?: string | null
}
export interface DecisionEnvelope {
  decision_id: string
  type: string
  status: 'running' | 'completed' | 'failed'
  command: string
  created_at: string
  error: string | null
  result: DecisionResult | null
  events: NodeEvent[] | null
  /** SSE URL; carries a short-lived ticket for signed-in owners (EventSource cannot send headers). */
  stream_url?: string
}
export interface AuditResponse {
  decision_id: string
  type: string
  status: string
  command: string
  created_at: string
  audit_trail: { seq: number; node_name: string; status: string; message: string; duration_ms: number; timestamp: string }[]
  agent_logs: { round: number; agent: string; stance: string; decision: string; reasoning: string; timestamp: string }[]
}

export interface DashboardData {
  goals: {
    name: string
    goal_type: string
    priority: string
    target: number
    current: number
    remaining: number
    years: number
    deadline: string
    probability: number | null
    primary: boolean
    basis: string
  }[]
  portfolio: {
    total_value: number
    investable_value: number
    health_score: number
    sub_scores: Record<string, number>
    by_class: Record<string, number>
    largest_class: string
    largest_share: number
    portfolio_vol_pct: number
    target_vol_pct: number
    equity_share: number
    target_equity: number
  } | null
  plan: Plan
  atlas?: AtlasBrief
}

export interface NewsItem {
  id: string
  title: string
  link: string | null
  source: string
  source_url: string | null
  published: string | null
  summary: string
  demo: boolean
  categories: string[]
  primary_category: string
  relevance: 'high' | 'medium' | 'low'
  relevance_score: number
  impact: {
    domains: ('loans' | 'goals' | 'portfolio' | 'liquidity' | 'inflation')[]
    why: string
    simulators: { label: string; path: string }[]
  }
}

export interface NewsResponse {
  mode: 'live' | 'offline'
  fetched_at: string
  sources: { name: string; url: string; ok: boolean; error?: string; count: number }[]
  categories: Record<string, number>
  items: NewsItem[]
  note: string
  cached: boolean
  refresh_throttled: boolean
  retry_after: number
  disclaimer: string
}

// ---------- Atlas (engines/atlas.py via POST /api/atlas/brief and /api/dashboard) ----------
export type AtlasSource = 'user' | 'calculated' | 'historical' | 'assumption' | 'simulated'
export interface AtlasPillar {
  key: 'liquidity' | 'debt' | 'goals' | 'growth' | 'resilience'
  score: number | null
  weight: number
  source: AtlasSource
  basis: Record<string, number | string | null>
}
export interface AtlasFinding {
  code: string
  severity: 'red' | 'amber' | 'blue'
  route: string
  pillar: AtlasPillar['key'] | null
  params: Record<string, number | string>
}
export interface AtlasBrief {
  health_index: { score: number; band: 'STRONG' | 'STABLE' | 'STRETCHED' | 'FRAGILE'; pillars: AtlasPillar[]; renormalised: boolean; formula: string }
  recommendation: AtlasFinding
  findings: AtlasFinding[]
  strengths: AtlasPillar[]
  progress: { twin: boolean; risk: boolean; goals: boolean; portfolio: boolean }
}

export interface ReoptimizeSide {
  plan: Plan
  health: PlanHealth
  red_team_score: number
  weaknesses: Weakness[]
}
export interface ReoptimizeResult {
  decision_id: string
  critic_reasons: string[]
  changes: string[]
  note: string
  searched: number
  feasible: number
  original: ReoptimizeSide
  optimized: ReoptimizeSide
}
export interface RedTeamAttack {
  headline: string
  red_team_score: number
  weaknesses: Weakness[]
  tests: RedTeamTest[]
  most_fragile?: Fragile
}
