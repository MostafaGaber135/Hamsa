import type { Strings } from '@/lib/i18n'
import type { Message } from '@/types/chat'
/** One line describing the last message, for the conversation list. */
export function messagePreview(m: Message | undefined, t: Strings): string {
  if (!m) return ''
  switch (m.kind) {
    case 'image': return m.content ? `📷 ${m.content}` : t.photo
    case 'video': return m.content ? `🎬 ${m.content}` : t.rich.video
    case 'voice': return t.rich.voice
    case 'file': return t.rich.file(m.attachment?.name ?? t.rich.document)
    case 'location': return t.rich.locationPreview
    case 'sticker': return `🙂 ${t.rich.sticker}`
    default: return m.content ?? ''
  }
}
