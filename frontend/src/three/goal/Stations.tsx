/**
 * The remaining stations of the Goal Survival Theatre. Every size, height and fraction below is
 * a value from the API response (or a difference of two such values); see `model.ts`.
 */
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import type { GoalTheatreData, Percentiles, RiskDimension, TheatreScenario } from '@/services/types'
import { toneOf, type Gate, type RiskPeak, type Scale, type ScenarioKey, type StateNode } from '@/three/goal/model'

const TONE: Record<string, string> = { green: '#3ccb8f', amber: '#e8a33d', red: '#f0566a', blue: '#6fa8ff' }
export const TOWER_GAP = 4.4
export const TOWER_H = 10

// ---------------------------------------------------------------- C. scenario towers
export function towerX(i: number, n: number) {
  return (i - (n - 1) / 2) * TOWER_GAP
}

export function Towers({
  scenarios,
  selected,
  hovered,
  onSelect,
  onHover,
}: {
  scenarios: TheatreScenario[]
  selected: ScenarioKey
  hovered: ScenarioKey | null
  onSelect: (k: ScenarioKey) => void
  onHover: (k: ScenarioKey | null) => void
}) {
  return (
    <group>
      {scenarios.map((s, i) => (
        <Tower key={s.scenario} s={s} x={towerX(i, scenarios.length)} active={s.scenario === selected} hot={s.scenario === hovered} onSelect={onSelect} onHover={onHover} />
      ))}
      <mesh position={[0, -0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[scenarios.length * TOWER_GAP + 4, 9]} />
        <meshStandardMaterial color="#0a0d14" metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  )
}

function Tower({ s, x, active, hot, onSelect, onHover }: { s: TheatreScenario; x: number; active: boolean; hot: boolean; onSelect: (k: ScenarioKey) => void; onHover: (k: ScenarioKey | null) => void }) {
  const p = s.success_probability ?? 0
  const h = Math.max(0.15, p * TOWER_H)
  const color = TONE[toneOf(s.success_probability)]!
  const g = useRef<THREE.Group>(null)
  const mat = useRef<THREE.MeshStandardMaterial>(null)
  useFrame((_, dt) => {
    if (g.current) g.current.position.y += ((active ? 0.6 : hot ? 0.3 : 0) - g.current.position.y) * Math.min(1, dt * 6)
    if (mat.current) mat.current.emissiveIntensity += ((active ? 0.55 : hot ? 0.35 : 0.12) - mat.current.emissiveIntensity) * Math.min(1, dt * 6)
  })
  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    onHover(s.scenario)
    document.body.style.cursor = 'pointer'
  }
  return (
    <group position={[x, 0, 0]}>
      {/* plinth: the full-height glass shows 100% survival for reference */}
      <mesh position={[0, TOWER_H / 2, 0]}>
        <boxGeometry args={[2.3, TOWER_H, 2.3]} />
        <meshPhysicalMaterial color="#9fb3d1" transparent opacity={0.05} roughness={0.1} metalness={0} depthWrite={false} />
      </mesh>
      <group ref={g}>
        <mesh
          position={[0, h / 2, 0]}
          onPointerOver={over}
          onPointerOut={() => {
            onHover(null)
            document.body.style.cursor = ''
          }}
          onClick={(e) => {
            e.stopPropagation()
            if (e.delta < 6) onSelect(s.scenario)
          }}
        >
          <boxGeometry args={[2, h, 2]} />
          <meshStandardMaterial ref={mat} color={color} emissive={color} emissiveIntensity={0.12} metalness={0.75} roughness={0.32} />
        </mesh>
        <mesh position={[0, h + 0.03, 0]}>
          <boxGeometry args={[2.05, 0.05, 2.05]} />
          <meshBasicMaterial color={active ? '#fff3d6' : color} toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}

// ---------------------------------------------------------------- I. survival core + K. resilience ring
export function Core({ probability, dna, reduced }: { probability: number | null; dna: RiskDimension[]; reduced: boolean }) {
  const p = probability ?? 0
  const color = TONE[toneOf(probability)]!
  const ringA = useRef<THREE.Mesh>(null)
  const ringB = useRef<THREE.Mesh>(null)
  const sphere = useRef<THREE.Mesh>(null)
  // instability grows as survival falls below 75%: gimbals tilt and wander; above it they align
  const instability = Math.max(0, 0.75 - p) / 0.75
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime
    const wob = reduced ? 0 : instability
    if (ringA.current) {
      ringA.current.rotation.x = Math.PI / 2 + 0.5 * wob + 0.12 * wob * Math.sin(t * 1.3)
      ringA.current.rotation.z += dt * 0.15
    }
    if (ringB.current) {
      ringB.current.rotation.y = 0.6 * wob + 0.15 * wob * Math.sin(t * 0.9 + 1)
      ringB.current.rotation.z -= dt * 0.1
    }
    if (sphere.current) sphere.current.position.y = 4.2 + (reduced ? 0 : (1 - instability) * 0.15 * Math.sin(t * 0.8))
  })
  const arc = useMemo(() => new THREE.TorusGeometry(4.4, 0.2, 16, 160, Math.max(0.0001, p * Math.PI * 2)), [p])
  useEffect(() => () => arc.dispose(), [arc])
  return (
    <group>
      {/* pedestal */}
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[3.6, 4.2, 0.8, 64]} />
        <meshStandardMaterial color="#11151d" metalness={0.85} roughness={0.35} />
      </mesh>
      <mesh ref={sphere} position={[0, 4.2, 0]}>
        <sphereGeometry args={[1.9, 64, 48]} />
        <meshPhysicalMaterial color="#1b2230" metalness={1} roughness={0.22} clearcoat={1} clearcoatRoughness={0.1} emissive={color} emissiveIntensity={0.08 + 0.25 * p} />
      </mesh>
      <mesh ref={ringA} position={[0, 4.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.7, 0.07, 12, 120]} />
        <meshStandardMaterial color="#c9a24a" metalness={1} roughness={0.25} />
      </mesh>
      <mesh ref={ringB} position={[0, 4.2, 0]}>
        <torusGeometry args={[3.2, 0.06, 12, 120]} />
        <meshStandardMaterial color="#8a6d2c" metalness={1} roughness={0.3} />
      </mesh>
      {/* the survival arc: exactly the returned probability of a full circle */}
      <group position={[0, 4.2, 0]} rotation={[0, 0, Math.PI / 2]}>
        <mesh>
          <torusGeometry args={[4.4, 0.05, 8, 160]} />
          <meshBasicMaterial color="#2a3242" />
        </mesh>
        <mesh geometry={arc} rotation={[0, 0, 0]}>
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} metalness={0.5} roughness={0.3} toneMapped={false} />
        </mesh>
      </group>
      <ResilienceRing dna={dna} />
    </group>
  )
}

export const RING_R = 8

export function ringAngle(i: number, n: number) {
  return (i / n) * Math.PI * 2 + Math.PI / 2
}

/** Risk DNA dimensions as a mechanical ring of blocks around the core; height = the score. */
function ResilienceRing({ dna }: { dna: RiskDimension[] }) {
  const ring = useRef<THREE.Group>(null)
  return (
    <group ref={ring}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[RING_R - 1.1, RING_R + 1.1, 96]} />
        <meshStandardMaterial color="#0d1119" metalness={0.8} roughness={0.4} side={THREE.DoubleSide} />
      </mesh>
      {dna.map((d, i) => {
        const a = ringAngle(i, dna.length)
        const h = Math.max(0.12, (d.score / 100) * 4)
        return (
          <group key={d.key} position={[Math.cos(a) * RING_R, 0, Math.sin(a) * RING_R]} rotation={[0, -a, 0]}>
            <mesh position={[0, h / 2 + 0.05, 0]}>
              <boxGeometry args={[0.7, h, 1.4]} />
              <meshStandardMaterial color="#c9a24a" metalness={0.9} roughness={0.3} emissive="#3a2a08" emissiveIntensity={0.3} />
            </mesh>
            <mesh position={[0, 2.05, 0]}>
              <boxGeometry args={[0.72, 4, 1.42]} />
              <meshBasicMaterial color="#5fd4e6" wireframe transparent opacity={0.07} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

// ---------------------------------------------------------------- E. goal distance engine
export const ENGINE_X = 14

export function GoalEngine({ scale, start, p50, target }: { scale: Scale; start: number; p50: number; target: number }) {
  const top = scale.y(target)
  const fill = scale.y(Math.min(p50, scale.maxWealth))
  return (
    <group position={[ENGINE_X, 0, 0]}>
      <mesh position={[0, top / 2, 0]}>
        <cylinderGeometry args={[1.1, 1.1, top, 48, 1, true]} />
        <meshPhysicalMaterial color="#9fb3d1" transparent opacity={0.08} roughness={0.05} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[0, fill / 2, 0]}>
        <cylinderGeometry args={[0.85, 0.85, Math.max(0.05, fill), 48]} />
        <meshStandardMaterial color={p50 >= target ? '#3ccb8f' : '#c9a24a'} metalness={0.8} roughness={0.3} emissive={p50 >= target ? '#0e3a28' : '#3a2a08'} emissiveIntensity={0.5} />
      </mesh>
      {[
        { w: start, c: '#6fa8ff' },
        { w: p50, c: '#e3c37a' },
        { w: target, c: '#ffffff' },
      ].map((r) => (
        <mesh key={r.c} position={[0, scale.y(Math.min(r.w, scale.maxWealth)), 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.35, 0.06, 10, 64]} />
          <meshBasicMaterial color={r.c} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- D. constellation
export const NODE_POS: Record<StateNode['id'], [number, number, number]> = {
  start: [-15, 11, -6],
  midpoint: [-9, 14, -9],
  approach: [-2, 16, -10],
  achieved: [6, 18, -8],
  failure: [7, 12, -6],
  crash: [-15, 6, -2],
  recovery: [-9, 8.5, -4],
}

export function Constellation({ nodes, edges, reduced }: { nodes: StateNode[]; edges: [StateNode['id'], StateNode['id']][]; reduced: boolean }) {
  const lines = useMemo(() => {
    const pts: number[] = []
    for (const [a, b] of edges) pts.push(...NODE_POS[a], ...NODE_POS[b])
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [edges])
  useEffect(() => () => lines.dispose(), [lines])
  const pulses = useRef<THREE.InstancedMesh>(null)
  const m = useMemo(() => new THREE.Matrix4(), [])
  const va = useMemo(() => new THREE.Vector3(), [])
  const vb = useMemo(() => new THREE.Vector3(), [])
  // one light travels along each edge in the direction the financial state evolves
  useFrame(({ clock }) => {
    if (!pulses.current) return
    const t = reduced ? 0.5 : (clock.elapsedTime * 0.35) % 1
    edges.forEach(([a, b], i) => {
      va.fromArray(NODE_POS[a])
      vb.fromArray(NODE_POS[b])
      va.lerp(vb, (t + i * 0.13) % 1)
      m.makeTranslation(va.x, va.y, va.z)
      pulses.current!.setMatrixAt(i, m)
    })
    pulses.current.instanceMatrix.needsUpdate = true
  })
  return (
    <group>
      <lineSegments geometry={lines}>
        <lineBasicMaterial color="#5fd4e6" transparent opacity={0.35} />
      </lineSegments>
      <instancedMesh ref={pulses} args={[undefined, undefined, edges.length]}>
        <sphereGeometry args={[0.12, 10, 8]} />
        <meshBasicMaterial color="#bdf3ff" toneMapped={false} />
      </instancedMesh>
      {nodes.map((n) => {
        const tone = n.id === 'achieved' ? '#3ccb8f' : n.id === 'failure' ? '#f0566a' : n.id === 'crash' ? '#e8a33d' : n.id === 'recovery' ? '#6fa8ff' : '#e3c37a'
        // outcome nodes are sized by their probability; the others are fixed waypoints
        const r = n.kind === 'probability' && n.value != null ? 0.3 + 0.9 * n.value : 0.42
        return (
          <mesh key={n.id} position={NODE_POS[n.id]}>
            <icosahedronGeometry args={[r, 2]} />
            <meshStandardMaterial color={tone} emissive={tone} emissiveIntensity={0.55} metalness={0.6} roughness={0.25} />
          </mesh>
        )
      })}
    </group>
  )
}

// ---------------------------------------------------------------- J. timeline
export const TIMELINE_W = 28

export function gateX(i: number, n: number) {
  return n > 1 ? (i / (n - 1) - 0.5) * TIMELINE_W : 0
}

export function Timeline({ scale, gates, target }: { scale: Scale; gates: Gate[]; target: number }) {
  const curve = useMemo(() => {
    const pts = gates.map((g, i) => new THREE.Vector3(gateX(i, gates.length), scale.y(g.p50), 0))
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.08, 8, false)
  }, [gates, scale])
  useEffect(() => () => curve.dispose(), [curve])
  return (
    <group>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[TIMELINE_W + 6, 3]} />
        <meshStandardMaterial color="#0b0e15" metalness={0.7} roughness={0.4} />
      </mesh>
      <mesh geometry={curve}>
        <meshStandardMaterial color="#e3c37a" emissive="#5a4310" emissiveIntensity={0.6} metalness={0.8} roughness={0.25} />
      </mesh>
      {/* the goal height, held across the whole timeline */}
      <mesh position={[0, scale.y(target), 0]}>
        <boxGeometry args={[TIMELINE_W + 2, 0.04, 0.04]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.5} />
      </mesh>
      {gates.map((g, i) => {
        const x = gateX(i, gates.length)
        const h = scale.y(g.p50)
        const c = g.lossRisk ? '#e8a33d' : i === gates.length - 1 && g.p50 >= target ? '#3ccb8f' : '#6fa8ff'
        return (
          <group key={g.month} position={[x, 0, 0]}>
            <mesh position={[0, h / 2, 0]}>
              <boxGeometry args={[0.18, h, 0.18]} />
              <meshStandardMaterial color="#2a3242" metalness={0.9} roughness={0.3} />
            </mesh>
            <mesh position={[0, scale.y(g.contributed), 0]}>
              <boxGeometry args={[0.9, 0.05, 0.9]} />
              <meshBasicMaterial color="#6fa8ff" transparent opacity={0.8} />
            </mesh>
            <mesh position={[0, h, 0]}>
              <octahedronGeometry args={[0.38]} />
              <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.6} metalness={0.5} roughness={0.3} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

// ---------------------------------------------------------------- G. risk topology
export const PEAK_R = 6.5

export function peakXZ(i: number, n: number): [number, number] {
  const a = (i / n) * Math.PI * 2 - Math.PI / 2
  return [Math.cos(a) * PEAK_R, Math.sin(a) * PEAK_R]
}

export function RiskTopology({ peaks }: { peaks: RiskPeak[] }) {
  const geo = useMemo(() => {
    const size = 24
    const g = new THREE.PlaneGeometry(size, size, 96, 96)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position as THREE.BufferAttribute
    const col = new Float32Array(pos.count * 3)
    const lo = new THREE.Color('#14304d')
    const mid = new THREE.Color('#e8a33d')
    const hi = new THREE.Color('#f0566a')
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      let h = 0
      peaks.forEach((pk, j) => {
        const [px, pz] = peakXZ(j, peaks.length)
        const d2 = (x - px) ** 2 + (z - pz) ** 2
        h += (pk.pressure / 100) * 7 * Math.exp(-d2 / 6)
      })
      pos.setY(i, h)
      // calm navy → amber → red as the pressure rises
      const k = Math.min(1, h / 5)
      if (k < 0.5) c.copy(lo).lerp(mid, k * 2)
      else c.copy(mid).lerp(hi, (k - 0.5) * 2)
      col.set([c.r, c.g, c.b], i * 3)
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.computeVertexNormals()
    return g
  }, [peaks])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <group>
      <mesh geometry={geo}>
        <meshStandardMaterial vertexColors metalness={0.3} roughness={0.55} />
      </mesh>
      <mesh geometry={geo} position={[0, 0.01, 0]}>
        <meshBasicMaterial color="#5fd4e6" wireframe transparent opacity={0.06} />
      </mesh>
    </group>
  )
}

export function peakHeight(p: RiskPeak) {
  return (p.pressure / 100) * 7
}

// ---------------------------------------------------------------- L. before → after
export const WORLD_GAP = 8

export function DecisionWorlds({ scale, current, optimized }: { scale: Scale; current: Percentiles; optimized: GoalTheatreData['optimized'] }) {
  return (
    <group>
      <Fan scale={scale} p={current} x={-WORLD_GAP} tone="#c9a24a" />
      {optimized ? <Fan scale={scale} p={optimized.percentiles} x={WORLD_GAP} tone="#3ccb8f" /> : <Pedestal x={WORLD_GAP} dim />}
    </group>
  )
}

function Pedestal({ x, dim }: { x: number; dim?: boolean }) {
  return (
    <mesh position={[x, -0.2, 0]}>
      <cylinderGeometry args={[7.4, 7.8, 0.4, 64]} />
      <meshStandardMaterial color={dim ? '#0b0e14' : '#10141c'} metalness={0.85} roughness={0.35} />
    </mesh>
  )
}

/** A compact future world: the P5–P95 band as a translucent ribbon and the median as a gold line. */
function Fan({ scale, p, x, tone }: { scale: Scale; p: Percentiles; x: number; tone: string }) {
  const w = 12
  const xs = useMemo(() => p.month.map((m) => (m / (p.month[p.month.length - 1] || 1) - 0.5) * w), [p])
  const band = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(xs[0]!, scale.y(p.p5[0]!))
    p.p95.forEach((v, i) => s.lineTo(xs[i]!, scale.y(v)))
    for (let i = p.p5.length - 1; i >= 0; i--) s.lineTo(xs[i]!, scale.y(p.p5[i]!))
    s.closePath()
    return new THREE.ExtrudeGeometry(s, { depth: 1.6, bevelEnabled: false })
  }, [p, scale, xs])
  const inner = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(xs[0]!, scale.y(p.p25[0]!))
    p.p75.forEach((v, i) => s.lineTo(xs[i]!, scale.y(v)))
    for (let i = p.p25.length - 1; i >= 0; i--) s.lineTo(xs[i]!, scale.y(p.p25[i]!))
    s.closePath()
    return new THREE.ExtrudeGeometry(s, { depth: 1.9, bevelEnabled: false })
  }, [p, scale, xs])
  const median = useMemo(() => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(p.p50.map((v, i) => new THREE.Vector3(xs[i]!, scale.y(v), 1))), 120, 0.09, 8, false), [p, scale, xs])
  useEffect(
    () => () => {
      band.dispose()
      inner.dispose()
      median.dispose()
    },
    [band, inner, median],
  )
  return (
    <group position={[x, 0, 0]}>
      <Pedestal x={0} />
      <mesh geometry={band} position={[0, 0, -0.8]}>
        <meshStandardMaterial color={tone} transparent opacity={0.18} metalness={0.4} roughness={0.4} depthWrite={false} />
      </mesh>
      <mesh geometry={inner} position={[0, 0, -0.95]}>
        <meshStandardMaterial color={tone} transparent opacity={0.3} metalness={0.4} roughness={0.4} depthWrite={false} />
      </mesh>
      <mesh geometry={median}>
        <meshStandardMaterial color="#e3c37a" emissive="#5a4310" emissiveIntensity={0.8} metalness={0.8} roughness={0.25} />
      </mesh>
    </group>
  )
}
