import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { inr, inrShort, pct } from '@/lib/format'
import type { Percentiles } from '@/services/types'

const AXIS = { stroke: '#5d6b84', fontSize: 12, tickLine: false, axisLine: false } as const
const GRID = <CartesianGrid stroke="#22314a" strokeDasharray="0" vertical={false} />
const TIP = {
  contentStyle: { background: '#16223a', border: '1px solid #2d3f5e', borderRadius: 10, fontSize: 13 },
  labelStyle: { color: '#b4bfd1' },
  itemStyle: { color: '#e8ecf3' },
}

function yearLabel(m: number) {
  return m === 0 ? 'Now' : m % 12 === 0 ? `Y${m / 12}` : `M${m}`
}

function rows(p: Percentiles) {
  return p.month.map((m, i) => ({
    m,
    band: [p.p5[i], p.p95[i]] as [number, number],
    mid: [p.p25[i], p.p75[i]] as [number, number],
    p50: p.p50[i],
    p5: p.p5[i],
    p95: p.p95[i],
  }))
}

/** Percentile fan: P5–P95 and P25–P75 bands with the median line and an optional goal line. */
export function FanChart({ p, target, compare, compareLabel = 'Before', label = 'Median', height = 280, tone = 'blue' }: { p: Percentiles; target?: number | null; compare?: Percentiles; compareLabel?: string; label?: string; height?: number; tone?: 'blue' | 'red' }) {
  const data = rows(p).map((r, i) => ({ ...r, cmp: compare ? compare.p50[Math.min(i, compare.p50.length - 1)] : undefined }))
  const c = tone === 'red' ? '#f0566a' : '#6fa8ff'
  return (
    <div style={{ height }} role="img" aria-label={`Percentile fan chart. Median ends at ${inrShort(p.p50[p.p50.length - 1])}`}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          {GRID}
          <XAxis dataKey="m" tickFormatter={yearLabel} {...AXIS} interval="preserveStartEnd" minTickGap={28} />
          <YAxis tickFormatter={(v) => inrShort(v)} {...AXIS} width={64} />
          <Tooltip
            {...TIP}
            labelFormatter={(m) => `Month ${m}`}
            formatter={(v: number | number[], name: string) => {
              if (Array.isArray(v)) return [`${inrShort(v[0])} – ${inrShort(v[1])}`, name]
              return [inrShort(v), name]
            }}
          />
          <Area dataKey="band" name="P5–P95" stroke="none" fill={c} fillOpacity={0.12} isAnimationActive={false} />
          <Area dataKey="mid" name="P25–P75" stroke="none" fill={c} fillOpacity={0.22} isAnimationActive={false} />
          {compare && <Line dataKey="cmp" name={compareLabel} stroke="#8d9ab0" strokeDasharray="5 4" dot={false} strokeWidth={1.5} isAnimationActive={false} />}
          <Line dataKey="p50" name={label} stroke={c} dot={false} strokeWidth={2.2} isAnimationActive={false} />
          {target ? <ReferenceLine y={target} stroke="#c9a24a" strokeDasharray="6 4" label={{ value: `Goal ${inrShort(target)}`, fill: '#e3c37a', fontSize: 12, position: 'insideTopLeft' }} /> : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

const FUTURE_COLORS = ['#6fa8ff', '#c9a24a', '#a99bf0', '#3ccb8f']

/** Median + P5–P95 band for several what-if futures on one axis. */
export function MultiFan({ futures, target, height = 320 }: { futures: { name: string; percentiles: Percentiles }[]; target?: number | null; height?: number }) {
  const months = Array.from(new Set(futures.flatMap((f) => f.percentiles.month))).sort((a, b) => a - b)
  const data = months.map((m) => {
    const row: Record<string, number | [number, number]> = { m }
    futures.forEach((f, i) => {
      const idx = f.percentiles.month.indexOf(m)
      if (idx >= 0) {
        row[`b${i}`] = [f.percentiles.p5[idx]!, f.percentiles.p95[idx]!]
        row[`p${i}`] = f.percentiles.p50[idx]!
      }
    })
    return row
  })
  return (
    <div style={{ height }} role="img" aria-label="Comparison of simulated futures">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          {GRID}
          <XAxis dataKey="m" tickFormatter={yearLabel} {...AXIS} type="number" domain={['dataMin', 'dataMax']} />
          <YAxis tickFormatter={(v) => inrShort(v)} {...AXIS} width={64} />
          <Tooltip
            {...TIP}
            labelFormatter={(m) => `Month ${m}`}
            formatter={(v: number | number[], name: string) => (Array.isArray(v) ? [`${inrShort(v[0])} – ${inrShort(v[1])}`, name] : [inrShort(v), name])}
          />
          <Legend wrapperStyle={{ fontSize: 13 }} />
          {futures.map((f, i) => (
            <Area key={`b${i}`} dataKey={`b${i}`} name={`${f.name} P5–P95`} legendType="none" stroke="none" fill={FUTURE_COLORS[i]} fillOpacity={0.1} isAnimationActive={false} connectNulls />
          ))}
          {futures.map((f, i) => (
            <Line key={`p${i}`} dataKey={`p${i}`} name={`${f.name} median`} stroke={FUTURE_COLORS[i]} dot={false} strokeWidth={2.2} isAnimationActive={false} connectNulls />
          ))}
          {target ? <ReferenceLine y={target} stroke="#c9a24a" strokeDasharray="6 4" /> : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
export { FUTURE_COLORS }

const CLASS_COLOR: Record<string, string> = { equity: '#6fa8ff', debt: '#3ccb8f', gold: '#c9a24a', cash: '#8d9ab0', real_estate: '#a99bf0', other: '#5d6b84' }

export function Donut({ data, height = 200, center }: { data: { name: string; value: number; key: string }[]; height?: number; center?: string }) {
  return (
    <div style={{ height, position: 'relative' }} role="img" aria-label={data.map((d) => `${d.name} ${pct(d.value)}`).join(', ')}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" stroke="#111b2e" strokeWidth={2} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.key} fill={CLASS_COLOR[d.key] ?? '#5d6b84'} />
            ))}
          </Pie>
          <Tooltip {...TIP} formatter={(v: number, n: string) => [pct(v, 1), n]} />
        </PieChart>
      </ResponsiveContainer>
      {center && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
          <span className="small text-2" style={{ textAlign: 'center', maxWidth: 90 }}>
            {center}
          </span>
        </div>
      )}
    </div>
  )
}
export { CLASS_COLOR }

export function Legendish({ items }: { items: { label: string; value: string; key: string }[] }) {
  return (
    <div className="stack-sm">
      {items.map((i) => (
        <div key={i.key} className="row between small">
          <span className="row">
            <span className="dot" style={{ color: CLASS_COLOR[i.key] ?? '#5d6b84' }} />
            {i.label}
          </span>
          <span className="num">{i.value}</span>
        </div>
      ))}
    </div>
  )
}

export function AmortChart({ rows: data, height = 220 }: { rows: { year: number; interest: number; principal: number }[]; height?: number }) {
  return (
    <div style={{ height }} role="img" aria-label="Yearly principal and interest">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          {GRID}
          <XAxis dataKey="year" tickFormatter={(y) => `Y${y}`} {...AXIS} />
          <YAxis tickFormatter={(v) => inrShort(v)} {...AXIS} width={60} />
          <Tooltip {...TIP} labelFormatter={(y) => `Year ${y}`} formatter={(v: number, n: string) => [inr(v), n]} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Legend wrapperStyle={{ fontSize: 13 }} />
          <Bar dataKey="principal" name="Principal" stackId="a" fill="#6fa8ff" isAnimationActive={false} />
          <Bar dataKey="interest" name="Interest" stackId="a" fill="#f0566a" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Horizontal probability bars — exact values are printed, colour encodes the band. */
export function ProbBars({ items }: { items: { label: string; value: number | null; note?: string }[] }) {
  return (
    <div className="stack-sm">
      {items.map((i) => {
        const v = i.value ?? 0
        const color = v >= 0.7 ? 'var(--green)' : v >= 0.5 ? 'var(--amber)' : 'var(--red)'
        return (
          <div key={i.label}>
            <div className="row between small">
              <span>{i.label}</span>
              <span className="num" style={{ color }}>
                {pct(i.value)}
              </span>
            </div>
            <div className="bar mt-sm" style={{ height: 8 }}>
              <i style={{ width: `${v * 100}%`, background: color }} />
            </div>
            {i.note && <div className="tiny muted mt-sm">{i.note}</div>}
          </div>
        )
      })}
    </div>
  )
}
