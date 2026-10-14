import { useEffect, useState } from 'react'

import { useLanguage } from '@/components/LanguageContext'
import { DataTag } from '@/components/atlas/DataTag'
import { api } from '@/services/api'
import type { AtlasSource, MarketStats } from '@/services/types'

const SOURCES: AtlasSource[] = ['user', 'calculated', 'historical', 'assumption', 'simulated']
const METHODS = ['calc', 'sim', 'rules', 'retrieval', 'llm'] as const

/** Where every number comes from, how fresh the data is, and which method produced each answer. */
export function DataBasis({ market }: { market: MarketStats | null }) {
  const { t } = useLanguage()
  const [llm, setLlm] = useState<string | null>(null)
  useEffect(() => {
    const c = new AbortController()
    api<{ llm: string }>('/api/health', { signal: c.signal })
      .then((h) => setLlm(h.llm))
      .catch(() => setLlm(null))
    return () => c.abort()
  }, [])
  const llmOn = !!llm && llm !== 'none'
  return (
    <section className="cc-panel basis mt" data-i18n aria-labelledby="basis-h">
      <h2 id="basis-h">{t('db.title')}</h2>
      <p className="small text-2">{t('db.sub')}</p>
      <div className="basis-grid">
        <div>
          <h3 className="basis-k">{t('db.kinds')}</h3>
          <ul className="basis-list">
            {SOURCES.map((s) => (
              <li key={s}>
                <DataTag source={s} /> <span>{t(`db.${s}`)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="basis-k">{t('db.fresh')}</h3>
          {market ? (
            <ul className="basis-list">
              <li>
                <DataTag source="historical" /> <span>{t('db.market', { period: market.equity.period, asOf: market.regime.as_of })}</span>
              </li>
              <li>
                <DataTag source="historical" /> <span>{t('db.debt', { source: market.debt.source })}</span>
              </li>
              <li>
                <DataTag source="assumption" /> <span>{t('db.gold', { mean: market.gold.mean_pct.toFixed(1), vol: market.gold.vol_pct.toFixed(1) })}</span>
              </li>
              <li>
                <DataTag source="assumption" /> <span>{t('db.inflation', { mean: market.inflation.mean_pct.toFixed(1) })}</span>
              </li>
              <li>
                <DataTag source="simulated" /> <span>{t('db.paths')}</span>
              </li>
              <li className="basis-warn">{t('db.notLive')}</li>
            </ul>
          ) : (
            <div className="skeleton" style={{ height: 140 }} />
          )}
        </div>
        <div>
          <h3 className="basis-k">{t('db.methods')}</h3>
          <ul className="basis-list">
            {METHODS.map((m) => (
              <li key={m}>
                <b>{t(`db.m.${m}`)}</b> <span>{m === 'llm' ? (llm === null ? '…' : llmOn ? t('db.m.llm.on', { provider: llm }) : t('db.m.llm.off')) : t(`db.m.${m}.x`)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
