import { useEffect, useRef, useState, type FormEvent } from 'react'

import { useLanguage } from '@/components/LanguageContext'
import { Spinner } from '@/components/ui'
import { completeSignIn, type AuthUser } from '@/lib/session'
import { api, ApiError } from '@/services/api'
import './auth.css'

export type AuthMode = 'login' | 'register'
type Field = 'name' | 'email' | 'password' | 'confirm'
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * Log in / create account, drawn inside the cinematic entry scene. Talks to the existing
 * /api/auth endpoints; the server re-validates everything and owns the password hashing.
 */
export function AuthPanel({ mode, onMode, onClose, onDone }: { mode: AuthMode; onMode: (m: AuthMode) => void; onClose: () => void; onDone: (user: AuthUser) => void }) {
  const { t } = useLanguage()
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [errs, setErrs] = useState<Partial<Record<Field, string>>>({})
  const [formErr, setFormErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const first = useRef<HTMLInputElement>(null)

  useEffect(() => {
    first.current?.focus()
    setErrs({})
    setFormErr(null)
  }, [mode])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  function validate(): Partial<Record<Field, string>> {
    const e: Partial<Record<Field, string>> = {}
    if (mode === 'register' && !form.name.trim()) e.name = t('auth.err.name')
    if (!EMAIL.test(form.email.trim())) e.email = t('auth.err.email')
    if (form.password.length < 8 || form.password.length > 128) e.password = t('auth.err.password')
    if (mode === 'register' && form.confirm !== form.password) e.confirm = t('auth.err.confirm')
    return e
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    const e = validate()
    setErrs(e)
    setFormErr(null)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      const body = mode === 'register' ? { name: form.name.trim(), email: form.email.trim(), password: form.password } : { email: form.email.trim(), password: form.password }
      const r = await api<{ token: string; user: AuthUser }>(`/api/auth/${mode}`, { body })
      await completeSignIn(r.token, r.user)
      setForm({ name: '', email: '', password: '', confirm: '' })
      onDone(r.user)
    } catch (ex) {
      const err = ex as ApiError
      const field = err.details?.[0]?.field as Field | undefined
      if (err.status === 0) setFormErr(t('auth.err.offline'))
      else if (err.status === 409) setErrs({ email: t('auth.err.exists') })
      else if (err.status === 401 && mode === 'login') setFormErr(t('auth.err.invalid'))
      else if (err.status === 422 && field) setErrs({ [field]: t(`auth.err.${field}`) })
      else setFormErr(t('auth.err.generic', { message: err.message }))
    } finally {
      setBusy(false)
    }
  }

  const input = (f: Field, type: string, auto: string) => (
    <div className={`auth-field ${errs[f] ? 'bad' : ''}`}>
      <label htmlFor={`auth-${f}`}>{t(f === 'confirm' ? 'auth.confirm' : `auth.${f}`)}</label>
      <input
        ref={(f === 'name' && mode === 'register') || (f === 'email' && mode === 'login') ? first : undefined}
        id={`auth-${f}`}
        type={type}
        autoComplete={auto}
        value={form[f]}
        maxLength={f === 'name' ? 80 : f === 'email' ? 254 : 128}
        aria-invalid={!!errs[f]}
        aria-describedby={errs[f] ? `auth-${f}-err` : undefined}
        onChange={(e) => {
          setForm({ ...form, [f]: e.target.value })
          if (errs[f]) setErrs({ ...errs, [f]: undefined })
        }}
      />
      {errs[f] ? (
        <span className="auth-err" id={`auth-${f}-err`} role="alert">
          {errs[f]}
        </span>
      ) : (
        f === 'password' && mode === 'register' && <span className="auth-hint">{t('auth.passwordHint')}</span>
      )}
    </div>
  )

  return (
    <div className="auth-layer" data-i18n onClick={() => !busy && onClose()}>
      <form className="auth-panel" onSubmit={submit} onClick={(e) => e.stopPropagation()} noValidate aria-labelledby="auth-title">
        <span className="auth-corner tl" aria-hidden="true" />
        <span className="auth-corner br" aria-hidden="true" />
        <button type="button" className="auth-x" aria-label={t('auth.close')} onClick={onClose} disabled={busy}>
          ×
        </button>
        <p className="auth-kicker">CAPITAL COMPASS · ATLAS</p>
        <h2 id="auth-title">{t(mode === 'login' ? 'auth.loginTitle' : 'auth.registerTitle')}</h2>
        <p className="auth-sub">{t(mode === 'login' ? 'auth.loginSub' : 'auth.registerSub')}</p>
        {mode === 'register' && input('name', 'text', 'name')}
        {input('email', 'email', 'email')}
        {input('password', 'password', mode === 'login' ? 'current-password' : 'new-password')}
        {mode === 'register' && input('confirm', 'password', 'new-password')}
        {formErr && (
          <p className="auth-form-err" role="alert">
            {formErr}
          </p>
        )}
        <button className="btn primary auth-submit" disabled={busy}>
          {busy ? (
            <>
              <Spinner /> {t('auth.working')}
            </>
          ) : (
            t(mode === 'login' ? 'auth.submitLogin' : 'auth.submitRegister')
          )}
        </button>
        <button type="button" className="auth-switch" onClick={() => onMode(mode === 'login' ? 'register' : 'login')} disabled={busy}>
          {t(mode === 'login' ? 'auth.toRegister' : 'auth.toLogin')}
        </button>
      </form>
    </div>
  )
}
