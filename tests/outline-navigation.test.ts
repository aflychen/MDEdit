import { describe, expect, it } from 'vitest'
import { precedingIndex, visibleOutlineIndices } from '../src/renderer/outline-navigation'
import type { OutlineHeading } from '../src/renderer/preview'

const headings: OutlineHeading[] = [
  { depth: 1, text: 'Guide', line: 1 },
  { depth: 2, text: 'Install', line: 4 },
  { depth: 3, text: 'macOS', line: 7 },
  { depth: 2, text: 'Usage', line: 12 },
  { depth: 1, text: 'Reference', line: 20 }
]

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

  it('hides descendants of a collapsed heading but keeps siblings visible', () => {
    expect(visibleOutlineIndices(headings, '', new Set([1]))).toEqual([0, 1, 3, 4])
    expect(visibleOutlineIndices(headings, '', new Set([0]))).toEqual([0, 4])
  })

  it('shows matching headings and their ancestors even inside collapsed branches', () => {
    expect(visibleOutlineIndices(headings, 'MAC', new Set([0, 1]))).toEqual([0, 1, 2])
    expect(visibleOutlineIndices(headings, 'not found', new Set())).toEqual([])
  })
})
