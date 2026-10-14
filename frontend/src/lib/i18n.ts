/**
 * Copy for the Atlas experience (entry, greeting, map, command center, decision war room).
 * Every visible string in those components comes from here through `t(key, params)`.
 * Numbers are never written into the copy: they arrive as {params} from engine outputs.
 */
import type { Lang } from '@/components/LanguageContext'

import { EN } from './i18n.en'
import { HI } from './i18n.hi'
import { ML } from './i18n.ml'
import { TA } from './i18n.ta'
import { TE } from './i18n.te'

export type Params = Record<string, string | number>
export type Dict = Record<string, string>

export function interpolate(s: string, params?: Params): string {
  if (!params) return s
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (params[k] !== undefined ? String(params[k]) : m))
}

export const ATLAS_COPY: Record<Lang, Dict> = { en: EN, te: TE, hi: HI, ta: TA, ml: ML }
