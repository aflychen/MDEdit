import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DocumentAccess } from '../src/main/document-access'
import { DocumentOperationQueue } from '../src/main/document-operations'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('document operation queue', () => {
  it('keeps a pending save ahead of a reload after an external edit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mdedit-operations-'))
    roots.push(root)
    const path = join(root, 'sample.md')
    await writeFile(path, 'original')
    const access = new DocumentAccess()
    const opened = await access.open(path)
    const queue = new DocumentOperationQueue()
    let releaseSave!: () => void
    const draftDelay = new Promise<void>(resolve => { releaseSave = resolve })

    const saving = queue.run(async () => {
      await draftDelay
      return access.save(opened.path, 'local edit')
    })
    await writeFile(path, 'external edit')
    const reloading = queue.run(() => access.reload(opened.path))
    releaseSave()

    await expect(saving).rejects.toMatchObject({ code: 'CONFLICT' })
    expect((await reloading).text).toBe('external edit')
    expect(await readFile(path, 'utf8')).toBe('external edit')
  })
})
