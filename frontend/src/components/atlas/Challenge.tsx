import { useState } from 'react'

import { useLanguage } from '@/components/LanguageContext'
import { BeforeAfter } from '@/components/atlas/BeforeAfter'
import { Spinner } from '@/components/ui'
import { api, ApiError } from '@/services/api'
import type { RedTeamAttack, ReoptimizeResult, Weakness } from '@/services/types'

const SEV_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 }

/**
 * "Challenge this decision": the existing Red Team attacks the stored final plan; then
 * "Re-optimize" runs the existing Critic rules and re-optimizer against what it found and
 * shows the original plan against the optimized one. Nothing is stored or overwritten.
 */
export function Challenge({ decisionId }: { decisionId: string }) {
  const { t } = useLanguage()
  const [attack, setAttack] = useState<RedTeamAttack | null>(null)
  const [reopt, setReopt] = useState<ReoptimizeResult | null>(null)
  const [busy, setBusy] = useState<'attack' | 'reopt' | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function run<T>(kind: 'attack' | 'reopt', path: string, done: (r: T) => void) {
    setBusy(kind)
    setErr(null)
    try {
      done(await api<T>(path, { method: 'POST' }))
    } catch (e) {
      const x = e as ApiError
      setErr(x.status === 0 ? t('err.backend') : x.message)
    } finally {
      setBusy(null)
    }
  }

  const weak: Weakness[] = [...(attack?.weaknesses ?? [])].sort((a, b) => (SEV_RANK[a.severity ?? 'Low'] ?? 3) - (SEV_RANK[b.severity ?? 'Low'] ?? 3))

  return (
    <div className="challenge" data-i18n>
      {!attack && (
        <button className="btn danger-outline" disabled={busy !== null} onClick={() => run<{ attack: RedTeamAttack }>('attack', `/api/decision/${decisionId}/break`, (r) => setAttack(r.attack))}>
          {busy === 'attack' ? (
            <>
              <Spinner /> {t('ch.running')}
            </>
          ) : (
            <>⚔ {t('ch.button')}</>
          )}
        </button>
      )}
      {err && (
        <p className="ch-err" role="alert">
          {err}
        </p>
      )}
      {attack && (
        <div className="ch-result" aria-live="polite">
          <div className="ch-head">
            <strong className={weak.length ? 'red' : 'green'}>{weak.length ? t('ch.found').toUpperCase() : t('ch.none')}</strong>
            <span className="ch-score">{t('ch.score', { score: attack.red_team_score })}</span>
          </div>
          {weak.slice(0, 2).map((w) => (
            <dl key={w.test} className={`ch-attack sev-${w.severity ?? 'Low'}`}>
              <dt>{t('ch.weakness')}</dt>
              <dd>
                {w.name} {w.severity && <span className="ch-sev">{t(`ch.sev.${w.severity}`)}</span>}
              </dd>
              {w.question && (
                <>
                  <dt>{t('ch.scenario')}</dt>
                  <dd>{w.question}</dd>
                </>
              )}
              <dt>{t('ch.impact')}</dt>
              <dd>{w.detail}</dd>
              <dt>{t('ch.defense')}</dt>
              <dd>{t(`ch.defense.${w.test}`)}</dd>
            </dl>
          ))}
          {weak.length > 0 && !reopt && (
            <div className="ch-reopt">
              <button className="btn primary" disabled={busy !== null} onClick={() => run<ReoptimizeResult>('reopt', `/api/decision/${decisionId}/reoptimize`, setReopt)}>
                {busy === 'reopt' ? (
                  <>
                    <Spinner /> {t('ch.reoptRunning')}
                  </>
                ) : (
                  t('ch.reopt')
                )}
              </button>
              <p className="tiny muted">{t('ch.reoptNote')}</p>
            </div>
          )}
          {reopt && (
            <div className="ch-ba">
              <div className="ch-head">
                <strong>{t('ba.title')}</strong>
                <span className="ch-score">
                  {t('ch.score', { score: reopt.original.red_team_score })} → {t('ch.score', { score: reopt.optimized.red_team_score })}
                </span>
              </div>
              <ul className="list small">
                {reopt.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <BeforeAfter before={reopt.original.health} after={reopt.optimized.health} planBefore={reopt.original.plan} planAfter={reopt.optimized.plan} />
              <p className="tiny muted">{reopt.note}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
