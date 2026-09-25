import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { en, type Strings } from './en'
import { LocaleContext, intlLocale, makeFormatters, type Lang, type LocaleValue } from './index'

const STORAGE_KEY = 'hamsa:lang'

/** English ships with the app; Arabic is its own download, fetched when it's needed. */
const load: Record<Lang, () => Promise<Strings>> = {
  en: async () => en,
  ar: () => import('./ar').then((m) => m.ar),
}

function savedLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'ar' ? 'ar' : 'en'
  } catch {
    return 'en'
  }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(savedLang)
  const [loaded, setLoaded] = useState<Partial<Record<Lang, Strings>>>({ en })
  // What's on screen while the chosen language downloads: English if the app started in
  // English, nothing at start-up in Arabic (a moment), English if Arabic can't be fetched.
  const [fallback, setFallback] = useState<Lang | null>(lang === 'en' ? 'en' : null)
  const shown: Lang | null = loaded[lang] ? lang : fallback

  useEffect(() => {
    if (loaded[lang]) return
    let cancelled = false
    load[lang]()
      .then((strings) => {
        if (!cancelled) setLoaded((current) => ({ ...current, [lang]: strings }))
      })
      .catch(() => {
        if (!cancelled) setFallback('en')
      })
    return () => {
      cancelled = true
    }
  }, [lang, loaded])

  const dir = shown === 'ar' ? 'rtl' : 'ltr'

  // Set lang and dir on <html> so logical CSS and the rtl: variant mirror everything.
  useEffect(() => {
    if (!shown) return
    document.documentElement.lang = shown
    document.documentElement.dir = dir
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      /* ignore */
    }
  }, [shown, dir, lang])

  const value = useMemo<LocaleValue | null>(() => {
    const t = shown ? loaded[shown] : undefined
    if (!shown || !t) return null
    return { lang: shown, locale: intlLocale[shown], dir, t, fmt: makeFormatters(shown, t), setLang }
  }, [shown, loaded, dir])

  // A moment at start-up while the Arabic text downloads.
  if (!value) return null
  return <LocaleContext value={value}>{children}</LocaleContext>
}
