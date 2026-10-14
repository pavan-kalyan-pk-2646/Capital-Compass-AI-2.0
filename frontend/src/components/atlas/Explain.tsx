import './atlas-ui.css'
import { useEffect, useId, useRef, useState } from 'react'

import { useLanguage } from '@/components/LanguageContext'

export type Term = 'foir' | 'cagr' | 'sip' | 'drawdown' | 'volatility' | 'liquidity' | 'diversification' | 'montecarlo' | 'coverage' | 'debtburden'

/** "What is this?" for a finance term: what it is, why it matters, and a worked example. */
export function Explain({ term, label }: { term: Term; label?: boolean }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const id = useId()
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])
  return (
    <span className="explain" ref={box} data-i18n>
      <button type="button" className="explain-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} title={t('ex.button')}>
        {label ? `${t(`term.${term}`)} · ` : ''}?<span className="sr-only">{t('ex.button')}</span>
      </button>
      {open && (
        <span className="explain-pop" id={id} role="dialog" aria-label={t(`term.${term}`)}>
          <b>{t(`term.${term}`)}</b>
          <span className="explain-k">{t('ex.what')}</span>
          <span>{t(`term.${term}.what`)}</span>
          <span className="explain-k">{t('ex.why')}</span>
          <span>{t(`term.${term}.why`)}</span>
          <span className="explain-k">{t('ex.example')}</span>
          <span className="explain-ex">{t(`term.${term}.ex`)}</span>
        </span>
      )}
    </span>
  )
}
