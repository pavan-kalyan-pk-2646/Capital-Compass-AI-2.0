/**
 * Station A — the Monte Carlo future universe.
 *
 * One LineSegments buffer holds every sampled path (time-major order, so the draw range can
 * grow all futures from "today" toward the horizon at once). x = time, y = wealth, z = the
 * path's rank by ending wealth, so the field reads as a sheet from the worst futures (front)
 * to the best (back). Colour = the path's real outcome against the scenario's target; additive
 * blending at low alpha turns overlap into visible probability density.
 * Switching scenario morphs each path to the same-ranked path of the new world.
 */
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import { outcomeOf, type Outcome, type Scale } from '@/three/goal/model'
import type { TheatreScenario } from '@/services/types'

const COL: Record<Outcome, [number, number, number, number]> = {
  success: [0.24, 0.8, 0.56, 0.3],
  borderline: [0.91, 0.64, 0.24, 0.38],
  fail: [0.94, 0.34, 0.42, 0.36],
}
export const DEPTH = 12

interface Props {
  scale: Scale
  scene: TheatreScenario
  maxPaths: number
  months: number[]
  reveal: React.MutableRefObject<number>
  reduced: boolean
  selected: number | null
  onSelect: (i: number | null) => void
}

/** Paths of a scenario sorted by ending wealth (worst first), with their original index. */
export function rankedPaths(scene: TheatreScenario) {
  return scene.sample_paths.map((p, i) => ({ p, i, end: p[p.length - 1]! })).sort((a, b) => a.end - b.end)
}

export function Universe({ scale, scene, maxPaths, months, reveal, reduced, selected, onSelect }: Props) {
  const C = months.length
  const segs = C - 1
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxPaths * segs * 2 * 3), 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(maxPaths * segs * 2 * 4), 4))
    return g
  }, [maxPaths, segs])
  const mat = useMemo(() => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.NormalBlending }), [])
  useEffect(
    () => () => {
      geo.dispose()
      mat.dispose()
    },
    [geo, mat],
  )

  // current and target heights per (path, column); morphing lerps between them
  const from = useRef<Float32Array>(new Float32Array(maxPaths * C))
  const to = useRef<Float32Array>(new Float32Array(maxPaths * C))
  const morph = useRef(1)
  const dirty = useRef(true)
  const ranked = useMemo(() => rankedPaths(scene), [scene])
  const P = ranked.length
  const zOf = (r: number) => (P > 1 ? (0.5 - r / (P - 1)) * DEPTH : 0)

  useEffect(() => {
    // start the morph from wherever the paths are now
    const cur = new Float32Array(maxPaths * C)
    const k = reduced ? 1 : Math.min(1, morph.current)
    for (let i = 0; i < cur.length; i++) cur[i] = from.current[i]! + (to.current[i]! - from.current[i]!) * k
    from.current = cur
    const next = new Float32Array(maxPaths * C)
    ranked.forEach((r, rank) => {
      for (let c = 0; c < C; c++) next[rank * C + c] = scale.y(r.p[c] ?? r.end)
    })
    to.current = next
    morph.current = reduced ? 1 : 0
    dirty.current = true
    // colours follow the new world immediately: what each future becomes there
    const col = geo.attributes.color as THREE.BufferAttribute
    const arr = col.array as Float32Array
    for (let s = 0; s < segs; s++) {
      for (let rank = 0; rank < maxPaths; rank++) {
        const o = rank < P ? COL[outcomeOf(ranked[rank]!.end, scene.target)] : null
        for (let v = 0; v < 2; v++) {
          const base = ((s * maxPaths + rank) * 2 + v) * 4
          arr[base] = o ? o[0] : 0
          arr[base + 1] = o ? o[1] : 0
          arr[base + 2] = o ? o[2] : 0
          arr[base + 3] = o ? o[3] : 0
        }
      }
    }
    col.needsUpdate = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranked, scale, scene.target])

  useFrame((_, dt) => {
    // futures grow from today toward the horizon as the result is revealed
    geo.setDrawRange(0, Math.round(segs * reveal.current) * maxPaths * 2)
    // rewrite the buffer only while paths are moving
    if (morph.current >= 1 && !dirty.current) return
    if (morph.current < 1) morph.current = Math.min(1, morph.current + dt / 1.2)
    dirty.current = morph.current < 1
    const k = morph.current < 1 ? 1 - Math.pow(1 - morph.current, 3) : 1
    const pos = geo.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const f = from.current
    const tt = to.current
    for (let s = 0; s < segs; s++) {
      const x0 = scale.x(months[s]!)
      const x1 = scale.x(months[s + 1]!)
      for (let rank = 0; rank < maxPaths; rank++) {
        const a = rank * C + s
        const y0 = f[a]! + (tt[a]! - f[a]!) * k
        const y1 = f[a + 1]! + (tt[a + 1]! - f[a + 1]!) * k
        const z = rank < P ? zOf(rank) : 0
        const base = (s * maxPaths + rank) * 6
        arr[base] = x0
        arr[base + 1] = y0
        arr[base + 2] = z
        arr[base + 3] = x1
        arr[base + 4] = y1
        arr[base + 5] = z
      }
    }
    pos.needsUpdate = true
    geo.computeBoundingSphere()
  })

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.delta > 6 || e.index == null) return
    const rank = Math.floor(e.index / 2) % maxPaths
    onSelect(rank < P ? rank : null)
  }

  return (
    <group>
      <lineSegments geometry={geo} material={mat} onClick={onClick} />
      <EndCloud scale={scale} ranked={ranked} target={scene.target} reveal={reveal} zOf={zOf} lastMonth={months[C - 1]!} />
      {selected != null && selected < P && <SelectedPath scale={scale} path={ranked[selected]!.p} months={months} z={zOf(selected)} />}
    </group>
  )
}

/** The horizon: where each sampled future ends, coloured by outcome. Clusters show density. */
function EndCloud({
  scale,
  ranked,
  target,
  reveal,
  zOf,
  lastMonth,
}: {
  scale: Scale
  ranked: ReturnType<typeof rankedPaths>
  target: number
  reveal: React.MutableRefObject<number>
  zOf: (r: number) => number
  lastMonth: number
}) {
  const pts = useRef<THREE.Points>(null)
  // the horizon lights up once every future has reached it
  useFrame(() => {
    if (pts.current) pts.current.visible = reveal.current > 0.98
  })
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(ranked.length * 3)
    const col = new Float32Array(ranked.length * 3)
    ranked.forEach((r, i) => {
      pos.set([scale.x(lastMonth) + 0.15, scale.y(r.end), zOf(i)], i * 3)
      const c = COL[outcomeOf(r.end, target)]
      col.set([c[0], c[1], c[2]], i * 3)
    })
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    return g
  }, [ranked, scale, target, zOf, lastMonth])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <points ref={pts} geometry={geo} visible={false}>
      <pointsMaterial size={0.16} vertexColors transparent opacity={0.9} depthWrite={false} sizeAttenuation />
    </points>
  )
}

function SelectedPath({ scale, path, months, z }: { scale: Scale; path: number[]; months: number[]; z: number }) {
  const geo = useMemo(() => {
    const pts = path.map((w, c) => new THREE.Vector3(scale.x(months[c]!), scale.y(w), z))
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(32, pts.length * 2), 0.06, 6, false)
  }, [path, months, scale, z])
  useEffect(() => () => geo.dispose(), [geo])
  const end = path[path.length - 1]!
  return (
    <group>
      <mesh geometry={geo}>
        <meshBasicMaterial color="#fff3d6" toneMapped={false} />
      </mesh>
      <mesh position={[scale.x(months[months.length - 1]!), scale.y(end), z]}>
        <sphereGeometry args={[0.22, 16, 12]} />
        <meshBasicMaterial color="#fff3d6" toneMapped={false} />
      </mesh>
    </group>
  )
}

/** The goal as a physical plane across the whole future field; it moves when the target moves. */
export function TargetPlane({ scale, target, width, depth }: { scale: Scale; target: number; width: number; depth: number }) {
  const ref = useRef<THREE.Group>(null)
  const want = scale.y(target)
  useFrame((_, dt) => {
    if (ref.current) ref.current.position.y += (want - ref.current.position.y) * Math.min(1, dt * 3)
  })
  const edge = useMemo(() => {
    const g = new THREE.EdgesGeometry(new THREE.PlaneGeometry(width, depth))
    return g
  }, [width, depth])
  useEffect(() => () => edge.dispose(), [edge])
  return (
    <group ref={ref} position={[0, want, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#c9a24a" emissive="#5a4310" emissiveIntensity={0.6} transparent opacity={0.13} side={THREE.DoubleSide} depthWrite={false} metalness={0.6} roughness={0.3} />
      </mesh>
      <lineSegments geometry={edge} rotation={[-Math.PI / 2, 0, 0]}>
        <lineBasicMaterial color="#e3c37a" transparent opacity={0.85} />
      </lineSegments>
    </group>
  )
}
