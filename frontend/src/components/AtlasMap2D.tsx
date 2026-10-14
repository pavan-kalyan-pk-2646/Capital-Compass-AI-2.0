/**
 * The Financial Atlas in 2D: the same terrain, roads and landmarks seen from above.
 * Used on phones (tap a landmark → bottom sheet) and whenever WebGL is unavailable.
 * Contour lines are traced from `terrainHeight` with marching squares, so the 2D map shows
 * the same topography as the 3D one.
 */
import { useMemo } from 'react'

import { byId, LANDMARKS, ROADS, terrainHeight, type LandmarkId } from '@/lib/atlasMap'
import type { LandmarkView } from '@/three/AtlasScene'

const EXTENT = 27
/** Extra margin around the terrain so edge labels are never clipped. */
const PAD = 3
const STEP = 1

function contours(levels: number[]): string[] {
  const n = Math.round((EXTENT * 2) / STEP)
  const h: number[][] = []
  for (let j = 0; j <= n; j++) {
    const row: number[] = []
    for (let i = 0; i <= n; i++) row.push(terrainHeight(-EXTENT + i * STEP, -EXTENT + j * STEP))
    h.push(row)
  }
  return levels.map((lv) => {
    let d = ''
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = h[j]![i]!
        const b = h[j]![i + 1]!
        const c = h[j + 1]![i + 1]!
        const e = h[j + 1]![i]!
        const x0 = -EXTENT + i * STEP
        const z0 = -EXTENT + j * STEP
        const pts: [number, number][] = []
        const cross = (p: number, q: number, px: number, pz: number, qx: number, qz: number) => {
          if (p < lv !== q < lv) {
            const t = (lv - p) / (q - p)
            pts.push([px + (qx - px) * t, pz + (qz - pz) * t])
          }
        }
        cross(a, b, x0, z0, x0 + STEP, z0)
        cross(b, c, x0 + STEP, z0, x0 + STEP, z0 + STEP)
        cross(c, e, x0 + STEP, z0 + STEP, x0, z0 + STEP)
        cross(e, a, x0, z0 + STEP, x0, z0)
        for (let k = 0; k + 1 < pts.length; k += 2) d += `M${pts[k]![0].toFixed(2)} ${pts[k]![1].toFixed(2)}L${pts[k + 1]![0].toFixed(2)} ${pts[k + 1]![1].toFixed(2)}`
      }
    }
    return d
  })
}

function roadD(a: LandmarkId, b: LandmarkId): string {
  const A = byId(a)
  const B = byId(b)
  const dx = B.x - A.x
  const dz = B.z - A.z
  const bow = 0.12 * Math.sign(Math.sin(A.x * 3.1 + B.z * 1.7) || 1)
  const cx = (A.x + B.x) / 2 - dz * bow
  const cz = (A.z + B.z) / 2 + dx * bow
  return `M${A.x} ${A.z}Q${cx} ${cz} ${B.x} ${B.z}`
}

export default function AtlasMap2D({ views, route, selected, onSelect }: { views: Record<LandmarkId, LandmarkView>; route: LandmarkId[] | null; selected: LandmarkId | null; onSelect: (id: LandmarkId | null) => void }) {
  const iso = useMemo(() => contours([-1.5, -0.75, 0, 0.75, 1.5, 2.25, 3, 4]), [])
  const target = route?.[route.length - 1]
  return (
    <svg className="atlas-2d" viewBox={`${-EXTENT - PAD} ${-EXTENT} ${(EXTENT + PAD) * 2} ${EXTENT * 2 + PAD}`} role="img" aria-label="Financial atlas map" onClick={() => onSelect(null)}>
      <defs>
        <radialGradient id="atlas2d-fade" cx="50%" cy="50%" r="50%">
          <stop offset="82%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#020306" stopOpacity="1" />
        </radialGradient>
      </defs>
      <rect x={-EXTENT} y={-EXTENT} width={EXTENT * 2} height={EXTENT * 2} fill="#05080e" />
      {Array.from({ length: 11 }, (_, i) => -25 + i * 5).map((v) => (
        <g key={v} stroke="rgba(95,212,230,0.07)" strokeWidth={0.05}>
          <line x1={v} y1={-EXTENT} x2={v} y2={EXTENT} />
          <line x1={-EXTENT} y1={v} x2={EXTENT} y2={v} />
        </g>
      ))}
      {iso.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="rgba(201,162,74,0.28)" strokeWidth={0.06} />
      ))}
      {ROADS.map(([a, b]) => (
        <path key={a + b} d={roadD(a, b)} fill="none" stroke={views[a].active && views[b].active ? 'rgba(201,162,74,0.6)' : 'rgba(80,92,110,0.5)'} strokeWidth={0.12} />
      ))}
      {route &&
        route.slice(1).map((id, i) => <path key={id} className="atlas-2d-route" d={roadD(route[i]!, id)} fill="none" stroke="#5fd4e6" strokeWidth={0.28} strokeDasharray="0.8 0.5" />)}
      {LANDMARKS.map((lm) => {
        const v = views[lm.id]
        const sel = selected === lm.id
        return (
          <g
            key={lm.id}
            className={`atlas-2d-lm ${v.active ? 'on' : 'off'} ${sel ? 'sel' : ''}`}
            transform={`translate(${lm.x} ${lm.z})`}
            role="button"
            tabIndex={0}
            aria-label={v.label}
            onClick={(e) => {
              e.stopPropagation()
              onSelect(lm.id)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(lm.id)
              }
            }}
          >
            <circle r={2.6} fill="transparent" />
            {target === lm.id && <circle className="atlas-2d-pulse" r={1.9} fill="none" stroke="#5fd4e6" strokeWidth={0.15} />}
            {v.visited && <circle r={1.55} fill="none" stroke="#5fd4e6" strokeWidth={0.1} />}
            <polygon points="0,-1.2 1.04,-0.6 1.04,0.6 0,1.2 -1.04,0.6 -1.04,-0.6" fill={v.active ? '#c9a24a' : '#232b38'} stroke={sel ? '#fff' : 'rgba(0,0,0,0.6)'} strokeWidth={0.12} />
            {/* labels near the left/right edge grow inward so they are never cut off */}
            <text x={lm.x < -19 ? -1.4 : lm.x > 19 ? 1.4 : 0} y={2.6} textAnchor={lm.x < -19 ? 'start' : lm.x > 19 ? 'end' : 'middle'} className="atlas-2d-label">
              {v.label}
            </text>
          </g>
        )
      })}
      <rect x={-EXTENT} y={-EXTENT} width={EXTENT * 2} height={EXTENT * 2} fill="url(#atlas2d-fade)" pointerEvents="none" />
    </svg>
  )
}
