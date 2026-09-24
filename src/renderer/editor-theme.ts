import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { tags } from '@lezer/highlight'
import type { ResolvedTheme } from './theme'

const darkSyntax = HighlightStyle.define([
  { tag: tags.heading, color: '#9bb6ff', fontWeight: '700' },
  { tag: tags.keyword, color: '#c3a4ff' },
  { tag: [tags.string, tags.inserted], color: '#9bd5b0' },
  { tag: [tags.number, tags.bool, tags.atom], color: '#f3bc85' },
  { tag: [tags.comment, tags.quote], color: '#96a4b8' },
  { tag: [tags.link, tags.url], color: '#90b5ff' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '700' }
])

export function editorTheme(theme: ResolvedTheme): Extension {
  if (theme === 'light') return EditorView.theme({}, { dark: false })
  return [EditorView.theme({
    '&': { color: '#dce5f1', backgroundColor: '#1b2433' },
    '.cm-content': { caretColor: '#a8b6ff' },
    '.cm-gutters': { color: '#7c8a9d', backgroundColor: '#1b2433', border: 'none' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#263249' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#3b4b70' }
  }, { dark: true }), syntaxHighlighting(darkSyntax)]
}
