import type { OpenedDocument, WorkspaceSearchResult } from '../shared/contracts'
import { lineMatches } from '../shared/text-search'

export interface MatchPosition { line: number; column: number }

export function searchResultPosition(
  result: WorkspaceSearchResult,
  query: string,
  opened: Pick<OpenedDocument, 'path' | 'text' | 'fingerprint'>,
  bufferText: string
): MatchPosition | null {
  if (!query.trim() || result.absolutePath !== opened.path || result.fingerprint !== opened.fingerprint) return null
  const originalLine = opened.text.split('\n')[result.line - 1]
  const line = bufferText.split('\n')[result.line - 1]
  if (line === undefined || line !== originalLine || result.column < 1) return null
  let matched = false
  for (const match of lineMatches(line, query)) {
    if (match.index === result.column - 1) { matched = true; break }
  }
  if (!matched) return null
  return { line: result.line, column: result.column }
}
