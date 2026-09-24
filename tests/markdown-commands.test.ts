import { describe, expect, it } from 'vitest'
import { blockTemplate, createTable, setHeading } from '../src/renderer/markdown-commands'

describe('Markdown commands', () => {
  it('changes an existing heading level while keeping its text', () => {
    expect(setHeading('## 旧标题', 1)).toBe('# 旧标题')
  })

  it('turns a heading into a plain line when the level is zero', () => {
    expect(setHeading('### 旧标题', 0)).toBe('旧标题')
  })

  it('creates a GFM table with the requested body rows and selects the first header', () => {
    const table = createTable(2, 2)

    expect(table.text).toBe('| 表头 1 | 表头 2 |\n| --- | --- |\n|  |  |\n|  |  |')
    expect(table.text.slice(table.selectionStart, table.selectionEnd)).toBe('表头 1')
  })

  it('places the cursor in the first empty unordered list item', () => {
    const item = blockTemplate('list')

    expect(item.text).toBe('- ')
    expect(item.text.slice(item.selectionStart, item.selectionEnd)).toBe('')
    expect(item.selectionStart).toBe(2)
  })

  it('places the cursor after the checkbox in a task item', () => {
    const item = blockTemplate('task')

    expect(item.text).toBe('- [ ] ')
    expect(item.selectionStart).toBe(6)
    expect(item.selectionEnd).toBe(6)
  })

  it('places the cursor after the quote marker', () => {
    const quote = blockTemplate('quote')

    expect(quote.text).toBe('> ')
    expect(quote.selectionStart).toBe(2)
    expect(quote.selectionEnd).toBe(2)
  })

  it('places the cursor on the body line of a fenced code block', () => {
    const code = blockTemplate('code')

    expect(code.text).toBe('```\n\n```')
    expect(code.selectionStart).toBe(4)
    expect(code.selectionEnd).toBe(4)
  })
})
