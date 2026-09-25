import { createContext, useContext } from 'react'
import type { Strings } from './en'

export type { Strings } from './en'
export type Lang = 'en' | 'ar'

// Arabic uses Arabic-Indic digits and ص/م, per the design system.
export const intlLocale: Record<Lang, string> = { en: 'en-GB', ar: 'ar-EG' }

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function daysBetween(a: Date, b: Date) {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000)
}

export function makeFormatters(lang: Lang, t: Strings) {
  const locale = intlLocale[lang]
  const time = new Intl.DateTimeFormat(locale, {
    hour: lang === 'ar' ? 'numeric' : '2-digit',
    minute: '2-digit',
    hour12: lang === 'ar',
  })
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' })
  const dayMonth = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
  const dayMonthYear = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' })
  const number = new Intl.NumberFormat(locale)

  /** "Today", "Yesterday", "Monday", "Sep 12", "Sep 12, 2025" */
  function day(iso: string, now = new Date()) {
    const d = new Date(iso)
    const diff = daysBetween(d, now)
    if (diff === 0) return t.today
    if (diff === 1) return t.yesterday
    if (diff < 7) return weekday.format(d)
    return d.getFullYear() === now.getFullYear() ? dayMonth.format(d) : dayMonthYear.format(d)
  }

  return {
    /** "10:48" / "١٠:٤٨ ص" */
    time: (iso: string) => time.format(new Date(iso)),
    day,
    /** Conversation list: time today, otherwise the day label. */
    listTime: (iso: string, now = new Date()) =>
      daysBetween(new Date(iso), now) === 0 ? time.format(new Date(iso)) : day(iso, now),
    number: (n: number) => number.format(n),
    sameDay: (a: string, b: string) => daysBetween(new Date(a), new Date(b)) === 0,
  }
}

export interface LocaleValue {
  lang: Lang
  /** "en-GB" / "ar-EG", for Intl formatting. */
  locale: string
  dir: 'ltr' | 'rtl'
  t: Strings
  fmt: ReturnType<typeof makeFormatters>
  setLang: (lang: Lang) => void
}

export const LocaleContext = createContext<LocaleValue | null>(null)

export function useLocale() {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used inside <LocaleProvider>')
  return ctx
}
