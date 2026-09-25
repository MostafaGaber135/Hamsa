import { describe, expect, it } from 'vitest'
import type { CachedMessage, Member } from '@/types/chat'
import { withStatus } from './status'

const member = (id: string, lastReadAt: string): Member => ({ id, name: id, online: false, lastReadAt, role: 'member' })
const message: CachedMessage = {
  id: 'm1',
  conversationId: 'c1',
  senderId: 'me',
  kind: 'text',
  content: 'hi',
  createdAt: '2026-01-01T10:00:00Z',
}

describe('withStatus', () => {
  it('shows "sending" and "failed" while the message only exists here', () => {
    expect(withStatus({ ...message, pending: 'sending' }, 'me', []).status).toBe('sending')
    expect(withStatus({ ...message, pending: 'failed' }, 'me', []).status).toBe('failed')
  })

  it('is "read" once everyone else read past it, "sent" before', () => {
    const before = '2026-01-01T09:00:00Z'
    const after = '2026-01-01T11:00:00Z'
    expect(withStatus(message, 'me', [member('me', after), member('sara', after)]).status).toBe('read')
    expect(withStatus(message, 'me', [member('me', after), member('sara', before)]).status).toBe('sent')
    // In a group, one person who hasn't read it keeps it at "sent".
    expect(withStatus(message, 'me', [member('sara', after), member('omar', before)]).status).toBe('sent')
  })

  it("gives other people's messages no status", () => {
    expect(withStatus({ ...message, senderId: 'sara' }, 'me', []).status).toBeUndefined()
  })
})
