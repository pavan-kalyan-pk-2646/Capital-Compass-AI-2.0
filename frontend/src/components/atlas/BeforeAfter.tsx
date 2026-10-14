import { useLanguage } from '@/components/LanguageContext'
import { DataTag } from '@/components/atlas/DataTag'
import { Explain, type Term } from '@/components/atlas/Explain'
import { inr, pct } from '@/lib/format'
import type { Plan, PlanHealth } from '@/services/types'

interface Row {
  key: string
  term?: Term
  fmt: (h: PlanHealth, p: Plan) => string
  num: (h: PlanHealth, p: Plan) => number | null
  better: 'high' | 'low' | null
  source: 'simulated' | 'calculated'
}

const ROWS: Row[] = [
  { key: 'ba.goal', term: 'montecarlo', fmt: (h) => pct(h.goal_success_probability), num: (h) => h.goal_success_probability, better: 'high', source: 'simulated' },
  { key: 'ba.ef', term: 'coverage', fmt: (h) => `${h.emergency_fund_months.toFixed(1)}`, num: (h) => h.emergency_fund_months, better: 'high', source: 'calculated' },
  { key: 'ba.cash', fmt: (h) => (h.monthly_left_after_plan == null ? '—' : inr(h.monthly_left_after_plan)), num: (h) => h.monthly_left_after_plan ?? null, better: 'high', source: 'calculated' },
  { key: 'ba.debt', term: 'foir', fmt: (h) => pct(h.foir), num: (h) => h.foir, better: 'low', source: 'calculated' },
  { key: 'ba.worst', term: 'drawdown', fmt: (h) => pct(h.crash_loss, 1), num: (h) => h.crash_loss, better: 'low', source: 'calculated' },
  { key: 'ba.equity', fmt: (h, p) => pct(h.equity ?? p.weights.equity), num: (h, p) => h.equity ?? p.weights.equity, better: null, source: 'calculated' },
  { key: 'ba.sip', term: 'sip', fmt: (h, p) => inr(h.monthly_sip ?? p.monthly_sip), num: (h, p) => h.monthly_sip ?? p.monthly_sip, better: null, source: 'calculated' },
  { key: 'ba.emi', fmt: (h, p) => { const e = h.loan_emi ?? p.loan?.emi ?? 0; return e ? inr(e) : '—' }, num: (h, p) => h.loan_emi ?? p.loan?.emi ?? 0, better: 'low', source: 'calculated' },
]

/** Original vs optimized plan. Every value is an engine output (plan_health / the plan itself). */
export function BeforeAfter({ before, after, planBefore, planAfter }: { before: PlanHealth; after: PlanHealth; planBefore: Plan; planAfter: Plan }) {
  const { t } = useLanguage()
  return (
    <div className="table-wrap ba" data-i18n>
      <table className="table">
        <thead>
          <tr>
            <th />
            <th className="r">{t('ba.original')}</th>
            <th className="r">{t('ba.optimized')}</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => {
            const a = r.num(before, planBefore)
            const b = r.num(after, planAfter)
            const changed = a !== null && b !== null && Math.abs(a - b) > 1e-6
            const good = !changed || r.better === null ? null : r.better === 'high' ? (b ?? 0) > (a ?? 0) : (b ?? 0) < (a ?? 0)
            return (
              <tr key={r.key}>
                <td className="text-2">
                  {t(r.key)} {r.term && <Explain term={r.term} />} <DataTag source={r.source} />
                </td>
                <td className="r num">{r.fmt(before, planBefore)}</td>
                <td className={`r num ${good === null ? '' : good ? 'green' : 'red'}`}>
                  {r.fmt(after, planAfter)} {changed && <span aria-hidden="true">{(b ?? 0) > (a ?? 0) ? '▲' : '▼'}</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
