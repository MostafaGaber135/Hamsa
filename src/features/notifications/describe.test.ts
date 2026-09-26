import { describe, expect, it } from 'vitest'
import { en } from '@/lib/i18n/en'
import type { AppNotification } from './api'
import { describeNotification } from './describe'

const base: AppNotification = {
  id: 'n1',
  kind: 'friend_request',
  createdAt: '2026-09-26T10:00:00Z',
  read: false,
  actor: { id: 'u1', name: 'Sara', username: 'sara', online: false },
  messageDeleted: false,
}

describe('describeNotification', () => {
  it('says who did what', () => {
    expect(describeNotification(base, en)).toEqual({ text: 'Sara sent you a friend request' })
    expect(describeNotification({ ...base, kind: 'added_to_group', groupName: 'Book club' }, en).text).toBe(
      'Sara added you to Book club',
    )
  })

  it('quotes the message a reaction, mention or reply is about', () => {
    const reaction = {
      ...base,
      kind: 'reaction' as const,
      emoji: '❤️',
      messageKind: 'text' as const,
      messageText: 'See you',
    }
    expect(describeNotification(reaction, en)).toEqual({ text: 'Sara reacted ❤️ to your message', quote: 'See you' })
    const photo = { ...base, kind: 'reply' as const, messageKind: 'image' as const }
    expect(describeNotification(photo, en).quote).toBe(en.photo)
  })

  it('shows a deleted message as deleted', () => {
    const deleted = {
      ...base,
      kind: 'mention' as const,
      groupName: 'Team',
      messageKind: 'text' as const,
      messageDeleted: true,
    }
    expect(describeNotification(deleted, en)).toEqual({ text: 'Sara mentioned you in Team', quote: en.msg.deleted })
  })
})
