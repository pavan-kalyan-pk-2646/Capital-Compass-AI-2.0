/**
 * Station B — the goal terrain, and station F — the percentile mountain.
 *
 * Terrain: x = time, z = wealth (front = nothing, back = the highest band), height = the share
 * of ALL 10,000 simulated paths in that wealth band at that month (from `density`, square-root
 * scaled so thin tails stay visible). Bands at or beyond the target are green; short of it,
 * amber to red. The target is a gold wall across the terrain: everything behind it reached
 * the goal. Switching scenario morphs the surface to the new world.
 *
 * Mountain: five ridges, one per percentile series P5…P95 of the selected scenario, extruded and
 * set one behind another; the median (P50) is the gold ridge.
 */
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import type { PathDensity, Percentiles } from '@/services/types'
import type { Scale } from '@/three/goal/model'

export const TERRAIN_DEPTH = 16
export const TERRAIN_PEAK = 6

export function wealthZ(scale: Scale, w: number) {
  return (0.5 - Math.min(1, Math.max(0, w) / scale.maxWealth)) * TERRAIN_DEPTH
}

export function Terrain({ scale, density, target, reduced }: { scale: Scale; density: PathDensity; target: number; reduced: boolean }) {
  const C = density.months.length
  const B = density.share[0]?.length ?? 0
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(C * B * 3)
    const col = new Float32Array(C * B * 3)
    const idx: number[] = []
    for (let c = 0; c < C - 1; c++)
      for (let b = 0; b < B - 1; b++) {
        const a = c * B + b
        idx.push(a, a + B, a + 1, a + 1, a + B, a + B + 1)
      }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.setIndex(idx)
    return g
  }, [C, B])
  const heights = useRef({ from: new Float32Array(C * B), to: new Float32Array(C * B), k: 1 })
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25, side: THREE.DoubleSide, flatShading: false }), [])
  const wire = useMemo(() => new THREE.MeshBasicMaterial({ color: '#5fd4e6', wireframe: true, transparent: true, opacity: 0.08 }), [])
  useEffect(
    () => () => {
      geo.dispose()
      mat.dispose()
      wire.dispose()
    },
    [geo, mat, wire],
  )

  useEffect(() => {
    // each month is scaled to its own busiest band: early months are one narrow spike and would
    // otherwise flatten the spread of later years into nothing
    const ks = density.share.map((col) => TERRAIN_PEAK / Math.sqrt(Math.max(...col) || 1))
    const h = heights.current
    const cur = new Float32Array(C * B)
    for (let i = 0; i < cur.length; i++) cur[i] = h.from[i]! + (h.to[i]! - h.from[i]!) * Math.min(1, h.k)
    h.from = cur
    const next = new Float32Array(C * B)
    const pos = geo.attributes.position as THREE.BufferAttribute
    const col = geo.attributes.color as THREE.BufferAttribute
    const p = pos.array as Float32Array
    const cl = col.array as Float32Array
    const green = new THREE.Color('#3ccb8f')
    const amber = new THREE.Color('#e8a33d')
    const red = new THREE.Color('#f0566a')
    const tmp = new THREE.Color()
    for (let c = 0; c < C; c++)
      for (let b = 0; b < B; b++) {
        const i = c * B + b
        const k = ks[c]!
        const share = density.share[c]![b]!
        next[i] = Math.sqrt(share) * k
        const mid = (density.edges[b]! + density.edges[b + 1]!) / 2
        p[i * 3] = scale.x(density.months[c]!)
        p[i * 3 + 2] = wealthZ(scale, mid)
        if (mid >= target) tmp.copy(green)
        else tmp.copy(red).lerp(amber, Math.min(1, mid / target))
        // brighter where more futures sit; the floor stays faintly visible
        const lum = 0.18 + 0.82 * Math.min(1, (Math.sqrt(share) * k) / TERRAIN_PEAK)
        cl[i * 3] = tmp.r * lum
        cl[i * 3 + 1] = tmp.g * lum
        cl[i * 3 + 2] = tmp.b * lum
      }
    h.to = next
    h.k = reduced ? 1 : 0
    geo.userData.done = false
    col.needsUpdate = true
  }, [density, scale, target, geo, C, B, reduced])

  useFrame((_, dt) => {
    const h = heights.current
    if (h.k >= 1 && geo.userData.done === true) return
    h.k = Math.min(1, h.k + dt / 1.3)
    const e = 1 - Math.pow(1 - h.k, 3)
    const pos = geo.attributes.position as THREE.BufferAttribute
    const p = pos.array as Float32Array
    for (let i = 0; i < C * B; i++) p[i * 3 + 1] = h.from[i]! + (h.to[i]! - h.from[i]!) * e
    pos.needsUpdate = true
    geo.computeVertexNormals()
    geo.computeBoundingSphere()
    geo.userData.done = h.k >= 1
  })

  const wallZ = wealthZ(scale, target)
  return (
    <group>
      <mesh geometry={geo} material={mat} />
      <mesh geometry={geo} material={wire} />
      <TargetWall z={wallZ} width={scale.width} height={TERRAIN_PEAK + 1.5} />
    </group>
  )
}

function TargetWall({ z, width, height }: { z: number; width: number; height: number }) {
  const ref = useRef<THREE.Group>(null)
  useFrame((_, dt) => {
    if (ref.current) ref.current.position.z += (z - ref.current.position.z) * Math.min(1, dt * 3)
  })
  return (
    <group ref={ref} position={[0, 0, z]}>
      <mesh position={[0, height / 2, 0]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color="#c9a24a" emissive="#6b4f12" emissiveIntensity={0.7} transparent opacity={0.16} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[0, height, 0]}>
        <boxGeometry args={[width, 0.06, 0.06]} />
        <meshBasicMaterial color="#e3c37a" toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[width, 0.05, 0.12]} />
        <meshBasicMaterial color="#e3c37a" toneMapped={false} />
      </mesh>
    </group>
  )
}

const RIDGES: { key: keyof Omit<Percentiles, 'month'>; z: number; color: string; opacity: number; metal: number }[] = [
  { key: 'p95', z: -4.4, color: '#2f6b55', opacity: 0.55, metal: 0.3 },
  { key: 'p75', z: -2.2, color: '#3b5f93', opacity: 0.7, metal: 0.4 },
  { key: 'p50', z: 0, color: '#c9a24a', opacity: 1, metal: 0.85 },
  { key: 'p25', z: 2.2, color: '#4a5878', opacity: 0.8, metal: 0.4 },
  { key: 'p5', z: 4.4, color: '#7a2f3a', opacity: 0.9, metal: 0.3 },
]

export function Mountain({ scale, p }: { scale: Scale; p: Percentiles }) {
  const geos = useMemo(
    () =>
      RIDGES.map((r) => {
        const s = new THREE.Shape()
        const xs = p.month.map((m) => scale.x(m))
        s.moveTo(xs[0]!, 0)
        p[r.key].forEach((w, i) => s.lineTo(xs[i]!, scale.y(w)))
        s.lineTo(xs[xs.length - 1]!, 0)
        s.closePath()
        return new THREE.ExtrudeGeometry(s, { depth: r.key === 'p50' ? 0.9 : 0.5, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2, curveSegments: 4 })
      }),
    [p, scale],
  )
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos])
  // the ridges rise into place when the world changes
  const group = useRef<THREE.Group>(null)
  const t = useRef(0)
  useEffect(() => {
    t.current = 0
  }, [geos])
  useFrame((_, dt) => {
    if (!group.current) return
    t.current = Math.min(1, t.current + dt / 0.9)
    group.current.scale.y = 0.85 + 0.15 * (1 - Math.pow(1 - t.current, 3))
  })
  return (
    <group ref={group}>
      {RIDGES.map((r, i) => (
        <mesh key={r.key} geometry={geos[i]} position={[0, 0, r.z]}>
          <meshStandardMaterial color={r.color} metalness={r.metal} roughness={0.35} transparent={r.opacity < 1} opacity={r.opacity} emissive={r.key === 'p50' ? '#3a2a08' : '#000'} />
        </mesh>
      ))}
    </group>
  )
}
