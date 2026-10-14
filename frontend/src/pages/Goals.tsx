import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { FanChart, ProbBars } from '@/charts/charts'
import { DataTag } from '@/components/atlas/DataTag'
import { Explain } from '@/components/atlas/Explain'
import { useDemoStep } from '@/components/DemoGuide'
import { useLanguage } from '@/components/LanguageContext'
import { RunDecision } from '@/components/RunDecision'
import { Disclaimer, ErrorBox, Metric, MoneyInput, NeedsTwin, NumInput, Panel, Spinner } from '@/components/ui'
import { hasWebGL } from '@/components/WebGLOnly'
import { useTwin } from '@/hooks/useTwin'
import { inr, inrShort, months as monthsFmt, pct, probTone } from '@/lib/format'
import { analyze, ApiError } from '@/services/api'
import type { GoalSurvival } from '@/services/types'
import { buildAnchors } from '@/three/goal/anchors'
import type { CameraMode } from '@/three/goal/GoalTheatre'
import { outcomeOf, scenarioBy, toneOf, type ScenarioKey } from '@/three/goal/model'
import { rankedPaths } from '@/three/goal/Universe'
import './goals.css'

const GoalTheatre = lazy(() => import('@/three/goal/GoalTheatre'))

const MODES: CameraMode[] = ['overview', 'montecarlo', 'terrain', 'scenarios', 'goal', 'risk', 'decision']
const STRESS: ScenarioKey[] = ['normal', 'crash', 'job_loss', 'inflation', 'rate_shock', 'crash_job_loss', 'bear']
type Stage = 'input' | 'building' | 'generating' | 'stressing' | 'calculating' | 'complete' | 'result'

class SceneBoundary extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onFail()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

function useMedia(q: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}

export default function Goals() {
  const { t } = useLanguage()
  const { profile, snapshot } = useTwin()
  const primary = profile?.goals[0]
  const [target, setTarget] = useState(primary?.target_amount ?? 2500000)
  const [years, setYears] = useState(primary?.years ?? 5)
  const [sip, setSip] = useState<number | null>(null)
  const [corpus, setCorpus] = useState<number | null>(null)
  const [ret, setRet] = useState<number | null>(null)
  const compact = useMedia('(max-width: 760px)')
  // phones: the inspector starts folded to its headline so the theatre stays visible
  const [inspOpen, setInspOpen] = useState(false)
  const reduced = useMedia('(prefers-reduced-motion: reduce)')
  const [gl, setGl] = useState(hasWebGL)

  // ---- the simulation request and its real lifecycle
  const [data, setData] = useState<GoalSurvival | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [stage, setStage] = useState<Stage>('input')
  const ctl = useRef<AbortController | null>(null)
  const timers = useRef<number[]>([])
  const clearTimers = () => {
    timers.current.forEach((h) => window.clearTimeout(h))
    timers.current = []
  }
  const [mode, setMode] = useState<CameraMode>('overview')
  const [scenario, setScenario] = useState<ScenarioKey>('normal')
  const [hovered, setHovered] = useState<ScenarioKey | null>(null)
  const [path, setPath] = useState<number | null>(null)
  const [reset, setReset] = useState(0)

  const run = useCallback(async () => {
    ctl.current?.abort()
    const c = new AbortController()
    ctl.current = c
    clearTimers()
    setError(null)
    setPath(null)
    setStage('building')
    // the stages name what the backend is doing during this one request; the last one holds
    // until the response actually arrives, so completion is never shown early
    timers.current.push(
      window.setTimeout(() => setStage((s) => (s === 'building' ? 'generating' : s)), 450),
      window.setTimeout(() => setStage((s) => (s === 'generating' ? 'stressing' : s)), 950),
      window.setTimeout(() => setStage((s) => (s === 'stressing' ? 'calculating' : s)), 1500),
    )
    try {
      const r = await analyze<GoalSurvival>(
        '/api/goals/survival',
        {
          target,
          years,
          theatre: true,
          paths: compact ? 120 : 240,
          ...(sip !== null ? { monthly_sip: sip } : {}),
          ...(corpus !== null ? { current_corpus: corpus } : {}),
          ...(ret !== null ? { expected_return_pct: ret } : {}),
        },
        c.signal,
      )
      if (c.signal.aborted) return
      clearTimers()
      setData(r)
      setScenario('normal')
      setStage('complete')
      timers.current.push(
        window.setTimeout(
          () => {
            setStage('result')
            setMode('montecarlo')
          },
          reduced ? 200 : 1100,
        ),
      )
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      clearTimers()
      setError(e as ApiError)
      setStage(data ? 'result' : 'input')
    }
  }, [target, years, sip, corpus, ret, compact, reduced, data])

  useEffect(
    () => () => {
      ctl.current?.abort()
      clearTimers()
    },
    [],
  )
  useEffect(() => {
    if (primary) {
      setTarget(primary.target_amount)
      setYears(primary.years)
      setSip(null)
      setCorpus(null)
      setRet(null)
    }
  }, [primary])
  useDemoStep([3], () => void run())

  const anchors = useMemo(() => (data && stage === 'result' ? buildAnchors(data, scenario, t) : []), [data, scenario, t, stage])
  const running = stage !== 'input' && stage !== 'result'
  const th = data?.theatre
  const sc = th ? scenarioBy(th, scenario) : null
  const insp = th ? scenarioBy(th, hovered ?? scenario) : null
  const selectedPath = useMemo(() => {
    if (!sc || path == null) return null
    const r = rankedPaths(sc)[path]
    return r ? { end: r.end, rank: path, of: r ? sc.sample_paths.length : 0 } : null
  }, [sc, path])

  if (!profile)
    return (
      <div className="page">
        <h1>{t('gs.title')}</h1>
        <div className="mt">
          <NeedsTwin what="The Goal Survival Engine" />
        </div>
      </div>
    )

  const tw = snapshot?.twin
  const normal = data?.scenarios[0]?.success_probability ?? null
  const d = data

  return (
    <div className="page gs-page">
      <div className="page-head" data-i18n>
        <div>
          <p className="cc-eyebrow">CAPITAL COMPASS · {t('gs.kicker')}</p>
          <h1>{t('gs.title')}</h1>
          <p>{t('gs.sub')}</p>
        </div>
      </div>

      {/* ---------------- input control room ---------------- */}
      <section className="gs-control" data-i18n aria-labelledby="gs-ctl">
        <form
          className="gs-inputs"
          onSubmit={(e) => {
            e.preventDefault()
            void run()
          }}
        >
          <h2 id="gs-ctl">{t('gs.control')}</h2>
          <div className="gs-fields">
            <MoneyInput label={t('gs.f.target')} value={target} min={10000} max={1e10} onChange={setTarget} hint={inrShort(target)} />
            <NumInput label={t('gs.f.years')} value={years} min={0.5} max={40} step={0.5} onChange={setYears} />
            <MoneyInput label={t('gs.f.corpus')} value={corpus ?? d?.start_corpus ?? 0} min={0} max={1e10} onChange={setCorpus} hint={t('gs.f.corpusHint')} />
            <MoneyInput label={t('gs.f.sip')} value={sip ?? d?.current_monthly_sip ?? 0} min={0} max={10000000} onChange={setSip} hint={t('gs.f.sipHint')} />
            <NumInput
              label={t('gs.f.return')}
              value={ret ?? d?.expected_return_pct ?? 10}
              min={0}
              max={30}
              step={0.5}
              suffix="%"
              onChange={setRet}
              hint={d?.historical_return_pct != null ? t('gs.f.returnHint', { v: d.historical_return_pct.toFixed(1) }) : t('gs.f.returnDefault')}
            />
          </div>
          <div className="gs-actions">
            <button className="gs-simulate" disabled={running}>
              {running ? <Spinner /> : null} {t('gs.simulate')}
            </button>
            {(sip !== null || corpus !== null || ret !== null) && (
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  setSip(null)
                  setCorpus(null)
                  setRet(null)
                }}
              >
                {t('gs.reset')}
              </button>
            )}
          </div>
        </form>
        <aside className="gs-twin">
          <div className="gs-twin-head">
            <h3>{t('gs.twin')}</h3>
            <DataTag source="user" />
          </div>
          {tw ? (
            <dl>
              <dt>{t('gs.tw.income')}</dt>
              <dd>{inr(tw.monthly_income)}</dd>
              <dt>{t('gs.tw.expenses')}</dt>
              <dd>{inr(tw.monthly_expenses)}</dd>
              <dt>{t('gs.tw.ef')}</dt>
              <dd>{inrShort(profile.assets.cash)}</dd>
              <dt>{t('gs.tw.emi')}</dt>
              <dd>{inr(tw.monthly_emi)}</dd>
              <dt>{t('gs.tw.risk')}</dt>
              <dd>{t('gs.tw.riskV', { pct: profile.risk.max_tolerated_loss_pct })}</dd>
              <dt>{t('gs.tw.inflation')}</dt>
              <dd>{t('gs.tw.inflationV')}</dd>
            </dl>
          ) : (
            <div className="skeleton" style={{ height: 150 }} />
          )}
          <Link className="btn sm ghost" to="/twin">
            {t('gs.editTwin')}
          </Link>
        </aside>
      </section>

      {/* ---------------- the 3D theatre ---------------- */}
      <section className={`gs-theatre stage-${stage}`} data-i18n aria-label={t('gs.theatre')}>
        {gl ? (
          <SceneBoundary onFail={() => setGl(false)}>
            <Suspense
              fallback={
                <div className="gs-status">
                  <Spinner /> {t('gs.loading3d')}
                </div>
              }
            >
              <GoalTheatre
                data={stage === 'result' || stage === 'complete' ? data : null}
                running={running}
                scenario={scenario}
                hoveredScenario={hovered}
                mode={mode}
                resetSignal={reset}
                selectedPath={path}
                reduced={reduced}
                compact={compact}
                maxPaths={th?.paths_sampled ?? (compact ? 120 : 240)}
                anchors={anchors}
                onScenario={(k) => {
                  setScenario(k)
                  setPath(null)
                }}
                onHoverScenario={setHovered}
                onSelectPath={setPath}
              />
            </Suspense>
          </SceneBoundary>
        ) : (
          <div className="gs-status gs-nogl">{t('gs.noWebgl')}</div>
        )}

        {/* lifecycle overlay */}
        {stage !== 'result' && (
          <div className="gs-overlay" role="status" aria-live="polite">
            {stage === 'input' ? (
              <>
                <p className="gs-overlay-k">{t('gs.idle.k')}</p>
                <p className="gs-overlay-t">{t('gs.idle.t')}</p>
              </>
            ) : (
              <>
                <ol className="gs-stages">
                  {(['building', 'generating', 'stressing', 'calculating', 'complete'] as const).map((s, i, arr) => {
                    const cur = arr.indexOf(stage as (typeof arr)[number])
                    return (
                      <li key={s} className={i < cur ? 'done' : i === cur ? 'now' : ''}>
                        {t(`gs.stage.${s}`)}
                      </li>
                    )
                  })}
                </ol>
              </>
            )}
          </div>
        )}

        {stage === 'result' && th && sc && (
          <>
            <div className="gs-hud-top">
              <div className="gs-stress" role="group" aria-label={t('gs.stress')}>
                <span className="gs-hud-k">{t('gs.stress')}</span>
                {STRESS.map((k) => (
                  <button key={k} className={k === scenario ? 'on' : ''} aria-pressed={k === scenario} onClick={() => setScenario(k)}>
                    {t(`gt.sc.${k}`)}
                  </button>
                ))}
              </div>
              {gl && (
                <div className="gs-hud-tools">
                  <button className="btn sm ghost" onClick={() => setReset((n) => n + 1)}>
                    {t('gs.resetCam')}
                  </button>
                  <button
                    className="btn sm ghost"
                    onClick={() => {
                      const el = document.querySelector('.gs-theatre')
                      if (document.fullscreenElement) void document.exitFullscreen()
                      else void el?.requestFullscreen?.()
                    }}
                  >
                    {t('gs.fullscreen')}
                  </button>
                </div>
              )}
            </div>

            <aside className={`gs-inspector ${inspOpen ? 'open' : ''}`} aria-live="polite">
              {selectedPath ? (
                <>
                  <p className="gs-hud-k">{t('gs.path.k')}</p>
                  <p className={`gs-big ${outcomeOf(selectedPath.end, sc.target) === 'success' ? 'green' : outcomeOf(selectedPath.end, sc.target) === 'borderline' ? 'amber' : 'red'}`}>{inrShort(selectedPath.end)}</p>
                  <p className="small">{t(`gs.path.${outcomeOf(selectedPath.end, sc.target)}`, { v: inrShort(Math.abs(sc.target - selectedPath.end)) })}</p>
                  <p className="tiny muted">{t('gs.path.of', { rank: selectedPath.rank + 1, of: selectedPath.of, n: th.n_paths.toLocaleString('en-IN') })}</p>
                  <button className="btn sm ghost" onClick={() => setPath(null)}>
                    {t('map.close')}
                  </button>
                </>
              ) : (
                insp && (
                  <>
                    <p className="gs-hud-k">{t(`gt.sc.${insp.scenario}`)}</p>
                    <p className={`gs-big ${toneOf(insp.success_probability)}`}>{pct(insp.success_probability, 1)}</p>
                    <button className="btn sm ghost gs-insp-toggle" aria-expanded={inspOpen} onClick={() => setInspOpen((o) => !o)}>
                      {inspOpen ? t('gs.i.less') : t('gs.i.more')}
                    </button>
                    <dl className="gs-dl">
                      <dt>{t('gs.i.ending')}</dt>
                      <dd>{inrShort(insp.ending.p50)}</dd>
                      <dt>{t('gs.i.range')}</dt>
                      <dd>
                        {inrShort(insp.ending.p5)} – {inrShort(insp.ending.p95)}
                      </dd>
                      <dt>
                        {t('gs.i.drawdown')} <Explain term="drawdown" />
                      </dt>
                      <dd>−{pct(Math.abs(insp.max_drawdown.p95))}</dd>
                      <dt>{t('gs.i.recovery')}</dt>
                      <dd>{insp.recovery_months_median == null ? '—' : monthsFmt(insp.recovery_months_median)}</dd>
                      <dt>{t('gs.i.gap')}</dt>
                      <dd>{insp.shortfall_median ? inrShort(insp.shortfall_median) : '—'}</dd>
                      <dt>{t('gs.i.target')}</dt>
                      <dd>{inrShort(insp.target)}</dd>
                      <dt>
                        {t('gs.i.required')} <Explain term="sip" />
                      </dt>
                      <dd>{inr(insp.required_monthly_sip)}</dd>
                    </dl>
                    <p className="tiny muted gs-why">{t(`gs.why.${insp.scenario}`)}</p>
                  </>
                )
              )}
            </aside>

            {gl && (
              <>
                <nav className="gs-modes" aria-label={t('gs.modes')}>
                  {MODES.map((m) => (
                    <button key={m} className={m === mode ? 'on' : ''} aria-pressed={m === mode} onClick={() => setMode(m)}>
                      {t(`gs.mode.${m}`)}
                    </button>
                  ))}
                </nav>
                <p className="gs-legend">
                  <span className="lg-s">{t('gs.lg.success')}</span>
                  <span className="lg-b">{t('gs.lg.border')}</span>
                  <span className="lg-f">{t('gs.lg.fail')}</span>
                  <span>{t('gs.lg.hint')}</span>
                </p>
              </>
            )}
          </>
        )}
      </section>
      <ErrorBox error={error} onRetry={() => void run()} />

      {/* ---------------- analytical data: the exact numbers ---------------- */}
      {d && stage === 'result' && (
        <section className="gs-analytic" aria-labelledby="gs-an">
          <div className="row between" data-i18n>
            <h2 id="gs-an" className="section-label" style={{ margin: 0 }}>
              {t('gs.analytic')}
            </h2>
            <DataTag source="simulated" />
          </div>
          <div className="kpis k4 mt-sm">
            <div>
              <Metric label="Probability of success" value={pct(normal)} tone={probTone(normal)} size="lg" sub="normal markets" />
            </div>
            <div>
              <Metric label="Required each month" value={inr(d.required_monthly_sip)} sub={`at ${d.expected_return_pct.toFixed(1)}% expected return`} />
            </div>
            <div>
              <Metric label="Planned each month" value={inr(d.current_monthly_sip)} tone={d.sip_gap > 0 ? 'amber' : 'green'} sub={d.sip_gap > 0 ? `${inr(d.sip_gap)} short` : 'covers the requirement'} />
            </div>
            <div>
              <Metric
                label="Shortfall risk"
                value={pct(d.shortfall_risk ?? (normal != null ? 1 - normal : null))}
                tone={probTone(normal)}
                sub={d.shortfall_median ? `median gap ${inrShort(d.shortfall_median)} when short` : 'chance of missing the target'}
              />
            </div>
          </div>
          {d.ending_wealth && (
            <div className="kpis k4">
              <div>
                <Metric label="Ending wealth · bad case (P5)" value={inrShort(d.ending_wealth.p5)} tone={d.ending_wealth.p5 < d.target_amount ? 'red' : 'green'} />
              </div>
              <div>
                <Metric label="Ending wealth · median (P50)" value={inrShort(d.ending_wealth.p50)} tone={d.ending_wealth.p50 < d.target_amount ? 'amber' : 'green'} />
              </div>
              <div>
                <Metric label="Ending wealth · good case (P95)" value={inrShort(d.ending_wealth.p95)} />
              </div>
              <div>
                <Metric label="Target" value={inrShort(d.target_amount)} sub={`from ${inrShort(d.start_corpus)} today · ${d.return_assumption === 'user' ? 'your return assumption' : 'historical returns'}`} />
              </div>
            </div>
          )}
          <div className="grid g-wide">
            <Panel title="Goal corpus over time" sub={`${d.simulation.n_paths.toLocaleString('en-IN')} paths, P5–P95 and P25–P75 bands`}>
              <FanChart p={d.simulation.percentiles} target={d.target_amount} height={300} />
            </Panel>
            <Panel title="Survival by market">
              <div id="scenarios" style={{ scrollMarginTop: 90 }}>
                <ProbBars
                  items={d.scenarios.map((s) => ({
                    label: s.label,
                    value: s.success_probability,
                    note: `Median ${inrShort(s.ending_p50)} · P5 ${inrShort(s.ending_p5)}${s.shortfall_median ? ` · typical gap ${inrShort(s.shortfall_median)}` : ''}${s.forced_liquidation_probability > 0.05 ? `; forced selling in ${pct(s.forced_liquidation_probability)} of futures` : ''}`,
                  }))}
                />
              </div>
            </Panel>
          </div>
          <Panel title="Want the plan challenged?" sub="The AI Committee re-checks this goal against crash, inflation, income-stop, goal-change, low-return and rate-shock attacks">
            <RunDecision type="goal" params={{ target, years }} command={`Can I reach ${inrShort(target)} in ${years} years?`} />
          </Panel>
        </section>
      )}
      <Disclaimer />
    </div>
  )
}
