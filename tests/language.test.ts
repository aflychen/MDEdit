import { describe, expect, it } from 'vitest'
import { messages, parseLanguage, text } from '../src/shared/language'

describe('interface language', () => {
  it('starts in English when a saved preference is absent or invalid', () => {
    expect(parseLanguage(null)).toBe('en')
    expect(parseLanguage('')).toBe('en')
    expect(parseLanguage('fr')).toBe('en')
    expect(parseLanguage('zh-CN')).toBe('zh-CN')
  })

  it('renders a count in the chosen language without changing its value', () => {
    expect(text('en', 'recovery.count', { count: 2 })).toBe('2 recoverable drafts')
    expect(text('zh-CN', 'recovery.count', { count: 2 })).toBe('2 份可恢复草稿')
  })

  it('has a translation for every visible message in both languages', () => {
    expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages['zh-CN']).sort())
  })
})
