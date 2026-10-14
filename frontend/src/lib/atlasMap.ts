/**
 * The Financial Atlas: landmarks, the real pages they open, and how each one's state follows
 * the user's actual data. Shared by the 3D map, the 2D fallback and the mobile sheet.
 * Pure functions only — no rendering, no invented values.
 */
import type { DecisionEnvelope, Profile } from '@/services/types'

export type LandmarkId = 'citadel' | 'twin' | 'risk' | 'goals' | 'market' | 'invest' | 'loan' | 'crisis' | 'portfolio' | 'committee' | 'redteam' | 'critic' | 'trust' | 'audit'
export type LandmarkKind = 'citadel' | 'harbor' | 'ridge' | 'valley' | 'horizon' | 'district' | 'crossing' | 'frontier' | 'clinic' | 'chamber' | 'fortress' | 'gate' | 'observatory' | 'archive'

export interface Landmark {
  id: LandmarkId
  kind: LandmarkKind
  /** Map coordinates (x east, z south) in world units; the citadel sits at the origin. */
  x: number
  z: number
  /** What the landmark needs before it holds the user's data. */
  needs: 'none' | 'twin' | 'goal' | 'holdings' | 'decision'
}

export const LANDMARKS: Landmark[] = [
  { id: 'citadel', kind: 'citadel', x: 0, z: 0, needs: 'none' },
  // understand — the north-west uplands
  { id: 'twin', kind: 'harbor', x: -11, z: -6, needs: 'none' },
  { id: 'risk', kind: 'ridge', x: -6, z: -13, needs: 'twin' },
  { id: 'goals', kind: 'valley', x: 4, z: -12, needs: 'goal' },
  { id: 'market', kind: 'horizon', x: 13, z: -18, needs: 'none' },
  // decide — the eastern districts
  { id: 'invest', kind: 'district', x: 13, z: -5, needs: 'twin' },
  { id: 'loan', kind: 'crossing', x: 15, z: 5, needs: 'twin' },
  { id: 'portfolio', kind: 'clinic', x: 8, z: 12, needs: 'holdings' },
  // stress test — the southern frontier
  { id: 'crisis', kind: 'frontier', x: -1, z: 17, needs: 'twin' },
  // challenge — the south-western fortifications
  { id: 'committee', kind: 'chamber', x: -10, z: 9, needs: 'decision' },
  { id: 'redteam', kind: 'fortress', x: -16, z: 15, needs: 'decision' },
  { id: 'critic', kind: 'gate', x: -18, z: 4, needs: 'decision' },
  // trust — the western archives
  { id: 'trust', kind: 'observatory', x: -21, z: -9, needs: 'decision' },
  { id: 'audit', kind: 'archive', x: -15, z: -18, needs: 'decision' },
]

/** Roads between landmarks; the citadel connects to every district hub. */
export const ROADS: [LandmarkId, LandmarkId][] = [
  ['citadel', 'twin'],
  ['twin', 'risk'],
  ['risk', 'goals'],
  ['citadel', 'goals'],
  ['goals', 'market'],
  ['citadel', 'invest'],
  ['invest', 'market'],
  ['citadel', 'loan'],
  ['loan', 'portfolio'],
  ['citadel', 'portfolio'],
  ['citadel', 'crisis'],
  ['crisis', 'committee'],
  ['citadel', 'committee'],
  ['committee', 'redteam'],
  ['committee', 'critic'],
  ['critic', 'trust'],
  ['twin', 'trust'],
  ['trust', 'audit'],
  ['risk', 'audit'],
]

export interface AtlasInputs {
  profile: Profile | null
  /** The latest decision the server returned for this user (owner-checked), or null. */
  decision: DecisionEnvelope | null
  /** `progress.portfolio` from /api/atlas/brief: the user has holdings to diagnose. */
  hasHoldings: boolean | null
  lastDecisionId: string | null
}

export type LandmarkStatus = 'active' | 'locked'

export function landmarkStatus(lm: Landmark, s: AtlasInputs): LandmarkStatus {
  const twin = !!s.profile
  const done = s.decision?.status === 'completed'
  switch (lm.needs) {
    case 'none':
      return 'active'
    case 'twin':
      return twin ? 'active' : 'locked'
    case 'goal':
      return twin && (s.profile?.goals.length ?? 0) > 0 ? 'active' : 'locked'
    case 'holdings':
      return twin && !!s.hasHoldings ? 'active' : 'locked'
    case 'decision':
      return done ? 'active' : 'locked'
  }
}

/** The step a locked landmark is waiting for, as an i18n key. */
export function needsKey(lm: Landmark): string {
  return { none: '', twin: 'lm.twin', goal: 'guide.noGoal.cta', holdings: 'lm.twin', decision: 'guide.noDecision.cta' }[lm.needs]
}

/** The real page each landmark opens. Decision landmarks open the user's latest decision. */
export function landmarkRoute(id: LandmarkId, lastDecisionId: string | null): string {
  const d = lastDecisionId ? `?id=${encodeURIComponent(lastDecisionId)}` : ''
  switch (id) {
    case 'citadel':
      return '/dashboard'
    case 'twin':
      return '/twin'
    case 'risk':
      return '/twin#risk-dna'
    case 'goals':
      return '/goals'
    case 'market':
      return '/market'
    case 'invest':
      return '/investment'
    case 'loan':
      return '/loan'
    case 'portfolio':
      return '/portfolio'
    case 'crisis':
      return '/crisis'
    case 'committee':
      return `/committee${d}`
    case 'redteam':
      return `/committee${d}#redteam`
    case 'critic':
      return `/committee${d}#critic`
    case 'trust':
      return '/trust'
    case 'audit':
      return `/audit${d}`
  }
}

/** Which landmark a recommendation route (from the Atlas engine) points at. */
export function landmarkForRoute(route: string): LandmarkId {
  const path = route.split(/[?#]/)[0]
  const map: Record<string, LandmarkId> = {
    '/dashboard': 'citadel',
    '/twin': 'twin',
    '/goals': 'goals',
    '/market': 'market',
    '/investment': 'invest',
    '/loan': 'loan',
    '/portfolio': 'portfolio',
    '/crisis': 'crisis',
    '/spending': 'twin',
    '/committee': 'committee',
    '/trust': 'trust',
    '/audit': 'audit',
  }
  return map[path ?? ''] ?? 'citadel'
}

/** Shortest road path between two landmarks (breadth-first over ROADS). */
export function roadPath(from: LandmarkId, to: LandmarkId): LandmarkId[] {
  if (from === to) return [from]
  const adj = new Map<LandmarkId, LandmarkId[]>()
  for (const [a, b] of ROADS) {
    adj.set(a, [...(adj.get(a) ?? []), b])
    adj.set(b, [...(adj.get(b) ?? []), a])
  }
  const prev = new Map<LandmarkId, LandmarkId | null>([[from, null]])
  const queue: LandmarkId[] = [from]
  while (queue.length) {
    const cur = queue.shift()!
    if (cur === to) break
    for (const n of adj.get(cur) ?? []) {
      if (!prev.has(n)) {
        prev.set(n, cur)
        queue.push(n)
      }
    }
  }
  if (!prev.has(to)) return [from, to]
  const path: LandmarkId[] = []
  for (let c: LandmarkId | null = to; c; c = prev.get(c) ?? null) path.unshift(c)
  return path
}

export const byId = (id: LandmarkId): Landmark => LANDMARKS.find((l) => l.id === id)!

/** Deterministic terrain height (smooth value noise), flattened into plateaus under landmarks. */
export function terrainHeight(x: number, z: number): number {
  const n = (ix: number, iz: number) => {
    const s = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453
    return s - Math.floor(s)
  }
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const noise = (px: number, pz: number) => {
    const ix = Math.floor(px)
    const iz = Math.floor(pz)
    const fx = smooth(px - ix)
    const fz = smooth(pz - iz)
    const a = n(ix, iz)
    const b = n(ix + 1, iz)
    const c = n(ix, iz + 1)
    const d = n(ix + 1, iz + 1)
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz
  }
  let h = 0
  let amp = 1
  let f = 0.07
  for (let o = 0; o < 4; o++) {
    h += (noise(x * f + 11.3, z * f - 4.7) - 0.5) * amp
    amp *= 0.5
    f *= 2.1
  }
  // gentle overall bowl so the edges rise like a horizon
  const r = Math.hypot(x, z)
  h = h * 3.2 + Math.max(0, r - 24) * 0.12
  // plateaus where landmarks stand, so buildings sit level
  for (const lm of LANDMARKS) {
    const d = Math.hypot(x - lm.x, z - lm.z)
    const k = Math.max(0, 1 - d / 3.2)
    if (k > 0) h = h * (1 - k * k) + plateau(lm) * k * k
  }
  return h
}

function plateau(lm: Landmark): number {
  return lm.kind === 'ridge' ? 1.6 : lm.kind === 'valley' ? -0.6 : lm.kind === 'horizon' ? 1.2 : 0.3
}
