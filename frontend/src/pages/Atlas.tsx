import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import AtlasMap2D from '@/components/AtlasMap2D'
import { Icon } from '@/components/icons'
import { LANGS, useLanguage, type Lang } from '@/components/LanguageContext'
import { Spinner } from '@/components/ui'
import { byId, LANDMARKS, landmarkForRoute, landmarkRoute, landmarkStatus, needsKey, roadPath, type LandmarkId } from '@/lib/atlasMap'
import { findingAction, findingText } from '@/lib/atlasText'
import { verifySession } from '@/lib/session'
import { loadJudgeProfile } from '@/hooks/useTwin'
import { analyze, api, ApiError } from '@/services/api'
import type { AtlasBrief, DecisionEnvelope } from '@/services/types'
import { useApp } from '@/stores/app'
import type { AtlasPhase, LandmarkView } from '@/three/AtlasScene'
import './atlas.css'

const AtlasScene = lazy(() => import('@/three/AtlasScene'))

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'))
  } catch {
    return false
  }
}

/** If the 3D map throws (driver, context loss), fall back to the 2D map instead of a blank screen. */
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

const visitedKey = (who: string) => `cc2-atlas-visited:${who}`
function loadVisited(who: string): Set<LandmarkId> {
  try {
    return new Set(JSON.parse(localStorage.getItem(visitedKey(who)) ?? '[]') as LandmarkId[])
  } catch {
    return new Set()
  }
}

export default function Atlas() {
  const { t, lang, setLang } = useLanguage()
  const nav = useNavigate()
  const loc = useLocation()
  const user = useApp((s) => s.user)
  const profile = useApp((s) => s.profile)
  const lastDecisionId = useApp((s) => s.lastDecisionId)
  const reduced = useMedia('(prefers-reduced-motion: reduce)')
  const phone = useMedia('(max-width: 720px)')
  const [glFailed, setGlFailed] = useState(() => !hasWebGL())
  const use3D = !phone && !glFailed

  // ---- greeting: once per sign-in (or once per visit for a guest), always skippable
  const who = user ? `u${user.id}` : 'guest'
  const greetedKey = `cc2-atlas-greeted:${who}`
  const [phase, setPhase] = useState<AtlasPhase>(() => {
    const asked = (loc.state as { greet?: boolean } | null)?.greet
    let seen = false
    try {
      seen = sessionStorage.getItem(greetedKey) === '1'
    } catch {
      /* no storage */
    }
    return asked || !seen ? 'greeting' : 'map'
  })
  // the greet flag is one-shot: a refresh of /atlas should not replay the greeting
  useEffect(() => {
    if ((loc.state as { greet?: boolean } | null)?.greet) nav(loc.pathname, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const lines = useMemo(() => [...(user ? [t('greet.hello', { name: user.name || user.email })] : []), t('greet.atlas1'), t('greet.atlas2'), t('greet.atlas3')], [user, t])
  const [shown, setShown] = useState(0)
  const [pulse, setPulse] = useState(0)
  const endGreeting = useCallback(() => {
    try {
      sessionStorage.setItem(greetedKey, '1')
    } catch {
      /* no storage */
    }
    setPhase((p) => (p === 'greeting' ? 'map' : p))
  }, [greetedKey])
  useEffect(() => {
    if (phase !== 'greeting') return
    if (shown >= lines.length) {
      const h = window.setTimeout(endGreeting, reduced ? 600 : 1900)
      return () => window.clearTimeout(h)
    }
    const h = window.setTimeout(
      () => {
        setShown((n) => n + 1)
        setPulse((p) => p + 1) // the compass and coordinates respond each time Atlas speaks
      },
      shown === 0 ? 500 : reduced ? 500 : 1500,
    )
    return () => window.clearTimeout(h)
  }, [phase, shown, lines.length, endGreeting, reduced])

  useEffect(() => {
    void verifySession()
    try {
      // Atlas shows its own language picker, so the app does not need to ask again this visit.
      sessionStorage.setItem('cc2-language-gate', '1')
    } catch {
      /* no storage */
    }
  }, [])

  // ---- real state behind the map
  const [brief, setBrief] = useState<AtlasBrief | null>(null)
  const [hasHoldings, setHasHoldings] = useState<boolean | null>(null)
  const [briefErr, setBriefErr] = useState<ApiError | null>(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [decision, setDecision] = useState<DecisionEnvelope | null>(null)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (!profile) {
      setBrief(null)
      setHasHoldings(null)
      return
    }
    const c = new AbortController()
    setBriefLoading(true)
    setBriefErr(null)
    analyze<{ atlas: AtlasBrief }>('/api/atlas/brief', {}, c.signal)
      .then((r) => {
        setBrief(r.atlas)
        setHasHoldings(r.atlas.progress.portfolio)
      })
      .catch((e: ApiError) => e.name !== 'AbortError' && setBriefErr(e))
      .finally(() => !c.signal.aborted && setBriefLoading(false))
    return () => c.abort()
  }, [profile, nonce])
  useEffect(() => {
    if (!lastDecisionId) {
      setDecision(null)
      return
    }
    const c = new AbortController()
    api<DecisionEnvelope>(`/api/decision/${lastDecisionId}`, { signal: c.signal })
      .then(setDecision)
      .catch(() => setDecision(null)) // not found / not ours: the decision landmarks stay unlit
    return () => c.abort()
  }, [lastDecisionId])

  const [visited, setVisited] = useState(() => loadVisited(who))
  useEffect(() => setVisited(loadVisited(who)), [who])
  const inputs = { profile, decision, hasHoldings, lastDecisionId }
  const views = useMemo(() => {
    const out = {} as Record<LandmarkId, LandmarkView>
    for (const lm of LANDMARKS) out[lm.id] = { active: landmarkStatus(lm, inputs) === 'active', visited: visited.has(lm.id), label: t(`lm.${lm.id}`) }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, decision, hasHoldings, visited, t])

  // ---- what Atlas suggests, from real state only
  const guide = useMemo(() => {
    if (!profile) return { lines: [t('guide.noTwin.1'), t('guide.noTwin.2')], cta: t('guide.noTwin.cta'), to: '/twin', target: 'twin' as LandmarkId, tone: 'amber' }
    if (profile.goals.length === 0) return { lines: [t('guide.noGoal.1'), t('guide.noGoal.2')], cta: t('guide.noGoal.cta'), to: '/twin', target: 'goals' as LandmarkId, tone: 'amber' }
    if (brief) {
      const r = brief.recommendation
      return { lines: [findingText(t, r)], cta: findingAction(t, r), to: r.route, target: landmarkForRoute(r.route), tone: r.severity }
    }
    return null
  }, [profile, brief, t])
  const route = useMemo(() => (guide ? roadPath('citadel', guide.target) : null), [guide])

  const [hovered, setHoveredNow] = useState<LandmarkId | null>(null)
  // Leaving a landmark closes its card after a short grace period, so the pointer can reach the card.
  const leaveTimer = useRef<number>()
  const setHovered = useCallback((id: LandmarkId | null) => {
    window.clearTimeout(leaveTimer.current)
    if (id) setHoveredNow(id)
    else leaveTimer.current = window.setTimeout(() => setHoveredNow(null), 280)
  }, [])
  useEffect(() => () => window.clearTimeout(leaveTimer.current), [])
  const [selected, setSelected] = useState<LandmarkId | null>(null)
  const [reset, setReset] = useState(0)
  const focus = selected ?? hovered

  const go = useCallback(
    (id: LandmarkId, to?: string) => {
      const next = new Set(visited).add(id)
      setVisited(next)
      try {
        localStorage.setItem(visitedKey(who), JSON.stringify([...next]))
      } catch {
        /* visited marks are a convenience */
      }
      nav(to ?? landmarkRoute(id, lastDecisionId))
    },
    [visited, who, nav, lastDecisionId],
  )

  const enter = useCallback(() => {
    if (!use3D || reduced) {
      nav('/dashboard')
      return
    }
    setSelected(null)
    setPhase('entering')
  }, [use3D, reduced, nav])
  const [demoBusy, setDemoBusy] = useState(false)
  const [demoErr, setDemoErr] = useState<string | null>(null)

  // Escape closes the landmark card
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  const labels = LANDMARKS.map((lm) => {
    const v = views[lm.id]
    const open = focus === lm.id
    return (
      <div key={lm.id} data-lm={lm.id} className={`atlas-label ${v.active ? 'on' : 'off'} ${open ? 'open' : ''} ${route?.[route.length - 1] === lm.id ? 'target' : ''} ${lm.id === 'citadel' ? 'citadel' : ''}`}>
        <span className="atlas-label-name">{v.label}</span>
        {open && (
          <div className="atlas-card" onPointerEnter={() => setHovered(lm.id)} onPointerLeave={() => setHovered(null)}>
            <p>{t(`lm.${lm.id}.d`)}</p>
            <div className="atlas-card-row">
              <span className={`atlas-dot ${v.active ? 'on' : 'off'}`} /> {v.active ? t('map.status.active') : t('map.needs', { step: t(needsKey(lm)) })}
              {v.visited && <span className="atlas-visited">· {t('map.status.visited')}</span>}
            </div>
            <button className="btn primary sm" onClick={() => go(lm.id)}>
              {t('map.explore')} <Icon name="arrow" size={13} />
            </button>
          </div>
        )}
      </div>
    )
  })

  const sheet = selected && !use3D ? byId(selected) : null
  const greeting = phase === 'greeting'

  return (
    <div className={`atlas-page phase-${phase} ${use3D ? 'is-3d' : 'is-2d'}`} data-i18n>
      <header className="atlas-top">
        <Link to="/" className="atlas-brand">
          <img src="/favicon.svg" width={24} height={24} alt="" />
          <span>CAPITAL COMPASS</span>
        </Link>
        <div className="atlas-top-r">
          <select className="atlas-lang" value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t('entry.language')}>
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.native}
              </option>
            ))}
          </select>
          {greeting ? (
            <button className="btn sm ghost" onClick={endGreeting}>
              {t('greet.skip')}
            </button>
          ) : (
            use3D && (
              <button className="btn sm ghost" onClick={() => setReset((n) => n + 1)}>
                {t('map.reset')}
              </button>
            )
          )}
        </div>
      </header>

      <div className="atlas-stage">
        {use3D ? (
          <SceneBoundary onFail={() => setGlFailed(true)}>
            <Suspense
              fallback={
                <div className="atlas-loading">
                  <Spinner /> {t('map.loading')}
                </div>
              }
            >
              <AtlasScene
                phase={phase}
                views={views}
                route={route}
                hovered={hovered}
                selected={selected}
                pulse={pulse}
                reduced={reduced}
                resetSignal={reset}
                onHover={setHovered}
                onSelect={setSelected}
                onEntered={() => nav('/dashboard')}
                labels={phase === 'map' ? labels : null}
              />
            </Suspense>
          </SceneBoundary>
        ) : (
          <div className="atlas-2d-wrap">
            <AtlasMap2D views={views} route={greeting ? null : route} selected={selected} onSelect={setSelected} />
          </div>
        )}
      </div>

      {greeting && (
        <div className="atlas-greet" aria-live="polite">
          {lines.slice(0, shown).map((l, i) => (
            <p key={i} className={i === 0 && user ? 'greet-hello' : 'greet-line'}>
              {l}
            </p>
          ))}
          {shown >= lines.length && (
            <button className="btn primary" onClick={endGreeting}>
              {t('greet.continue')}
            </button>
          )}
        </div>
      )}

      {!greeting && (
        <>
          <section className={`atlas-guide tone-${guide?.tone ?? 'blue'}`} aria-live="polite">
            <p className="atlas-guide-who">ATLAS</p>
            {guide ? (
              <>
                {guide.lines.map((l) => (
                  <p key={l} className="atlas-guide-line">
                    {l}
                  </p>
                ))}
                <div className="atlas-guide-route">
                  {route?.map((id, i) => (
                    <span key={id}>
                      {i > 0 && <span className="atlas-arrow">→</span>}
                      {t(`lm.${id}`)}
                    </span>
                  ))}
                </div>
                <div className="row wrap">
                  <button className="btn primary sm" onClick={() => go(guide.target, guide.to)}>
                    {guide.cta}
                  </button>
                  {!profile && (
                    <button
                      className="btn sm"
                      disabled={demoBusy}
                      onClick={async () => {
                        setDemoBusy(true)
                        setDemoErr(null)
                        try {
                          await loadJudgeProfile()
                        } catch (e) {
                          setDemoErr((e as Error).message)
                        } finally {
                          setDemoBusy(false)
                        }
                      }}
                    >
                      {demoBusy && <Spinner />} {t('entry.demo')}
                    </button>
                  )}
                </div>
                {demoErr && <p className="atlas-err">{demoErr}</p>}
              </>
            ) : briefErr ? (
              <>
                <p className="atlas-guide-line">{t('guide.error', { message: briefErr.message })}</p>
                <button className="btn sm" onClick={() => setNonce((n) => n + 1)}>
                  {t('guide.retry')}
                </button>
              </>
            ) : (
              briefLoading && (
                <p className="atlas-guide-line">
                  <Spinner /> {t('guide.loading')}
                </p>
              )
            )}
          </section>

          <div className="atlas-legend" aria-hidden="true">
            <span>
              <i className="lg on" /> {t('map.legend.active')}
            </span>
            <span>
              <i className="lg off" /> {t('map.legend.locked')}
            </span>
            <span>
              <i className="lg visited" /> {t('map.legend.visited')}
            </span>
            <span>
              <i className="lg route" /> {t('map.legend.route')}
            </span>
            <em>{use3D ? t('map.controls') : t('map.controls2d')}</em>
            {glFailed && !phone && <em>{t('map.fallbackNote')}</em>}
          </div>

          <div className="atlas-cta">
            <button className="atlas-enter" onClick={enter} disabled={phase === 'entering'}>
              {t('map.enter')} <span aria-hidden="true">→</span>
            </button>
          </div>
        </>
      )}

      {sheet && (
        <div className="atlas-sheet" role="dialog" aria-labelledby="atlas-sheet-title">
          <button className="atlas-sheet-x" onClick={() => setSelected(null)} aria-label={t('map.close')}>
            ×
          </button>
          <h2 id="atlas-sheet-title">{t(`lm.${sheet.id}`)}</h2>
          <p>{t(`lm.${sheet.id}.d`)}</p>
          <p className="atlas-card-row">
            <span className={`atlas-dot ${views[sheet.id].active ? 'on' : 'off'}`} /> {views[sheet.id].active ? t('map.status.active') : t('map.needs', { step: t(needsKey(sheet)) })}
          </p>
          <button className="btn primary" onClick={() => go(sheet.id)}>
            {t('map.open', { name: t(`lm.${sheet.id}`) })}
          </button>
        </div>
      )}
    </div>
  )
}
