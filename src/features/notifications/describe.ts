import { messagePreview } from '@/features/conversations/preview'
import type { Strings } from '@/lib/i18n'
import type { AppNotification } from './api'

/** What a notification says ("Sara reacted ❤️ to your message"), and the message it's about, if any. */
export function describeNotification(n: AppNotification, t: Strings): { text: string; quote?: string } {
  const who = n.actor.name
  const where = n.groupName
  const s = t.notifications
  const text = {
    friend_request: s.friendRequest(who),
    friend_accepted: s.friendAccepted(who),
    added_to_group: where ? s.addedToGroup(who, where) : s.addedToAGroup(who),
    made_admin: where ? s.madeAdmin(who, where) : s.madeAdminOfAGroup(who),
    reaction: n.emoji ? s.reaction(who, n.emoji) : s.reactedTo(who),
    mention: where ? s.mention(who, where) : s.mentionAnywhere(who),
    reply: s.reply(who),
  }[n.kind]

  if (!n.messageKind) return { text }
  const quote = messagePreview(
    { kind: n.messageKind, content: n.messageText, deletedAt: n.messageDeleted ? n.createdAt : undefined },
    t,
  )
  return { text, quote: quote || undefined }
}
