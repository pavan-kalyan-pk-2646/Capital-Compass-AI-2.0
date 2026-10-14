import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { AuthPanel, type AuthMode } from '@/components/AuthPanel'
import { startDemo } from '@/components/DemoGuide'
import { Icon } from '@/components/icons'
import { LANGS, useLanguage, type Lang } from '@/components/LanguageContext'
import { verifySession } from '@/lib/session'
import { useApp } from '@/stores/app'
import CompassFallback from '@/three/CompassFallback'
import VaultSphere from '@/three/VaultSphere'
import { WebGLOnly } from '@/components/WebGLOnly'
import type { IntroPhase } from '@/three/CompassScene'
import './landing.css'

const CompassScene = lazy(() => import('@/three/CompassScene'))

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')))
  } catch {
    return false
  }
}

class GLBoundary extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onFail()
  }
  render() {
    return this.state.failed ? <CompassFallback /> : this.props.children
  }
}

const Live = {
  Twin: lazy(() => import('@/components/LandingLive').then((m) => ({ default: m.TwinPreview }))),
  Futures: lazy(() => import('@/components/LandingLive').then((m) => ({ default: m.FuturesPreview }))),
  Critic: lazy(() => import('@/components/LandingLive').then((m) => ({ default: m.CriticPreview }))),
}

/** Render children only once the section is near the viewport (keeps the intro light). */
function WhenVisible({ children, height }: { children: ReactNode; height: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return setOn(true)
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setOn(true), { rootMargin: '300px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref} style={{ minHeight: on ? undefined : height }}>
      {on && <Suspense fallback={<div className="skeleton" style={{ height }} />}>{children}</Suspense>}
    </div>
  )
}

/** Sections fade up once as they enter the viewport. */
function useReveal() {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.l-section')]
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      els.forEach((e) => e.classList.add('in'))
      return
    }
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting || e.boundingClientRect.top < 0) {
            e.target.classList.add('in')
            io.unobserve(e.target)
          }
        }),
      { rootMargin: '0px 0px -10% 0px' },
    )
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
  }, [])
}

const CONSEQUENCES = [
  { t: 'Taking a loan', c: 'The EMI shrinks what you can invest, and the goal date quietly slips.' },
  { t: 'Investing', c: 'More equity raises the median outcome and the size of the worst year.' },
  { t: 'Changing allocation', c: 'A safer mix can protect against a crash but fall short of the goal.' },
  { t: 'Spending more', c: 'Every recurring rupee is a rupee your future self does not compound.' },
  { t: 'Losing a job', c: 'Without an emergency fund, investments get sold at the worst time.' },
  { t: 'A long-term goal', c: 'Five years is long enough for a crash and a recovery, or not.' },
  { t: 'Inflation', c: 'The same goal costs more every year it stays out of reach.' },
  { t: 'A market crash', c: 'A paper loss becomes a real one if you have to sell.' },
]

const CONNECTS = ['Personal finances', 'Goals', 'Risk', 'Debt', 'Market scenarios', 'Simulations', 'Adversarial testing']

const AGENTS = [
  { k: 'Bull', c: 'var(--brass)', d: 'Argues the upside from the simulated outcomes.' },
  { k: 'Bear', c: 'var(--red)', d: 'Argues the downside: crash loss, drawdown, recovery time.' },
  { k: 'Risk', c: 'var(--blue)', d: 'Checks the plan against your Risk DNA and stated loss limit.' },
  { k: 'Goal', c: 'var(--green)', d: 'Asks one thing: does the goal survive?' },
  { k: 'Compliance', c: 'var(--lavender)', d: 'Checks suitability rules from a local knowledge base, and can veto.' },
]

const ATTACKS = [
  ['Market crash', 'NIFTY −30% against your loss limit'],
  ['Inflation', '5 points above plan, for the whole horizon'],
  ['Income stop', 'Six months without salary'],
  ['Goal change', 'The target rises 20%'],
  ['Low returns', 'Equity 4% a year below history'],
  ['Liquidity crisis', 'An emergency bill in the middle of a crash'],
  ['Rate shock', 'Loan rates up 2.5 points'],
]

const LOOP = ['Old recommendation', 'Weakness found', 'Re-optimisation', 'New simulation', 'New committee', 'New Red Team', 'Critic', 'Final recommendation']

const EXPLAIN = [
  { t: 'Counterfactual', d: 'Why this plan, and why not the riskier or the safer one, from the same simulations.', to: '/committee#why', icon: 'multiverse' },
  { t: 'Trust Center', d: 'Data sources, assumptions, simulation count, agents, compliance checks, confidence and limitations.', to: '/trust', icon: 'trust' },
  { t: 'Audit trail', d: 'Every node of every decision stored with its time, status and output.', to: '/audit', icon: 'audit' },
]

const WORKFLOW = [
  { t: 'Understand', d: 'Your Financial Digital Twin and Risk DNA.' },
  { t: 'Decide', d: 'The Supervisor routes your question to the right engine.' },
  { t: 'Simulate', d: '10,000 futures from 24 years of market history.' },
  { t: 'Challenge', d: 'Five agents debate; seven attacks try to break the plan.' },
  { t: 'Optimize', d: 'The Critic can reject it and force a better plan.' },
  { t: 'Trust', d: 'Every reason, assumption and step on record.' },
]

const DECISIONS = [
  { icon: 'invest', t: 'Should I invest ₹20,000 a month?', to: '/investment' },
  { icon: 'loan', t: 'Can I afford a ₹5 lakh personal loan?', to: '/loan' },
  { icon: 'goal', t: 'Will I reach ₹25 lakh in five years?', to: '/goals' },
  { icon: 'crisis', t: 'What happens if I lose my job?', to: '/crisis?scenario=job_loss' },
  { icon: 'portfolio', t: 'Is my current portfolio healthy?', to: '/portfolio' },
  { icon: 'multiverse', t: 'Which of three futures holds up best?', to: '/multiverse' },
]

const TITLE = 'CAPITAL COMPASS'

export default function Landing() {
  const nav = useNavigate()
  const [gl, setGl] = useState(hasWebGL)
  const [fontsReady, setFontsReady] = useState(false)
  const [phase, setPhase] = useState<IntroPhase>('emerging')
  const [skipped, setSkipped] = useState(false)
  const [auth, setAuth] = useState<AuthMode | null>(null)
  const [arriving, setArriving] = useState(false)
  const user = useApp((s) => s.user)
  const sessionExpired = useApp((s) => s.sessionExpired)
  const signOut = useApp((s) => s.signOut)
  const { t, lang, setLang } = useLanguage()
  const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const cinematic = gl && !reduced
  const revealed = phase === 'settled' || !cinematic

  const skip = useCallback(() => {
    setSkipped(true)
    setPhase('settled')
  }, [])

  useEffect(() => {
    let done = false
    const ready = () => {
      if (!done) {
        done = true
        setFontsReady(true)
      }
    }
    document.fonts?.ready.then(ready).catch(ready)
    const t = setTimeout(ready, 900)
    // never hold the page hostage: reveal even if the 3D is slow to start
    const safety = setTimeout(() => setPhase('settled'), 8500)
    return () => {
      clearTimeout(t)
      clearTimeout(safety)
    }
  }, [])

  useEffect(() => {
    if (revealed) return
    window.addEventListener('keydown', skip)
    window.addEventListener('wheel', skip, { passive: true })
    return () => {
      window.removeEventListener('keydown', skip)
      window.removeEventListener('wheel', skip)
    }
  }, [revealed, skip])

  useEffect(() => {
    void verifySession()
  }, [])

  /** Signed in: the compass locks, the scene brightens, and Atlas takes over. */
  // `greet`: a fresh sign-in always gets the personal greeting; "continue" goes straight to the map
  const toAtlas = useCallback(
    (greet = false) => {
      const go = () => nav('/atlas', { state: { greet } })
      if (reduced) return go()
      setArriving(true)
      window.setTimeout(go, 650)
    },
    [nav, reduced],
  )

  useReveal()
  const stage = !cinematic ? 'static' : skipped ? 'skipped' : phase
  return (
    <div className={`landing stage-${stage} ${arriving ? 'arriving' : ''}`}>
      {cinematic && (
        <>
          <div className="letterbox top" aria-hidden="true" />
          <div className="letterbox bottom" aria-hidden="true" />
          <div className="grain" aria-hidden="true" />
        </>
      )}
      <header className={`l-nav ${revealed ? 'show' : ''}`}>
        <Link to="/" className="brand">
          <img src="/favicon.svg" width={28} height={28} alt="" />
          <span className="brand-name">Capital Compass</span>
          <span className="l-ver">AI 2.0</span>
        </Link>
        <nav className="row" data-i18n>
          <label className="entry-lang">
            <span className="sr-only">{t('entry.language')}</span>
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t('entry.language')}>
              {LANGS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.native}
                </option>
              ))}
            </select>
          </label>
          {user ? (
            <button className="btn sm" onClick={() => toAtlas()}>
              {t('entry.continueAs', { name: user.name || user.email })}
            </button>
          ) : (
            <button className="btn sm" onClick={() => setAuth('login')}>
              {t('entry.login')}
            </button>
          )}
        </nav>
      </header>

      <section className="intro" onClick={() => !revealed && skip()}>
        <div className="intro-stage" id="compass-stage" aria-hidden="true">
          {gl && fontsReady ? (
            <GLBoundary onFail={() => setGl(false)}>
              <Suspense fallback={<CompassFallback />}>
                <CompassScene onPhase={setPhase} skip={skipped} />
              </Suspense>
            </GLBoundary>
          ) : (
            <CompassFallback />
          )}
        </div>
        <p className={`intro-caption ${(phase === 'signal' || phase === 'searching') && !revealed ? 'show' : ''}`} aria-hidden="true">
          YOUR MONEY HAS MORE THAN ONE FUTURE.
        </p>
        <p className={`intro-caption ${phase === 'aligning' && !revealed ? 'show' : ''}`} aria-hidden="true">
          WATCH CAPITAL COMPASS BUILD, STRESS AND CHALLENGE IT.
        </p>
        {!revealed && cinematic && (
          <button
            className="skip-intro"
            onClick={(e) => {
              e.stopPropagation()
              skip()
            }}
          >
            Skip intro
          </button>
        )}
        <div className={`intro-copy ${revealed ? 'show' : ''}`}>
          <h1 className="wordmark" aria-label="Capital Compass">
            {TITLE.split('').map((ch, i) => (
              <span key={i} className="ch" style={{ '--i': i } as React.CSSProperties} aria-hidden="true">
                {ch === ' ' ? '\u00a0' : ch}
              </span>
            ))}
          </h1>
          <span className="title-flare" aria-hidden="true" />
          <div data-i18n>
            <p className="intro-sub">{t('entry.kicker')}</p>
            <p className="intro-line">{t('entry.line')}</p>
            {sessionExpired && !user && (
              <p className="entry-expired" role="status">
                {t('auth.expired')}
              </p>
            )}
            {user ? (
              <div className="row wrap intro-cta">
                <button className="btn primary lg" onClick={() => toAtlas()}>
                  {t('entry.continueAs', { name: user.name || user.email })}
                </button>
                <button className="btn lg" onClick={signOut}>
                  {t('entry.signOut')}
                </button>
              </div>
            ) : (
              <div className="row wrap intro-cta">
                <button className="btn primary lg" onClick={() => setAuth('login')}>
                  {t('entry.login')}
                </button>
                <button className="btn lg" onClick={() => setAuth('register')}>
                  {t('entry.register')}
                </button>
              </div>
            )}
            <div className="row wrap entry-alt">
              {!user && (
                <button className="link-btn" onClick={() => nav('/atlas')}>
                  {t('entry.guest')}
                </button>
              )}
              <button className="link-btn" onClick={() => startDemo(nav)}>
                <Icon name="play" size={12} /> {t('entry.demo')}
              </button>
            </div>
            <p className="hero-note">{t('entry.note')}</p>
          </div>
        </div>
      </section>

      <section className="vault-stage" aria-label="Interactive wealth field">
        <div className="vault-copy">
          <p className="l-kicker">LIVE 3D MODEL · WEALTH CONSOLIDATION</p>
          <h2 className="l-h2">Turn one decision into a field of futures.</h2>
          <p className="l-lead">The visual layer is a metaphor for the same idea the engines calculate: money is a connected system. Click the field to break the sphere apart and watch the system reveal its moving pieces.</p>
        </div>
        <WebGLOnly>
          <VaultSphere />
        </WebGLOnly>
      </section>

      <section className="l-section" aria-labelledby="s1">
        <p className="l-kicker">01 · The problem</p>
        <h2 className="l-h2" id="s1">
          Financial decisions have consequences.
        </h2>
        <p className="l-lead">Most of them are made without seeing what they set in motion. One choice touches your cash flow, your goals, your risk and your safety net at the same time.</p>
        <ul className="l-conseq">
          {CONSEQUENCES.map((c) => (
            <li key={c.t}>
              <strong>{c.t}</strong>
              <span>{c.c}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="l-section l-split" aria-labelledby="s2">
        <div>
          <p className="l-kicker">02 · The idea</p>
          <h2 className="l-h2" id="s2">
            What if you could see them before they happen?
          </h2>
          <p className="l-lead">Traditional tools answer one isolated question: an EMI calculator, a SIP calculator, a risk quiz. Each is right about its own number and silent about the rest.</p>
          <p className="l-lead">Capital Compass connects them into one decision system, so a loan is judged by what it does to your goal, your emergency fund and your worst year, not just by its EMI.</p>
        </div>
        <div className="l-connect" aria-label="What Capital Compass connects">
          {CONNECTS.map((c, i) => (
            <span key={c} style={{ '--i': i } as React.CSSProperties}>
              {c}
            </span>
          ))}
          <strong>One decision system</strong>
        </div>
      </section>

      <section className="l-section l-split" aria-labelledby="s3">
        <div>
          <p className="l-kicker">03 · The foundation</p>
          <h2 className="l-h2" id="s3">
            Meet the Financial Digital Twin.
          </h2>
          <p className="l-lead">
            A working model of your finances: income, expenses, assets, liabilities, goals, risk, liquidity and behaviour. Every engine reads the same twin, so every answer is about your situation, not an average one.
          </p>
          <Link className="btn mt" to="/twin">
            Build your twin <Icon name="arrow" size={14} />
          </Link>
        </div>
        <WhenVisible height={300}>
          <Live.Twin />
        </WhenVisible>
      </section>

      <section className="l-section l-split" aria-labelledby="s4">
        <div>
          <p className="l-kicker">04 · Simulation</p>
          <h2 className="l-h2" id="s4">
            One decision. Thousands of possible futures.
          </h2>
          <p className="l-lead">
            One predicted return is a guess. Capital Compass replays 10,000 futures built from 287 months of real NIFTY 50 and Indian debt history, scaled to today’s market regime, with your salary, expenses and EMIs
            flowing through every month.
          </p>
          <p className="l-lead">You see the range: the bad case, the typical case and the good case, and how often your goal survives each kind of market.</p>
        </div>
        <WhenVisible height={360}>
          <Live.Futures />
        </WhenVisible>
      </section>

      <section className="l-section" aria-labelledby="s5">
        <p className="l-kicker">05 · Deliberation</p>
        <h2 className="l-h2" id="s5">
          Your recommendation has opponents.
        </h2>
        <p className="l-lead">Five structured agents read the same numbers and take positions. They answer each other in a debate, then vote; Compliance can veto.</p>
        <div className="l-agents">
          {AGENTS.map((a) => (
            <div key={a.k} style={{ '--ac': a.c } as React.CSSProperties}>
              <strong>{a.k}</strong>
              <span>{a.d}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="l-section l-split" aria-labelledby="s6">
        <div>
          <p className="l-kicker">06 · Red Team</p>
          <h2 className="l-h2" id="s6">
            Then we attack our own recommendation.
          </h2>
          <p className="l-lead">
            A recommendation that only works when nothing goes wrong is not a recommendation. The Red Team tries to prove it wrong in seven ways, and every result is graded held, strained or broken.
          </p>
        </div>
        <ol className="l-attacks">
          {ATTACKS.map(([t, d]) => (
            <li key={t}>
              <strong>{t}</strong>
              <span>{d}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="l-section l-split" aria-labelledby="s7">
        <div>
          <p className="l-kicker">07 · Critic and re-optimisation</p>
          <h2 className="l-h2" id="s7">
            If it fails, we don’t hide it.
          </h2>
          <p className="l-lead">
            The Critic rejects a plan when a critical attack breaks it, when a high-priority goal has less than an even chance, or when it is not robust enough. The plan is then rebuilt and goes through the whole
            pipeline again.
          </p>
          <ol className="l-loop" aria-label="The re-optimisation loop">
            {LOOP.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ol>
        </div>
        <div className="l-panel">
          <WhenVisible height={180}>
            <Live.Critic />
          </WhenVisible>
        </div>
      </section>

      <section className="l-section" aria-labelledby="s8">
        <p className="l-kicker">08 · Explainability</p>
        <h2 className="l-h2" id="s8">
          Every decision should be explainable.
        </h2>
        <div className="l-explain">
          {EXPLAIN.map((e) => (
            <Link key={e.t} to={e.to}>
              <Icon name={e.icon} size={20} />
              <strong>{e.t}</strong>
              <span>{e.d}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="l-section" aria-labelledby="s9">
        <p className="l-kicker">09 · The workflow</p>
        <h2 className="l-h2" id="s9">
          The Capital Compass workflow
        </h2>
        <ol className="stages">
          {WORKFLOW.map((s, i) => (
            <li key={s.t} style={{ '--i': i } as React.CSSProperties}>
              <span className="stage-n">{i + 1}</span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </li>
          ))}
        </ol>
        <div className="row wrap mt" style={{ gap: 10 }}>
          <Link className="btn" to="/architecture">
            <Icon name="graph" size={15} /> Watch the agents run
          </Link>
          <Link className="btn ghost" to="/how-it-works">
            How it works, step by step
          </Link>
        </div>
      </section>

      <section className="l-section l-split" aria-labelledby="s10">
        <div>
          <h2 className="l-h2" id="s10">
            Ask the question you actually have
          </h2>
          <p className="l-lead">Type it in plain words in the command bar, or open the matching simulator.</p>
        </div>
        <ul className="questions">
          {DECISIONS.map((d) => (
            <li key={d.t}>
              <Link to={d.to}>
                <Icon name={d.icon} size={18} />
                <span>{d.t}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="l-section l-final">
        <p className="l-kicker">Direction before decision</p>
        <h2 className="l-h2">Don’t predict one future. Explore the futures your decision can create.</h2>
        <div className="row wrap" style={{ gap: 10, justifyContent: 'center' }} data-i18n>
          {user ? (
            <button className="btn primary lg" onClick={() => toAtlas()}>
              {t('entry.continueAs', { name: user.name || user.email })}
            </button>
          ) : (
            <>
              <button className="btn primary lg" onClick={() => setAuth('register')}>
                {t('entry.register')}
              </button>
              <button className="btn lg" onClick={() => setAuth('login')}>
                {t('entry.login')}
              </button>
            </>
          )}
        </div>
      </section>

      <footer className="l-foot">
        <p>
          <strong>What this is:</strong> a multi-agent decision orchestration system combining specialized financial reasoning engines, simulations, structured agent deliberation, adversarial testing and optional AI
          language capabilities. Runs locally with no API keys.
        </p>
        <p>
          Capital Compass provides scenario-based financial decision support. Simulated outcomes are not guaranteed predictions and should not be interpreted as regulated personalized financial advice. It never submits
          loan applications and never provides betting strategies or predictions.
        </p>
      </footer>
      {auth && <AuthPanel mode={auth} onMode={setAuth} onClose={() => setAuth(null)} onDone={() => { setAuth(null); toAtlas(true) }} />}
    </div>
  )
}
