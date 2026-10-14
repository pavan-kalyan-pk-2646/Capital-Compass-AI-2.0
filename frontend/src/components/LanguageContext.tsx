import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { ATLAS_COPY, interpolate, type Params } from '@/lib/i18n'

export type Lang = 'en' | 'te' | 'hi' | 'ta' | 'ml'

export const LANGS: { id: Lang; label: string; native: string }[] = [
  { id: 'en', label: 'English', native: 'English' },
  { id: 'te', label: 'Telugu', native: 'తెలుగు' },
  { id: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { id: 'ta', label: 'Tamil', native: 'தமிழ்' },
  { id: 'ml', label: 'Malayalam', native: 'മലയാളം' },
]

const COPY: Record<Lang, Record<string, string>> = {
  en: {
    command: 'Ask Capital Compass', enter: 'Enter the command center', demo: 'Run the flagship demo', language: 'Language', system: 'Live system map', what: 'What is this?', why: 'Why does it matter?', input: 'What goes in', output: 'What comes out', how: 'How it works', proof: 'What this website wants to prove', explain: 'Explain this page', ready: 'System ready', local: 'Runs locally · No API keys required',
  },
  te: {
    command: 'Capital Compass ni adagandi', enter: 'Command Center loki vellandi', demo: 'Flagship Demo run cheyyandi', language: 'Bhaasha', system: 'Live system map', what: 'Idi emiti?', why: 'Idi enduku important?', input: 'Em input velthundi', output: 'Em output vastundi', how: 'Ela panichestundi', proof: 'Ee website em prove cheyyalani korukuntundi', explain: 'Ee page ni explain cheyyi', ready: 'System ready', local: 'Local ga run avtundi · API keys avasaram ledu',
  },
  hi: {
    command: 'Capital Compass से पूछें', enter: 'Command Center खोलें', demo: 'Flagship Demo चलाएँ', language: 'भाषा', system: 'Live system map', what: 'यह क्या है?', why: 'यह क्यों महत्वपूर्ण है?', input: 'क्या input जाता है', output: 'क्या output मिलता है', how: 'यह कैसे काम करता है', proof: 'यह वेबसाइट क्या साबित करना चाहती है', explain: 'इस page को समझाएँ', ready: 'System ready', local: 'Local में चलता है · API keys जरूरी नहीं',
  },
  ta: {
    command: 'Capital Compass-ஐ கேளுங்கள்', enter: 'Command Center திறக்கவும்', demo: 'Flagship Demo இயக்கவும்', language: 'மொழி', system: 'Live system map', what: 'இது என்ன?', why: 'இது ஏன் முக்கியம்?', input: 'என்ன input செல்கிறது', output: 'என்ன output வருகிறது', how: 'இது எப்படி வேலை செய்கிறது', proof: 'இந்த website என்ன நிரூபிக்கிறது', explain: 'இந்த page-ஐ விளக்கவும்', ready: 'System ready', local: 'Local-ல் இயங்கும் · API keys தேவையில்லை',
  },
  ml: {
    command: 'Capital Compass-നോട് ചോദിക്കൂ', enter: 'Command Center തുറക്കുക', demo: 'Flagship Demo പ്രവർത്തിപ്പിക്കുക', language: 'ഭാഷ', system: 'Live system map', what: 'ഇത് എന്താണ്?', why: 'ഇത് എന്തുകൊണ്ട് പ്രധാനമാണ്?', input: 'എന്താണ് input', output: 'എന്താണ് output', how: 'ഇത് എങ്ങനെ പ്രവർത്തിക്കുന്നു', proof: 'ഈ website എന്താണ് തെളിയിക്കുന്നത്', explain: 'ഈ page വിശദീകരിക്കുക', ready: 'System ready', local: 'Local ആയി പ്രവർത്തിക്കും · API keys ആവശ്യമില്ല',
  },
}

type Ctx = { lang: Lang; setLang: (lang: Lang) => void; t: (key: string, params?: Params) => string }
const LanguageContext = createContext<Ctx | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem('cc2-language') as Lang | null
      return saved && LANGS.some((l) => l.id === saved) ? saved : 'en'
    } catch {
      return 'en'
    }
  })
  const setLang = (next: Lang) => {
    setLangState(next)
    try {
      localStorage.setItem('cc2-language', next)
      // a language chosen anywhere (e.g. on the entry screen) answers the in-app language prompt
      sessionStorage.setItem('cc2-language-gate', '1')
    } catch {
      /* storage unavailable: the choice lasts for this visit */
    }
  }
  // The document language drives font choice and turns off letter-spacing for Indic scripts,
  // which breaks their conjunct characters.
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
  const value = useMemo(
    () => ({
      lang,
      setLang,
      t: (key: string, params?: Params) => interpolate(ATLAS_COPY[lang][key] ?? COPY[lang][key] ?? ATLAS_COPY.en[key] ?? COPY.en[key] ?? key, params),
    }),
    [lang],
  )
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const value = useContext(LanguageContext)
  if (!value) throw new Error('useLanguage must be used inside LanguageProvider')
  return value
}

export function languageName(lang: Lang) {
  return LANGS.find((x) => x.id === lang)?.native ?? 'English'
}
