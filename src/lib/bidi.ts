const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/
const LTR = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/

/**
 * The direction of a piece of text, from its first letter.
 * Used instead of `unicode-bidi: plaintext` on text fields: mobile browsers
 * draw the caret on the wrong side with that CSS, but handle `dir` correctly.
 */
export function textDirection(text: string, fallback: 'ltr' | 'rtl'): 'ltr' | 'rtl' {
  for (const ch of text) {
    if (RTL.test(ch)) return 'rtl'
    if (LTR.test(ch)) return 'ltr'
  }
  return fallback
}

export function formatBytes(bytes: number | undefined, locale: string) {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0 }).format(value)} ${units[unit]}`
}

export function formatDuration(ms: number | undefined, locale: string) {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000))
  const nf = new Intl.NumberFormat(locale, { minimumIntegerDigits: 2 })
  const nfMin = new Intl.NumberFormat(locale)
  return `${nfMin.format(Math.floor(total / 60))}:${nf.format(total % 60)}`
}
