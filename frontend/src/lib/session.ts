/** Sign-in side effects shared by the entry screen and the in-app account menu. */
import { api, ApiError } from '@/services/api'
import type { Profile } from '@/services/types'
import { useApp } from '@/stores/app'

export interface AuthUser {
  id: number
  name: string
  email: string
}

/**
 * Store the session, then load the account's saved twin. If the account has none yet but this
 * browser built one as a guest, save it to the account (the server only allows that for the
 * guest key that created it), so nothing the person did before signing in is lost.
 */
export async function completeSignIn(token: string, user: AuthUser): Promise<void> {
  const st = useApp.getState()
  st.setAuth(token, user)
  const saved = await api<{ id: number | null; profile: Profile | null }>('/api/profile?optional=1')
  if (saved.profile && saved.id) {
    st.setProfile(saved.profile, saved.id)
    return
  }
  const { profile, profileId } = useApp.getState()
  if (!profile) return
  try {
    const r = profileId ? await api<{ id: number }>(`/api/profile?id=${profileId}`, { method: 'PUT', body: { profile } }) : await api<{ id: number }>('/api/profile', { body: { profile } })
    useApp.getState().setProfile(profile, r.id)
  } catch (e) {
    // The guest twin belongs to someone else (another browser key): start the account fresh.
    if (e instanceof ApiError && e.status === 404) {
      const r = await api<{ id: number }>('/api/profile', { body: { profile } })
      useApp.getState().setProfile(profile, r.id)
    } else throw e
  }
}

/** Ask the server whether the saved sign-in is still valid; expire it locally if not. */
export async function verifySession(): Promise<void> {
  if (!useApp.getState().token) return
  try {
    await api('/api/auth/me')
  } catch {
    /* api() already expired the session on a 401; network errors leave it alone */
  }
}
