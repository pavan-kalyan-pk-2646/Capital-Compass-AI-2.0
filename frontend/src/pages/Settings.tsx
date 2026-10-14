import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LANGS, useLanguage, languageName } from '@/components/LanguageContext'
import { useApp } from '@/stores/app'
import { Icon } from '@/components/icons'

export default function Settings() {
  const { lang, setLang, t } = useLanguage()
  const user = useApp((s) => s.user)
  const [saved, setSaved] = useState(false)
  const initials = (user?.name || user?.email || 'CC').split(/[\s@]+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join('') || 'CC'
  const [avatar, setAvatar] = useState(localStorage.getItem('cc2-avatar') || initials)
  const save = () => { localStorage.setItem('cc2-avatar', avatar); setSaved(true); setTimeout(()=>setSaved(false),1400) }
  return <div className="page settings-page">
    <div className="page-head"><div><div className="eyebrow">CONTROL DECK</div><h2>{t('Settings')}</h2><p>Personalize the command center without changing the financial engines.</p></div><Link className="btn ghost" to="/dashboard"><Icon name="arrow" size={14}/> {t('Command center')}</Link></div>
    <div className="settings-grid">
      <section className="settings-card hero-setting"><div className="avatar-orb">{avatar}</div><div><span className="eyebrow">ACCOUNT</span><h3>{user?.name || 'Guest operator'}</h3><p>{user?.email || 'Guest mode · decisions remain local to this browser.'}</p></div></section>
      <section className="settings-card"><div className="settings-head"><span>{t('Language')}</span><b>{languageName(lang)}</b></div><div className="settings-langs">{LANGS.map(l=><button className={lang===l.id?'selected':''} key={l.id} onClick={()=>setLang(l.id)}><strong>{l.native}</strong><small>{l.label}</small></button>)}</div></section>
      <section className="settings-card"><div className="settings-head"><span>Avatar</span><b>{avatar}</b></div><input className="input" maxLength={3} value={avatar} onChange={e=>setAvatar(e.target.value.toUpperCase())}/><button className="btn primary mt" onClick={save}>{saved ? 'Saved ✓' : t('Save settings')}</button></section>
      <section className="settings-card"><div className="settings-head"><span>Visual engine</span><b>OBSIDIAN 4DX</b></div><p className="text-2">Black cinematic surfaces, gold state lighting, CSS 3D architecture and GPU-aware WebGL. The product stays readable even when motion is reduced.</p><div className="setting-status"><span className="sd-dot"/> {t('System ready')}</div></section>
    </div>
  </div>
}
