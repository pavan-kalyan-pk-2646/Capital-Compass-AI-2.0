/**
 * Goal Survival Theatre — the world model.
 *
 * Pure functions that turn the /api/goals/survival response (with `theatre: true`) into the
 * shapes the 3D stations draw. Nothing here makes up a financial number: every value is read
 * from the response or is plain arithmetic on it (e.g. a difference of two returned
 * probabilities), and each derived value says what it was derived from.
 */
import type { GoalSurvival, GoalTheatreData, RiskDimension, TheatreScenario } from '@/services/types'

export type ScenarioKey = TheatreScenario['scenario']
export type Outcome = 'success' | 'borderline' | 'fail'

/**
 * World layout: the survival core sits at the centre; the other stations stand on a ring around
 * it, each turned to face the centre. Cameras stand between the centre and a station and look
 * outward, so nothing from another station clutters the background.
 */
export interface Station {
  x: number
  z: number
  /** rotation about y so the station's local +z faces the centre */
  yaw: number
}
const R = 58
const ring = (deg: number, r = R): Station => {
  const t = (deg * Math.PI) / 180
  const x = Math.cos(t) * r
  const z = Math.sin(t) * r
  return { x, z, yaw: Math.atan2(-x, -z) }
}
export const STATIONS = {
  core: { x: 0, z: 0, yaw: 0 },
  universe: ring(-90),
  mountain: ring(-90, R + 24),
  terrain: ring(-30),
  risk: ring(30),
  decision: ring(90),
  // in front of the decision worlds and drawn lower, so in the Decision view it reads beneath them
  timeline: ring(90, R - 14),
  towers: ring(150),
} satisfies Record<string, Station>
export type StationKey = keyof typeof STATIONS

/** The core is viewed from this bearing on the ring (no station behind it) and turned to face that camera. */
export const CORE_VIEW = (30 * Math.PI) / 180
export const CORE_YAW = Math.atan2(Math.cos(CORE_VIEW), Math.sin(CORE_VIEW))

/** A point given in a station's local frame, in world coordinates. */
export function toWorld(st: Station, x: number, y: number, z: number): [number, number, number] {
  const c = Math.cos(st.yaw)
  const s = Math.sin(st.yaw)
  return [st.x + x * c + z * s, y, st.z - x * s + z * c]
}

/** Time (months) → world x within a station, and wealth → height, shared by every station. */
export interface Scale {
  months: number
  width: number
  height: number
  maxWealth: number
  x: (month: number) => number
  y: (wealth: number) => number
}

export function makeScale(th: GoalTheatreData, width = 30, height = 12): Scale {
  // the tallest thing any station draws: P95 of every scenario, the targets, the optimized run
  let max = th.target
  for (const s of th.scenarios) {
    max = Math.max(max, s.target, ...s.percentiles.p95)
  }
  if (th.optimized) max = Math.max(max, ...th.optimized.percentiles.p95)
  max *= 1.08
  return {
    months: th.months,
    width,
    height,
    maxWealth: max,
    x: (m) => (m / th.months - 0.5) * width,
    y: (w) => (Math.max(0, w) / max) * height,
  }
}

/** The decision timeline is drawn lower than the other stations (same wealth axis, compressed). */
export const timelineScale = (th: GoalTheatreData): Scale => makeScale(th, 28, 4.5)

/** A path's outcome against the target: reached it, within 10% of it, or further short. */
export function outcomeOf(ending: number, target: number): Outcome {
  if (ending >= target) return 'success'
  if (ending >= target * 0.9) return 'borderline'
  return 'fail'
}

export const scenarioBy = (th: GoalTheatreData, key: ScenarioKey): TheatreScenario => th.scenarios.find((s) => s.scenario === key) ?? th.scenarios[0]!

export const toneOf = (p: number | null | undefined): 'green' | 'amber' | 'red' | 'blue' => (p == null ? 'blue' : p >= 0.75 ? 'green' : p >= 0.5 ? 'amber' : 'red')

/** Percentile value at (or nearest to) a given month. */
export function atMonth(series: number[], months: number[], m: number): number {
  let best = 0
  for (let i = 1; i < months.length; i++) if (Math.abs(months[i]! - m) < Math.abs(months[best]! - m)) best = i
  return series[best]!
}

// ---------------------------------------------------------------- constellation
export interface StateNode {
  id: 'start' | 'midpoint' | 'approach' | 'achieved' | 'failure' | 'crash' | 'recovery'
  value: number | null
  /** What the number is, for the label. */
  kind: 'wealth' | 'probability' | 'months' | 'drawdown'
  extra?: number | null
}

/** Financial states that the simulation actually reports; nothing is added for decoration. */
export function constellation(th: GoalTheatreData, sc: TheatreScenario): { nodes: StateNode[]; edges: [StateNode['id'], StateNode['id']][] } {
  const p = sc.percentiles
  const crash = scenarioBy(th, 'crash')
  const nodes: StateNode[] = [
    { id: 'start', value: th.start_corpus, kind: 'wealth' },
    { id: 'midpoint', value: atMonth(p.p50, p.month, th.months / 2), kind: 'wealth' },
    { id: 'approach', value: atMonth(p.p50, p.month, th.months * 0.8), kind: 'wealth' },
    { id: 'achieved', value: sc.success_probability, kind: 'probability' },
    { id: 'failure', value: sc.success_probability == null ? null : 1 - sc.success_probability, kind: 'probability', extra: sc.shortfall_median },
    { id: 'crash', value: crash.max_drawdown.p95, kind: 'drawdown', extra: crash.success_probability },
  ]
  const edges: [StateNode['id'], StateNode['id']][] = [
    ['start', 'midpoint'],
    ['midpoint', 'approach'],
    ['approach', 'achieved'],
    ['approach', 'failure'],
    ['start', 'crash'],
  ]
  if (crash.recovery_months_median != null) {
    nodes.push({ id: 'recovery', value: crash.recovery_months_median, kind: 'months' })
    edges.push(['crash', 'recovery'], ['recovery', 'approach'])
  } else edges.push(['crash', 'approach'])
  return { nodes, edges }
}

// ---------------------------------------------------------------- timeline
export interface Gate {
  month: number
  p50: number
  p5: number
  /** What has been put in by then: today's corpus plus the monthly SIP (arithmetic on inputs). */
  contributed: number
  distance: number
  /** P5 below what was put in: in the worst 5% of futures the money is worth less than invested. */
  lossRisk: boolean
}

export function timeline(gs: GoalSurvival, sc: TheatreScenario): Gate[] {
  const p = sc.percentiles
  const months = gs.months
  const years = Math.floor(months / 12)
  // today, each year (at most 8 gates in between), and the goal month
  const step = Math.max(1, Math.ceil(years / 8))
  const ms = [0]
  for (let y = step; y * 12 < months; y += step) ms.push(y * 12)
  ms.push(months)
  return ms.map((m) => {
    const p50 = atMonth(p.p50, p.month, m)
    const p5 = atMonth(p.p5, p.month, m)
    const contributed = gs.start_corpus + gs.current_monthly_sip * m
    return { month: m, p50, p5, contributed, distance: sc.target - p50, lossRisk: m > 0 && p5 < contributed }
  })
}

// ---------------------------------------------------------------- risk topology
export interface RiskPeak {
  key: 'market' | 'income' | 'inflation' | 'debt' | 'liquidity' | 'goal'
  /** 0–100: how hard this risk presses on the goal. */
  pressure: number
  basis: 'drop' | 'forced' | 'dna'
  /** For 'drop': percentage points of goal survival lost under that shock. */
  points?: number
}

/**
 * Six risk peaks, each measured, never scored by hand:
 *  market / income / inflation / debt — the fall in goal survival (percentage points) when the
 *    crash, job-loss, inflation and rate shocks are applied to the same 10,000 futures;
 *  liquidity — share of futures forced to sell investments in the crash + job-loss world;
 *  goal pressure — the Risk DNA "Goal Pressure" dimension.
 */
export function riskPeaks(th: GoalTheatreData, dna: RiskDimension[]): RiskPeak[] {
  const base = scenarioBy(th, 'normal').success_probability ?? 0
  const drop = (k: ScenarioKey) => Math.max(0, base - (scenarioBy(th, k).success_probability ?? 0)) * 100
  const goal = dna.find((d) => d.key === 'goal_pressure')
  const peaks: RiskPeak[] = [
    { key: 'market', pressure: drop('crash'), basis: 'drop', points: drop('crash') },
    { key: 'income', pressure: drop('job_loss'), basis: 'drop', points: drop('job_loss') },
    { key: 'inflation', pressure: drop('inflation'), basis: 'drop', points: drop('inflation') },
    { key: 'debt', pressure: drop('rate_shock'), basis: 'drop', points: drop('rate_shock') },
    { key: 'liquidity', pressure: scenarioBy(th, 'crash_job_loss').forced_liquidation_probability * 100, basis: 'forced' },
  ]
  if (goal) peaks.push({ key: 'goal', pressure: goal.score, basis: 'dna' })
  return peaks
}
