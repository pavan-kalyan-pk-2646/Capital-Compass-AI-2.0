/** Turn Atlas engine findings (codes + numbers) into localized sentences. No numbers are made up here. */
import { inr, pct } from '@/lib/format'
import type { Params } from '@/lib/i18n'
import type { AtlasFinding, AtlasPillar } from '@/services/types'

type T = (key: string, params?: Params) => string

/** Format the raw numbers a finding carries the way the sentence needs them. */
export function findingParams(f: AtlasFinding): Params {
  const p = f.params
  const out: Params = {}
  if (p.shortfall !== undefined) out.shortfall = inr(Number(p.shortfall))
  if (p.amount !== undefined) out.amount = inr(Number(p.amount))
  if (p.months !== undefined) out.months = Number(p.months).toFixed(1)
  if (p.dti !== undefined) out.pct = pct(Number(p.dti))
  if (p.probability !== undefined) out.pct = pct(Number(p.probability))
  if (p.goal !== undefined) out.goal = String(p.goal)
  if (p.equity_share !== undefined) out.equity = pct(Number(p.equity_share))
  if (p.target_equity !== undefined) out.target = pct(Number(p.target_equity))
  return out
}

export const findingText = (t: T, f: AtlasFinding) => t(`rec.${f.code}`, findingParams(f))
export const findingAction = (t: T, f: AtlasFinding) => t(`rec.${f.code}.a`)

/** One line explaining where a Capital Health Index pillar's score comes from. */
export function pillarExplain(t: T, p: AtlasPillar): string {
  const b = p.basis
  switch (p.key) {
    case 'liquidity':
      return t('chi.liquidity.x', { months: `${Number(b.months).toFixed(1)}` })
    case 'debt':
      return t('chi.debt.x', { pct: pct(Number(b.dti)) })
    case 'goals':
      return p.score === null ? t('chi.goals.none') : t('chi.goals.x', { pct: pct(Number(b.probability)) })
    case 'growth':
      return b.required !== undefined ? t('chi.growth.x', { current: inr(Number(b.monthly_investment)), required: inr(Number(b.required)) }) : t('chi.growth.sr', { pct: pct(Number(b.savings_rate)) })
    case 'resilience':
      return t('chi.resilience.x')
  }
}
