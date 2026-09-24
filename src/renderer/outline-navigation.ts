export function precedingIndex(positions: readonly number[], position: number): number {
  let index = -1
  for (let current = 0; current < positions.length && positions[current] <= position; current++) index = current
  return index
}
