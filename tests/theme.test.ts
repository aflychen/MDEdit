import { describe, expect, it } from 'vitest'
import { parseThemePreference, resolveTheme } from '../src/renderer/theme'

describe('theme preference', () => {
  it('uses system appearance for missing or invalid stored preferences', () => {
    expect(parseThemePreference(null)).toBe('system')
    expect(parseThemePreference('unknown')).toBe('system')
  })

  it('keeps explicit light and dark choices', () => {
    expect(parseThemePreference('light')).toBe('light')
    expect(parseThemePreference('dark')).toBe('dark')
  })

  it('tracks system appearance only in system mode', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})
