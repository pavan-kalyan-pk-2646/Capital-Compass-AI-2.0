import { useEffect, useRef } from 'react'
import { useNavigate, type NavigateFunction } from 'react-router-dom'

import { loadJudgeProfile } from '@/hooks/useTwin'
import { useApp } from '@/stores/app'

export interface DemoStep {
  title: string
  text: string
  route: string
}

/** The flagship judge walkthrough. Every step runs the real engines on the judge profile. */
export const DEMO: DemoStep[] = [
  { title: 'Create the Financial Digital Twin', text: 'Age 28, ₹80,000/month income, ₹6 lakh savings, a ₹25 lakh home goal in 5 years and a 15% loss limit.', route: '/twin' },
  {
    title: 'Generate the Risk DNA',
    text: 'Eight dimensions — growth appetite, loss tolerance, liquidity need, time horizon, income stability, goal pressure, debt burden, resilience — computed from the twin.',
    route: '/twin#risk-dna',
  },
  { title: 'Generate the portfolio', text: 'The Investment Engine turns Risk DNA into an allocation and a monthly investment, capped by the 15% loss limit.', route: '/investment' },
  { title: 'Run 10,000 simulations', text: 'Block-bootstrapped NIFTY 50 and debt history, scaled to the current market regime, with the full monthly cash flow inside every path.', route: '/goals' },
  { title: 'Read the goal probability', text: 'Goal survival under normal, bear, crash and crash + job-loss markets.', route: '/goals#scenarios' },
  { title: 'Add a ₹5 lakh personal loan', text: 'The Loan Decision Simulator runs the loan at 14% over 60 months with a 1% processing fee.', route: '/loan' },
  { title: 'Calculate the EMI', text: 'EMI, total interest, processing fee and total repayment, from the standard amortisation formula.', route: '/loan' },
  { title: 'Calculate debt stress', text: 'Debt-to-income before and after, the debt stress score, and what happens at −30% income or a job loss.', route: '/loan#stress' },
  { title: 'See the goal impact', text: 'The same 10,000 market paths with and without the loan: the EMI squeezes the monthly investment and the goal probability falls.', route: '/loan#impact' },
  { title: 'Trigger a NIFTY −30% crash', text: 'The Crisis War Room shocks the Digital Twin with a NIFTY −30% crash, gold +5% and debt flat.', route: '/crisis' },
  { title: 'See the portfolio impact', text: 'Portfolio loss against the 15% limit, goal probability before and after, recovery time and liquidity.', route: '/crisis#impact' },
  { title: 'Run the AI Committee', text: 'The full LangGraph pipeline starts on the flagship question. Bull, Bear, Risk, Goal and Compliance read the same numbers.', route: '/committee#committee' },
  { title: 'Run the debate', text: 'The agents answer each other, then vote. Compliance can veto.', route: '/committee#debate' },
  { title: 'Run the Red Team', text: 'Seven attacks on the loan plan: crash, inflation, income stop, goal change, low returns, liquidity crisis and rate shock.', route: '/committee#redteam' },
  { title: 'The Critic evaluates', text: 'A critical test failed and the goal is below an even chance, so the Critic rejects the plan.', route: '/committee#critic' },
  { title: 'Re-optimise', text: 'The re-optimiser searches allocation, investment and loan terms that clear every hard limit.', route: '/committee#critic' },
  { title: 'Simulate again', text: 'The new plan goes back through simulation, committee, Red Team and Critic. Watch the loop on the agent architecture.', route: '/architecture#node-critic' },
  { title: 'Compare old vs new', text: 'The rejected plan next to the approved one: goal success, resilience, debt stress and crash loss.', route: '/committee#compare' },
  { title: 'Counterfactual explanation', text: 'Why this plan, and why not the riskier or the safer one, from the same simulations.', route: '/committee#why' },
  { title: 'Trust Center', text: 'Data sources, simulation count, agents, committee, Red Team, Critic, compliance, confidence and limitations.', route: '/trust' },
  { title: 'Audit trail', text: 'Every node of the decision, in order, with timestamps and timings.', route: '/audit' },
]

export async function startDemo(nav: NavigateFunction) {
  const st = useApp.getState()
  st.setDemoStep(0)
  nav(DEMO[0]!.route)
}

/** Fires `fn` once each time the demo enters one of `steps` while the page is mounted. */
export function useDemoStep(steps: number[], fn: (step: number) => void) {
  const demoStep = useApp((s) => s.demoStep)
  const fired = useRef<number | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const key = steps.join(',')
  useEffect(() => {
    if (demoStep === null) {
      fired.current = null
      return
    }
    if (key.split(',').map(Number).includes(demoStep) && fired.current !== demoStep) {
      fired.current = demoStep
      fnRef.current(demoStep)
    }
  }, [demoStep, key])
}

export function DemoGuide() {
  const step = useApp((s) => s.demoStep)
  const setStep = useApp((s) => s.setDemoStep)
  const nav = useNavigate()
  const loadedRef = useRef(false)

  useEffect(() => {
    if (step === 0 && !loadedRef.current) {
      loadedRef.current = true
      loadJudgeProfile().catch(() => undefined)
    }
    if (step === null) loadedRef.current = false
  }, [step])

  if (step === null) return null
  const s = DEMO[step]!
  const go = (n: number) => {
    setStep(n)
    nav(DEMO[n]!.route)
  }
  return (
    <div className="demo-guide" role="dialog" aria-label="Flagship demo guide">
      <div className="row between">
        <span className="small brass">
          Flagship demo · step {step + 1} of {DEMO.length}
        </span>
        <button className="btn sm ghost" onClick={() => setStep(null)} aria-label="Exit demo">
          Exit
        </button>
      </div>
      <div className="demo-steps" aria-hidden="true">
        {DEMO.map((_, i) => (
          <i key={i} className={i <= step ? 'on' : ''} />
        ))}
      </div>
      <h3>{s.title}</h3>
      <p className="small text-2 mt-sm">{s.text}</p>
      <div className="row between mt">
        <button className="btn sm ghost" disabled={step === 0} onClick={() => go(step - 1)}>
          Back
        </button>
        {step < DEMO.length - 1 ? (
          <button className="btn sm primary" onClick={() => go(step + 1)}>
            Next step
          </button>
        ) : (
          <button className="btn sm primary" onClick={() => setStep(null)}>
            Finish demo
          </button>
        )}
      </div>
    </div>
  )
}
