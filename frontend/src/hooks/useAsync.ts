import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError } from '@/services/api'

export interface AsyncState<T> {
  data: T | null
  error: ApiError | null
  loading: boolean
  run: (...args: unknown[]) => Promise<T | null>
  reset: () => void
}

/** Runs an async API call; keeps the last good result visible while a new run loads. */
export function useAsync<T>(fn: (signal: AbortSignal, ...args: unknown[]) => Promise<T>): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(false)
  const ctrl = useRef<AbortController | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const run = useCallback(async (...args: unknown[]) => {
    ctrl.current?.abort()
    const c = new AbortController()
    ctrl.current = c
    setLoading(true)
    setError(null)
    try {
      const r = await fnRef.current(c.signal, ...args)
      if (!c.signal.aborted) setData(r)
      return r
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null
      setError(e instanceof ApiError ? e : new ApiError((e as Error).message || 'Unexpected error', 0))
      return null
    } finally {
      if (ctrl.current === c) setLoading(false)
    }
  }, [])

  const reset = useCallback(() => {
    setData(null)
    setError(null)
  }, [])

  useEffect(() => () => ctrl.current?.abort(), [])
  return { data, error, loading, run, reset }
}
