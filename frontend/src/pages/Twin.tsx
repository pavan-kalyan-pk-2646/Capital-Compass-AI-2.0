import { useEffect, useState } from 'react'

import { useDemoStep } from '@/components/DemoGuide'
import { Icon } from '@/components/icons'
import { BalanceSheet, FlowMap, HealthBadge, RiskDNAView } from '@/components/TwinViews'
import { Disclaimer, ErrorBox, Metric, MoneyInput, NumInput, Panel, SelectField, Spinner } from '@/components/ui'
import { loadJudgeProfile } from '@/hooks/useTwin'
import { inr, inrShort, months, pct } from '@/lib/format'
import { api, ApiError } from '@/services/api'
import type { Goal, Liability, Profile, Snapshot } from '@/services/types'
import { useApp } from '@/stores/app'

const BLANK: Profile = {
  name: 'My profile',
  age: 30,
  dependents: 0,
  employment: 'salaried_stable',
  monthly_income: 75000,
  other_income: 0,
  essential_expenses: 30000,
  discretionary_expenses: 12000,
  assets: { cash: 150000, equity: 150000, debt: 50000, gold: 0, real_estate: 0, other: 0 },
  liabilities: [],
  goals: [{ name: 'Home down payment', goal_type: 'home', target_amount: 2000000, current_amount: 0, years: 5, priority: 'high' }],
  risk: { max_tolerated_loss_pct: 15, experience: 'beginner', reaction_to_20pct_drop: 'hold' },
  behaviour: { investment_frequency: 'monthly_sip', current_monthly_investment: 10000, high_risk_spending: 0, credit_card_behaviour: 'full' },
}

const SECTIONS = ['Personal', 'Income & spending', 'Assets', 'Loans', 'Goals', 'Risk & behaviour'] as const
type Section = (typeof SECTIONS)[number]

export default function Twin() {
  const stored = useApp((s) => s.profile)
  const profileId = useApp((s) => s.profileId)
  const setProfile = useApp((s) => s.setProfile)
  const setSnapshot = useApp((s) => s.setSnapshot)
  const [draft, setDraft] = useState<Profile>(stored ?? BLANK)
  const [section, setSection] = useState<Section>('Personal')
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [liveErr, setLiveErr] = useState<ApiError | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<ApiError | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [loadingDemo, setLoadingDemo] = useState(false)

  useEffect(() => {
    if (stored) setDraft(stored)
  }, [stored])

  // live twin preview (no DB write)
  useEffect(() => {
    const c = new AbortController()
    const t = setTimeout(() => {
      api<Snapshot>('/api/twin/create', { body: { profile: draft, save: false }, signal: c.signal })
        .then((s) => {
          setSnap(s)
          setLiveErr(null)
        })
        .catch((e) => {
          if ((e as Error).name !== 'AbortError') setLiveErr(e as ApiError)
        })
    }, 220)
    return () => {
      clearTimeout(t)
      c.abort()
    }
  }, [draft])

  useDemoStep([0], async () => {
    setLoadingDemo(true)
    try {
      await loadJudgeProfile()
    } finally {
      setLoadingDemo(false)
    }
  })

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored)

  async function save() {
    setSaving(true)
    setSaveErr(null)
    try {
      const r = await api<Snapshot & { profile_id: number }>('/api/twin/create', { body: { profile: draft, save: true, profile_id: profileId } })
      setProfile(draft, r.profile_id)
      setSnapshot(r)
      setSaved(`Digital Twin saved (profile #${r.profile_id})`)
      setTimeout(() => setSaved(null), 3500)
    } catch (e) {
      const err = e as ApiError
      if (err.status === 404 || err.status === 403) {
        // stale id from another database: save as new
        const r = await api<Snapshot & { profile_id: number }>('/api/twin/create', { body: { profile: draft, save: true } })
        setProfile(draft, r.profile_id)
        setSnapshot(r)
        setSaved(`Digital Twin saved (profile #${r.profile_id})`)
      } else setSaveErr(err)
    } finally {
      setSaving(false)
    }
  }

  const t = snap?.twin

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Financial Digital Twin</h1>
          <p>One model of your financial life. Every engine — investment, loan, goals, crisis — reads from this twin, so change a number here and every decision updates.</p>
        </div>
        <div className="row wrap">
          <button
            className="btn"
            disabled={loadingDemo}
            onClick={async () => {
              setLoadingDemo(true)
              try {
                await loadJudgeProfile()
              } catch (e) {
                setSaveErr(e as ApiError)
              } finally {
                setLoadingDemo(false)
              }
            }}
          >
            {loadingDemo && <Spinner />} Load demo profile
          </button>
          <button className="btn primary" onClick={save} disabled={saving || !!liveErr}>
            {saving && <Spinner />} {stored ? (dirty ? 'Save changes' : 'Saved') : 'Create my twin'}
          </button>
        </div>
      </div>
      {saved && <div className="toast">{saved}</div>}
      <ErrorBox error={saveErr} />

      <div className="grid g-side">
        <Panel>
          <div className="seg" role="tablist" aria-label="Profile sections" style={{ marginBottom: 16 }}>
            {SECTIONS.map((s) => (
              <button key={s} role="tab" aria-selected={section === s} className={section === s ? 'on' : ''} onClick={() => setSection(s)}>
                {s}
              </button>
            ))}
          </div>
          <div className="stack">
            {section === 'Personal' && (
              <>
                <div className="field">
                  <label htmlFor="p-name">Name</label>
                  <input id="p-name" className="input" value={draft.name} maxLength={80} onChange={(e) => set('name', e.target.value)} />
                </div>
                <div className="grid g2">
                  <NumInput label="Age" value={draft.age} min={18} max={100} onChange={(v) => set('age', Math.round(v))} />
                  <NumInput label="Dependents" value={draft.dependents} min={0} max={20} onChange={(v) => set('dependents', Math.round(v))} />
                </div>
                <SelectField
                  label="Income type"
                  value={draft.employment}
                  onChange={(v) => set('employment', v)}
                  options={[
                    { value: 'salaried_stable', label: 'Salaried, stable' },
                    { value: 'salaried_variable', label: 'Salaried, variable pay' },
                    { value: 'self_employed', label: 'Self-employed' },
                    { value: 'gig', label: 'Gig / freelance' },
                  ]}
                />
                <SelectField
                  label="Investing experience"
                  value={draft.risk.experience}
                  onChange={(v) => set('risk', { ...draft.risk, experience: v })}
                  options={[
                    { value: 'none', label: 'None' },
                    { value: 'beginner', label: 'Beginner' },
                    { value: 'intermediate', label: 'Intermediate' },
                    { value: 'advanced', label: 'Advanced' },
                  ]}
                />
              </>
            )}
            {section === 'Income & spending' && (
              <>
                <div className="grid g2">
                  <MoneyInput label="Take-home salary / month" value={draft.monthly_income} onChange={(v) => set('monthly_income', v)} max={1e8} />
                  <MoneyInput label="Other income / month" value={draft.other_income} onChange={(v) => set('other_income', v)} max={1e8} />
                </div>
                <MoneyInput label="Essential expenses / month" hint="Rent, food, utilities, insurance" value={draft.essential_expenses} onChange={(v) => set('essential_expenses', v)} max={1e8} />
                <MoneyInput label="Lifestyle spending / month" hint="Eating out, shopping, travel" value={draft.discretionary_expenses} onChange={(v) => set('discretionary_expenses', v)} max={1e8} />
                <MoneyInput label="High-risk spending / month" hint="Betting or speculative punts — analysed for consequences only" value={draft.behaviour.high_risk_spending} onChange={(v) => set('behaviour', { ...draft.behaviour, high_risk_spending: v })} max={1e8} />
              </>
            )}
            {section === 'Assets' && (
              <>
                <MoneyInput label="Cash & emergency fund" hint="Savings account, liquid funds" value={draft.assets.cash} onChange={(v) => set('assets', { ...draft.assets, cash: v })} />
                <div className="grid g2">
                  <MoneyInput label="Equity" hint="Stocks, equity funds" value={draft.assets.equity} onChange={(v) => set('assets', { ...draft.assets, equity: v })} />
                  <MoneyInput label="Debt" hint="FDs, PPF, debt funds" value={draft.assets.debt} onChange={(v) => set('assets', { ...draft.assets, debt: v })} />
                  <MoneyInput label="Gold" value={draft.assets.gold} onChange={(v) => set('assets', { ...draft.assets, gold: v })} />
                  <MoneyInput label="Property" value={draft.assets.real_estate} onChange={(v) => set('assets', { ...draft.assets, real_estate: v })} />
                </div>
                <MoneyInput label="Other assets" value={draft.assets.other} onChange={(v) => set('assets', { ...draft.assets, other: v })} />
              </>
            )}
            {section === 'Loans' && <LoansEditor items={draft.liabilities} onChange={(v) => set('liabilities', v)} />}
            {section === 'Goals' && <GoalsEditor items={draft.goals} onChange={(v) => set('goals', v)} />}
            {section === 'Risk & behaviour' && (
              <>
                <NumInput label="Largest fall you could live with" suffix="% of portfolio" value={draft.risk.max_tolerated_loss_pct} min={0} max={100} onChange={(v) => set('risk', { ...draft.risk, max_tolerated_loss_pct: v })} hint="Every recommendation is crash-tested against this limit" />
                <SelectField
                  label="If markets fell 20% next month, you would…"
                  value={draft.risk.reaction_to_20pct_drop}
                  onChange={(v) => set('risk', { ...draft.risk, reaction_to_20pct_drop: v })}
                  options={[
                    { value: 'sell_all', label: 'Sell everything' },
                    { value: 'sell_some', label: 'Sell some' },
                    { value: 'hold', label: 'Hold' },
                    { value: 'buy_more', label: 'Buy more' },
                  ]}
                />
                <MoneyInput label="Currently investing / month" value={draft.behaviour.current_monthly_investment} onChange={(v) => set('behaviour', { ...draft.behaviour, current_monthly_investment: v })} />
                <SelectField
                  label="Credit card bills"
                  value={draft.behaviour.credit_card_behaviour}
                  onChange={(v) => set('behaviour', { ...draft.behaviour, credit_card_behaviour: v })}
                  options={[
                    { value: 'full', label: 'Paid in full' },
                    { value: 'partial', label: 'Partly paid' },
                    { value: 'minimum', label: 'Minimum due only' },
                    { value: 'none', label: 'No credit card' },
                  ]}
                />
              </>
            )}
          </div>
        </Panel>

        <div className="stack">
          <ErrorBox error={liveErr} />
          {!snap && !liveErr && <div className="skeleton" style={{ height: 420 }} />}
          {snap && t && (
            <>
              <div className="kpis">
                <div>
                  <Metric label="Financial health" value={`${Math.round(t.health_score)}`} sub={<HealthBadge band={t.health_band} />} />
                </div>
                <div>
                  <Metric label="Net worth" value={inrShort(t.net_worth)} sub={`${inrShort(t.total_assets)} assets`} />
                </div>
                <div>
                  <Metric label="Monthly surplus" value={inr(t.monthly_surplus)} tone={t.monthly_surplus < 0 ? 'red' : ''} sub={`${pct(t.savings_rate)} savings rate`} />
                </div>
                <div>
                  <Metric label="Emergency fund" value={months(t.emergency_fund_months)} tone={t.emergency_fund_months < 3 ? 'red' : t.emergency_fund_months < 6 ? 'amber' : ''} sub="of essentials + EMIs" />
                </div>
                <div>
                  <Metric label="Debt-to-income" value={pct(t.dti)} tone={t.dti > 0.4 ? 'red' : ''} sub={`${inr(t.monthly_emi)}/mo EMIs`} />
                </div>
              </div>
              <Panel title="Where your income goes" sub="Monthly cash flow, drawn to scale">
                <FlowMap s={snap} />
              </Panel>
              <div className="grid g2">
                <Panel title="Balance sheet">
                  <BalanceSheet s={snap} />
                </Panel>
                <Panel id="risk-dna" title="Risk DNA" sub="Eight dimensions computed from your inputs">
                  <RiskDNAView dna={snap.risk_dna} compact />
                </Panel>
              </div>
            </>
          )}
        </div>
      </div>
      <Disclaimer />
    </div>
  )
}

function LoansEditor({ items, onChange }: { items: Liability[]; onChange: (v: Liability[]) => void }) {
  const up = (i: number, patch: Partial<Liability>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <div className="stack">
      {items.length === 0 && <p className="small muted">No loans added. Add any EMI you pay today; a new loan you are considering goes in the Loan simulator.</p>}
      {items.map((l, i) => (
        <div key={i} className="inset stack-sm">
          <div className="row between">
            <input className="input" aria-label="Loan name" value={l.name} maxLength={80} onChange={(e) => up(i, { name: e.target.value })} style={{ maxWidth: 220 }} />
            <button className="btn sm ghost" aria-label={`Remove ${l.name}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
              <Icon name="trash" size={14} />
            </button>
          </div>
          <div className="grid g2">
            <SelectField
              label="Type"
              value={l.type}
              onChange={(v) => up(i, { type: v })}
              options={[
                { value: 'personal', label: 'Personal' },
                { value: 'education', label: 'Education' },
                { value: 'home', label: 'Home' },
                { value: 'vehicle', label: 'Vehicle' },
                { value: 'credit_card', label: 'Credit card' },
                { value: 'other', label: 'Other' },
              ]}
            />
            <MoneyInput label="Outstanding" value={l.outstanding} onChange={(v) => up(i, { outstanding: v })} id={`l-out-${i}`} />
            <MoneyInput label="EMI / month" value={l.emi} onChange={(v) => up(i, { emi: v })} id={`l-emi-${i}`} />
            <NumInput label={`Rate ${i + 1}`} suffix="% a year" value={l.annual_rate_pct} min={0} max={60} step={0.1} onChange={(v) => up(i, { annual_rate_pct: v })} />
            <NumInput label={`Months left ${i + 1}`} value={l.remaining_months} min={0} max={480} onChange={(v) => up(i, { remaining_months: Math.round(v) })} />
            <label className="row small" style={{ alignSelf: 'end', paddingBottom: 8 }}>
              <input type="checkbox" checked={l.floating_rate} onChange={(e) => up(i, { floating_rate: e.target.checked })} /> Floating rate
            </label>
          </div>
        </div>
      ))}
      <button className="btn" onClick={() => onChange([...items, { type: 'personal', name: `Loan ${items.length + 1}`, outstanding: 100000, emi: 5000, annual_rate_pct: 12, remaining_months: 24, floating_rate: false }])} disabled={items.length >= 20}>
        <Icon name="plus" size={14} /> Add loan
      </button>
    </div>
  )
}

function GoalsEditor({ items, onChange }: { items: Goal[]; onChange: (v: Goal[]) => void }) {
  const up = (i: number, patch: Partial<Goal>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <div className="stack">
      {items.length === 0 && <p className="small muted">No goals yet. Plans are then judged on wealth and resilience alone.</p>}
      {items.map((g, i) => (
        <div key={i} className="inset stack-sm">
          <div className="row between">
            <input className="input" aria-label="Goal name" value={g.name} maxLength={80} onChange={(e) => up(i, { name: e.target.value })} style={{ maxWidth: 240 }} />
            <button className="btn sm ghost" aria-label={`Remove ${g.name}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
              <Icon name="trash" size={14} />
            </button>
          </div>
          <div className="grid g2">
            <MoneyInput label="Target amount" value={g.target_amount} min={1} onChange={(v) => up(i, { target_amount: v })} id={`g-t-${i}`} />
            <NumInput label={`Years to goal ${i + 1}`} value={g.years} min={0.5} max={50} step={0.5} onChange={(v) => up(i, { years: v })} />
            <SelectField
              label="Type"
              value={g.goal_type}
              onChange={(v) => up(i, { goal_type: v })}
              options={['home', 'education', 'retirement', 'wealth', 'emergency', 'travel', 'vehicle', 'other'].map((x) => ({ value: x as Goal['goal_type'], label: x.charAt(0).toUpperCase() + x.slice(1) }))}
            />
            <SelectField
              label="Priority"
              value={g.priority}
              onChange={(v) => up(i, { priority: v })}
              options={[
                { value: 'high', label: 'High' },
                { value: 'medium', label: 'Medium' },
                { value: 'low', label: 'Low' },
              ]}
            />
          </div>
        </div>
      ))}
      <button className="btn" onClick={() => onChange([...items, { name: `Goal ${items.length + 1}`, goal_type: 'wealth', target_amount: 1000000, current_amount: 0, years: 5, priority: 'medium' }])} disabled={items.length >= 10}>
        <Icon name="plus" size={14} /> Add goal
      </button>
    </div>
  )
}
