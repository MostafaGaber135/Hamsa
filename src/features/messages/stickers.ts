/** Hamsa's own sticker pack (public/stickers). A sticker message stores only the id. */
export const STICKERS: { id: string; en: string; ar: string }[] = [
  { id: 'hi', en: 'Hi', ar: 'مرحبًا' },
  { id: 'ahlan', en: 'Welcome', ar: 'أهلًا' },
  { id: 'love', en: 'Love', ar: 'حب' },
  { id: 'haha', en: 'Haha', ar: 'ضحك' },
  { id: 'shukran', en: 'Thanks', ar: 'شكرًا' },
  { id: 'ok', en: 'OK', ar: 'تمام' },
  { id: 'coffee', en: 'Coffee?', ar: 'قهوة؟' },
  { id: 'party', en: 'Party', ar: 'احتفال' },
  { id: 'sleepy', en: 'Sleepy', ar: 'نعسان' },
  { id: 'hmm', en: 'Hmm', ar: 'همم' },
  { id: 'sad', en: 'Sad', ar: 'حزين' },
  { id: 'wow', en: 'Wow', ar: 'واو' },
]

export const stickerUrl = (id: string) => `/stickers/${encodeURIComponent(id)}.svg`

export const isKnownSticker = (id: string | undefined) => STICKERS.some((s) => s.id === id)
