import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Icon } from '@/components/icons'
import { ErrorBox, Spinner } from '@/components/ui'
import { api, ApiError } from '@/services/api'
import { useApp } from '@/stores/app'

/** Sends the current question to the full LangGraph pipeline and opens the AI Committee view. */
export function RunDecision({ type, params, command, label = 'Send to AI Committee' }: { type: string; params: Record<string, unknown>; command: string; label?: string }) {
  const profile = useApp((s) => s.profile)
  const setDecision = useApp((s) => s.setDecision)
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<ApiError | null>(null)
  return (
    <div className="stack-sm" style={{ alignItems: 'flex-start' }}>
      <button
        className="btn primary"
        disabled={busy || !profile}
        onClick={async () => {
          setBusy(true)
          setErr(null)
          try {
            const r = await api<{ decision_id: string }>('/api/decision/run', { body: { profile, decision_type: type, params, command } })
            setDecision(r.decision_id)
            nav(`/committee?id=${r.decision_id}`)
          } catch (e) {
            setErr(e as ApiError)
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? <Spinner /> : <Icon name="committee" size={16} />} {label}
      </button>
      <ErrorBox error={err} />
    </div>
  )
}
