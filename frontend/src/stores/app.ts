/** Global app state: the Digital Twin profile, its snapshot, the latest decision, auth. */

import { create } from 'zustand'

import type { Profile, Snapshot } from '@/services/types'

const KEY = 'cc2-state'
const GUEST_KEY = 'cc2-guest-key'

/** A random key for this browser. The server scopes a guest's decisions and profile to it, so one
 * guest can never open another guest's data. It is not a credential and never identifies a user. */
function guestKey(): string {
  try {
    const saved = localStorage.getItem(GUEST_KEY)
    if (saved && /^[A-Za-z0-9-]{32,64}$/.test(saved)) return saved
  } catch {
    /* storage unavailable */
  }
  // 128 random bits from the platform's secure generator (randomUUID needs a secure context)
  const fresh =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
  try {
    localStorage.setItem(GUEST_KEY, fresh)
  } catch {
    /* in-memory only */
  }
  return fresh
}

interface Persisted {
  profile: Profile | null
  profileId: number | null
  lastDecisionId: string | null
  token: string | null
  user: { id: number; name: string; email: string } | null
  decisionHistory: { id: string; at: string }[]
}

function load(): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Partial<Persisted>) : {}
  } catch {
    return {}
  }
}

interface AppState extends Persisted {
  snapshot: Snapshot | null
  demoStep: number | null
  guestKey: string
  /** Set when the server rejected the saved sign-in (expired or invalid token). */
  sessionExpired: boolean
  expireSession: () => void
  signOut: () => void
  setProfile: (p: Profile | null, id?: number | null) => void
  setSnapshot: (s: Snapshot | null) => void
  setDecision: (id: string | null) => void
  setAuth: (token: string | null, user: Persisted['user']) => void
  setDemoStep: (n: number | null) => void
}

const initial = load()

export const useApp = create<AppState>((set) => ({
  profile: initial.profile ?? null,
  profileId: initial.profileId ?? null,
  lastDecisionId: initial.lastDecisionId ?? null,
  token: initial.token ?? null,
  user: initial.user ?? null,
  decisionHistory: initial.decisionHistory ?? [],
  snapshot: null,
  demoStep: null,
  guestKey: guestKey(),
  sessionExpired: false,
  // The account's data must not stay in this browser for whoever uses it next.
  expireSession: () => set({ token: null, user: null, sessionExpired: true, profile: null, profileId: null, snapshot: null, lastDecisionId: null, decisionHistory: [] }),
  signOut: () => set({ token: null, user: null, sessionExpired: false, profile: null, profileId: null, snapshot: null, lastDecisionId: null, decisionHistory: [] }),
  setProfile: (profile, id) => set((s) => ({ profile, profileId: id === undefined ? s.profileId : id })),
  setSnapshot: (snapshot) => set({ snapshot }),
  setDecision: (lastDecisionId) => set((s) => ({ lastDecisionId, decisionHistory: lastDecisionId ? [{ id: lastDecisionId, at: new Date().toISOString() }, ...s.decisionHistory.filter((x) => x.id !== lastDecisionId)].slice(0, 30) : s.decisionHistory })),
  setAuth: (token, user) => set({ token, user, sessionExpired: false }),
  setDemoStep: (demoStep) => set({ demoStep }),
}))

useApp.subscribe((s) => {
  try {
    const p: Persisted = {
      profile: s.profile,
      profileId: s.profileId,
      lastDecisionId: s.lastDecisionId,
      token: s.token,
      user: s.user,
      decisionHistory: s.decisionHistory,
    }
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* storage unavailable — state stays in memory */
  }
})
