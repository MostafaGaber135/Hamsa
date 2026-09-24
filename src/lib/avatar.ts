const TINTS = ['sand', 'sage', 'rose', 'sky', 'plum'] as const
export type Tint = (typeof TINTS)[number]

/** Stable tint per user: the same id always gets the same colour. */
export function tintFor(id: string): Tint {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0
  return TINTS[hash % TINTS.length]
}

// Tailwind only generates classes it can see as full strings, so map them here.
export const avatarBg: Record<Tint, string> = {
  sand: 'bg-avatar-sand',
  sage: 'bg-avatar-sage',
  rose: 'bg-avatar-rose',
  sky: 'bg-avatar-sky',
  plum: 'bg-avatar-plum',
}

export const senderText: Record<Tint, string> = {
  sand: 'text-sender-sand',
  sage: 'text-sender-sage',
  rose: 'text-sender-rose',
  sky: 'text-sender-sky',
  plum: 'text-sender-plum',
}

const ARABIC = /[\u0600-\u06FF]/

/** "Sara Ahmed" → "SA"; Arabic names use one letter: "سارة أحمد" → "س". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/)
  const first = (w: string) => Array.from(w)[0] ?? ''
  if (ARABIC.test(name) || words.length === 1) return first(words[0])
  return (first(words[0]) + first(words[1])).toUpperCase()
}
