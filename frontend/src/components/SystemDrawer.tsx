import { useLocation } from 'react-router-dom'
import { Icon } from '@/components/icons'
import { useLanguage } from '@/components/LanguageContext'
import { useState } from 'react'

const FLOW: Record<string, { title: string; steps: string[]; output: string }> = {
  '/dashboard': { title: 'Command Center', steps: ['Your profile', 'Digital Twin', 'Active decision', 'Simulated futures', 'Signals'], output: 'A live view of your financial system.' },
  '/twin': { title: 'Digital Twin', steps: ['Income + expenses', 'Assets + liabilities', 'Goals', 'Risk DNA', 'Resilience'], output: 'One shared financial state used by every engine.' },
  '/investment': { title: 'Investment Engine', steps: ['Risk + goals', 'Allocation', '10K futures', 'Stress tests', 'Decision'], output: 'A tested investment plan, not a blind return estimate.' },
  '/loan': { title: 'Loan Simulator', steps: ['Loan inputs', 'EMI + interest', 'Liquidity', 'Goal impact', 'Shock tests'], output: 'Whether the loan still works when life gets worse.' },
  '/goals': { title: 'Goal Survival', steps: ['Target', 'Horizon', 'Monthly investment', 'Market shocks', 'Success range'], output: 'How likely the goal is to survive multiple futures.' },
  '/portfolio': { title: 'Portfolio Doctor', steps: ['Holdings', 'Concentration', 'Liquidity', 'Goal fit', 'Treatment'], output: 'What is unhealthy and what change could improve it.' },
  '/spending': { title: 'Spending Risk', steps: ['Recurring spend', 'Cash-flow drag', 'Opportunity cost', 'Stress test', 'Consequence'], output: 'The future capital pressure created by the spending pattern.' },
  '/crisis': { title: 'Crisis War Room', steps: ['Choose shock', 'Apply to Twin', 'Measure damage', 'Find break point', 'Restore resilience'], output: 'What breaks first and what change restores resilience.' },
  '/multiverse': { title: 'What-if Multiverse', steps: ['Change assumptions', 'Run engine', 'Generate futures', 'Compare ranges', 'Inspect trade-offs'], output: 'A field of possible outcomes, not a guaranteed prediction.' },
  '/committee': { title: 'AI Committee', steps: ['Bull', 'Bear', 'Risk', 'Goal', 'Compliance'], output: 'Competing perspectives on the same evidence.' },
  '/architecture': { title: 'Agent Architecture', steps: ['Supervisor', 'Specialized agents', 'Financial engines', 'Debate', 'Red Team → Critic'], output: 'The actual decision machinery behind the interface.' },
  '/audit': { title: 'Audit Trail', steps: ['Inputs', 'Agent logs', 'Simulation evidence', 'Decision checkpoints', 'Final output'], output: 'Evidence for how the decision was produced.' },
  '/trust': { title: 'Trust Center', steps: ['Sources', 'Assumptions', 'Methods', 'Safeguards', 'Limitations'], output: 'What the system knows, assumes and cannot guarantee.' },
  '/market': { title: 'Market Intelligence', steps: ['Public context', 'Regime', 'Historical data', 'Scenario input', 'Decision context'], output: 'Market context used as evidence, not prophecy.' },
  '/how-it-works': { title: 'How It Works', steps: ['Understand', 'Simulate', 'Stress-test', 'Challenge', 'Explain'], output: 'The complete product loop in plain language.' },
  '/learn': { title: 'Financial Intelligence Lab', steps: ['Term', 'Plain-language meaning', 'Why it matters', 'Example', 'Capital Compass use'], output: 'Learn the terminology while using the product.' },
}

export default function SystemDrawer() {
  const { t } = useLanguage()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const flow = FLOW[pathname] ?? FLOW['/dashboard']!
  return (
    <>
      <button className="system-drawer-toggle" onClick={() => setOpen(true)} aria-label={t('system')}>
        <span className="sd-dot" /> <Icon name="graph" size={15} /> <span>{t('system')}</span>
      </button>
      {open && (
        <div className="system-drawer-backdrop" onClick={() => setOpen(false)}>
          <aside className="system-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="system-drawer-head">
              <div><span className="sd-eyebrow">LIVE ARCHITECTURE</span><h2>{flow.title}</h2></div>
              <button className="btn sm ghost" onClick={() => setOpen(false)}>×</button>
            </div>
            <div className="sd-rail">
              {flow.steps.map((step, i) => <div className="sd-step" key={step}><b>{String(i + 1).padStart(2, '0')}</b><span>{step}</span>{i < flow.steps.length - 1 && <i />}</div>)}
            </div>
            <div className="sd-output"><span>{t('output')}</span><strong>{flow.output}</strong></div>
            <div className="sd-proof"><span>{t('proof')}</span><p>Capital Compass does not try to predict the future. It proves that a financial decision can be <b>tested, challenged and explained</b> before you commit.</p></div>
          </aside>
        </div>
      )}
    </>
  )
}
