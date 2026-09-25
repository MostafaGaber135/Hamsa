import { describe, expect, it } from 'vitest'
import { toAttachment, toMessage } from './api'

describe('toAttachment', () => {
  it('keeps a well-formed attachment', () => {
    expect(
      toAttachment({ path: 'c/m.webm', mime: 'audio/webm', size: 1200, duration_ms: 8400, waveform: [8, 50, 100] }),
    ).toEqual({
      path: 'c/m.webm',
      name: undefined,
      size: 1200,
      mime: 'audio/webm',
      durationMs: 8400,
      waveform: [8, 50, 100],
      lat: undefined,
      lng: undefined,
    })
  })

  it('drops fields with the wrong type instead of crashing (a crafted message)', () => {
    const a = toAttachment({ lat: 'x', lng: {}, name: 42, size: '9', path: ['a'] })
    expect(a).toMatchObject({ lat: undefined, lng: undefined, name: undefined, size: undefined, path: undefined })
  })

  it('refuses coordinates outside the globe and non-finite numbers', () => {
    expect(toAttachment({ lat: 91, lng: 181 })).toMatchObject({ lat: undefined, lng: undefined })
    expect(toAttachment({ lat: Infinity, lng: NaN })).toMatchObject({ lat: undefined, lng: undefined })
    expect(toAttachment({ lat: -33.86, lng: 151.2 })).toMatchObject({ lat: -33.86, lng: 151.2 })
  })

  it('clamps the waveform to 64 bars of 0–100', () => {
    const a = toAttachment({ waveform: [...Array(80).fill(50), -5, 300] })
    expect(a?.waveform).toHaveLength(64)
    expect(toAttachment({ waveform: [-5, 300, 'x'] })?.waveform).toEqual([0, 100, 0])
  })

  it('ignores anything that is not an object', () => {
    expect(toAttachment(null)).toBeUndefined()
    expect(toAttachment('x')).toBeUndefined()
    expect(toAttachment([1, 2])).toBeUndefined()
  })
})

describe('toMessage', () => {
  const row = {
    id: 'm1',
    conversation_id: 'c1',
    sender_id: 'u1',
    content: 'hi',
    image_path: null,
    created_at: '2026-01-01T10:00:00Z',
  }

  it('maps a plain text message', () => {
    expect(toMessage(row)).toMatchObject({ id: 'm1', conversationId: 'c1', senderId: 'u1', kind: 'text', content: 'hi' })
  })

  it('treats a row with an image and no kind as an image (older messages)', () => {
    expect(toMessage({ ...row, image_path: 'c1/m1.webp' }).kind).toBe('image')
  })

  it('carries replies, edits, deletions and reactions', () => {
    const m = toMessage({
      ...row,
      reply_to_id: 'm0',
      edited_at: '2026-01-01T10:01:00Z',
      deleted_at: null,
      message_reactions: [{ user_id: 'u2', emoji: '👍' }],
    })
    expect(m).toMatchObject({ replyToId: 'm0', editedAt: '2026-01-01T10:01:00Z', deletedAt: undefined })
    expect(m.reactions).toEqual([{ userId: 'u2', emoji: '👍' }])
  })

  it('leaves reactions undefined when the query did not ask for them', () => {
    expect(toMessage(row).reactions).toBeUndefined()
  })
})
