/**
 * Labels for the Goal Survival Theatre. Positions use the same scale and station functions as
 * the geometry, so each label sits on the thing it describes; every value is read from the API
 * response (or a difference of two returned values), formatted for display.
 */
import * as THREE from 'three'

import type { Params } from '@/lib/i18n'
import { inr, inrShort, pct } from '@/lib/format'
import type { GoalSurvival } from '@/services/types'
import type { Anchor } from '@/three/goal/GoalTheatre'
import { TERRAIN_DEPTH, TERRAIN_PEAK, wealthZ } from '@/three/goal/Landscape'
import { constellation, CORE_YAW, makeScale, timelineScale, riskPeaks, scenarioBy, STATIONS, timeline, toneOf, toWorld, type ScenarioKey, type Station, type StationKey } from '@/three/goal/model'
import { ENGINE_X, gateX, NODE_POS, peakHeight, peakXZ, RING_R, ringAngle, TOWER_H, towerX, WORLD_GAP } from '@/three/goal/Stations'
import { DEPTH } from '@/three/goal/Universe'

type T = (key: string, params?: Params) => string
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const at = (st: Station, x: number, y: number, z: number) => V(...toWorld(st, x, y, z))
const PREFIX: Record<string, StationKey> = { u: 'universe', m: 'mountain', t: 'terrain', c: 'towers', i: 'core', k: 'core', e: 'core', d: 'core', j: 'timeline', g: 'risk', l: 'decision' }
const yr = (m: number) => (m / 12).toFixed(m % 12 ? 1 : 0)

export function buildAnchors(d: GoalSurvival, key: ScenarioKey, t: T): Anchor[] {
  const th = d.theatre
  if (!th) return []
  const scale = makeScale(th)
  const sc = scenarioBy(th, key)
  const P = sc.percentiles
  const last = P.month.length - 1
  const out: Omit<Anchor, 'station'>[] = []
  const U = STATIONS.universe

  // A — universe
  out.push({ id: 'u-title', pos: at(U, 0, scale.height + 2.2, 0), className: 'gt-title', node: <>{t('gt.universe.title', { n: th.n_paths.toLocaleString('en-IN'), shown: sc.sample_paths.length })}</> })
  out.push({ id: 'u-start', pos: at(U, scale.x(0), scale.y(th.start_corpus) + 0.4, DEPTH / 2), node: <>{t('gt.today', { v: inrShort(th.start_corpus) })}</> })
  out.push({ id: 'u-goal', pos: at(U, -scale.width / 2 - 1.5, scale.y(sc.target) + 0.4, DEPTH / 2 + 1), className: 'gt-gold', node: <>{t('gt.goal', { v: inrShort(sc.target) })}</> })
  ;(['p95', 'p75', 'p50', 'p25', 'p5'] as const).forEach((k) => {
    out.push({ id: `u-${k}`, pos: at(U, scale.width / 2 + 1.3, scale.y(P[k][last]!) + 0.3, -DEPTH / 2 - 0.6), className: `gt-p gt-${k}`, node: <>{`${k.toUpperCase()} ${inrShort(P[k][last]!)}`}</> })
  })

  // F — percentile mountain
  const M = STATIONS.mountain
  out.push({ id: 'm-title', pos: at(M, 0, scale.height + 6, 0), className: 'gt-title', node: <>{t('gt.mountain.title')}</> })

  // B — terrain
  const B = STATIONS.terrain
  if (sc.density) {
    out.push({ id: 't-title', pos: at(B, 0, TERRAIN_PEAK + 3.2, -TERRAIN_DEPTH / 2), className: 'gt-title', node: <>{t('gt.terrain.title')}</> })
    out.push({
      id: 't-wall',
      pos: at(B, scale.width / 2 + 1, TERRAIN_PEAK + 1.6, wealthZ(scale, sc.target)),
      className: 'gt-gold',
      node: <>{t('gt.terrain.wall', { pct: pct(sc.success_probability), v: inrShort(sc.target) })}</>,
    })
    out.push({ id: 't-time', pos: at(B, scale.width / 2 + 1, 0.3, TERRAIN_DEPTH / 2 + 1), className: 'gt-axis', node: <>{t('gt.axis.time', { y: yr(th.months) })}</> })
    out.push({ id: 't-wealth', pos: at(B, -scale.width / 2 - 1.5, 0.3, -TERRAIN_DEPTH / 2), className: 'gt-axis', node: <>{t('gt.axis.wealth', { v: inrShort(scale.maxWealth) })}</> })
    out.push({ id: 't-height', pos: at(B, -scale.width / 2 - 1.5, TERRAIN_PEAK, TERRAIN_DEPTH / 2), className: 'gt-axis', node: <>{t('gt.axis.density')}</> })
  }

  // C — towers
  const C = STATIONS.towers
  out.push({ id: 'c-title', pos: at(C, 0, TOWER_H + 2.6, 0), className: 'gt-title', node: <>{t('gt.towers.title')}</> })
  th.scenarios.forEach((s, i) => {
    out.push({
      id: `c-${s.scenario}`,
      pos: at(C, towerX(i, th.scenarios.length), Math.max(0.15, (s.success_probability ?? 0) * TOWER_H) + 1.1, 0),
      className: `gt-tower ${toneOf(s.success_probability)} ${s.scenario === key ? 'on' : ''}`,
      node: (
        <>
          <b>{pct(s.success_probability)}</b>
          <span>{t(`gt.sc.${s.scenario}`)}</span>
        </>
      ),
    })
  })

  // I — core, K — resilience ring, E — goal engine, D — constellation
  const I: Station = { ...STATIONS.core, yaw: CORE_YAW }
  out.push({
    id: 'i-core',
    pos: at(I, 0, 8.6, 0),
    className: `gt-core ${toneOf(sc.success_probability)}`,
    node: (
      <>
        <b>{pct(sc.success_probability, 1)}</b>
        <span>{t('gt.core.label')}</span>
        <small>{t(`gt.sc.${sc.scenario}`)}</small>
      </>
    ),
  })
  th.risk_dna.forEach((dim, i) => {
    const a = ringAngle(i, th.risk_dna.length)
    out.push({ id: `k-${dim.key}`, pos: at(I, Math.cos(a) * (RING_R + 1.9), 1.2 + (dim.score / 100) * 4, Math.sin(a) * (RING_R + 1.9)), className: 'gt-small', node: <>{`${dim.label} ${Math.round(dim.score)}`}</> })
  })
  const p50end = sc.ending.p50
  out.push({ id: 'e-goal', pos: at(I, ENGINE_X + 2.2, scale.y(sc.target), 0), className: 'gt-gold gt-left', node: <>{t('gt.goal', { v: inrShort(sc.target) })}</> })
  out.push({ id: 'e-p50', pos: at(I, ENGINE_X + 2.2, scale.y(Math.min(p50end, scale.maxWealth)), 0), className: 'gt-left', node: <>{t('gt.engine.p50', { v: inrShort(p50end) })}</> })
  out.push({ id: 'e-start', pos: at(I, ENGINE_X + 2.2, scale.y(th.start_corpus), 0), className: 'gt-left', node: <>{t('gt.today', { v: inrShort(th.start_corpus) })}</> })
  out.push({
    id: 'e-sip',
    pos: at(I, ENGINE_X, scale.y(sc.target) + 3.2, 0),
    className: 'gt-card',
    node: (
      <>
        <span>{t('gt.engine.required', { v: inr(sc.required_monthly_sip) })}</span>
        <span>{t('gt.engine.current', { v: inr(d.current_monthly_sip) })}</span>
        <span className={sc.required_monthly_sip > d.current_monthly_sip ? 'amber' : 'green'}>
          {sc.required_monthly_sip > d.current_monthly_sip ? t('gt.engine.gap', { v: inr(sc.required_monthly_sip - d.current_monthly_sip) }) : t('gt.engine.covered')}
        </span>
      </>
    ),
  })
  const graph = constellation(th, sc)
  for (const n of graph.nodes) {
    const [x, y, z] = NODE_POS[n.id]
    const val = n.value == null ? '—' : n.kind === 'wealth' ? inrShort(n.value) : n.kind === 'probability' ? pct(n.value) : n.kind === 'months' ? t('gt.months', { n: Math.round(n.value) }) : `−${pct(Math.abs(n.value))}`
    const extra = n.id === 'failure' && n.extra ? t('gt.node.gap', { v: inrShort(n.extra) }) : n.id === 'crash' && n.extra != null ? t('gt.node.crashSurvival', { pct: pct(n.extra) }) : ''
    out.push({
      id: `d-${n.id}`,
      pos: at(I, x, y + 1.3, z),
      className: `gt-node gt-node-${n.id}`,
      node: (
        <>
          <span>{t(`gt.node.${n.id}`)}</span>
          <b>{val}</b>
          {extra && <small>{extra}</small>}
        </>
      ),
    })
  }

  // J — timeline
  const J = STATIONS.timeline
  const gates = timeline(d, sc)
  const tl = timelineScale(th)
  gates.forEach((g, i) => {
    out.push({
      id: `j-${g.month}`,
      pos: at(J, gateX(i, gates.length), tl.y(g.p50) + 1.2, 0),
      className: `gt-gate ${g.lossRisk ? 'amber' : ''}`,
      node: (
        <>
          <b>{g.month === 0 ? t('gt.tl.today') : i === gates.length - 1 ? t('gt.tl.goal') : t('gt.tl.year', { n: yr(g.month) })}</b>
          <span>{t('gt.tl.wealth', { v: inrShort(g.p50) })}</span>
          {g.month > 0 && <span>{t('gt.tl.contributed', { v: inrShort(g.contributed) })}</span>}
          <span>{g.distance > 0 ? t('gt.tl.distance', { v: inrShort(g.distance) }) : t('gt.tl.reached')}</span>
          {g.lossRisk && <span className="amber">{t('gt.tl.lossRisk')}</span>}
        </>
      ),
    })
  })
  out.push({ id: 'j-title', pos: at(J, 0, -0.6, 3), className: 'gt-title', node: <>{t('gt.timeline.title')}</> })

  // G — risk topology
  const G = STATIONS.risk
  const peaks = riskPeaks(th, th.risk_dna)
  out.push({ id: 'g-title', pos: at(G, 0, 9, -9), className: 'gt-title', node: <>{t('gt.risk.title')}</> })
  peaks.forEach((pk, i) => {
    const [x, z] = peakXZ(i, peaks.length)
    const basis =
      pk.basis === 'drop'
        ? t('gt.risk.drop', { pts: (pk.points ?? 0).toFixed(1) })
        : pk.basis === 'forced'
          ? t('gt.risk.forced', { pct: `${pk.pressure.toFixed(1)}%` })
          : t('gt.risk.dna', { score: Math.round(pk.pressure) })
    out.push({
      id: `g-${pk.key}`,
      pos: at(G, x, peakHeight(pk) + 1, z),
      className: 'gt-peak',
      node: (
        <>
          <b>{t(`gt.risk.${pk.key}`)}</b>
          <span>{basis}</span>
        </>
      ),
    })
  })

  // L — before / after
  const L = STATIONS.decision
  const normal = th.scenarios[0]!
  out.push({ id: 'l-title', pos: at(L, 0, scale.height + 2.6, 0), className: 'gt-title', node: <>{t('gt.decision.title')}</> })
  out.push({
    id: 'l-now',
    pos: at(L, -WORLD_GAP, scale.y(normal.percentiles.p95[last] ?? 0) + 1.6, 0),
    className: 'gt-card',
    node: (
      <>
        <b>{t('gt.decision.current')}</b>
        <span>{t('gt.decision.sip', { v: inr(d.current_monthly_sip) })}</span>
        <span>{t('gt.decision.prob', { pct: pct(normal.success_probability) })}</span>
        <span>{t('gt.decision.ending', { v: inrShort(normal.ending.p50) })}</span>
        <span>{normal.shortfall_median ? t('gt.decision.gap', { v: inrShort(normal.shortfall_median) }) : t('gt.decision.noGap')}</span>
        <span>{t('gt.decision.risk', { pct: pct(Math.abs(normal.max_drawdown.p95)) })}</span>
      </>
    ),
  })
  const o = th.optimized
  out.push({
    id: 'l-opt',
    pos: at(L, WORLD_GAP, o ? scale.y(o.percentiles.p95[last] ?? 0) + 1.6 : 3, 0),
    className: `gt-card ${o ? 'green' : ''}`,
    node: o ? (
      <>
        <b>{t('gt.decision.optimized')}</b>
        <span>{t('gt.decision.sip', { v: inr(o.monthly_sip) })}</span>
        <span>{t('gt.decision.prob', { pct: pct(o.success_probability) })}</span>
        <span>{t('gt.decision.ending', { v: inrShort(o.ending.p50) })}</span>
        <span>{o.shortfall_median ? t('gt.decision.gap', { v: inrShort(o.shortfall_median) }) : t('gt.decision.noGap')}</span>
        <span>{t('gt.decision.risk', { pct: pct(Math.abs(o.max_drawdown.p95)) })}</span>
      </>
    ) : (
      <>
        <b>{t('gt.decision.optimized')}</b>
        <span>{t('gt.decision.none')}</span>
      </>
    ),
  })
  return out.map((a) => ({ ...a, station: PREFIX[a.id[0]!]!, title: a.id.endsWith('-title') || a.id === 'i-core' }))
}
