export type BlockKind = 'list' | 'task' | 'quote' | 'code'

export interface MarkdownInsertion {
  text: string
  selectionStart: number
  selectionEnd: number
}

export function setHeading(_line: string, _level: 0 | 1 | 2 | 3 | 4 | 5): string {
  const match = _line.match(/^(\s{0,3})(?:#{1,6}(?:\s+|$))?(.*)$/)
  if (!match) return _line

  const [, indent, content] = match
  return _level === 0 ? `${indent}${content}` : `${indent}${'#'.repeat(_level)} ${content}`
}

export function createTable(columns: number, bodyRows: number): MarkdownInsertion {
  const columnCount = Math.max(1, Math.floor(columns))
  const rowCount = Math.max(1, Math.floor(bodyRows))
  const header = Array.from({ length: columnCount }, (_, index) => `表头 ${index + 1}`)
  const separator = Array.from({ length: columnCount }, () => '---')
  const emptyRow = Array.from({ length: columnCount }, () => '')
  const rows = [header, separator, ...Array.from({ length: rowCount }, () => emptyRow)]
  const text = rows.map((cells) => `| ${cells.join(' | ')} |`).join('\n')
  const selectionStart = 2

  return { text, selectionStart, selectionEnd: selectionStart + header[0].length }
}

export function blockTemplate(kind: BlockKind): MarkdownInsertion {
  const templates: Record<BlockKind, MarkdownInsertion> = {
    list: { text: '- ', selectionStart: 2, selectionEnd: 2 },
    task: { text: '- [ ] ', selectionStart: 6, selectionEnd: 6 },
    quote: { text: '> ', selectionStart: 2, selectionEnd: 2 },
    code: { text: '```\n\n```', selectionStart: 4, selectionEnd: 4 },
  }
  return templates[kind]
}
