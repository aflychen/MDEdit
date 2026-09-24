import { describe, expect, it } from 'vitest'
import { precedingIndex } from '../src/renderer/outline-navigation'

describe('outline navigation', () => {
  it('keeps content before the first heading at the start', () => {
    expect(precedingIndex([5, 15], 1)).toBe(-1)
    expect(precedingIndex([5, 15], 4)).toBe(-1)
  })

  it('maps positions to the nearest preceding heading', () => {
    expect(precedingIndex([5, 15], 5)).toBe(0)
    expect(precedingIndex([5, 15], 14)).toBe(0)
    expect(precedingIndex([5, 15], 15)).toBe(1)
    expect(precedingIndex([], 5)).toBe(-1)
  })
})
