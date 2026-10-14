import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { DemoGuide, startDemo } from '@/components/DemoGuide'
import { Icon } from '@/components/icons'
import AmbientOrbit from '@/three/AmbientOrbit'
import { WebGLOnly } from '@/components/WebGLOnly'
import PageContext from '@/components/PageContext'
import SystemDrawer from '@/components/SystemDrawer'
import UiTranslator from '@/components/UiTranslator'
import { LANGS, languageName, useLanguage, type Lang } from '@/components/LanguageContext'
import { AuthPanel, type AuthMode } from '@/components/AuthPanel'
import { verifySession } from '@/lib/session'
import { Spinner } from '@/components/ui'
import { api, ApiError } from '@/services/api'
import { useApp } from '@/stores/app'

const NAV = [
  {
    title: 'Understand',
    links: [
      { to: '/atlas', label: 'Atlas map', icon: 'compass' },
      { to: '/dashboard', label: 'Command center', icon: 'dashboard' },
      { to: '/twin', label: 'Digital Twin', icon: 'twin' },
    ],
  },
  {
    title: 'Decide',
    links: [
      { to: '/investment', label: 'Investment', icon: 'invest' },
      { to: '/loan', label: 'Loan simulator', icon: 'loan' },
      { to: '/goals', label: 'Goal survival', icon: 'goal' },
      { to: '/portfolio', label: 'Portfolio Doctor', icon: 'portfolio' },
      { to: '/spending', label: 'High-risk spending', icon: 'spending' },
    ],
  },
  {
    title: 'Stress-test',
    links: [
      { to: '/crisis', label: 'Crisis War Room', icon: 'crisis' },
      { to: '/multiverse', label: 'What-if multiverse', icon: 'multiverse' },
    ],
  },
  {
    title: 'Challenge and explain',
    links: [
      { to: '/committee', label: 'AI Committee', icon: 'committee' },
      { to: '/architecture', label: 'Agent architecture', icon: 'graph' },
      { to: '/audit', label: 'Audit trail', icon: 'audit' },
      { to: '/trust', label: 'Trust Center', icon: 'trust' },
    ],
  },
  {
    title: 'Context',
    links: [
      { to: '/market', label: 'Market intelligence', icon: 'news' },
      { to: '/how-it-works', label: 'How it works', icon: 'compass' },
      { to: '/learn', label: 'Learn', icon: 'book' },
    ],
  },
  {
    title: 'Personal',
    links: [
      { to: '/history', label: 'History', icon: 'audit' },
      { to: '/settings', label: 'Settings', icon: 'trust' },
    ],
  },
]

const EXAMPLES = ['Can I take a ₹5 lakh personal loan?', 'What if I lose my job for six months?', 'Can I reach ₹25 lakh in five years?', 'I want to invest ₹20,000/month', 'I spend ₹8,000/month on betting', 'Why did you reject my plan?']

interface Parsed {
  decision_type: string | null
  params: Record<string, unknown>
  reason: string
}

function CommandBar() {
  const [text, setText] = useState('')
  const [focus, setFocus] = useState(false)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nav = useNavigate()
  const profile = useApp((s) => s.profile)
  const setDecision = useApp((s) => s.setDecision)
  const lastDecisionId = useApp((s) => s.lastDecisionId)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!text.trim()) {
      setParsed(null)
      return
    }
    const c = new AbortController()
    const t = setTimeout(() => {
      api<Parsed>('/api/command', { body: { text }, signal: c.signal })
        .then(setParsed)
        .catch(() => undefined)
    }, 250)
    return () => {
      clearTimeout(t)
      c.abort()
    }
  }, [text])

  async function submit(value = text) {
    if (!value.trim()) return
    setError(null)
    if (!profile) {
      setError('Build your Digital Twin first — the command runs on your numbers.')
      return
    }
    setBusy(true)
    try {
      const p = await api<Parsed>('/api/command', { body: { text: value } })
      if (p.decision_type === 'explain') {
        nav(lastDecisionId ? `/committee?id=${lastDecisionId}#why` : '/committee')
      } else if (!p.decision_type) {
        setError(p.reason)
        return
      } else {
        const r = await api<{ decision_id: string }>('/api/decision/run', { body: { profile, command: value } })
        setDecision(r.decision_id)
        nav(`/committee?id=${r.decision_id}`)
      }
      setText('')
      setFocus(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Command failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="command"
      ref={wrap}
      onBlur={(e) => {
        if (!wrap.current?.contains(e.relatedTarget as Node)) setFocus(false)
      }}
    >
      <Icon name="search" size={16} />
      <input
        aria-label="Ask about a financial decision"
        placeholder="Ask about a decision — “Can I take a ₹5 lakh loan?”"
        value={text}
        onFocus={() => setFocus(true)}
        onChange={(e) => {
          setText(e.target.value)
          setError(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') setFocus(false)
        }}
      />
      {(focus || error) && (
        <div className="command-hint">
          {error ? (
            <div className="red">{error}</div>
          ) : busy ? (
            <div className="row">
              <Spinner /> Starting the decision pipeline…
            </div>
          ) : parsed && text.trim() ? (
            <div>
              <div className={parsed.decision_type ? 'brass' : 'amber'}>{parsed.reason}</div>
              {parsed.decision_type && parsed.decision_type !== 'explain' && <div className="muted tiny mt-sm">Press Enter to run the full pipeline: simulation, crisis test, AI committee, Red Team and Critic.</div>}
            </div>
          ) : (
            <>
              <div className="muted tiny" style={{ padding: '0 4px 4px' }}>
                Try one of these
              </div>
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => submit(ex)}>
                  {ex}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Account() {
  const user = useApp((s) => s.user)
  const signOut = useApp((s) => s.signOut)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<AuthMode | null>(null)
  const nav = useNavigate()

  if (user) {
    const initials = (user.name || user.email).split(/[\s@]+/).filter(Boolean).slice(0,2).map((x) => x[0]?.toUpperCase()).join('')
    return (
      <div className="account-menu">
        <button className="avatar-button" aria-label="Open account menu" onClick={() => setOpen((v) => !v)}><span className="avatar-mini">{initials}</span><span className="hide-sm account-name">{user.name || user.email}</span></button>
        {open && <div className="account-pop">
          <div className="account-pop-user"><span className="avatar-mini large">{initials}</span><span><b>{user.name || user.email}</b><small>{user.email}</small></span></div>
          <Link to="/history" onClick={() => setOpen(false)}>History</Link>
          <Link to="/settings" onClick={() => setOpen(false)}>Settings</Link>
          <button onClick={() => { signOut(); setOpen(false); nav('/') }}>Sign out</button>
        </div>}
      </div>
    )
  }

  return (
    <>
      <button className="btn sm ghost hide-sm" onClick={() => setMode('login')}>
        <Icon name="user" size={15} /> Sign in
      </button>
      {mode && <AuthPanel mode={mode} onMode={setMode} onClose={() => setMode(null)} onDone={() => setMode(null)} />}
    </>
  )
}

function SessionNotice() {
  const expired = useApp((s) => s.sessionExpired)
  const user = useApp((s) => s.user)
  const { t } = useLanguage()
  const [mode, setMode] = useState<AuthMode | null>(null)
  if (!expired || user) return null
  return (
    <div className="session-notice" role="status" data-i18n>
      <span>{t('auth.expired')}</span>
      <button className="btn sm" onClick={() => setMode('login')}>{t('entry.login')}</button>
      {mode && <AuthPanel mode={mode} onMode={setMode} onClose={() => setMode(null)} onDone={() => setMode(null)} />}
    </div>
  )
}

function LanguageGate({ onDone }: { onDone: () => void }) {
  const { lang, setLang, t } = useLanguage()
  return (
    <div className="language-gate" role="dialog" aria-modal="true">
      <div className="language-gate-glow" />
      <div className="language-gate-card">
        <div className="lang-compass">✦</div>
        <span className="sd-eyebrow">CAPITAL COMPASS · COMMAND CENTER</span>
        <h2>Choose how you want to understand the system.</h2>
        <p>Finance terminology should never be a barrier. Pick a language and every explanation layer will follow you through the command center.</p>
        <div className="lang-grid">
          {LANGS.map((l) => <button key={l.id} className={`lang-option ${lang === l.id ? 'selected' : ''}`} onClick={() => setLang(l.id as Lang)}><strong>{l.native}</strong><span>{l.label}</span></button>)}
        </div>
        <button className="btn primary lg lang-continue" onClick={onDone}>{t('enter')} →</button>
        <small>{t('local')}</small>
      </div>
    </div>
  )
}

export function AppShell() {
  const [open, setOpen] = useState(false)
  const [languageGate, setLanguageGate] = useState(() => sessionStorage.getItem('cc2-language-gate') !== '1')
  const loc = useLocation()
  const nav = useNavigate()
  const profile = useApp((s) => s.profile)
  const demoStep = useApp((s) => s.demoStep)
  const { lang } = useLanguage()
  useEffect(() => setOpen(false), [loc.pathname])
  useEffect(() => {
    void verifySession()
  }, [])
  useEffect(() => {
    if (!loc.hash) {
      window.scrollTo(0, 0)
      return
    }
    // Atlas landmarks link to a section (e.g. /twin#risk-dna) that may render after its data loads.
    // Wait until the section exists and the page has stopped growing (data above it loaded).
    const id = decodeURIComponent(loc.hash.slice(1))
    let tries = 0
    let lastHeight = -1
    const timer = window.setInterval(() => {
      const el = document.getElementById(id)
      const h = document.documentElement.scrollHeight
      const settled = h === lastHeight
      lastHeight = h
      if ((el && settled) || ++tries > 40) {
        window.clearInterval(timer)
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }, 150)
    return () => window.clearInterval(timer)
  }, [loc.pathname, loc.hash])

  return (
    <div className="shell blockbuster-shell">
      <UiTranslator />
      <div className="ambient-grid" aria-hidden="true" />
      <WebGLOnly>
        <AmbientOrbit />
      </WebGLOnly>
      <aside className={`rail ${open ? 'open' : ''}`} aria-label="Main navigation">
        <Link to="/" className="brand">
          <img src="/favicon.svg" width={30} height={30} alt="" />
          <span>
            <div className="brand-name">CAPITAL COMPASS</div>
            <div className="brand-sub">AI 2.0 · DECISION INTELLIGENCE</div>
          </span>
        </Link>
        {NAV.map((g) => (
          <nav className="nav-group" key={g.title} aria-label={g.title}>
            <div className="nav-title"><span>{g.title}</span><i /></div>
            {g.links.map((l) => (
              <NavLink key={l.to} to={l.to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <Icon name={l.icon} size={17} />
                {l.label}
              </NavLink>
            ))}
          </nav>
        ))}
        <div className="rail-foot">
          {profile ? (
            <>
              Twin: <span className="text-2">{profile.name}</span>
            </>
          ) : (
            'No Digital Twin yet'
          )}
          <div className="mt-sm">No API keys · runs locally</div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn sm ghost menu-btn" aria-label="Open navigation" onClick={() => setOpen(!open)}>
            <Icon name="menu" size={16} />
          </button>
          <CommandBar />
          <div className="row" style={{ marginLeft: 'auto' }}>
            <button className="btn sm ghost language-mini" onClick={() => setLanguageGate(true)} aria-label="Change language">◉ {languageName(lang)}</button>
            {demoStep === null && (
              <button className="btn sm" onClick={() => startDemo(nav)}>
                <Icon name="play" size={13} /> <span className="hide-sm">Flagship demo</span>
              </button>
            )}
            <Account />
          </div>
        </header>
        <SessionNotice />
        <PageContext />
        <Outlet />
      </div>
      <SystemDrawer />
      {languageGate && <LanguageGate onDone={() => { sessionStorage.setItem('cc2-language-gate', '1'); setLanguageGate(false) }} />}
      {open && <div className="overlay" style={{ zIndex: 44, background: 'rgba(5,9,16,.5)' }} onClick={() => setOpen(false)} />}
      <DemoGuide />
    </div>
  )
}
