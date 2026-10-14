/** Indian currency + number formatting: ₹5,00,000 · ₹25 L · ₹1.2 Cr. */

const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

export function inr(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const n = Math.round(value)
  return (n < 0 ? '−₹' : '₹') + inrFmt.format(Math.abs(n))
}

export function inrShort(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const sign = value < 0 ? '−' : ''
  const v = Math.abs(value)
  const trim = (x: number) => x.toFixed(2).replace(/\.?0+$/, '')
  if (v >= 1e7) return `${sign}₹${trim(v / 1e7)} Cr`
  if (v >= 1e5) return `${sign}₹${trim(v / 1e5)} L`
  return sign + inr(v)
}

export function pct(x: number | null | undefined, digits = 0): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—'
  return `${(x * 100).toFixed(digits)}%`
}

export function months(x: number | null | undefined): string {
  if (x === null || x === undefined) return '—'
  if (x >= 99) return 'No outflow'
  return `${x.toFixed(1)} mo`
}

export function signed(x: number, digits = 0): string {
  const s = (x * 100).toFixed(digits)
  return x > 0 ? `+${s}` : x < 0 ? `−${s.replace('-', '')}` : s
}

export function probTone(p: number | null | undefined): 'green' | 'amber' | 'red' | '' {
  if (p === null || p === undefined) return ''
  if (p >= 0.7) return 'green'
  if (p >= 0.5) return 'amber'
  return 'red'
}

export function timeAgo(iso: string): string {
  const t = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z').getTime()
  const s = Math.max(1, Math.round((Date.now() - t) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export function verdictTone(v: string | null | undefined): string {
  if (!v) return ''
  if (v.includes('FLAGGED')) return 'amber'
  if (v.includes('RE-OPTIMIZATION')) return 'brass'
  return 'green'
}

/** Backend timestamps are UTC, sometimes without a zone suffix. */
export function parseUtc(iso: string): Date {
  return new Date(iso.endsWith('Z') || /[+-]\d\d:\d\d$/.test(iso) ? iso : iso + 'Z')
}
export function clockTime(iso: string): string {
  const d = parseUtc(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
export function shortDate(iso: string): string {
  const d = parseUtc(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
