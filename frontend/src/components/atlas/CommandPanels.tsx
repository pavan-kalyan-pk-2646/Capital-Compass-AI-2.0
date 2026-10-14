import { Link } from 'react-router-dom'

import { Icon } from '@/components/icons'
import { useLanguage } from '@/components/LanguageContext'
import { DataTag } from '@/components/atlas/DataTag'
import { Explain, type Term } from '@/components/atlas/Explain'
import { findingAction, findingText, pillarExplain } from '@/lib/atlasText'
import { pct } from '@/lib/format'
import type { AtlasBrief, AtlasSource, DashboardData, Snapshot } from '@/services/types'
import './atlas-ui.css'

const tone = (v: number) => (v >= 80 ? 'green' : v >= 60 ? 'blue' : v >= 40 ? 'amber' : 'red')

/** The Capital Health Index and its five pillars, each with where its number came from. */
export function HealthIndex({ brief }: { brief: AtlasBrief }) {
  const { t } = useLanguage()
  const h = brief.health_index
  return (
    <section className="cc-panel chi" data-i18n aria-labelledby="chi-h">
      <div className="cc-panel-head">
        <h2 id="chi-h">{t('chi.title')}</h2>
        <DataTag source="calculated" />
      </div>
      <div className="chi-top">
        <div className={`chi-score ${tone(h.score)}`}>
          <strong>{Math.round(h.score)}</strong>
          <span>/100</span>
        </div>
        <div>
          <div className={`chi-band ${tone(h.score)}`}>{t(`chi.band.${h.band}`)}</div>
          <p className="small text-2">{t('chi.sub')}</p>
        </div>
      </div>
      <ul className="chi-pillars">
        {h.pillars.map((p) => (
          <li key={p.key} className={p.score === null ? 'none' : ''}>
            <div className="chi-row">
              <span className="chi-name">{t(`chi.${p.key}`)}</span>
              <span className="chi-bar" aria-hidden="true">
                <i className={p.score === null ? '' : tone(p.score)} style={{ width: `${p.score ?? 0}%` }} />
              </span>
              <span className="chi-val num">{p.score === null ? '—' : Math.round(p.score)}</span>
            </div>
            <div className="chi-x">
              {pillarExplain(t, p)} <DataTag source={p.source} />
            </div>
          </li>
        ))}
      </ul>
      <p className="tiny muted">
        {t('chi.formula')} {h.renormalised && t('chi.renorm')}
      </p>
    </section>
  )
}

/** Atlas's next action: the first threshold rule that fires, with the numbers that fired it. */
export function AtlasRecommends({ brief }: { brief: AtlasBrief }) {
  const { t } = useLanguage()
  const r = brief.recommendation
  const strengths = brief.strengths.slice(0, 2).map((s) => t(`chi.${s.key}`).toLowerCase())
  return (
    <section className={`cc-panel rec rec-${r.severity}`} data-i18n aria-labelledby="rec-h">
      <p className="rec-who" id="rec-h">
        <span className="rec-mark" aria-hidden="true" /> {t('rec.title').toUpperCase()}
      </p>
      {strengths.length > 0 && <p className="rec-strength">{t('rec.strength', { list: strengths.join(', ') })}</p>}
      <p className="rec-text">{findingText(t, r)}</p>
      <p className="rec-next-k">{t('rec.next')}</p>
      <Link className="btn primary rec-cta" to={r.route}>
        {findingAction(t, r)} <Icon name="arrow" size={14} />
      </Link>
      {brief.findings.length > 0 && (
        <div className="rec-also">
          <p className="rec-next-k">{t('rec.also')}</p>
          <ul>
            {brief.findings.slice(0, 3).map((f) => (
              <li key={f.code} className={`sev-${f.severity}`}>
                <span>{findingText(t, f)}</span>
                <Link to={f.route}>{findingAction(t, f)}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="tiny muted rec-basis">{t('rec.basis')}</p>
    </section>
  )
}

interface Cell {
  key: string
  label: string
  value: string
  sub: string
  tone: string
  to: string
  source: AtlasSource
  term?: Term
}

/** The six numbers that answer "where am I?", each linking to the page that explains it. */
export function StatusStrip({ snap, board }: { snap: Snapshot; board: DashboardData | null }) {
  const { t } = useLanguage()
  const tw = snap.twin
  const primary = board?.goals.find((g) => g.primary) ?? board?.goals[0]
  const pf = board?.portfolio
  const debt = tw.dti > 0.4 ? 'High' : tw.dti > 0.3 ? 'Moderate' : 'Low'
  const cells: Cell[] = [
    { key: 'health', label: t('cc.health'), value: `${Math.round(tw.health_score)}`, sub: t(`chi.band.${tw.health_band}`), tone: tone(tw.health_score), to: '/twin', source: 'calculated' },
    { key: 'risk', label: t('cc.riskStatus'), value: `${Math.round(snap.risk_dna.profile_score)}`, sub: snap.risk_dna.label, tone: 'blue', to: '/twin#risk-dna', source: 'calculated' },
    {
      key: 'goal',
      label: t('cc.goalSurvival'),
      value: primary && primary.probability != null ? pct(primary.probability) : '—',
      sub: primary ? primary.name : t('cc.noGoal'),
      tone: primary?.probability == null ? '' : primary.probability >= 0.75 ? 'green' : primary.probability >= 0.5 ? 'amber' : 'red',
      to: '/goals',
      source: 'simulated',
      term: 'montecarlo',
    },
    { key: 'liq', label: t('cc.liquidity'), value: tw.emergency_fund_months >= 99 ? '∞' : tw.emergency_fund_months.toFixed(1), sub: t('cc.monthsUnit'), tone: tw.emergency_fund_months < 3 ? 'red' : tw.emergency_fund_months < 6 ? 'amber' : 'green', to: '/crisis?scenario=job_loss', source: 'calculated', term: 'coverage' },
    { key: 'debt', label: t('cc.debtPressure'), value: t(`cc.band.${debt}`), sub: t('cc.emiShare', { pct: pct(tw.dti) }), tone: debt === 'High' ? 'red' : debt === 'Moderate' ? 'amber' : 'green', to: '/loan', source: 'calculated', term: 'foir' },
    { key: 'pf', label: t('cc.portfolioHealth'), value: pf ? `${Math.round(pf.health_score)}` : '—', sub: pf ? '' : t('cc.noHoldings'), tone: pf ? tone(pf.health_score) : '', to: '/portfolio', source: 'calculated', term: 'diversification' },
  ]
  return (
    <div className="cc-status" data-i18n>
      {cells.map((c) => (
        <div key={c.key} className="cc-cell">
          <Link to={c.to} className="cc-cell-link">
            <span className="cc-k">{c.label}</span>
            <strong className={`cc-v ${c.tone}`}>{c.value}</strong>
            <span className="cc-s">{c.sub}</span>
          </Link>
          <div className="cc-cell-foot">
            <DataTag source={c.source} />
            {c.term && <Explain term={c.term} />}
          </div>
        </div>
      ))}
    </div>
  )
}
