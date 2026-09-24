import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Draft } from '../shared/contracts'

export class DraftStore {
  private operations = new Map<string, Promise<void>>()
  constructor(private directory: string) {}

  private filename(key: string): string {
    return join(this.directory, `${createHash('sha256').update(key).digest('hex')}.json`)
  }

  async write(draft: Draft): Promise<void> {
    const previous = this.operations.get(draft.key) ?? Promise.resolve()
    const work = previous.catch(() => undefined).then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const destination = this.filename(draft.key)
      try {
        const existing = JSON.parse(await readFile(destination, 'utf8')) as Draft
        if (existing.updatedAt > draft.updatedAt ||
          (existing.updatedAt === draft.updatedAt && (existing.revision ?? 0) >= draft.revision)) return
      } catch { /* No valid previous draft. */ }
      const temporary = join(this.directory, `${randomUUID()}.tmp`)
      try {
        await writeFile(temporary, JSON.stringify(draft), { mode: 0o600 })
        await rename(temporary, destination)
      } finally { await rm(temporary, { force: true }) }
    })
    this.operations.set(draft.key, work)
    try { await work } finally { if (this.operations.get(draft.key) === work) this.operations.delete(draft.key) }
  }

  async list(): Promise<Draft[]> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const names = (await readdir(this.directory)).filter(name => name.endsWith('.json'))
    const drafts = await Promise.all(names.map(async name => {
      try { return JSON.parse(await readFile(join(this.directory, name), 'utf8')) as Draft }
      catch { return null }
    }))
    return drafts.filter((draft): draft is Draft => draft !== null).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async delete(key: string, expected?: { revision: number; updatedAt: number }): Promise<void> {
    const previous = this.operations.get(key) ?? Promise.resolve()
    const work = previous.catch(() => undefined).then(async () => {
      if (expected) {
        let current: Draft
        try { current = JSON.parse(await readFile(this.filename(key), 'utf8')) as Draft }
        catch { return }
        if (current.revision !== expected.revision || current.updatedAt !== expected.updatedAt) return
      }
      await rm(this.filename(key), { force: true })
    })
    this.operations.set(key, work)
    try { await work } finally { if (this.operations.get(key) === work) this.operations.delete(key) }
  }
}
