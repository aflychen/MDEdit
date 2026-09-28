import { describe, expect, it } from 'vitest'
import { focusedParagraphLines } from '../src/renderer/writing-mode'

describe('writing mode paragraph focus', () => {
  const document = '# 标题\n正文一\n正文二\n\n- 第一项\n- 第二项\n\n```ts\nconst x = 1\n```\n\n结尾'

  it('focuses the current paragraph without merging an adjacent heading', () => {
    expect(focusedParagraphLines(document, 1)).toEqual({ from: 1, to: 1 })
    expect(focusedParagraphLines(document, 2)).toEqual({ from: 2, to: 3 })
  })

  it('focuses one list item and keeps a fenced block together', () => {
    expect(focusedParagraphLines(document, 5)).toEqual({ from: 5, to: 5 })
    expect(focusedParagraphLines(document, 6)).toEqual({ from: 6, to: 6 })
    expect(focusedParagraphLines(document, 9)).toEqual({ from: 8, to: 10 })
  })

  it('uses the nearest nonempty paragraph when the caret is on a blank line', () => {
    expect(focusedParagraphLines(document, 4)).toEqual({ from: 2, to: 3 })
    expect(focusedParagraphLines('\n\n正文', 1)).toEqual({ from: 3, to: 3 })
  })

  it('handles an empty document', () => {
    expect(focusedParagraphLines('', 1)).toEqual({ from: 1, to: 1 })
  })
})
