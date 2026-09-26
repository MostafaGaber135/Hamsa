import type { Strings } from '@/lib/i18n'
import type { Message } from '@/types/chat'
/** The parts of a message a one-line preview needs. */
export type PreviewableMessage = Pick<Message, 'kind' | 'content' | 'deletedAt' | 'attachment'>

/** One line describing a message, for the conversation list and notifications. */
export function messagePreview(m: PreviewableMessage | undefined, t: Strings): string {
  if (!m) return ''
  if (m.deletedAt) return t.msg.deleted
  switch (m.kind) {
    case 'image':
      return m.content ? `📷 ${m.content}` : t.photo
    case 'video':
      return m.content ? `🎬 ${m.content}` : t.rich.video
    case 'voice':
      return t.rich.voice
    case 'file':
      return t.rich.file(m.attachment?.name ?? t.rich.document)
    case 'location':
      return t.rich.locationPreview
    case 'sticker':
      return `🙂 ${t.rich.sticker}`
    default:
      return m.content ?? ''
  }
}
