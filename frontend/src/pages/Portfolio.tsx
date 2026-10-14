import { useRef, useState } from 'react'

import { CLASS_COLOR } from '@/charts/charts'
import { Icon } from '@/components/icons'
import { Badge, Bar, Disclaimer, ErrorBox, Metric, NeedsTwin, Panel, Spinner } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { inr, inrShort, pct, probTone } from '@/lib/format'
import { analyze, api } from '@/services/api'
import type { DoctorResult, Holding } from '@/services/types'
import { useApp } from '@/stores/app'

const CLASSES = ['equity', 'debt', 'gold', 'cash', 'real_estate', 'other']
const SUB_LABEL: Record<string, string> = { diversification: 'Diversification', concentration: 'Concentration', sector_exposure: 'Sector exposure', liquidity: 'Liquidity', risk: 'Risk fit', goal_alignment: 'Goal alignment' }
const SEV_TONE: Record<string, string> = { high: 'red', medium: 'amber', low: 'blue' }

export default function Portfolio() {
  const profile = useApp((s) => s.profile)
  const [rows, setRows] = useState<Holding[]>([])
  const [csv, setCsv] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const doc = useAsync((signal) => analyze<DoctorResult>('/api/portfolio/doctor', csv ? { csv } : { holdings: rows }, signal))
  const [loadErr, setLoadErr] = useState<string | null>(null)

  if (!profile)
    return (
      <div className="page">
        <h1>Portfolio Doctor</h1>
        <div className="mt">
          <NeedsTwin what="The Portfolio Doctor" />
        </div>
      </div>
    )

  async function readFile(f: File) {
    setLoadErr(null)
    if (f.size > 500_000) {
      setLoadErr('That file is larger than 500 KB. Export just the holdings.')
      return
    }
    const text = await f.text()
    setCsv(text)
    setFileName(f.name)
    setRows([])
  }

  async function useSample() {
    setLoadErr(null)
    try {
      const r = await api<{ csv: string }>('/api/demo/sample-portfolio')
      setCsv(r.csv)
      setFileName('sample portfolio.csv')
      setRows([])
    } catch (e) {
      setLoadErr((e as Error).message)
    }
  }

  const d = doc.data
  const ready = !!csv || rows.length > 0
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Portfolio Doctor</h1>
          <p>Upload what you hold today. The Doctor scores diversification, concentration, sector exposure, liquidity, risk and goal fit, finds the problems, and writes a rebalancing plan toward your recommended mix.</p>
        </div>
      </div>
      <div className="grid g-side">
        <div className="stack">
          <Panel title="Your holdings">
            <div
              className="state"
              style={{ borderColor: drag ? 'var(--brass)' : undefined, textAlign: 'center', padding: 22 }}
              onDragOver={(e) => {
                e.preventDefault()
                setDrag(true)
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDrag(false)
                const f = e.dataTransfer.files[0]
                if (f) readFile(f)
              }}
            >
              <Icon name="upload" size={22} />
              <p className="small mt-sm">{fileName ? `Loaded ${fileName}` : 'Drop portfolio.csv here'}</p>
              <p className="tiny muted">Columns: symbol, asset_class, sector, value</p>
              <div className="row wrap mt" style={{ justifyContent: 'center' }}>
                <button className="btn sm" onClick={() => fileRef.current?.click()}>
                  Choose file
                </button>
                <button className="btn sm ghost" onClick={useSample}>
                  Use sample portfolio
                </button>
              </div>
              <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
            </div>
            <div className="row between mt">
              <span className="small text-2">Or enter holdings manually</span>
              <button
                className="btn sm"
                onClick={() => {
                  setCsv(null)
                  setFileName(null)
                  setRows((r) => [...r, { symbol: '', asset_class: 'equity', sector: '', value: 0 }])
                }}
              >
                <Icon name="plus" size={13} /> Add holding
              </button>
            </div>
            {rows.length > 0 && (
              <div className="stack-sm mt">
                {rows.map((h, i) => (
                  <div key={i} className="grid" style={{ gridTemplateColumns: '1.3fr 1fr 1fr 32px', gap: 6 }}>
                    <input className="input" aria-label="Holding name" placeholder="Name" value={h.symbol} onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, symbol: e.target.value } : x)))} />
                    <select className="select" aria-label="Asset class" value={h.asset_class} onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, asset_class: e.target.value } : x)))}>
                      {CLASSES.map((c) => (
                        <option key={c} value={c}>
                          {c.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                    <input className="input num" aria-label="Value in rupees" inputMode="numeric" placeholder="₹ value" value={h.value || ''} onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, value: Number(e.target.value.replace(/,/g, '')) || 0 } : x)))} />
                    <button className="btn sm ghost" aria-label="Remove holding" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
                      <Icon name="x" size={13} />
                    </button>
                    <input className="input" aria-label="Sector" placeholder="Sector (optional)" style={{ gridColumn: '1 / 4' }} value={h.sector} onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, sector: e.target.value } : x)))} />
                  </div>
                ))}
              </div>
            )}
            <ErrorBox error={loadErr} />
            <button className="btn primary mt" style={{ width: '100%' }} disabled={!ready || doc.loading} onClick={() => doc.run()}>
              {doc.loading && <Spinner />} Diagnose portfolio
            </button>
          </Panel>
        </div>

        <div className="stack">
          <ErrorBox error={doc.error} onRetry={() => doc.run()} />
          {!d && !doc.loading && (
            <div className="state">
              <h3>No portfolio yet</h3>
              <p>Upload a CSV, add holdings by hand, or try the sample portfolio to see a full diagnosis.</p>
            </div>
          )}
          {!d && doc.loading && <div className="skeleton" style={{ height: 380 }} />}
          {d && (
            <>
              <Panel>
                <div className="grid g3">
                  <Metric label="Portfolio health" value={`${Math.round(d.health_score)}/100`} size="lg" sub={<Badge tone={d.health_score >= 75 ? 'green' : d.health_score >= 55 ? 'amber' : 'red'}>{d.health_label.toLowerCase()}</Badge>} />
                  <Metric label="Total value" value={inrShort(d.total_value)} sub={`${d.holdings.length} holdings, concentration index ${d.hhi.toFixed(2)}`} />
                  <Metric label="Goal success" value={`${pct(d.goal_probability_current)} → ${pct(d.goal_probability_prescribed)}`} tone={probTone(d.goal_probability_prescribed)} sub="current mix → after treatment" />
                </div>
                <div className="grid g2 mt" style={{ gap: '10px 32px' }}>
                  {Object.entries(d.sub_scores).map(([k, v]) => (
                    <div key={k} className="dna-row" style={{ gridTemplateColumns: '130px 1fr 34px' }}>
                      <span className="text-2">{SUB_LABEL[k] ?? k}</span>
                      <Bar value={v} tone={v >= 75 ? 'green' : v >= 55 ? 'amber' : 'red'} />
                      <span className="num" style={{ textAlign: 'right' }}>
                        {Math.round(v)}
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>
              <div className="grid g2">
                <Panel title="Diagnosis">
                  {d.issues.length === 0 ? (
                    <p className="small green">No issues found against your Risk DNA and goal.</p>
                  ) : (
                    <div className="stack-sm">
                      {d.issues.map((i) => (
                        <div key={i.text} className="row" style={{ alignItems: 'flex-start' }}>
                          <Badge tone={SEV_TONE[i.severity]}>{i.severity}</Badge>
                          <span className="small">{i.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="small text-2 mt">
                    Estimated volatility {d.portfolio_vol_pct.toFixed(1)}% vs {d.target_vol_pct.toFixed(1)}% suited to you.
                  </div>
                </Panel>
                <Panel title="Allocation before and after">
                  <div className="stack-sm">
                    {CLASSES.filter((c) => (d.allocation_before[c] ?? 0) > 0 || (d.allocation_after[c] ?? 0) > 0).map((c) => (
                      <div key={c}>
                        <div className="row between small">
                          <span className="row">
                            <span className="dot" style={{ color: CLASS_COLOR[c] }} />
                            {c.replace('_', ' ')}
                          </span>
                          <span className="num">
                            {pct(d.allocation_before[c])} → {pct(d.allocation_after[c])}
                          </span>
                        </div>
                        <div className="bar mt-sm">
                          <i style={{ width: `${(d.allocation_after[c] ?? 0) * 100}%`, background: CLASS_COLOR[c] }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  {Object.keys(d.sectors).length > 0 && (
                    <div className="mt small">
                      <div className="text-2">Equity by sector</div>
                      <div className="row wrap mt-sm">
                        {Object.entries(d.sectors).map(([s, v]) => (
                          <Badge key={s} tone={v > 0.3 ? 'red' : ''}>
                            {s} {pct(v)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </Panel>
              </div>
              <Panel title="Treatment plan" sub="Trades that move the portfolio to your recommended mix and inside concentration limits">
                {d.treatment.length === 0 ? (
                  <p className="small text-2">No trades needed.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Action</th>
                          <th>What</th>
                          <th className="r">Amount</th>
                          <th>Why</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.treatment.map((t, i) => (
                          <tr key={i}>
                            <td>
                              <Badge tone={t.action === 'BUY' ? 'green' : 'red'}>{t.action.toLowerCase()}</Badge>
                            </td>
                            <td>{t.target}</td>
                            <td className="r num">{inr(t.amount)}</td>
                            <td className="small text-2">{t.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
              <Panel title="How the holdings move together" sub="Class and sector correlation model; darker means more alike">
                <Heatmap symbols={d.symbols} m={d.correlation} />
              </Panel>
            </>
          )}
        </div>
      </div>
      <Disclaimer />
    </div>
  )
}

function Heatmap({ symbols, m }: { symbols: string[]; m: number[][] }) {
  const n = symbols.length
  if (n > 20) return <p className="small muted">Too many holdings to draw the matrix.</p>
  const cell = 34
  const pad = 130
  return (
    <div className="table-wrap">
      <svg width={pad + n * cell} height={pad + n * cell} role="img" aria-label="Correlation matrix">
        {symbols.map((s, i) => (
          <text key={`r${s}${i}`} x={pad - 8} y={pad + i * cell + cell / 2} textAnchor="end" dominantBaseline="middle" fill="#b4bfd1" fontSize="12">
            {s.slice(0, 18)}
          </text>
        ))}
        {symbols.map((s, j) => (
          <text key={`c${s}${j}`} transform={`translate(${pad + j * cell + cell / 2} ${pad - 8}) rotate(-50)`} fill="#b4bfd1" fontSize="12">
            {s.slice(0, 18)}
          </text>
        ))}
        {m.map((row, i) =>
          row.map((v, j) => (
            <g key={`${i}-${j}`}>
              <rect x={pad + j * cell} y={pad + i * cell} width={cell - 2} height={cell - 2} rx={3} fill={v >= 0 ? `rgba(111,168,255,${0.08 + v * 0.75})` : `rgba(201,162,74,${0.15 + -v * 2})`}>
                <title>
                  {symbols[i]} × {symbols[j]}: {v.toFixed(2)}
                </title>
              </rect>
              {n <= 10 && (
                <text x={pad + j * cell + (cell - 2) / 2} y={pad + i * cell + (cell - 2) / 2} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="#e8ecf3">
                  {v.toFixed(1)}
                </text>
              )}
            </g>
          )),
        )}
      </svg>
    </div>
  )
}
