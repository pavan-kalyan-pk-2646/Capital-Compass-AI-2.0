import './atlas-ui.css'
import { useLanguage } from '@/components/LanguageContext'
import { Explain } from '@/components/atlas/Explain'
import type { DecisionResult, NodeEvent } from '@/services/types'

type Status = 'done' | 'running' | 'pending' | 'reject'
interface Stage {
  key: string
  label: string
  value: string
  status: Status
}

const NODES: Record<string, string[]> = {
  twin: ['profile_parser', 'financial_twin'],
  sim: ['simulation_engine', 'crisis_engine'],
  committee: ['financial_committee', 'debate'],
  red: ['red_team'],
  critic: ['critic'],
  reopt: ['re_optimize'],
  final: ['explanation', 'trust_center'],
}

function stageStatus(key: string, events: NodeEvent[], current: string | null): Status {
  const nodes = NODES[key]!
  if (current && nodes.includes(current)) return 'running'
  return events.some((e) => nodes.includes(e.node) && e.status === 'done') ? 'done' : 'pending'
}

const lastPayload = (events: NodeEvent[], node: string) => [...events].reverse().find((e) => e.node === node && e.status === 'done')?.payload

/** Verdict family for the receipt and the final stage: APPROVED, CONDITIONAL or REJECTED. */
export function verdictKind(v: string): 'APPROVED' | 'CONDITIONAL' | 'REJECTED' {
  if (v.includes('REJECT')) return 'REJECTED'
  if (v.includes('MODIFICATION') || v.includes('CONDITION') || v.includes('FLAGGED')) return 'CONDITIONAL'
  return 'APPROVED'
}

/**
 * Every stage of one decision with what it actually produced: live from the SSE events while the
 * graph runs, then from the stored result. Nothing here is estimated.
 */
export function WarRoom({ events, res, current }: { events: NodeEvent[]; res: DecisionResult | null; current: string | null }) {
  const { t } = useLanguage()
  const first = res?.rounds[0]
  const lastRound = res?.rounds[res.rounds.length - 1]
  const opinions = lastRound?.opinions ?? ((lastPayload(events, 'financial_committee') as { opinions?: { stance: string }[] } | undefined)?.opinions ?? null)
  const votes = opinions ? { support: opinions.filter((o) => o.stance === 'support').length, conditional: opinions.filter((o) => o.stance === 'conditional').length, oppose: opinions.filter((o) => o.stance === 'oppose').length } : null
  const liveTests = (lastPayload(events, 'red_team') as { tests?: { status: string }[] } | undefined)?.tests
  const vulns = first ? first.red_team.weaknesses.length : liveTests ? liveTests.filter((x) => x.status !== 'PASS').length : null
  const firstCritic = first?.critic.verdict ?? (events.find((e) => e.node === 'critic' && e.status === 'done')?.payload as { verdict?: string } | undefined)?.verdict
  const reoptRounds = res ? res.rounds.length : events.filter((e) => e.node === 're_optimize' && e.status === 'done').length + 1
  const nPaths = res?.simulation_results.n_paths ?? (lastPayload(events, 'simulation_engine') as { n_paths?: number } | undefined)?.n_paths
  const verdict = res ? (res.explanation.verdict ?? res.recommendation.status) : null

  const st = (k: string): Status => (res ? 'done' : stageStatus(k, events, current))
  const stages: Stage[] = [
    { key: 'twin', label: t('war.twin'), value: res ? t('war.twin.v', { score: Math.round(res.risk_dna.scores.financial_resilience ?? 0) }) : '', status: st('twin') },
    { key: 'sim', label: t('war.sim'), value: nPaths ? t('war.sim.v', { n: nPaths.toLocaleString('en-IN') }) : '', status: st('sim') },
    { key: 'committee', label: t('war.committee'), value: votes ? t('war.committee.v', votes) : '', status: st('committee') },
    { key: 'red', label: t('war.red'), value: vulns === null ? '' : vulns ? t('war.red.v', { n: vulns }) : t('war.red.none'), status: st('red') },
    { key: 'critic', label: t('war.critic'), value: firstCritic ? t(`war.critic.${firstCritic}`) : '', status: firstCritic === 'REJECT' ? 'reject' : st('critic') },
    {
      key: 'reopt',
      label: t('war.reopt'),
      value: res || reoptRounds > 1 ? (reoptRounds > 1 ? t('war.reopt.done', { rounds: reoptRounds }) : t('war.reopt.none')) : '',
      status: res && reoptRounds <= 1 ? 'done' : st('reopt'),
    },
    { key: 'final', label: t('war.final'), value: verdict ? t(`rc.${verdictKind(verdict)}`) : '', status: st('final') },
  ]
  return (
    <section className="war" data-i18n aria-labelledby="war-h">
      <div className="war-head">
        <h2 id="war-h">{t('war.title')}</h2>
        <p className="small text-2">{t('war.sub')}</p>
      </div>
      <ol className="war-track">
        {stages.map((s, i) => (
          <li key={s.key} className={`war-stage ${s.status}`}>
            <span className="war-n">{String(i + 1).padStart(2, '0')}</span>
            <span className="war-label">
              {s.label} {s.key === 'sim' && <Explain term="montecarlo" />}
            </span>
            <strong className="war-value">{s.value || (s.status === 'running' ? t('war.running') : s.status === 'pending' ? t('war.pending') : '')}</strong>
          </li>
        ))}
      </ol>
    </section>
  )
}
