export function* lineMatches(line: string, query: string): Generator<{ index: number; length: number }> {
  const needle = query.trim()
  if (!needle) return
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const match of line.matchAll(new RegExp(escaped, 'giu'))) {
    yield { index: match.index, length: match[0].length }
  }
}
