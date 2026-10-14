import { Bar, Badge } from '@/components/ui'
import { inr, inrShort, pct } from '@/lib/format'
import type { RiskDNA, Snapshot } from '@/services/types'

const BAND_TONE: Record<string, string> = { STRONG: 'green', STABLE: 'blue', STRETCHED: 'amber', FRAGILE: 'red' }

export function HealthBadge({ band }: { band: string }) {
  return <Badge tone={BAND_TONE[band] ?? ''}>{band.charAt(0) + band.slice(1).toLowerCase()}</Badge>
}

export function RiskDNAView({ dna, compact = false }: { dna: RiskDNA; compact?: boolean }) {
  const tone = (k: string, v: number) => {
    const inverse = ['liquidity_need', 'goal_pressure', 'debt_burden'].includes(k)
    const good = inverse ? 100 - v : v
    return good >= 60 ? 'green' : good >= 40 ? 'amber' : 'red'
  }
  return (
    <div className="stack-sm">
      {dna.dimensions.map((d) => (
        <div key={d.key} title={d.explanation}>
          <div className="dna-row">
            <span className="text-2">{d.label}</span>
            <Bar value={d.score} tone={tone(d.key, d.score)} />
            <span className="num" style={{ textAlign: 'right' }}>
              {Math.round(d.score)}
            </span>
          </div>
          {!compact && <div className="tiny muted" style={{ marginLeft: 162 }}>{d.explanation}</div>}
        </div>
      ))}
      <div className="row between small mt-sm">
        <span className="text-2">Overall profile</span>
        <span>
          <strong>{dna.label}</strong> <span className="muted">({Math.round(dna.profile_score)}/100)</span>
        </span>
      </div>
      {dna.capped_by_max_loss && <p className="tiny muted">Profile capped by your stated maximum loss.</p>}
    </div>
  )
}

/** Cash-flow map: where each rupee of income goes, drawn to scale. */
export function FlowMap({ s }: { s: Snapshot }) {
  const f = s.flows
  const income = Math.max(f.income ?? 0, 1)
  const outs = [
    { key: 'essential', label: 'Essentials', v: f.essential ?? 0, color: '#8d9ab0' },
    { key: 'discretionary', label: 'Lifestyle', v: f.discretionary ?? 0, color: '#a99bf0' },
    { key: 'high_risk', label: 'High-risk spending', v: f.high_risk ?? 0, color: '#f0566a' },
    { key: 'emi', label: 'Loan EMIs', v: f.emi ?? 0, color: '#e8a33d' },
    { key: 'surplus', label: 'Surplus', v: Math.max(0, f.surplus ?? 0), color: '#3ccb8f' },
  ].filter((o) => o.v > 0)
  const total = outs.reduce((a, o) => a + o.v, 0) || 1
  const H = 260
  const gap = 8
  const usable = H - gap * (outs.length - 1)
  let y = 0
  const left = { x: 0, w: 14 }
  const rightX = 300
  let ly = 0
  const bands = outs.map((o) => {
    const h = (o.v / total) * usable
    const lh = (o.v / total) * H
    const band = { ...o, y, h, ly, lh }
    y += h + gap
    ly += lh
    return band
  })
  const deficit = (f.surplus ?? 0) < 0
  return (
    <div>
      <svg viewBox={`0 0 520 ${H}`} width="100%" role="img" aria-label="Monthly cash-flow map">
        <rect x={left.x} y={0} width={left.w} height={H} rx={3} fill="#c9a24a" />
        {bands.map((b) => (
          <g key={b.key}>
            <path
              d={`M${left.w} ${b.ly} C ${rightX * 0.55} ${b.ly}, ${rightX * 0.45} ${b.y}, ${rightX} ${b.y} L ${rightX} ${b.y + b.h} C ${rightX * 0.45} ${b.y + b.h}, ${rightX * 0.55} ${b.ly + b.lh}, ${left.w} ${b.ly + b.lh} Z`}
              fill={b.color}
              opacity={0.22}
            />
            <rect x={rightX} y={b.y} width={10} height={Math.max(b.h, 2)} rx={2} fill={b.color} />
            <text x={rightX + 20} y={b.y + Math.max(b.h, 14) / 2 + 1} fill="#e8ecf3" fontSize="11.5" dominantBaseline="middle">
              {b.label}
              <tspan fill="#8d9ab0"> {inr(b.v)} ({pct(b.v / income)})</tspan>
            </text>
          </g>
        ))}
      </svg>
      <div className="row between small mt-sm">
        <span className="text-2">Income {inr(income)}/mo</span>
        {deficit ? <span className="red">Spending exceeds income by {inr(-(f.surplus ?? 0))}/mo</span> : <span className="green">Surplus {inr(f.surplus ?? 0)}/mo</span>}
      </div>
    </div>
  )
}

export function BalanceSheet({ s }: { s: Snapshot }) {
  const a = s.balance.assets
  const l = s.balance.liabilities
  const ta = s.twin.total_assets || 1
  const names: Record<string, string> = { cash: 'Cash & emergency fund', equity: 'Equity', debt: 'Debt / FD / PPF', gold: 'Gold', real_estate: 'Property', other: 'Other' }
  const colors: Record<string, string> = { cash: '#8d9ab0', equity: '#6fa8ff', debt: '#3ccb8f', gold: '#c9a24a', real_estate: '#a99bf0', other: '#5d6b84' }
  return (
    <div className="grid g2" style={{ gap: 24 }}>
      <div>
        <div className="row between small">
          <span className="text-2">Assets</span>
          <strong className="num">{inrShort(s.twin.total_assets)}</strong>
        </div>
        <div className="row mt-sm" style={{ height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 }}>
          {Object.entries(a)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => (
              <span key={k} style={{ flex: v / ta, background: colors[k], height: '100%' }} title={`${names[k]} ${inr(v)}`} />
            ))}
        </div>
        <div className="stack-sm mt">
          {Object.entries(a)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => (
              <div key={k} className="row between small">
                <span className="row">
                  <span className="dot" style={{ color: colors[k] }} />
                  {names[k]}
                </span>
                <span className="num">{inr(v)}</span>
              </div>
            ))}
        </div>
      </div>
      <div>
        <div className="row between small">
          <span className="text-2">Liabilities</span>
          <strong className="num">{inrShort(s.twin.total_liabilities)}</strong>
        </div>
        <div className="stack-sm mt">
          {Object.keys(l).length === 0 && <span className="small muted">No loans or card debt</span>}
          {Object.entries(l).map(([k, v]) => (
            <div key={k} className="row between small">
              <span>{k}</span>
              <span className="num">{inr(v)}</span>
            </div>
          ))}
        </div>
        <div className="inset mt">
          <div className="row between small">
            <span className="text-2">Net worth</span>
            <strong className="num">{inrShort(s.twin.net_worth)}</strong>
          </div>
          <div className="row between small mt-sm">
            <span className="text-2">Liquid share</span>
            <span className="num">{pct(s.twin.liquidity_ratio)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
