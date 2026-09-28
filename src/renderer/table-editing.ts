import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'

export interface TableContext {
  row: number
  column: number
  columns: number
  bodyRows: number
  editable: boolean
}

export interface TableCommand {
  changes?: { from: number; to: number; insert: string }
  anchor: number
}

export type TableAction = 'insert-row' | 'delete-row' | 'insert-column' | 'delete-column' | 'align-default' | 'align-left' | 'align-center' | 'align-right'

type Alignment = 'left' | 'center' | 'right' | null
interface Position { start: { offset?: number }; end: { offset?: number } }
interface MarkdownNode {
  type: string
  position?: Position
  children?: MarkdownNode[]
  align?: Alignment[]
}
interface Cell { value: string; start: number; end: number; anchor: number }
interface TableModel extends TableContext {
  from: number
  to: number
  rows: string[][]
  cells: Cell[][]
  alignment: Alignment[]
  safe: boolean
}

const parser = unified().use(remarkParse).use(remarkGfm)

function tableNodeAt(node: MarkdownNode, position: number): MarkdownNode | null {
  // Nested tables have container prefixes (for example "> ") that the simple
  // table serializer cannot preserve. Only edit top-level GFM tables.
  for (const child of node.children ?? []) {
    const from = child.position?.start.offset
    const to = child.position?.end.offset
    if (child.type === 'table' && from !== undefined && to !== undefined && position >= from && position <= to) return child
  }
  return null
}

function cellFromSource(text: string, node: MarkdownNode): Cell | null {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) return null
  const raw = text.slice(start, end)
  const leadingPipe = raw.startsWith('|') ? 1 : 0
  let content = raw.slice(leadingPipe)
  if (content.endsWith('|') && !/(?:^|[^\\])(?:\\\\)*\\\|$/.test(content)) content = content.slice(0, -1)
  // Only ASCII spaces outside a cell's Markdown are table formatting.
  // Other whitespace (notably NBSP) is part of the user's content.
  const leadingSpaces = content.match(/^ */)?.[0].length ?? 0
  const value = content.slice(leadingSpaces).replace(/ *$/, '')
  const anchor = start + leadingPipe + (value ? leadingSpaces : Math.min(1, leadingSpaces))
  return { value, start, end, anchor }
}

function findTable(text: string, position: number): TableModel | null {
  const node = tableNodeAt(parser.parse(text) as MarkdownNode, position)
  const from = node?.position?.start.offset
  const to = node?.position?.end.offset
  if (!node || from === undefined || to === undefined || !node.children?.length) return null
  const cells = node.children.map(row => row.children?.map(cell => cellFromSource(text, cell)) ?? [])
  if (cells.some(row => row.some(cell => cell === null))) return null
  const typedCells = cells as Cell[][]
  const columns = typedCells[0].length
  if (!columns) return null
  const rows = typedCells.map(row => row.map(cell => cell.value))
  const safe = rows.every(row => row.length <= columns)
  for (const row of rows) while (row.length < columns) row.push('')
  const alignment = Array.from({ length: columns }, (_, index) => node.align?.[index] ?? null)
  let activeRow = 0
  for (let index = 0; index < node.children.length; index++) {
    const rowFrom = node.children[index].position?.start.offset ?? -1
    const rowTo = node.children[index].position?.end.offset ?? -1
    if (position >= rowFrom && position <= rowTo) { activeRow = index; break }
  }
  const activeCells = typedCells[activeRow]
  let column = activeCells.findIndex(cell => position >= cell.start && position < cell.end)
  if (column < 0) column = position >= (activeCells.at(-1)?.end ?? Number.POSITIVE_INFINITY) ? activeCells.length - 1 : 0
  return { from, to, row: activeRow, column: Math.max(0, column), columns, bodyRows: rows.length - 1, editable: safe, rows, cells: typedCells, alignment, safe }
}

export function tableAt(text: string, position: number): TableContext | null {
  const model = findTable(text, position)
  return model ? { row: model.row, column: model.column, columns: model.columns, bodyRows: model.bodyRows, editable: model.editable } : null
}

function delimiter(alignment: Alignment): string {
  return alignment === 'left' ? ':---' : alignment === 'center' ? ':---:' : alignment === 'right' ? '---:' : '---'
}

function renderTable(model: TableModel, row: number, column: number): TableCommand {
  let insert = ''
  const anchors: number[][] = []
  const appendRow = (cells: string[], index: number) => {
    if (insert) insert += '\n'
    insert += '| '
    anchors[index] = []
    cells.forEach((cell, cellIndex) => {
      anchors[index][cellIndex] = insert.length
      insert += cell + (cellIndex < cells.length - 1 ? ' | ' : ' |')
    })
  }
  appendRow(model.rows[0], 0)
  insert += `\n| ${model.alignment.map(delimiter).join(' | ')} |`
  for (let index = 1; index < model.rows.length; index++) appendRow(model.rows[index], index)
  return { changes: { from: model.from, to: model.to, insert }, anchor: model.from + anchors[row][column] }
}

export function navigateTableCell(text: string, position: number, backward = false): TableCommand | null {
  const model = findTable(text, position)
  if (!model || !model.safe) return null
  let row = model.row
  let column = model.column
  if (backward) {
    if (row === 0 && column === 0) return null
    if (column > 0) column--
    else { row--; column = model.columns - 1 }
  } else if (column < model.columns - 1) column++
  else if (row < model.rows.length - 1) { row++; column = 0 }
  else {
    model.rows.push(Array.from({ length: model.columns }, () => ''))
    return renderTable(model, model.rows.length - 1, 0)
  }
  const cell = model.cells[row]?.[column]
  return cell ? { anchor: cell.anchor } : renderTable(model, row, column)
}

export function editTable(text: string, position: number, action: TableAction): TableCommand | null {
  const model = findTable(text, position)
  if (!model || !model.safe) return null
  let row = model.row
  let column = model.column
  switch (action) {
    case 'insert-row':
      model.rows.splice(row + 1, 0, Array.from({ length: model.columns }, () => ''))
      row++
      break
    case 'delete-row':
      if (row === 0) return null
      model.rows.splice(row, 1)
      row = Math.min(row, model.rows.length - 1)
      break
    case 'insert-column':
      model.rows.forEach(cells => cells.splice(column + 1, 0, ''))
      model.alignment.splice(column + 1, 0, null)
      model.columns++
      column++
      break
    case 'delete-column':
      if (model.columns === 1) return null
      model.rows.forEach(cells => cells.splice(column, 1))
      model.alignment.splice(column, 1)
      model.columns--
      column = Math.min(column, model.columns - 1)
      break
    case 'align-default': model.alignment[column] = null; break
    case 'align-left': model.alignment[column] = 'left'; break
    case 'align-center': model.alignment[column] = 'center'; break
    case 'align-right': model.alignment[column] = 'right'; break
  }
  return renderTable(model, row, column)
}
