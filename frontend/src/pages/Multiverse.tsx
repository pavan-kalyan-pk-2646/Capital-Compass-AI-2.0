import { useEffect, useState } from 'react'

import { FUTURE_COLORS, MultiFan } from '@/charts/charts'
import { Icon } from '@/components/icons'
import { Disclaimer, ErrorBox, Loading, NeedsTwin, Panel, Slider, Spinner } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { inr, inrShort, pct, probTone } from '@/lib/format'
import { analyze } from '@/services/api'
import type { Plan, WhatIfFuture } from '@/services/types'
import { useApp } from '@/stores/app'

interface FutureInput {
  name: string
  market_return_pct: number
  inflation_pct: number
  income_change_pct: number
  monthly_investment: number | null
  interest_rate_change_pct: number
  years: number | null
  sip_multiplier?: number
}

const PRESETS: FutureInput[] = [
  { name: 'As planned', market_return_pct: 0, inflation_pct: 5.5, income_change_pct: 0, monthly_investment: null, interest_rate_change_pct: 0, years: null },
  { name: 'Hard landing', market_return_pct: -30, inflation_pct: 7.5, income_change_pct: -30, monthly_investment: null, interest_rate_change_pct: 2, years: null },
  { name: 'Invest more', market_return_pct: 0, inflation_pct: 5.5, income_change_pct: 0, monthly_investment: null, interest_rate_change_pct: 0, years: null, sip_multiplier: 1.12 },
]

export default function Multiverse() {
  const profile = useApp((s) => s.profile)
  const [futures, setFutures] = useState<FutureInput[]>(PRESETS)
  const [active, setActive] = useState(0)
  const w = useAsync((signal) =>
    analyze<{ futures: WhatIfFuture[]; plan: Plan; goal: { target: number | null; months: number } }>(
      '/api/simulation/what-if',
      {
        futures: futures.map((f) => ({
          ...f,
          monthly_investment: f.monthly_investment ?? undefined,
          years: f.years ?? undefined,
        })),
      },
      signal,
    ),
  )

  useEffect(() => {
    if (profile) w.run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  // fill unset sliders with the values the server actually simulated
  useEffect(() => {
    const res = w.data?.futures
    if (!res) return
    setFutures((fs) =>
      fs.map((f, i) => ({
        ...f,
        monthly_investment: f.monthly_investment ?? res[i]?.inputs.monthly_investment ?? null,
        years: f.years ?? res[i]?.inputs.years ?? null,
      })),
    )
  }, [w.data])

  if (!profile)
    return (
      <div className="page">
        <h1>What-if multiverse</h1>
        <div className="mt">
          <NeedsTwin what="The What-If Multiverse" />
        </div>
      </div>
    )

  const f = futures[active]!
  const up = (patch: Partial<FutureInput>) => setFutures((fs) => fs.map((x, i) => (i === active ? { ...x, ...patch } : x)))
  const res = w.data?.futures
  const target = w.data?.goal.target

  const rows: { label: string; get: (x: WhatIfFuture) => number | null; fmt: (v: number | null) => string; better: 'high' | 'low' }[] = [
    { label: 'Goal success', get: (x) => x.goal_success_probability, fmt: (v) => pct(v), better: 'high' },
    { label: 'Median ending wealth', get: (x) => x.ending.p50, fmt: (v) => inrShort(v), better: 'high' },
    { label: 'Worst 5% ending wealth', get: (x) => x.ending.p5, fmt: (v) => inrShort(v), better: 'high' },
    { label: 'Median in today’s money', get: (x) => x.ending.p50_real, fmt: (v) => inrShort(v), better: 'high' },
    { label: 'Worst 5% drawdown', get: (x) => Math.abs(x.max_drawdown_p95), fmt: (v) => pct(v), better: 'low' },
    { label: 'Liquidity risk (forced selling)', get: (x) => x.liquidity_risk, fmt: (v) => pct(v), better: 'low' },
    { label: 'Debt stress (EMIs to income)', get: (x) => x.debt_stress_foir, fmt: (v) => (v === null ? 'No income' : pct(v)), better: 'low' },
    { label: 'Recovery time (median)', get: (x) => x.recovery_months_median, fmt: (v) => (v === null ? '—' : `${Math.round(v)} mo`), better: 'low' },
  ]

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>What-if multiverse</h1>
          <p>Build up to three alternative futures and compare them side by side. Each one is 10,000 simulated paths of your own twin.</p>
        </div>
        <button className="btn primary" onClick={() => w.run()} disabled={w.loading}>
          {w.loading && <Spinner />} Simulate {futures.length} futures
        </button>
      </div>
      <div className="grid g-side">
        <Panel>
          <div className="seg" role="tablist" aria-label="Futures">
            {futures.map((x, i) => (
              <button key={i} role="tab" aria-selected={active === i} className={active === i ? 'on' : ''} onClick={() => setActive(i)}>
                <span className="dot" style={{ color: FUTURE_COLORS[i] }} /> {x.name}
              </button>
            ))}
          </div>
          <div className="stack mt">
            <div className="field">
              <label htmlFor="fut-name">Name</label>
              <input id="fut-name" className="input" maxLength={40} value={f.name} onChange={(e) => up({ name: e.target.value })} />
            </div>
            <Slider label="Market move now" value={f.market_return_pct} min={-50} max={50} step={5} onChange={(v) => up({ market_return_pct: v })} format={(v) => `${v > 0 ? '+' : ''}${v}%`} />
            <Slider label="Inflation" value={f.inflation_pct} min={2} max={12} step={0.5} onChange={(v) => up({ inflation_pct: v })} format={(v) => `${v}% a year`} />
            <Slider label="Income change" value={f.income_change_pct} min={-100} max={100} step={10} onChange={(v) => up({ income_change_pct: v })} format={(v) => `${v > 0 ? '+' : ''}${v}%`} />
            <Slider label="Monthly investment" value={f.monthly_investment ?? 0} min={0} max={200000} step={500} onChange={(v) => up({ monthly_investment: v, sip_multiplier: undefined })} format={(v) => inr(v)} />
            <Slider label="Interest-rate change" value={f.interest_rate_change_pct} min={-2} max={5} step={0.5} onChange={(v) => up({ interest_rate_change_pct: v })} format={(v) => `${v > 0 ? '+' : ''}${v} pts`} />
            <Slider label="Time horizon" value={f.years ?? 5} min={1} max={30} step={1} onChange={(v) => up({ years: v })} format={(v) => `${v} years`} />
            <div className="row wrap">
              {futures.length < 3 && (
                <button className="btn sm" onClick={() => setFutures((fs) => [...fs, { ...fs[active]!, name: `Future ${String.fromCharCode(65 + fs.length)}` }])}>
                  <Icon name="plus" size={13} /> Add future
                </button>
              )}
              {futures.length > 1 && (
                <button
                  className="btn sm ghost"
                  onClick={() => {
                    setFutures((fs) => fs.filter((_, i) => i !== active))
                    setActive(0)
                  }}
                >
                  Remove this future
                </button>
              )}
            </div>
            <p className="tiny muted">Changes apply when you press Simulate.</p>
          </div>
        </Panel>
        <div className="stack">
          <ErrorBox error={w.error} onRetry={() => w.run()} />
          {!res && w.loading && <Loading label="Simulating every future…" height={360} />}
          {res && (
            <>
              <Panel title="Futures compared" sub="Median line and P5–P95 band for each future; the dashed line is your goal">
                <MultiFan futures={res} target={target} />
              </Panel>
              <Panel title="Side by side">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Measure</th>
                        {res.map((x, i) => (
                          <th key={x.name + i} className="r">
                            <span className="row" style={{ justifyContent: 'flex-end' }}>
                              <span className="dot" style={{ color: FUTURE_COLORS[i] }} />
                              {x.name}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const vals = res.map(r.get)
                        const nums = vals.filter((v): v is number => v !== null)
                        const best = nums.length > 1 ? (r.better === 'high' ? Math.max(...nums) : Math.min(...nums)) : null
                        return (
                          <tr key={r.label}>
                            <td className="text-2">{r.label}</td>
                            {vals.map((v, i) => (
                              <td key={i} className={`r num ${r.label === 'Goal success' ? probTone(v) : ''}`} style={best !== null && v === best ? { fontWeight: 600 } : undefined}>
                                {r.fmt(v)}
                                {best !== null && v === best && res.length > 1 ? ' ★' : ''}
                              </td>
                            ))}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="tiny muted mt-sm">★ marks the best value in each row. Goal targets are re-priced when inflation differs from the 5.5% base.</p>
              </Panel>
            </>
          )}
        </div>
      </div>
      <Disclaimer />
    </div>
  )
}
