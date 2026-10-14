import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { startDemo } from '@/components/DemoGuide'
import { Icon } from '@/components/icons'
import { Disclaimer } from '@/components/ui'

import './learn.css'

type Stage = 'Understand' | 'Decide' | 'Simulate' | 'Challenge' | 'Optimize' | 'Trust'

interface Step {
  title: string
  stage: Stage
  text: ReactNode
  list?: ReactNode[]
  nodes: string[]
  link: { to: string; label: string }
}

const STAGES: { name: Stage; steps: string }[] = [
  { name: 'Understand', steps: 'Steps 1–3' },
  { name: 'Decide', steps: 'Step 4' },
  { name: 'Simulate', steps: 'Steps 5–6' },
  { name: 'Challenge', steps: 'Steps 7–9' },
  { name: 'Optimize', steps: 'Step 10' },
  { name: 'Trust', steps: 'Steps 11–12' },
]

const STEPS: Step[] = [
  {
    title: 'Understand the user',
    stage: 'Understand',
    text: 'Your income, expenses, assets, loans, goals and risk answers are validated into one structured profile. Questions typed into the command bar are parsed by deterministic rules, so no API key is needed.',
    nodes: ['profile_parser'],
    link: { to: '/twin', label: 'Enter your profile' },
  },
  {
    title: 'Build the Financial Digital Twin',
    stage: 'Understand',
    text: 'The profile becomes a working model: net worth, monthly surplus, savings rate, emergency-fund months, debt-to-income and a 0–100 health score. Every later step reads from this twin.',
    nodes: ['financial_twin'],
    link: { to: '/twin', label: 'Open the Digital Twin' },
  },
  {
    title: 'Understand Risk DNA',
    stage: 'Understand',
    text: 'Three branches run in parallel: Risk DNA scores eight dimensions from 0 to 100, the Goal Agent checks whether the goal is feasible with your surplus, and the Market Agent reads the current volatility regime from NIFTY 50 history.',
    nodes: ['risk_dna', 'goal_agent', 'market_agent'],
    link: { to: '/learn#risk-dna', label: 'Learn about Risk DNA' },
  },
  {
    title: 'Route the decision',
    stage: 'Decide',
    text: 'The Supervisor works out what you are deciding, and the Decision Router sends it to the matching engine: investment (also used for goals), loan, high-risk spending or crisis. The engine drafts a plan and the Portfolio Doctor checks the proposed mix, or your uploaded holdings.',
    nodes: ['supervisor', 'decision_router', 'investment', 'loan', 'spending', 'crisis', 'portfolio_doctor'],
    link: { to: '/architecture', label: 'See the pipeline' },
  },
  {
    title: 'Generate possible futures',
    stage: 'Simulate',
    text: 'The plan is run through 10,000 simulated futures built from random 6-month blocks of real NIFTY 50 and debt history (2000–2023), scaled to the current regime, with your full monthly cash flow inside every path. The result is a range of outcomes and a goal probability, not a single forecast.',
    nodes: ['simulation_engine'],
    link: { to: '/goals', label: 'See goal survival' },
  },
  {
    title: 'Stress-test the decision',
    stage: 'Simulate',
    text: 'The Crisis engine shocks the twin to see what breaks: market crash, job loss, inflation spike, interest-rate shock, medical emergency, or crash plus income loss together.',
    nodes: ['crisis_engine'],
    link: { to: '/crisis', label: 'Open the Crisis War Room' },
  },
  {
    title: 'Let competing agents debate',
    stage: 'Challenge',
    text: 'Five committee agents each take a position from the engine numbers. The debate runs structured rebuttals and a weighted vote in which Risk and Compliance count 1.5 and a Compliance objection is a veto.',
    list: [
      'Bull argues the growth case from the simulated upside',
      'Bear argues the downside from crash, drawdown and crisis results',
      'Risk checks the plan against your Risk DNA and limits',
      'Goal checks what the plan does to your goal',
      'Compliance checks 23 local rules, retrieved with BM25 and cited by ID',
    ],
    nodes: ['financial_committee', 'debate'],
    link: { to: '/committee', label: 'Open the AI Committee' },
  },
  {
    title: 'Let the Red Team attack',
    stage: 'Challenge',
    text: 'Seven attacks try to break the plan. Each is graded pass, warn or fail, and the results produce a robustness score out of 100.',
    list: [
      'Crash: loss in a NIFTY −30% crash versus your loss limit (critical)',
      'Inflation: 5 points above the base for the whole horizon',
      'Income stop: six months without salary (critical)',
      'Goal change: the target rises by 20%',
      'Low return: equity returns 4% a year lower',
      'Liquidity crisis: an emergency bill during a crash, covered from cash and debt or not',
      'Rate shock: floating and new loan rates up 2.5 points (critical)',
    ],
    nodes: ['red_team'],
    link: { to: '/committee#redteam', label: 'See the Red Team' },
  },
  {
    title: 'Let the Critic decide',
    stage: 'Challenge',
    text: 'The Critic applies fixed rules. It rejects the plan if:',
    list: ['any critical Red Team test fails', 'base-case goal success is below 50% for a high-priority goal', 'the robustness score is below 55'],
    nodes: ['critic'],
    link: { to: '/committee#critic', label: 'See the Critic’s verdict' },
  },
  {
    title: 'Re-optimize if necessary',
    stage: 'Optimize',
    text: 'A rejected plan goes to the re-optimiser, which searches across allocation, monthly investment, loan amount and tenure, and spending cut. Candidates that break a hard limit are filtered out, the rest are simulated and ranked, and the best goes back through the pipeline. After two retries the best plan found is accepted with its weaknesses flagged.',
    nodes: ['re_optimize', 'simulation_engine'],
    link: { to: '/committee#compare', label: 'Compare old and new plans' },
  },
  {
    title: 'Explain the result',
    stage: 'Trust',
    text: 'Counterfactuals show why this plan and not a riskier or safer version, and assumption sensitivity ranks what would change the answer most: lower returns, higher inflation, a smaller investment, an earlier deadline or higher volatility. The explanation is written from engine numbers; an optional language model may only rephrase it.',
    nodes: ['counterfactual', 'explanation'],
    link: { to: '/committee#why', label: 'See “why this, why not that”' },
  },
  {
    title: 'Preserve the audit trail',
    stage: 'Trust',
    text: 'Every node is recorded with a timestamp and duration, and the decision, agent logs and audit trail are stored across 12 MySQL tables (SQLite when MySQL is not configured). The Trust Center lists data sources, assumptions, simulated paths, agents, compliance results and confidence.',
    nodes: ['trust_center'],
    link: { to: '/audit', label: 'Open the audit trail' },
  },
]

function prefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export default function HowItWorks() {
  const navigate = useNavigate()
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const fillRef = useRef<HTMLDivElement | null>(null)
  const stepRefs = useRef<(HTMLLIElement | null)[]>([])
  const [seen, setSeen] = useState<boolean[]>(() => STEPS.map(() => false))

  // Reveal each step once it scrolls into view.
  useEffect(() => {
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      setSeen(STEPS.map(() => true))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        // a step counts as seen once it is in view or has already been scrolled past (anchor jumps, fast scrolls)
        const hit = entries.filter((e) => e.isIntersecting || e.boundingClientRect.top < 0)
        const idx = hit.map((e) => Number((e.target as HTMLElement).dataset.index))
        if (idx.length === 0) return
        const max = Math.max(...idx)
        setSeen((prev) => prev.map((v, i) => v || idx.includes(i) || i < max))
        hit.forEach((e) => io.unobserve(e.target))
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.15 },
    )
    stepRefs.current.forEach((el) => el && io.observe(el))
    return () => io.disconnect()
  }, [])

  // Fill the vertical progress line as the reader moves through the steps.
  useEffect(() => {
    const fill = fillRef.current
    const wrap = wrapRef.current
    if (!fill || !wrap) return
    if (prefersReducedMotion()) {
      fill.style.transform = 'scaleY(1)'
      return
    }
    let frame = 0
    const update = () => {
      frame = 0
      const r = wrap.getBoundingClientRect()
      const anchor = window.innerHeight * 0.6
      const p = r.height > 0 ? Math.min(1, Math.max(0, (anchor - r.top) / r.height)) : 0
      fill.style.transform = `scaleY(${p})`
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="learn-eyebrow">Direction before decision</div>
          <h1 className="mt-sm">How Capital Compass works</h1>
          <p className="learn-lead">
            Before you make a financial decision, Capital Compass lets you live through its possible consequences. Here is what happens, step by step, between your question and the answer you see.
          </p>
        </div>
      </div>

      <ol className="hiw-stages" aria-label="The six stages">
        {STAGES.map((s, i) => (
          <li key={s.name}>
            <div className="hiw-stage-n">Stage {i + 1}</div>
            <div className="hiw-stage-name">{s.name}</div>
            <div className="hiw-stage-steps">{s.steps}</div>
          </li>
        ))}
      </ol>

      <section className="panel hiw-honest" aria-labelledby="hiw-what">
        <h2 id="hiw-what" className="learn-eyebrow">
          What the system is
        </h2>
        <blockquote>
          A multi-agent decision orchestration system combining specialized financial reasoning engines, simulations, structured agent deliberation, adversarial testing and optional AI language capabilities.
        </blockquote>
        <p>
          The numbers come from deterministic, tested engines. The agents are structured reasoning components that read those numbers and apply fixed rules, so the same inputs give the same result. A language model is
          optional and off by default; when it is enabled it can only rephrase the final summary, never change a number. Simulated outcomes describe a range of possible futures and are not guaranteed predictions.
        </p>
      </section>

      <div className="hiw-steps-wrap" ref={wrapRef}>
        <div className="hiw-track" aria-hidden="true" />
        <div className="hiw-fill" ref={fillRef} aria-hidden="true" />
        <ol className="hiw-steps" aria-label="Twelve steps">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              ref={(el) => {
                stepRefs.current[i] = el
              }}
              data-index={i}
              className={`hiw-step${seen[i] ? ' is-in' : ''}`}
            >
              <div className="hiw-num" aria-hidden="true">
                {i + 1}
              </div>
              <article className="hiw-card" aria-labelledby={`hiw-step-${i + 1}`}>
                <div className="hiw-stage-tag">
                  Step {i + 1} · {s.stage}
                </div>
                <h2 id={`hiw-step-${i + 1}`}>{s.title}</h2>
                <p>{s.text}</p>
                {s.list && (
                  <ul className="hiw-list">
                    {s.list.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ul>
                )}
                <div className="hiw-foot">
                  <div className="learn-chips" style={{ marginTop: 0 }} aria-label="Graph nodes">
                    {s.nodes.map((n) => (
                      <code key={n} className="learn-code">
                        {n}
                      </code>
                    ))}
                  </div>
                  <Link className="learn-try" to={s.link.to}>
                    {s.link.label}
                    <Icon name="arrow" size={16} />
                  </Link>
                </div>
              </article>
            </li>
          ))}
        </ol>
      </div>

      <section className="panel hiw-cta" aria-labelledby="hiw-cta-h">
        <h2 id="hiw-cta-h">See it for yourself</h2>
        <p>Watch the pipeline execute node by node, or follow the guided flagship demo, where every step calls the real engines on a sample profile.</p>
        <div className="row wrap mt">
          <Link className="btn primary" to="/architecture">
            <Icon name="committee" size={16} />
            Watch the agents run
          </Link>
          <button type="button" className="btn" onClick={() => void startDemo(navigate)}>
            <Icon name="play" size={16} />
            Run the flagship demo
          </button>
        </div>
      </section>

      <Disclaimer />
    </div>
  )
}
