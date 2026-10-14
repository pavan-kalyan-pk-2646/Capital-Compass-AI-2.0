/** Thin fetch client for the Flask API. Errors carry the server's message and field details. */

import { useApp } from '@/stores/app'

export class ApiError extends Error {
  status: number
  details: { field: string; message: string }[]
  constructor(message: string, status: number, details: { field: string; message: string }[] = []) {
    super(message)
    this.status = status
    this.details = details
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const { token, guestKey } = useApp.getState()
  let res: Response
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers: {
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'X-Guest-Key': guestKey,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError('Cannot reach the Capital Compass server. Start the backend with `python app.py` and try again.', 0)
  }
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; details?: { field: string; message: string }[] }
    // A saved sign-in the server no longer accepts: end the session cleanly instead of failing silently.
    if (res.status === 401 && token && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/register')) useApp.getState().expireSession()
    throw new ApiError(d.error ?? `Request failed (${res.status})`, res.status, d.details ?? [])
  }
  return data as T
}

/** POST {profile, ...extra} — every analysis endpoint takes the current Digital Twin profile. */
export function analyze<T>(path: string, extra: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  const profile = useApp.getState().profile
  if (!profile) return Promise.reject(new ApiError('Create your Financial Digital Twin first.', 422))
  return api<T>(path, { body: { profile, ...extra }, signal })
}
