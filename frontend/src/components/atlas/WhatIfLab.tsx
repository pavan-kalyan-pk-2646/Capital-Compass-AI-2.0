import { useEffect, useRef, useState } from 'react'

import { useLanguage } from '@/components/LanguageContext'
import { DataTag } from '@/components/atlas/DataTag'
import { Explain } from '@/components/atlas/Explain'
import { Spinner } from '@/components/ui'
import { inr, inrShort, pct } from '@/lib/format'
import { analyze, ApiError } from '@/services/api'

type Key = 'income' | 'expenses' | 'sip' | 'loan_amount' | 'loan_rate' | 'equity' | 'emergency_fund'
type Values = Record<Key, number>
interface Preview {
  surplus_after_plan: number
  new_emi: number
  foir: number | null
  emergency_months: number | null
  goal_corpus: number
  goal_target: number | null
  goal_name: string
  goal_months: number
  expected_return_pct: number
  crash_loss: number
}
interface LabResponse {
  current: Values
  base: Preview
  preview: Preview
  simulation?: { n_paths: number; goal_success_probability: number | null; ending: { p5: number; p50: number }; max_drawdown_p95: number }
}

const SLIDERS: { key: Key; label: string; max: (c: Values) => number; step: number; fmt: (v: number) => string }[] = [
  { key: 'income', label: 'wi.income', max: (c) => Math.max(50000, c.income * 2), step: 1000, fmt: inr },
  { key: 'expenses', label: 'wi.expenses', max: (c) => Math.max(50000, c.expenses * 2), step: 1000, fmt: inr },
  { key: 'sip', label: 'wi.sip', max: (c) => Math.max(50000, c.sip * 3), step: 500, fmt: inr },
  { key: 'loan_amount', label: 'wi.loan', max: () => 2000000, step: 25000, fmt: inrShort },
  { key: 'loan_rate', label: 'wi.rate', max: () => 30, step: 0.5, fmt: (v) => `${v}%` },
  { key: 'equity', label: 'wi.equity', max: () => 0.95, step: 0.05, fmt: (v) => pct(v) },
  { key: 'emergency_fund', label: 'wi.ef', max: (c) => Math.max(200000, c.emergency_fund * 3), step: 5000, fmt: inrShort },
]

/** Explore changes without touching the saved twin: instant arithmetic preview, full run on demand. */
export function WhatIfLab() {
  const { t } = useLanguage()
  const [cur, setCur] = useState<Values | null>(null)
  const [vals, setVals] = useState<Values | null>(null)
  const [data, setData] = useState<LabResponse | null>(null)
  const [sim, setSim] = useState<{ result: NonNullable<LabResponse['simulation']>; at: string } | null>(null)
  const [busy, setBusy] = useState<'preview' | 'sim' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const ctl = useRef<AbortController | null>(null)

  const changed = (v: Values | null): Partial<Values> => {
    if (!v || !cur) return {}
    const out: Partial<Values> = {}
    for (const k of Object.keys(v) as Key[]) if (Math.abs(v[k] - cur[k]) > 1e-9) out[k] = v[k]
    return out
  }

  async function call(simulate: boolean, v: Values | null) {
    ctl.current?.abort()
    const c = new AbortController()
    ctl.current = c
    setBusy(simulate ? 'sim' : 'preview')
    setErr(null)
    try {
      const r = await analyze<LabResponse>('/api/whatif/lab', { changes: changed(v), simulate }, c.signal)
      if (c.signal.aborted) return
      setData(r)
      if (!cur) {
        setCur(r.current)
        setVals(r.current)
      }
      if (r.simulation) setSim({ result: r.simulation, at: JSON.stringify(v) })
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      const x = e as ApiError
      setErr(x.status === 0 ? t('err.backend') : x.message)
    } finally {
      if (ctl.current === c) setBusy(null)
    }
  }

  // first load: the twin's own values
  useEffect(() => {
    void call(false, null)
    return () => ctl.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // dragging: a cheap arithmetic preview, at most every 250 ms — never a simulation
  const sig = JSON.stringify(vals)
  const first = useRef(true)
  useEffect(() => {
    if (!vals || !cur) return
    if (first.current) {
      first.current = false
      return
    }
    const h = window.setTimeout(() => void call(false, vals), 250)
    return () => window.clearTimeout(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  if (!cur || !vals) {
    return (
      <section className="cc-panel wi" data-i18n>
        <h2>{t('wi.title')}</h2>
        {err ? <p className="ch-err">{err}</p> : <div className="skeleton" style={{ height: 220 }} />}
        {err && (
          <button className="btn sm" onClick={() => void call(false, null)}>
            {t('err.retry')}
          </button>
        )}
      </section>
    )
  }

  const pv = data?.preview
  const base = data?.base
  const stale = sim && sim.at !== sig
  const cell = (label: string, now: string, was: string, term?: Parameters<typeof Explain>[0]['term']) => (
    <div className="wi-cell">
      <span className="cc-k">
        {label} {term && <Explain term={term} />}
      </span>
      <strong>{now}</strong>
      <span className="tiny muted">{t('wi.vsTwin', { value: was })}</span>
    </div>
  )

  return (
    <section className="cc-panel wi" data-i18n aria-labelledby="wi-h">
      <div className="cc-panel-head">
        <h2 id="wi-h">{t('wi.title')}</h2>
        <button className="btn sm ghost" onClick={() => setVals(cur)} disabled={sig === JSON.stringify(cur)}>
          {t('wi.reset')}
        </button>
      </div>
      <p className="small text-2">{t('wi.sub')}</p>
      <div className="wi-grid">
        <div className="wi-sliders">
          {SLIDERS.map((s) => (
            <label key={s.key} className="wi-slider">
              <span className="wi-slider-top">
                <span>{t(s.label)}</span>
                <b className="num">{s.fmt(vals[s.key])}</b>
              </span>
              <input type="range" min={0} max={s.max(cur)} step={s.step} value={vals[s.key]} onChange={(e) => setVals({ ...vals, [s.key]: Number(e.target.value) })} />
            </label>
          ))}
        </div>
        <div className="wi-out">
          <div className="wi-out-head">
            <span className="cc-k">{t('wi.preview')}</span>
            <DataTag source="calculated" />
            {busy === 'preview' && <Spinner />}
          </div>
          {pv && base && (
            <div className="wi-cells">
              {cell(t('wi.surplus'), inr(pv.surplus_after_plan), inr(base.surplus_after_plan))}
              {cell(t('wi.emi'), inr(pv.new_emi), inr(base.new_emi))}
              {cell(t('wi.foir'), pv.foir === null ? '—' : pct(pv.foir), base.foir === null ? '—' : pct(base.foir), 'foir')}
              {cell(t('wi.cover'), pv.emergency_months === null ? '—' : t('wi.months', { months: pv.emergency_months.toFixed(1) }), base.emergency_months === null ? '—' : t('wi.months', { months: base.emergency_months.toFixed(1) }), 'coverage')}
              <div className="wi-cell wide">
                <span className="cc-k">
                  {t('wi.projected')} <DataTag source="assumption" />
                </span>
                <strong>{inrShort(pv.goal_corpus)}</strong>
                <span className="tiny muted">
                  {t('wi.projectedSub', { rate: pv.expected_return_pct.toFixed(1) })}
                  {pv.goal_target ? ` · ${pv.goal_name} ${inrShort(pv.goal_target)}` : ''}
                </span>
              </div>
            </div>
          )}
          <button className="btn primary" disabled={busy === 'sim'} onClick={() => void call(true, vals)}>
            {busy === 'sim' ? (
              <>
                <Spinner /> {t('wi.running')}
              </>
            ) : (
              t('wi.run')
            )}
          </button>
          {sim && (
            <div className={`wi-sim ${stale ? 'stale' : ''}`}>
              <div className="wi-out-head">
                <span className="cc-k">
                  {t('wi.result')} · {sim.result.n_paths.toLocaleString('en-IN')} <Explain term="montecarlo" />
                </span>
                <DataTag source="simulated" />
              </div>
              <div className="wi-cells">
                <div className="wi-cell">
                  <span className="cc-k">{t('wi.success')}</span>
                  <strong>{pct(sim.result.goal_success_probability)}</strong>
                </div>
                <div className="wi-cell">
                  <span className="cc-k">{t('wi.median')}</span>
                  <strong>{inrShort(sim.result.ending.p50)}</strong>
                </div>
                <div className="wi-cell">
                  <span className="cc-k">{t('wi.worst')}</span>
                  <strong>{inrShort(sim.result.ending.p5)}</strong>
                </div>
                <div className="wi-cell">
                  <span className="cc-k">
                    {t('wi.drawdown')} <Explain term="drawdown" />
                  </span>
                  <strong>{pct(Math.abs(sim.result.max_drawdown_p95))}</strong>
                </div>
              </div>
              {stale && <p className="tiny muted">{t('wi.stale')}</p>}
            </div>
          )}
          {err && (
            <p className="ch-err" role="alert">
              {err}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
