import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { loadJudgeProfile } from '@/hooks/useTwin'
import { inr } from '@/lib/format'
import type { ApiError } from '@/services/api'

export function Panel({ title, sub, action, children, className = '', id }: { title?: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`panel ${className}`} id={id}>
      {(title || action) && (
        <div className="panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <p className="mt-sm">{sub}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Metric({ label, value, sub, tone = '', size = '' }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: string; size?: '' | 'lg' }) {
  return (
    <div>
      <div className="metric-label">{label}</div>
      <div className={`metric-value num ${size} ${tone}`}>{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  )
}

export function Badge({ tone = '', children }: { tone?: string; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

export function Bar({ value, tone }: { value: number; tone?: string }) {
  const color = tone === 'green' ? 'var(--green)' : tone === 'red' ? 'var(--red)' : tone === 'amber' ? 'var(--amber)' : tone === 'blue' ? 'var(--blue)' : 'var(--brass)'
  return (
    <div className="bar" role="presentation">
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: ApiError | string | null; onRetry?: () => void }) {
  if (!error) return null
  const msg = typeof error === 'string' ? error : error.message
  const details = typeof error === 'string' ? [] : error.details
  return (
    <div className="error-box" role="alert">
      <div className="row between">
        <strong>{msg}</strong>
        {onRetry && (
          <button className="btn sm ghost" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
      {details.length > 0 && (
        <ul>
          {details.slice(0, 6).map((d) => (
            <li key={d.field + d.message}>
              {d.field.replace(/_/g, ' ')}: {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Loading({ label, height = 220 }: { label: string; height?: number }) {
  return (
    <div className="skeleton row" style={{ height, justifyContent: 'center', color: 'var(--text-2)' }} aria-busy="true">
      <span className="spinner" /> {label}
    </div>
  )
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />
}

export function Disclaimer() {
  return <p className="disclaimer">Capital Compass provides scenario-based financial decision support. Simulated outcomes are not guaranteed predictions and should not be interpreted as regulated personalized financial advice. Simulations use NIFTY 50 and Indian debt history (2000–2023) plus documented assumptions.</p>
}

export function NeedsTwin({ what }: { what: string }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="state">
      <h3>Your Financial Digital Twin comes first</h3>
      <p>{what} runs on your income, expenses, assets, loans and goals. Build your twin, or load the demo profile used in the flagship walkthrough.</p>
      <div className="row wrap mt">
        <Link className="btn primary" to="/twin">
          Build my Digital Twin
        </Link>
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setErr(null)
            try {
              await loadJudgeProfile()
            } catch (e) {
              setErr((e as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy && <Spinner />} Load demo profile
        </button>
      </div>
      {err && <div className="mt">{<ErrorBox error={err} />}</div>}
    </div>
  )
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function MoneyInput({ label, value, onChange, hint, min = 0, max = 1e10, id }: { label: string; value: number; onChange: (v: number) => void; hint?: string; min?: number; max?: number; id?: string }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const fid = id ?? `f-${label.replace(/\W+/g, '-').toLowerCase()}`
  const n = Number(text.replace(/,/g, ''))
  const invalid = text.trim() === '' || Number.isNaN(n) || n < min || n > max
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      <div className="input-prefix">
        <span>₹</span>
        <input
          id={fid}
          className={`input num ${invalid ? 'invalid' : ''}`}
          inputMode="numeric"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            const v = Number(e.target.value.replace(/,/g, ''))
            if (e.target.value.trim() !== '' && !Number.isNaN(v) && v >= min && v <= max) onChange(Math.round(v))
          }}
          aria-invalid={invalid}
        />
      </div>
      <span className="hint">{invalid ? `Enter an amount between ${inr(min)} and ${inr(max)}` : hint ?? inr(value)}</span>
    </div>
  )
}

export function NumInput({ label, value, onChange, step = 1, min, max, suffix, hint }: { label: string; value: number; onChange: (v: number) => void; step?: number; min: number; max: number; suffix?: string; hint?: string }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const fid = `n-${label.replace(/\W+/g, '-').toLowerCase()}`
  const n = Number(text)
  const invalid = text.trim() === '' || Number.isNaN(n) || n < min || n > max
  return (
    <div className="field">
      <label htmlFor={fid}>
        {label}
        {suffix ? ` (${suffix})` : ''}
      </label>
      <input
        id={fid}
        className={`input num ${invalid ? 'invalid' : ''}`}
        type="number"
        step={step}
        min={min}
        max={max}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const v = Number(e.target.value)
          if (e.target.value.trim() !== '' && !Number.isNaN(v) && v >= min && v <= max) onChange(v)
        }}
        aria-invalid={invalid}
      />
      {(invalid || hint) && <span className="hint">{invalid ? `Between ${min} and ${max}` : hint}</span>}
    </div>
  )
}

export function Slider({ label, value, onChange, min, max, step, format }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; format: (v: number) => string }) {
  const fid = `s-${label.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <div className="field">
      <div className="row between">
        <label htmlFor={fid}>{label}</label>
        <span className="small num">{format(value)}</span>
      </div>
      <input id={fid} className="range" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  )
}

export function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const fid = `sel-${label.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      <select id={fid} className="select" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function StanceBadge({ stance }: { stance: string }) {
  const tone = stance === 'support' ? 'green' : stance === 'oppose' ? 'red' : 'amber'
  const label = stance === 'support' ? 'Supports' : stance === 'oppose' ? 'Opposes' : 'Conditional'
  return (
    <Badge tone={tone}>
      <span className="dot" />
      {label}
    </Badge>
  )
}

export function StatusBadge({ status }: { status: 'PASS' | 'WARN' | 'FAIL' | string }) {
  const tone = status === 'PASS' ? 'green' : status === 'FAIL' ? 'red' : 'amber'
  const label = status === 'PASS' ? 'Held' : status === 'FAIL' ? 'Broken' : 'Strained'
  return <Badge tone={tone}>{label}</Badge>
}
