import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Icon } from '@/components/icons'
import { Badge, Disclaimer, ErrorBox, Loading, Panel, Spinner } from '@/components/ui'
import { useAsync } from '@/hooks/useAsync'
import { inr } from '@/lib/format'
import { api } from '@/services/api'
import type { NewsItem, NewsResponse } from '@/services/types'
import { useApp } from '@/stores/app'

import './market.css'

type Domain = NewsItem['impact']['domains'][number]

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'top', label: 'Top stories' },
  { value: 'india', label: 'India' },
  { value: 'global', label: 'Global' },
  { value: 'markets', label: 'Markets' },
  { value: 'economy', label: 'Economy' },
  { value: 'interest_rates', label: 'Interest rates' },
  { value: 'inflation', label: 'Inflation' },
  { value: 'employment', label: 'Employment' },
  { value: 'technology', label: 'Technology' },
  { value: 'sectors', label: 'Sectors' },
  { value: 'policy', label: 'Financial policy' },
]
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]))

const DOMAINS: { value: Domain; label: string; icon: string; blurb: string }[] = [
  { value: 'loans', label: 'Loans', icon: 'loan', blurb: 'EMIs and borrowing costs' },
  { value: 'goals', label: 'Goals', icon: 'goal', blurb: 'Future cost and funding of goals' },
  { value: 'portfolio', label: 'Portfolio', icon: 'portfolio', blurb: 'Value of investments' },
  { value: 'liquidity', label: 'Liquidity', icon: 'spending', blurb: 'Cash, deposits and emergency fund' },
  { value: 'inflation', label: 'Inflation', icon: 'invest', blurb: 'Purchasing power' },
]
const DOMAIN_LABEL = Object.fromEntries(DOMAINS.map((d) => [d.value, d.label])) as Record<Domain, string>

const REL_TONE: Record<NewsItem['relevance'], string> = { high: 'brass', medium: 'blue', low: '' }
const PAGE = 20

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' })

function relTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 48) return `${h} h ago`
  return dateFmt.format(d)
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d)
}

interface Personal {
  hasProfile: boolean
  emiTotal: number
  floating: boolean
  goalCount: number
}

function personalNotes(item: NewsItem, me: Personal): string[] {
  if (!me.hasProfile) return []
  const out: string[] = []
  const rateStory = item.categories.includes('interest_rates') || item.impact.domains.includes('loans')
  if (rateStory && me.emiTotal > 0) out.push(me.floating ? 'Relevant to you: you have EMIs, some on floating rates' : 'Relevant to you: you have EMIs')
  if ((item.impact.domains.includes('goals') || item.impact.domains.includes('inflation')) && me.goalCount > 0) out.push(`Relevant to you: you have ${me.goalCount} goal${me.goalCount > 1 ? 's' : ''}`)
  return out
}

export default function Market() {
  const [category, setCategory] = useState('top')
  const [shown, setShown] = useState(PAGE)
  const news = useAsync((signal, refresh) => api<NewsResponse>(refresh ? '/api/news?refresh=1' : '/api/news', { signal }))
  const profile = useApp((s) => s.profile)

  const run = news.run
  useEffect(() => {
    run()
  }, [run])

  const me: Personal = useMemo(
    () => ({
      hasProfile: !!profile,
      emiTotal: (profile?.liabilities ?? []).reduce((s, l) => s + (l.emi > 0 ? l.emi : 0), 0),
      floating: (profile?.liabilities ?? []).some((l) => l.emi > 0 && l.floating_rate),
      goalCount: profile?.goals.length ?? 0,
    }),
    [profile],
  )

  const data = news.data
  const visible = useMemo(() => (data ? data.items.filter((i) => i.categories.includes(category)) : []), [data, category])

  const byDomain = useMemo(
    () =>
      DOMAINS.map((d) => {
        const hits = visible.filter((i) => i.impact.domains.includes(d.value))
        const top = hits.reduce<NewsItem | null>((best, i) => (!best || i.relevance_score > best.relevance_score ? i : best), null)
        return { ...d, count: hits.length, top }
      }),
    [visible],
  )
  const maxCount = Math.max(1, ...byDomain.map((d) => d.count))

  const selectCategory = (c: string) => {
    setCategory(c)
    setShown(PAGE)
  }
  const refresh = () => news.run(true)
  const liveFeeds = data ? data.sources.filter((s) => s.ok && s.count > 0).length : 0
  const failedFeeds = data ? data.sources.filter((s) => !s.ok).length : 0

  return (
    <div className="page market">
      <div className="page-head">
        <div>
          <h1>Market Intelligence</h1>
          <p>Financial headlines from public sources, sorted by what they could mean for your loans, goals, portfolio, liquidity and purchasing power.</p>
        </div>
        {data && (
          <button type="button" className="btn sm ghost" onClick={refresh} disabled={news.loading}>
            {news.loading ? <Spinner /> : <Icon name="refresh" size={15} />} Refresh
          </button>
        )}
      </div>

      {data && data.mode === 'live' && (
        <div className="mkt-banner live" role="status">
          <span className="dot" aria-hidden="true" />
          <div className="mkt-banner-body">
            <strong>
              Live headlines from {liveFeeds} public feed{liveFeeds === 1 ? '' : 's'}, fetched {timeFmt.format(new Date(data.fetched_at))}
            </strong>
            <span className="small text-2">
              {failedFeeds > 0 ? `${failedFeeds} feed${failedFeeds === 1 ? '' : 's'} could not be reached. ` : ''}
              Every headline links to the original article.
            </span>
          </div>
        </div>
      )}
      {data && data.mode === 'offline' && (
        <div className="mkt-banner offline" role="status">
          <Icon name="crisis" size={18} />
          <div className="mkt-banner-body">
            <strong>Market Intelligence is operating in demo/offline mode.</strong>
            <span className="small text-2">
              Showing an illustrative sample dataset, not current news.{' '}
              {data.sources.length > 0 ? `None of the ${data.sources.length} public feeds could be reached from the server.` : 'Live fetching is turned off on this server.'}
            </span>
            {data.refresh_throttled && <span className="small amber">Live feeds were checked moments ago. Try again in about {data.retry_after} s.</span>}
          </div>
          <button type="button" className="btn sm" onClick={refresh} disabled={news.loading}>
            {news.loading ? <Spinner /> : <Icon name="refresh" size={15} />} Retry
          </button>
        </div>
      )}
      {data && data.mode === 'live' && data.refresh_throttled && <p className="small text-2 mt-sm">Headlines were refreshed moments ago. The next refresh is available in about {data.retry_after} s.</p>}

      {news.error && (
        <div className="mt">
          <ErrorBox error={news.error} onRetry={() => news.run()} />
        </div>
      )}
      {!data && news.loading && (
        <div className="mt">
          <Loading label="Gathering headlines from public feeds" height={180} />
        </div>
      )}

      {data && (
        <>
          <div className="mkt-tabs mt" role="group" aria-label="News categories">
            {CATEGORIES.map((c) => (
              <button key={c.value} type="button" className={`mkt-chip ${category === c.value ? 'on' : ''}`} aria-pressed={category === c.value} onClick={() => selectCategory(c.value)}>
                {c.label}
                <span className="mkt-count num">{data.categories[c.value] ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="mkt-layout mt">
            <div className="mkt-feed" aria-live="polite">
              {visible.length === 0 ? (
                <div className="state">
                  <h3>No {CAT_LABEL[category]?.toLowerCase() ?? ''} stories right now</h3>
                  <p>None of the current headlines matched this category’s keyword rules.</p>
                  {category !== 'top' && (
                    <button type="button" className="btn sm mt" onClick={() => selectCategory('top')}>
                      Show top stories
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {visible.slice(0, shown).map((item) => (
                    <StoryCard key={item.id} item={item} notes={personalNotes(item, me)} />
                  ))}
                  {visible.length > shown && (
                    <button type="button" className="btn mkt-more" onClick={() => setShown((n) => n + PAGE)}>
                      Show more ({visible.length - shown} remaining)
                    </button>
                  )}
                </>
              )}
            </div>

            <aside className="mkt-side">
              <Panel title="What this means for your decisions" sub={`Across the ${visible.length} ${(CAT_LABEL[category] ?? '').toLowerCase().replace(/ stories$/, '')} stor${visible.length === 1 ? 'y' : 'ies'} shown`}>
                <ul className="mkt-domains">
                  {byDomain.map((d) => (
                    <li key={d.value}>
                      <div className="row between">
                        <span className="row mkt-domain-name">
                          <Icon name={d.icon} size={16} /> {d.label}
                        </span>
                        <span className="num small">
                          {d.count} {d.count === 1 ? 'story' : 'stories'}
                        </span>
                      </div>
                      <div className="mkt-meter" aria-hidden="true">
                        <i style={{ width: `${(d.count / maxCount) * 100}%` }} />
                      </div>
                      {d.top ? (
                        <p className="tiny text-2">
                          Most relevant:{' '}
                          {d.top.link ? (
                            <a href={d.top.link} target="_blank" rel="noopener noreferrer">
                              {d.top.title}
                            </a>
                          ) : (
                            d.top.title
                          )}
                        </p>
                      ) : (
                        <p className="tiny muted">No story here touches {d.blurb.toLowerCase()}.</p>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="inset mt small">
                  {me.hasProfile ? (
                    <>
                      <strong>From your Digital Twin: </strong>
                      {me.emiTotal > 0 ? `you pay ${inr(me.emiTotal)} a month in EMIs${me.floating ? ', some on floating rates' : ''}` : 'you have no EMIs'}
                      {', and '}
                      {me.goalCount > 0 ? `${me.goalCount} goal${me.goalCount > 1 ? 's' : ''} to fund.` : 'no goals set yet.'} Stories that touch these are marked “Relevant to you”.
                    </>
                  ) : (
                    <>
                      <Link to="/twin">Build your Digital Twin</Link> to see which stories touch your own loans and goals.
                    </>
                  )}
                </div>
                <p className="tiny muted mt-sm">Counts come from keyword rules applied to the headlines shown. They describe what a story is about, not what will happen.</p>
              </Panel>

              {data.mode === 'live' && data.sources.length > 0 && (
                <details className="panel tight mkt-sources">
                  <summary>Sources ({data.sources.length})</summary>
                  <ul>
                    {data.sources.map((s) => (
                      <li key={s.url} className="small">
                        <Badge tone={s.ok ? 'green' : 'red'}>{s.ok ? `${s.count}` : 'Failed'}</Badge> {s.name}
                        {s.error && <span className="tiny muted"> — {s.error}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </aside>
          </div>
        </>
      )}

      <div className="mt">
        <Disclaimer />
        <p className="small muted mt-sm">Headlines are context, not predictions. Capital Compass never trades on news.</p>
      </div>
    </div>
  )
}

function StoryCard({ item, notes }: { item: NewsItem; notes: string[] }) {
  const primary = CAT_LABEL[item.primary_category] ?? item.primary_category
  return (
    <article className="panel mkt-story">
      <div className="mkt-meta small">
        <span className="mkt-source">{item.source}</span>
        <span aria-hidden="true">·</span>
        {item.demo || !item.published ? (
          <span className="muted">{item.demo ? 'Illustrative sample' : 'Date not given'}</span>
        ) : (
          <time dateTime={item.published} title={fmtDate(item.published)} className="muted">
            {relTime(item.published)}
          </time>
        )}
      </div>
      <h3 className="mkt-title">
        {item.link ? (
          <a href={item.link} target="_blank" rel="noopener noreferrer">
            {item.title}
            <span className="sr-only"> (opens the original article in a new tab)</span>
          </a>
        ) : (
          item.title
        )}
      </h3>
      <div className="row wrap mkt-badges">
        <Badge>{primary}</Badge>
        <Badge tone={REL_TONE[item.relevance]}>
          {item.relevance === 'high' ? 'High' : item.relevance === 'medium' ? 'Medium' : 'Low'} relevance · {item.relevance_score}
        </Badge>
        {notes.map((n) => (
          <Badge key={n} tone="amber">
            {n}
          </Badge>
        ))}
      </div>
      {item.summary && <p className="text-2 mkt-summary">{item.summary}</p>}

      <div className="mkt-why">
        <div className="metric-label">Why this matters</div>
        <p className="small">{item.impact.why}</p>
      </div>

      {item.impact.domains.length > 0 && (
        <div className="mkt-impact">
          <span className="tiny muted">Capital Compass impact</span>
          <ul className="mkt-impact-chips" aria-label="Capital Compass impact areas">
            {item.impact.domains.map((d) => (
              <li key={d} className={`mkt-dchip d-${d}`}>
                {DOMAIN_LABEL[d]}
              </li>
            ))}
          </ul>
        </div>
      )}

      {item.impact.simulators.length > 0 && (
        <div className="row wrap mkt-test">
          <span className="tiny muted">Test it:</span>
          {item.impact.simulators.map((s) => (
            <Link key={s.path} className="btn sm" to={s.path}>
              {s.label} <Icon name="arrow" size={14} />
            </Link>
          ))}
        </div>
      )}
      {item.link && (
        <a className="tiny mkt-out" href={item.link} target="_blank" rel="noopener noreferrer">
          Read at {item.source} ↗
        </a>
      )}
    </article>
  )
}
