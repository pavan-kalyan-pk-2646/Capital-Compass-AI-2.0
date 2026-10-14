import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Disclaimer } from '@/components/ui'
import { Icon } from '@/components/icons'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/services/api'
import type { MarketStats } from '@/services/types'

import './learn.css'

/* ---------- Small building blocks ---------- */

function Code({ children }: { children: ReactNode }) {
  return <code className="learn-code">{children}</code>
}

function Uses({ chips, children }: { chips: string[]; children: ReactNode }) {
  return (
    <aside className="learn-uses" aria-label="How Capital Compass uses it">
      <h3>How Capital Compass uses it</h3>
      {children}
      <div className="learn-chips">
        {chips.map((c) => (
          <Code key={c}>{c}</Code>
        ))}
      </div>
    </aside>
  )
}

function Try({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className="learn-try" to={to}>
      Try it: {children}
      <Icon name="arrow" size={16} />
    </Link>
  )
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="learn-figure">
      {children}
      <figcaption>Conceptual illustration — {label}. Shapes are schematic, not data.</figcaption>
    </figure>
  )
}

function ArrowDefs() {
  return (
    <defs>
      <marker id="lsvg-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 10 5 0 10z" className="lsvg-arrow" />
      </marker>
      <marker id="lsvg-arr-red" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 10 5 0 10z" className="lsvg-arrow-red" />
      </marker>
      <marker id="lsvg-arr-green" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 10 5 0 10z" className="lsvg-arrow-green" />
      </marker>
    </defs>
  )
}

/* ---------- Diagrams (schematic; no data) ---------- */

const FAN = (() => {
  const x0 = 50
  const x1 = 520
  const y0 = 210
  const steps = 40
  const xs = Array.from({ length: steps + 1 }, (_, i) => x0 + ((x1 - x0) * i) / steps)
  const med = (t: number) => y0 - 95 * t
  const spread = (t: number, k: number) => k * Math.sqrt(t)
  const line = (f: (t: number) => number) => xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${f(i / steps).toFixed(1)}`).join(' ')
  const band = (k: number) => {
    const up = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${(med(i / steps) - spread(i / steps, k)).toFixed(1)}`).join(' ')
    const dn = xs
      .map((x, i) => [x, med(i / steps) + spread(i / steps, k * 0.8)] as const)
      .reverse()
      .map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`)
      .join(' ')
    return `${up} ${dn} Z`
  }
  // a fixed-seed generator so the sketch is identical on every render
  let s = 7
  const rnd = () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647 - 0.5
  }
  const paths = Array.from({ length: 14 }, () => {
    let y = y0
    const drift = 95 / steps + rnd() * 1.6
    return xs.map((x, i) => {
      if (i) y += -drift + rnd() * 9
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
  }).map((p) => p.join(' '))
  return { outer: band(95), inner: band(40), median: line(med), paths, x0, x1, y0 }
})()

function MonteCarloFan() {
  return (
    <Figure label="each thin line is one possible future; the shaded bands show where most of them land">
      <svg viewBox="0 0 560 270" role="img" aria-labelledby="mc-title">
        <title id="mc-title">A fan of simulated futures spreading out from today, with a median line and percentile bands, compared with a goal line</title>
        <line x1={FAN.x0} y1={250} x2={FAN.x1} y2={250} className="lsvg-axis" />
        <line x1={FAN.x0} y1={20} x2={FAN.x0} y2={250} className="lsvg-axis" />
        <path d={FAN.outer} className="lsvg-band-outer" />
        <path d={FAN.inner} className="lsvg-band-inner" />
        {FAN.paths.map((d, i) => (
          <path key={i} d={d} className="lsvg-path" />
        ))}
        <path d={FAN.median} className="lsvg-median" />
        <line x1={FAN.x0} y1={96} x2={FAN.x1} y2={96} className="lsvg-goal" />
        <text x={FAN.x1} y={88} textAnchor="end" className="lsvg-label-brass">
          Goal
        </text>
        <text x={FAN.x1 - 4} y={124} textAnchor="end" className="lsvg-label-strong">
          Median (P50)
        </text>
        <text x={FAN.x1 - 4} y={30} textAnchor="end" className="lsvg-label">
          P95
        </text>
        <text x={FAN.x1 - 4} y={202} textAnchor="end" className="lsvg-label">
          P5
        </text>
        <text x={FAN.x0} y={266} className="lsvg-label">
          Today
        </text>
        <text x={FAN.x1} y={266} textAnchor="end" className="lsvg-label">
          Goal date
        </text>
      </svg>
    </Figure>
  )
}

const DNA_DIMS = ['Growth Appetite', 'Loss Tolerance', 'Liquidity Need', 'Time Horizon', 'Income Stability', 'Goal Pressure', 'Debt Burden', 'Financial Resilience']
const DNA_SHAPE = [0.72, 0.55, 0.4, 0.8, 0.85, 0.6, 0.3, 0.68]

function RiskDnaOctagon() {
  const cx = 280
  const cy = 165
  const r = 105
  const pt = (i: number, k: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 8
    return [cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k] as const
  }
  const ring = (k: number) => DNA_DIMS.map((_, i) => pt(i, k).join(',')).join(' ')
  const shape = DNA_SHAPE.map((k, i) => pt(i, k).join(',')).join(' ')
  return (
    <Figure label="eight dimensions, each scored 0–100; the outline is an example shape">
      <svg viewBox="0 0 560 330" role="img" aria-labelledby="dna-title">
        <title id="dna-title">{`An octagon with eight axes: ${DNA_DIMS.join(', ')}. A filled shape shows one person's profile across them.`}</title>
        {[0.33, 0.66, 1].map((k) => (
          <polygon key={k} points={ring(k)} className="lsvg-grid" />
        ))}
        {DNA_DIMS.map((_, i) => {
          const [x, y] = pt(i, 1)
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} className="lsvg-grid" />
        })}
        <polygon points={shape} className="lsvg-shape" />
        {DNA_SHAPE.map((k, i) => {
          const [x, y] = pt(i, k)
          return <circle key={i} cx={x} cy={y} r={3} className="lsvg-dot" />
        })}
        {DNA_DIMS.map((d, i) => {
          const [x, y] = pt(i, 1.16)
          const anchor = Math.abs(x - cx) < 4 ? 'middle' : x > cx ? 'start' : 'end'
          return (
            <text key={d} x={x} y={y + 4} textAnchor={anchor} className="lsvg-label-strong">
              {d}
            </text>
          )
        })}
      </svg>
    </Figure>
  )
}

function RedTeamLoop() {
  return (
    <Figure label="the plan is attacked, judged, and either accepted or sent back to be improved (at most twice)">
      <svg viewBox="0 0 560 250" role="img" aria-labelledby="rt-title">
        <title id="rt-title">Loop: simulation, then Red Team attacks, then the Critic. If the Critic rejects, the plan is re-optimised and simulated again; if it accepts, the result is explained.</title>
        <ArrowDefs />
        <rect x={14} y={40} width={124} height={52} rx={10} className="lsvg-box" />
        <text x={76} y={63} textAnchor="middle" className="lsvg-label-strong">
          Simulate
        </text>
        <text x={76} y={80} textAnchor="middle" className="lsvg-label">
          10,000 futures
        </text>
        <rect x={180} y={40} width={124} height={52} rx={10} className="lsvg-box-red" />
        <text x={242} y={63} textAnchor="middle" className="lsvg-label-strong">
          Red Team
        </text>
        <text x={242} y={80} textAnchor="middle" className="lsvg-label">
          seven attacks
        </text>
        <rect x={346} y={40} width={100} height={52} rx={10} className="lsvg-box-brass" />
        <text x={396} y={63} textAnchor="middle" className="lsvg-label-strong">
          Critic
        </text>
        <text x={396} y={80} textAnchor="middle" className="lsvg-label">
          accept / reject
        </text>
        <rect x={470} y={40} width={80} height={52} rx={10} className="lsvg-box-green" />
        <text x={510} y={63} textAnchor="middle" className="lsvg-label-strong">
          Explain
        </text>
        <text x={510} y={80} textAnchor="middle" className="lsvg-label">
          accepted
        </text>
        <rect x={180} y={170} width={200} height={52} rx={10} className="lsvg-box" />
        <text x={280} y={193} textAnchor="middle" className="lsvg-label-strong">
          Re-optimise
        </text>
        <text x={280} y={210} textAnchor="middle" className="lsvg-label">
          search safer plans
        </text>
        <path d="M138 66 H176" className="lsvg-edge" markerEnd="url(#lsvg-arr)" />
        <path d="M304 66 H342" className="lsvg-edge" markerEnd="url(#lsvg-arr)" />
        <path d="M446 66 H466" className="lsvg-edge-green" markerEnd="url(#lsvg-arr-green)" />
        <path d="M396 92 V196 H384" className="lsvg-edge-red" markerEnd="url(#lsvg-arr-red)" />
        <path d="M180 196 H76 V96" className="lsvg-edge" markerEnd="url(#lsvg-arr)" />
        <text x={404} y={150} className="lsvg-label">
          reject
        </text>
        <text x={84} y={150} className="lsvg-label">
          max 2 retries
        </text>
      </svg>
    </Figure>
  )
}

function DecisionWeb() {
  const nodes: { id: string; label: string; x: number; y: number; w: number }[] = [
    { id: 'emi', label: 'New EMI', x: 280, y: 40, w: 110 },
    { id: 'surplus', label: 'Monthly surplus', x: 110, y: 120, w: 150 },
    { id: 'debt', label: 'Debt stress', x: 450, y: 120, w: 120 },
    { id: 'sip', label: 'Monthly investment', x: 110, y: 200, w: 160 },
    { id: 'ef', label: 'Emergency fund', x: 330, y: 200, w: 140 },
    { id: 'goal', label: 'Goal success', x: 110, y: 285, w: 130 },
    { id: 'res', label: 'Resilience', x: 400, y: 285, w: 120 },
  ]
  const at = (id: string) => nodes.find((n) => n.id === id)!
  const edges: [string, string][] = [
    ['emi', 'surplus'],
    ['emi', 'debt'],
    ['emi', 'ef'],
    ['surplus', 'sip'],
    ['sip', 'goal'],
    ['ef', 'res'],
    ['debt', 'res'],
  ]
  return (
    <Figure label="one change (a new loan EMI) travels through several parts of the same financial life">
      <svg viewBox="0 0 560 320" role="img" aria-labelledby="web-title">
        <title id="web-title">
          A new loan EMI reduces the monthly surplus, which reduces the monthly investment and goal success; it also lowers emergency-fund cover and raises debt stress, which both reduce resilience.
        </title>
        <ArrowDefs />
        {edges.map(([a, b]) => {
          const p = at(a)
          const q = at(b)
          const dy = q.y - p.y
          const y1 = p.y + (dy > 0 ? 16 : dy < 0 ? -16 : 0)
          const y2 = q.y - (dy > 0 ? 20 : dy < 0 ? -20 : 0)
          return <path key={a + b} d={`M${p.x} ${y1} L${q.x} ${y2}`} className="lsvg-edge" markerEnd="url(#lsvg-arr)" />
        })}
        {nodes.map((n) => (
          <g key={n.id}>
            <rect x={n.x - n.w / 2} y={n.y - 16} width={n.w} height={32} rx={16} className={n.id === 'emi' ? 'lsvg-box-brass' : n.id === 'goal' || n.id === 'res' ? 'lsvg-box-green' : 'lsvg-box'} />
            <text x={n.x} y={n.y + 4} textAnchor="middle" className="lsvg-label-strong">
              {n.label}
            </text>
          </g>
        ))}
      </svg>
    </Figure>
  )
}

/* ---------- Real market statistics (optional, silent on failure) ---------- */

const f1 = (x: number) => `${x.toFixed(1)}%`

function MarketFacts() {
  const market = useAsync((signal) => api<MarketStats>('/api/market', { signal }))
  const run = market.run
  useEffect(() => {
    run()
  }, [run])

  if (market.loading && !market.data) return <div className="skeleton learn-facts-skeleton" aria-busy="true" aria-label="Loading market statistics" />
  const m = market.data
  if (!m) return null
  return (
    <>
      <dl className="learn-facts">
        <div>
          <dt>Equity history</dt>
          <dd>{m.equity.months} months</dd>
        </div>
        <div>
          <dt>Annualised return (CAGR)</dt>
          <dd>{f1(m.equity.cagr_pct)}</dd>
        </div>
        <div>
          <dt>Annualised volatility</dt>
          <dd>{f1(m.equity.vol_pct)}</dd>
        </div>
        <div>
          <dt>Worst 12 months</dt>
          <dd>{f1(m.equity.worst_12m_pct)}</dd>
        </div>
        <div>
          <dt>Maximum drawdown</dt>
          <dd>{f1(m.equity.max_drawdown_pct)}</dd>
        </div>
        <div>
          <dt>Current regime</dt>
          <dd style={{ textTransform: 'capitalize' }}>
            {m.regime.label} · ×{m.regime.vol_scale}
          </dd>
        </div>
      </dl>
      <p className="learn-facts-note">
        From the local data the simulator actually samples: {m.equity.source}, {m.equity.period}. Trailing 12-month volatility is {f1(m.regime.trailing_12m_vol_pct)}, at the {Math.round(m.regime.percentile_vs_history)}th
        percentile of history
        {m.regime.as_of ? ` (as of ${m.regime.as_of})` : ''}. These describe the past, not a forecast.
      </p>
    </>
  )
}

/* ---------- Topics ---------- */

interface Topic {
  id: string
  title: string
  short: string
  body: ReactNode
}

const TOPICS: Topic[] = [
  {
    id: 'digital-twin',
    title: 'What is a Financial Digital Twin?',
    short: 'Financial Digital Twin',
    body: (
      <>
        <div className="learn-body">
          <p>
            A Financial Digital Twin is a working model of your financial life: what you earn, what you spend, what you own, what you owe and what you are saving for. It is not a static snapshot. Because it can be
            changed and re-run, it lets you ask “what happens if…?” before you commit to anything real.
          </p>
          <p>
            Engineers build digital twins of jet engines and power plants so they can test changes safely. The idea here is the same: try a loan, a new monthly investment or a job loss on the model first, and see which
            parts of your finances strain.
          </p>
        </div>
        <Uses chips={['digital_twin.py', 'financial_twin']}>
          <p>
            The Digital Twin engine turns your profile into the numbers every other engine reads: net worth, liquid and investable assets, monthly surplus, savings rate, emergency-fund months (cash ÷ essential spending
            plus EMIs) and debt-to-income ratio.
          </p>
          <p>
            It also computes a health score from 0 to 100 (35% emergency fund, 35% savings rate, 30% debt-to-income), banded Strong, Stable, Stretched or Fragile. Change one input and every decision downstream is
            recalculated from the updated twin.
          </p>
        </Uses>
        <Try to="/twin">open your Financial Digital Twin</Try>
      </>
    ),
  },
  {
    id: 'risk-dna',
    title: 'What is Risk DNA?',
    short: 'Risk DNA',
    body: (
      <>
        <div className="learn-body">
          <p>
            “Risk tolerance” is usually reduced to one word such as conservative or aggressive. In practice, how much risk you can take depends on several separate things: how much loss you can stomach, how soon you need
            the money, how secure your income is and how much debt you already carry.
          </p>
          <p>Risk DNA keeps those things apart, so a plan can respect each one. Someone may be comfortable with volatility yet still need high liquidity because a goal is close; one score would hide that.</p>
          <ul>
            <li>
              <strong>Growth Appetite</strong> and <strong>Loss Tolerance</strong> — your stated loss limit, experience and how you say you would react to a 20% fall
            </li>
            <li>
              <strong>Liquidity Need</strong> and <strong>Time Horizon</strong> — emergency-fund gap, dependants, and how far away your goals are
            </li>
            <li>
              <strong>Income Stability</strong>, <strong>Goal Pressure</strong> and <strong>Debt Burden</strong> — the type of employment, the investment your goal requires versus your surplus, and EMIs versus income
            </li>
            <li>
              <strong>Financial Resilience</strong> — how well you could absorb a shock (see below)
            </li>
          </ul>
        </div>
        <RiskDnaOctagon />
        <Uses chips={['risk_engine.py', 'risk_dna']}>
          <p>
            The Risk DNA engine scores all eight dimensions from 0 to 100 with fixed, documented formulas; no language model is involved. A weighted profile score gives a label (Conservative, Moderate, Growth or
            Aggressive), which is then capped by your stated maximum loss: under 10% can never be more than Conservative, under 20% never more than Moderate, under 30% never more than Growth. The Investment Engine uses
            the result to choose an allocation.
          </p>
        </Uses>
        <Try to="/investment">see how Risk DNA shapes an investment plan</Try>
      </>
    ),
  },
  {
    id: 'monte-carlo',
    title: 'What is Monte Carlo simulation?',
    short: 'Monte Carlo simulation',
    body: (
      <>
        <div className="learn-body">
          <p>
            Nobody knows what markets will do next year. A single projection that assumes, say, a steady 12% a year hides the most important fact: the order and size of good and bad years vary, and that variation decides
            whether a goal is reached.
          </p>
          <p>
            Monte Carlo simulation answers a different question. Instead of one forecast, it generates thousands of plausible futures and counts how many of them reach your goal. The result is a range and a probability,
            such as “in most simulated futures you reach the goal; in the worst tenth you fall short by this much”.
          </p>
          <p>A probability from a simulation is not a promise. It describes how the plan behaves across the futures that were modelled, which in turn depend on the history and assumptions used.</p>
        </div>
        <MonteCarloFan />
        <Uses chips={['simulation_engine.py', 'simulation_engine', 'market/loader.py']}>
          <ul>
            <li>10,000 paths per run, with monthly steps, using a fixed seed so the same inputs always give the same answer.</li>
            <li>
              Equity returns are a block bootstrap of real NIFTY 50 monthly total returns (2000–2023): each path stitches together random 6-month blocks of actual history. Debt returns are taken from the same months, so
              crisis periods stay intact.
            </li>
            <li>The current market regime scales the swings: calm ×0.9, normal ×1.0, volatile ×1.25.</li>
            <li>Gold uses fat-tailed (Student-t) draws around a documented assumption, and each path gets its own inflation rate.</li>
            <li>Your full monthly cash flow runs inside every path: salary, expenses, EMIs and investments, including job-loss months and forced selling if cash runs out.</li>
          </ul>
          <p>Outputs include P5/P25/P50/P75/P95 bands, goal success probability, ending wealth, drawdown, recovery time and the chance of forced liquidation.</p>
        </Uses>
        <MarketFacts />
        <Try to="/goals">see your goal across 10,000 futures</Try>
      </>
    ),
  },
  {
    id: 'scenario-analysis',
    title: 'What is scenario analysis?',
    short: 'Scenario analysis',
    body: (
      <>
        <div className="learn-body">
          <p>
            Scenario analysis asks a focused question: “What if this one thing were different?” What if returns were lower than expected, inflation ran higher, my income dropped, or I invested more each month? Each
            scenario changes a few assumptions and leaves the rest alone.
          </p>
          <p>
            Comparing scenarios side by side shows which assumptions your plan is sensitive to and which barely matter. That tells you where to focus: building a buffer, changing the timeline or adjusting how much you
            invest.
          </p>
        </div>
        <Uses chips={['goal_engine.py', 'simulation_engine.py', 'POST /api/simulation/what-if']}>
          <p>
            The Goal Survival engine runs four standard scenarios on the same seed: normal, bear (equity −6% a year with volatility ×1.25), crash (NIFTY −30% in the first month) and crash plus six months without salary.
            Because they share random numbers, the differences come from the scenario, not from noise.
          </p>
          <p>
            The What-If Multiverse lets you define up to four futures of your own, adjusting market return, inflation, income, monthly investment, interest rates and timeline. Each one is simulated with 10,000 paths.
          </p>
        </Uses>
        <Try to="/multiverse">compare futures in the What-If Multiverse</Try>
      </>
    ),
  },
  {
    id: 'stress-testing',
    title: 'What is stress testing?',
    short: 'Stress testing',
    body: (
      <>
        <div className="learn-body">
          <p>
            Stress testing deliberately applies a severe but realistic shock and measures what breaks. Banks are required to do this; households rarely do. The question is not “is this likely?” but “if it happens, can I
            get through it?”
          </p>
          <p>A plan that looks fine on average can fail badly in a crisis, for example if a market crash and a job loss arrive together and you are forced to sell investments at the bottom to pay bills.</p>
        </div>
        <Uses chips={['crisis_engine.py', 'crisis_engine', 'crisis']}>
          <p>The Crisis War Room applies one of six scenarios to your twin, with a severity slider that scales the shock:</p>
          <ul>
            <li>Market crash (NIFTY −30%), job loss, inflation spike, interest-rate shock, medical emergency, and crash plus income loss together.</li>
          </ul>
          <p>
            It measures portfolio impact, goal probability before and after (10,000 paths, same seed), how many months your emergency fund lasts, EMI affordability, purchasing power, recovery time and liquidity, then
            gives rule-based responses from those numbers.
          </p>
        </Uses>
        <Try to="/crisis">open the Crisis War Room</Try>
      </>
    ),
  },
  {
    id: 'multi-agent',
    title: 'What is a multi-agent system?',
    short: 'Multi-agent systems',
    body: (
      <>
        <div className="learn-body">
          <p>
            A multi-agent system splits a complex judgement into several specialised roles that each look at the problem from one angle, then combines their views. It works like a committee: one member argues for growth,
            another for caution, another checks the rules.
          </p>
          <p>
            In Capital Compass the agents are <strong>structured reasoning components</strong>, not free-running chatbots. Each one reads numbers produced by the engines and applies its own fixed rules to form an
            opinion. That keeps the reasoning repeatable and auditable: the same inputs give the same opinions.
          </p>
        </div>
        <Uses chips={['financial_committee', 'debate', 'bull_agent', 'bear_agent', 'risk_agent', 'goal_agent', 'compliance_agent']}>
          <p>
            Five committee agents (Bull, Bear, Risk, Goal and Compliance) each give a stance with reasons. Compliance checks the plan against a local knowledge base of 23 rules, retrieved with BM25 search and cited by
            ID. The debate then runs structured rebuttals and a weighted vote: Risk and Compliance count 1.5, the others 1.0, and a Compliance objection is a veto.
          </p>
          <p>A LangGraph pipeline orchestrates the whole flow. A language model is optional and off by default; when enabled, it may only rephrase the final summary and must keep every number unchanged.</p>
        </Uses>
        <Try to="/architecture">watch the agents run</Try>
      </>
    ),
  },
  {
    id: 'red-teaming',
    title: 'What is red teaming?',
    short: 'Red teaming',
    body: (
      <>
        <div className="learn-body">
          <p>
            Red teaming means assigning someone the job of trying to prove a plan wrong. It comes from security and military planning, where a dedicated “red team” attacks a system to find weaknesses before a real
            adversary does.
          </p>
          <p>
            For a financial plan, the attacker is reality: crashes, inflation, lost income, changed goals, poor returns, sudden cash needs and rising interest rates. If the plan only works when nothing goes wrong, the
            Red Team should find out first.
          </p>
        </div>
        <RedTeamLoop />
        <Uses chips={['decision_engine.red_team', 'red_team', 'critic', 're_optimize']}>
          <p>Seven attacks are run on every recommendation, each graded pass, warn or fail:</p>
          <ul>
            <li>Crash test: instant loss in a NIFTY −30% crash versus your stated loss limit (critical)</li>
            <li>Inflation test: inflation 5 points above the base for the whole horizon</li>
            <li>Income-stop test: six months without salary (critical)</li>
            <li>Goal-change test: the target rises by 20%</li>
            <li>Low-return test: equity returns 4% a year lower</li>
            <li>Liquidity-crisis test: an emergency bill plus three months of essentials and EMIs during a crash, covered from cash and debt holdings or not</li>
            <li>Rate-shock test: floating and new loan rates up 2.5 points (critical)</li>
          </ul>
          <p>
            A robustness score starts at 100 and loses points for each failure or warning. The Critic rejects the plan if a critical test fails, if base-case goal success is below 50% for a high-priority goal, or if
            robustness is below 55.
          </p>
        </Uses>
        <Try to="/committee#redteam">see the Red Team attack a plan</Try>
      </>
    ),
  },
  {
    id: 'counterfactual',
    title: 'What is counterfactual analysis?',
    short: 'Counterfactual analysis',
    body: (
      <>
        <div className="learn-body">
          <p>
            A counterfactual is the answer to “what would have happened if we had chosen differently?” A recommendation on its own is hard to trust. Seeing the nearby alternatives, and why they were not chosen, is what
            makes it understandable.
          </p>
          <p>Counterfactuals also reveal sensitivity: which assumptions, if they turned out wrong, would change the answer the most.</p>
        </div>
        <Uses chips={['decision_engine.counterfactual', 'counterfactual', 'explanation']}>
          <ul>
            <li>
              <strong>Why not higher risk?</strong> The same plan with 15 percentage points more equity is simulated on the same seed, showing its goal success and crash loss.
            </li>
            <li>
              <strong>Why not lower risk?</strong> The same plan with 15 points less equity, for comparison.
            </li>
            <li>
              <strong>Which assumptions matter most?</strong> Equity returns −2% a year, inflation +2% a year, monthly investment −20%, the deadline one year sooner and volatility ×1.3 are each re-simulated and ranked by
              their effect on goal success.
            </li>
          </ul>
        </Uses>
        <Try to="/committee#why">see “why this, why not that”</Try>
      </>
    ),
  },
  {
    id: 'resilience',
    title: 'What is financial resilience?',
    short: 'Financial resilience',
    body: (
      <>
        <div className="learn-body">
          <p>
            Financial resilience is your ability to absorb a shock without lasting damage: a few months without income, a large medical bill, a rate rise on your loan. It is different from wealth. A high earner with no
            savings and large EMIs can be less resilient than someone who earns less but has a buffer and little debt.
          </p>
          <p>Resilience comes mostly from three things: an emergency fund that covers your unavoidable spending, a healthy gap between income and outgoings, and debt payments that leave room to breathe.</p>
        </div>
        <Uses chips={['risk_engine.py', 'loan_engine.py', 'decision_engine.plan_health']}>
          <p>
            Financial Resilience is one of the eight Risk DNA dimensions: 35% emergency-fund cover, 25% savings rate, 20% debt-to-income and 20% income stability, scored 0 to 100. The Loan Decision Simulator reports how
            a loan changes it, and the final decision screen compares resilience, debt stress and liquidity before and after the recommended plan.
          </p>
        </Uses>
        <Try to="/loan">see how a loan changes your resilience</Try>
      </>
    ),
  },
  {
    id: 'interconnected',
    title: 'Why are financial decisions interconnected?',
    short: 'Interconnected decisions',
    body: (
      <>
        <div className="learn-body">
          <p>
            Every rupee in a monthly budget can only be used once. A new EMI does not just add a payment; it reduces what is left to invest, shrinks the cushion for emergencies and raises your exposure to rate changes.
            Those effects then compound over years.
          </p>
          <p>
            This is why looking at a decision in isolation can mislead. A loan may be “affordable” by the bank’s standard and still push a goal out of reach, or leave you one bad month away from selling investments at a
            loss.
          </p>
        </div>
        <DecisionWeb />
        <Uses chips={['financial_twin', 'loan_engine.py', 'portfolio_doctor', 'simulation_engine']}>
          <p>
            All engines read the same Digital Twin, and the LangGraph pipeline passes one shared state from step to step. The Loan Decision Simulator, for example, recomputes EMI, debt-to-income, emergency-fund months
            and a Debt Stress Score, then re-runs the goal simulation with the monthly investment reduced to what the post-EMI surplus can afford. The Portfolio Doctor checks the proposed mix, or your uploaded holdings,
            against the same profile.
          </p>
        </Uses>
        <Try to="/loan">test a loan against your whole plan</Try>
      </>
    ),
  },
  {
    id: 'multiple-goals',
    title: 'Why can one decision affect multiple goals?',
    short: 'One decision, many goals',
    body: (
      <>
        <div className="learn-body">
          <p>
            Most people save for several things at once: a home, a child’s education, retirement, a safety buffer. These goals share one source of money, your monthly surplus. Anything that changes the surplus, whether a
            loan, a pay cut or new spending, changes the outlook for all of them at once.
          </p>
          <p>
            Goals also compete on timing. Money set aside for a near goal is not available for a distant one, and a short deadline usually calls for less volatile investments, which in turn changes how fast the long-term
            goals can grow.
          </p>
          <ul>
            <li>Priority matters: protecting a high-priority goal may mean slowing a lower one.</li>
            <li>Your emergency fund is a goal in its own right and should not be raided to fund the others.</li>
          </ul>
        </div>
        <Uses chips={['goal_agent', 'goal_engine.py', 'risk_engine.primary_goal', 'critic']}>
          <p>
            Your twin stores every goal with a priority. Goal success is simulated for the primary goal (highest priority first, then the nearest deadline), and only savings above your starting emergency fund count
            toward it. The Goal Pressure dimension of Risk DNA compares the investment that goal requires with your surplus, and the Critic will not accept a plan whose base-case success for a high-priority goal is below
            50%.
          </p>
        </Uses>
        <Try to="/goals">check your goal’s survival</Try>
      </>
    ),
  },
]

/* ---------- Page ---------- */

export default function Learn() {
  const [active, setActive] = useState<string>(TOPICS[0]!.id)

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const els = TOPICS.map((t) => document.getElementById(t.id)).filter((e): e is HTMLElement => e !== null)
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (hit) setActive(hit.target.id)
      },
      { rootMargin: '-90px 0px -55% 0px', threshold: 0 },
    )
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
  }, [])

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="learn-eyebrow">Learn</div>
          <h1 className="mt-sm">The ideas behind Capital Compass</h1>
          <p className="learn-lead">
            Before you make a financial decision, Capital Compass lets you live through its possible consequences. These short guides explain the concepts it uses, in plain language, and show exactly where each one runs
            in the app.
          </p>
        </div>
      </div>

      <div className="learn-layout">
        <nav className="learn-toc" aria-label="Learn topics">
          <div className="learn-toc-title">On this page</div>
          <ol>
            {TOPICS.map((t, i) => (
              <li key={t.id}>
                <Link to={`#${t.id}`} aria-current={active === t.id ? 'true' : undefined} onClick={() => setActive(t.id)}>
                  <span>{String(i + 1).padStart(2, '0')}</span>
                  {t.short}
                </Link>
              </li>
            ))}
          </ol>
        </nav>

        <div className="learn-topics">
          {TOPICS.map((t, i) => (
            <section key={t.id} id={t.id} className="learn-topic" aria-labelledby={`${t.id}-h`}>
              <div className="learn-eyebrow">Topic {String(i + 1).padStart(2, '0')}</div>
              <h2 id={`${t.id}-h`}>{t.title}</h2>
              {t.body}
            </section>
          ))}
          <Disclaimer />
        </div>
      </div>
    </div>
  )
}
