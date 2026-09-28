import { type Extension, type Text } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

export interface FocusedLines { from: number; to: number }

const isBlank = (line: string) => !line.trim()
const isHeading = (line: string) => /^ {0,3}#{1,6}(?:\s|$)/.test(line)
const isListItem = (line: string) => /^ {0,3}(?:[-+*]|\d+[.)])\s/.test(line)
const fenceStart = (line: string) => line.match(/^ {0,3}(`{3,}|~{3,})/)
const startsBlock = (line: string) => isHeading(line) || isListItem(line) || Boolean(fenceStart(line))

function paragraphBlocks(lines: readonly string[]): FocusedLines[] {
  const blocks: FocusedLines[] = []
  for (let index = 0; index < lines.length;) {
    if (isBlank(lines[index])) { index++; continue }
    const from = index + 1
    const fence = fenceStart(lines[index])?.[1]
    if (fence) {
      index++
      const closing = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`)
      while (index < lines.length && !closing.test(lines[index])) index++
      if (index < lines.length) index++
    } else if (isHeading(lines[index])) {
      index++
    } else {
      index++
      while (index < lines.length && !isBlank(lines[index]) && !startsBlock(lines[index])) index++
    }
    blocks.push({ from, to: index })
  }
  return blocks
}

export function focusedParagraphLines(text: string, line: number): FocusedLines {
  const lines = text.split('\n')
  const blocks = paragraphBlocks(lines)
  if (!blocks.length) return { from: 1, to: 1 }
  return closestBlock(blocks, Math.max(1, Math.min(lines.length, line)))
}

function closestBlock(blocks: readonly FocusedLines[], line: number): FocusedLines {
  if (!blocks.length) return { from: 1, to: 1 }
  let low = 0
  let high = blocks.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (blocks[middle].to < line) low = middle + 1
    else high = middle
  }
  const after = blocks[low]
  const before = blocks[low - 1]
  if (!after) return before
  if (!before || line >= after.from || after.from - line < line - before.to) return after
  return before
}

function focusedDocumentLines(view: EditorView): FocusedLines {
  const doc = view.state.doc
  let line = doc.lineAt(view.state.selection.main.head).number
  if (!doc.line(line).text.trim()) {
    for (let distance = 1; distance < doc.lines; distance++) {
      if (line - distance >= 1 && doc.line(line - distance).text.trim()) { line -= distance; break }
      if (line + distance <= doc.lines && doc.line(line + distance).text.trim()) { line += distance; break }
    }
  }
  const position = doc.line(line).from
  for (let node: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(view.state).resolveInner(position, 1); node; node = node.parent) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
      return { from: doc.lineAt(node.from).number, to: doc.lineAt(Math.max(node.from, node.to - 1)).number }
    }
  }
  return nearbyBlock(doc, line)
}

function nearbyBlock(doc: Text, line: number): FocusedLines {
  const current = doc.line(line).text
  if (isHeading(current)) return { from: line, to: line }
  const fence = fenceStart(current)?.[1]
  if (fence) {
    const closing = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`)
    let to = line
    while (to < doc.lines) {
      to++
      if (closing.test(doc.line(to).text)) break
    }
    return { from: line, to }
  }
  let from = line
  if (!isListItem(current)) {
    while (from > 1 && !isBlank(doc.line(from - 1).text) && !startsBlock(doc.line(from - 1).text)) from--
    if (from > 1 && isListItem(doc.line(from - 1).text)) from--
  }
  let to = line
  while (to < doc.lines && !isBlank(doc.line(to + 1).text) && !startsBlock(doc.line(to + 1).text)) to++
  return { from, to }
}

function focusDecorations(view: EditorView): DecorationSet {
  const focused = focusedDocumentLines(view)
  const dimmed = []
  const seen = new Set<number>()
  for (const range of view.visibleRanges) {
    const first = view.state.doc.lineAt(range.from).number
    const last = view.state.doc.lineAt(range.to).number
    for (let number = first; number <= last; number++) {
      if (seen.has(number) || (number >= focused.from && number <= focused.to)) continue
      seen.add(number)
      const line = view.state.doc.line(number)
      if (view.state.selection.ranges.some(range => !range.empty && range.from <= line.to && range.to > line.from)) continue
      dimmed.push(Decoration.line({ class: 'cm-focus-dim' }).range(line.from))
    }
  }
  return Decoration.set(dimmed, true)
}

export const focusModeExtension: Extension = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = focusDecorations(view) }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) this.decorations = focusDecorations(update.view)
  }
}, { decorations: plugin => plugin.decorations })

export const typewriterModeExtension: Extension = ViewPlugin.fromClass(class {
  private frame: number | null = null
  update(update: ViewUpdate) {
    if (!update.docChanged) return
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    const document = update.state.doc
    this.frame = requestAnimationFrame(() => {
      this.frame = null
      const view = update.view
      if (!view.hasFocus || view.state.doc !== document) return
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }) })
    })
  }
  destroy() { if (this.frame !== null) cancelAnimationFrame(this.frame) }
})
