import { useEffect, useState } from 'react'

import { api } from '@/services/api'
import type { Profile, Snapshot } from '@/services/types'
import { useApp } from '@/stores/app'

/** Keeps the Digital Twin snapshot in sync with the stored profile (no DB write). */
export function useTwin() {
  const profile = useApp((s) => s.profile)
  const snapshot = useApp((s) => s.snapshot)
  const setSnapshot = useApp((s) => s.setSnapshot)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!profile) {
      setSnapshot(null)
      return
    }
    const c = new AbortController()
    api<Snapshot>('/api/twin/create', { body: { profile, save: false }, signal: c.signal })
      .then((s) => {
        setSnapshot(s)
        setError(null)
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message)
      })
    return () => c.abort()
  }, [profile, setSnapshot])

  return { profile, snapshot, error }
}

/** Load the flagship judge profile and save it as the Digital Twin. */
export async function loadJudgeProfile(): Promise<Snapshot> {
  const { profile } = await api<{ profile: Profile }>('/api/demo/judge-profile')
  const snap = await api<Snapshot & { profile_id: number }>('/api/twin/create', { body: { profile, save: true } })
  const st = useApp.getState()
  st.setProfile(profile, snap.profile_id)
  st.setSnapshot(snap)
  return snap
}
