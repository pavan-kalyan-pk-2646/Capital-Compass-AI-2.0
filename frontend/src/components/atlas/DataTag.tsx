import { useLanguage } from '@/components/LanguageContext'
import type { AtlasSource } from '@/services/types'
import './atlas-ui.css'

/** Where a number comes from: the user, a calculation, history, an assumption or a simulation. */
export function DataTag({ source, note }: { source: AtlasSource; note?: string }) {
  const { t } = useLanguage()
  return (
    <span className={`data-tag src-${source}`} title={note}>
      {t(`tag.${source}`)}
    </span>
  )
}
