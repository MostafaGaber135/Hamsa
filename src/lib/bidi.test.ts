import { describe, expect, it } from 'vitest'
import { formatBytes, formatDuration, textDirection } from './bidi'

describe('textDirection', () => {
  it('follows the first letter', () => {
    expect(textDirection('مرحبا hello', 'ltr')).toBe('rtl')
    expect(textDirection('hello مرحبا', 'rtl')).toBe('ltr')
  })

  it('skips digits and punctuation before the first letter', () => {
    expect(textDirection('123 !? مرحبا', 'ltr')).toBe('rtl')
  })

  it('uses the interface direction for text without letters', () => {
    expect(textDirection('', 'rtl')).toBe('rtl')
    expect(textDirection('😀 123', 'ltr')).toBe('ltr')
  })
})

describe('formatBytes', () => {
  it('picks a readable unit', () => {
    expect(formatBytes(512, 'en-GB')).toBe('512 B')
    expect(formatBytes(48213, 'en-GB')).toBe('47 KB')
    expect(formatBytes(5 * 1024 * 1024, 'en-GB')).toBe('5 MB')
  })

  it('is empty for no size', () => {
    expect(formatBytes(undefined, 'en-GB')).toBe('')
  })
})

describe('formatDuration', () => {
  it('shows minutes and seconds', () => {
    expect(formatDuration(8400, 'en-GB')).toBe('0:08')
    expect(formatDuration(125_000, 'en-GB')).toBe('2:05')
  })
})
