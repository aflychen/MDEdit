import type { OutlineHeading } from './preview'

export function precedingIndex(positions: readonly number[], position: number): number {
  let index = -1
  for (let current = 0; current < positions.length && positions[current] <= position; current++) index = current
  return index
}

export function visibleOutlineIndices(headings: readonly OutlineHeading[], query: string, collapsed: ReadonlySet<number>): number[] {
  const term = query.trim().toLocaleLowerCase()
  const ancestors: number[] = []
  const visible: number[] = []
  const matches = new Set<number>()
  for (let index = 0; index < headings.length; index++) {
    while (ancestors.length && headings[ancestors[ancestors.length - 1]].depth >= headings[index].depth) ancestors.pop()
    if (term) {
      if (headings[index].text.toLocaleLowerCase().includes(term)) {
        matches.add(index)
        ancestors.forEach(ancestor => matches.add(ancestor))
      }
    } else if (!ancestors.some(ancestor => collapsed.has(ancestor))) visible.push(index)
    ancestors.push(index)
  }
  return term ? [...matches].sort((a, b) => a - b) : visible
}
