import { describe, expect, it } from 'vitest'
import { messagePreview } from '@/features/conversations/preview'
import { en } from '@/lib/i18n/en'
import type { Message } from '@/types/chat'
import { firstLink } from './links'

describe('firstLink', () => {
  it('finds the first web link', () => {
    expect(firstLink('see https://example.com/a?b=1 and https://two.org')).toBe('https://example.com/a?b=1')
  })

  it('leaves out punctuation that ends the sentence', () => {
    expect(firstLink('Look: https://example.com/page.')).toBe('https://example.com/page')
    expect(firstLink('(https://example.com/x)')).toBe('https://example.com/x')
  })

  it('ignores text without links, and non-web schemes', () => {
    expect(firstLink('no links here')).toBeUndefined()
    expect(firstLink('javascript:alert(1)')).toBeUndefined()
    expect(firstLink(undefined)).toBeUndefined()
  })
})

describe('messagePreview', () => {
  const base: Message = { id: 'm', conversationId: 'c', senderId: 'u', kind: 'text', createdAt: '2026-01-01T00:00:00Z' }

  it('describes each kind of message', () => {
    expect(messagePreview({ ...base, content: 'hello' }, en)).toBe('hello')
    expect(messagePreview({ ...base, kind: 'image' }, en)).toBe(en.photo)
    expect(messagePreview({ ...base, kind: 'voice' }, en)).toBe(en.rich.voice)
    expect(messagePreview({ ...base, kind: 'location' }, en)).toBe(en.rich.locationPreview)
  })

  it('says a deleted message was deleted, whatever it was', () => {
    expect(messagePreview({ ...base, kind: 'text', deletedAt: '2026-01-01T00:01:00Z' }, en)).toBe(en.msg.deleted)
  })
})
