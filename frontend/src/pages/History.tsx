import { Link } from 'react-router-dom'
import { Icon } from '@/components/icons'
import { Panel } from '@/components/ui'
import { useApp } from '@/stores/app'
import { useLanguage } from '@/components/LanguageContext'

export default function History() {
  const history = useApp((s) => s.decisionHistory)
  const { t } = useLanguage()
  return <div className="page history-page">
    <div className="page-head"><div><div className="eyebrow">DECISION MEMORY</div><h2>{t('Decision history')}</h2><p>{t('Decisions you run appear here with their recommendation, confidence and risk level.')}</p></div><Link className="btn primary" to="/dashboard"><Icon name="dashboard" size={15}/> {t('Command center')}</Link></div>
    <Panel title={t('Decision history')} sub="Local session memory · latest 30 runs">
      {history.length ? <div className="history-list">{history.map((x, i) => <Link className="history-item" key={x.id} to={`/committee?id=${x.id}`}><span className="history-index">{String(i+1).padStart(2,'0')}</span><span><strong>{x.id}</strong><small>{new Date(x.at).toLocaleString()}</small></span><Icon name="arrow" size={15}/></Link>)}</div> : <div className="state"><h3>{t('No decisions yet')}</h3><p>{t('Run a decision to start building your decision memory.')}</p></div>}
    </Panel>
  </div>
}
