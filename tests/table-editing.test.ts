import { describe, expect, it } from 'vitest'
import { editTable, navigateTableCell, tableAt, type TableCommand } from '../src/renderer/table-editing'

function apply(text: string, command: TableCommand): string {
  if (!command.changes) return text
  const { from, to, insert } = command.changes
  return text.slice(0, from) + insert + text.slice(to)
}

describe('GFM table editing', () => {
  const table = '| A | B |\n| --- | --- |\n| x | y |\n| z | w |'

  it('finds a real table and ignores table-looking code fences', () => {
    expect(tableAt(table, table.indexOf('x'))).toMatchObject({ row: 1, column: 0, columns: 2, bodyRows: 2 })
    expect(tableAt('```md\n' + table + '\n```', 10)).toBeNull()
  })

  it('moves between cells in both directions and skips the separator', () => {
    expect(navigateTableCell(table, table.indexOf('A'))?.anchor).toBe(table.indexOf('B'))
    expect(navigateTableCell(table, table.indexOf('B'))?.anchor).toBe(table.indexOf('x'))
    expect(navigateTableCell(table, table.indexOf('y'), true)?.anchor).toBe(table.indexOf('x'))
    expect(navigateTableCell(table, table.indexOf('A'), true)).toBeNull()
  })

  it('adds a blank body row when Tab leaves the last cell', () => {
    const command = navigateTableCell(table, table.indexOf('w'))!
    const next = apply(table, command)
    expect(next).toBe(table + '\n|  |  |')
    expect(next.slice(command.anchor, command.anchor + 2)).toBe(' |')
  })

  it('adds the first body row after a header-only table', () => {
    const source = '| A | B |\n| --- | --- |'
    const command = navigateTableCell(source, source.indexOf('B'))!
    expect(apply(source, command)).toBe(source + '\n|  |  |')
  })

  it('inserts and removes body rows without changing adjacent prose', () => {
    const source = `before\n\n${table}\n\nafter`
    const inserted = editTable(source, source.indexOf('x'), 'insert-row')!
    expect(apply(source, inserted)).toBe(`before\n\n| A | B |\n| --- | --- |\n| x | y |\n|  |  |\n| z | w |\n\nafter`)
    const deleted = editTable(source, source.indexOf('x'), 'delete-row')!
    expect(apply(source, deleted)).toBe(`before\n\n| A | B |\n| --- | --- |\n| z | w |\n\nafter`)
    expect(editTable(source, source.indexOf('A'), 'delete-row')).toBeNull()
  })

  it('inserts and removes the selected column', () => {
    const inserted = editTable(table, table.indexOf('x'), 'insert-column')!
    expect(apply(table, inserted)).toBe('| A |  | B |\n| --- | --- | --- |\n| x |  | y |\n| z |  | w |')
    const deleted = editTable(table, table.indexOf('B'), 'delete-column')!
    expect(apply(table, deleted)).toBe('| A |\n| --- |\n| x |\n| z |')
    const oneColumn = '| A |\n| --- |\n| x |'
    expect(editTable(oneColumn, oneColumn.indexOf('x'), 'delete-column')).toBeNull()
  })

  it('sets alignment and preserves escaped Markdown in cells', () => {
    const source = '| A | B |\n| --- | --- |\n| x \\| y | `code` |'
    const aligned = editTable(source, source.indexOf('`code`'), 'align-center')!
    expect(apply(source, aligned)).toBe('| A | B |\n| --- | :---: |\n| x \\| y | `code` |')
  })

  it('keeps cells in tables without outer pipes', () => {
    const source = 'A | B\n--- | ---\nx | y'
    const command = editTable(source, source.indexOf('x'), 'insert-column')!
    expect(apply(source, command)).toBe('| A |  | B |\n| --- | --- | --- |\n| x |  | y |')
  })

  it('does not rewrite a table nested inside a blockquote', () => {
    const source = '> | A | B |\n> | --- | --- |\n> | x | y |'
    expect(editTable(source, source.indexOf('x'), 'insert-column')).toBeNull()
  })

  it('refuses a structural edit if a body row has surplus cells', () => {
    const source = '| A | B |\n| --- | --- |\n| x | y | extra |'
    expect(tableAt(source, source.indexOf('x'))?.editable).toBe(false)
    expect(editTable(source, source.indexOf('x'), 'insert-column')).toBeNull()
  })
})
