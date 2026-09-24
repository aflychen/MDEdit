import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DraftStore } from '../src/main/drafts'
import { readLocalImage } from '../src/main/assets'

const dirs: string[] = []
async function dir() { const value = await mkdtemp(join(tmpdir(), 'mdedit-test-')); dirs.push(value); return value }
afterEach(async () => { await Promise.all(dirs.splice(0).map(value => rm(value, { recursive: true, force: true }))) })

describe('drafts', () => {
  it('persists a recoverable draft and deletes it after save', async () => {
    const root = await dir()
    const store = new DraftStore(root)
    await store.write({ key: 'untitled', path: null, text: 'unfinished', fingerprint: null, revision: 1, updatedAt: 42 })
    expect((await store.list())[0].text).toBe('unfinished')
    await store.delete('untitled')
    expect(await store.list()).toEqual([])
  })

  it('does not let an older save snapshot replace a newer draft', async () => {
    const store = new DraftStore(await dir())
    await store.write({ key: 'note.md', path: 'note.md', text: 'newer', fingerprint: 'a', revision: 2, updatedAt: 200 })
    await store.write({ key: 'note.md', path: 'note.md', text: 'older', fingerprint: 'a', revision: 1, updatedAt: 100 })
    expect((await store.list())[0].text).toBe('newer')
  })

  it('does not delete a newer draft when an older save finishes', async () => {
    const store = new DraftStore(await dir())
    await store.write({ key: 'note.md', path: 'note.md', text: 'newer', fingerprint: 'a', revision: 2, updatedAt: 200 })
    await store.delete('note.md', { revision: 1, updatedAt: 100 })
    expect((await store.list())[0].text).toBe('newer')
    await Promise.all([
      store.write({ key: 'note.md', path: 'note.md', text: 'newest', fingerprint: 'a', revision: 3, updatedAt: 300 }),
      store.delete('note.md', { revision: 2, updatedAt: 200 })
    ])
    expect((await store.list())[0].text).toBe('newest')
  })
})

describe('local images', () => {
  it('reads an image under the current document directory', async () => {
    const root = await dir()
    await mkdir(join(root, 'images'))
    await writeFile(join(root, 'images', 'a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const result = await readLocalImage(join(root, 'note.md'), 'images/a.png')
    expect(result).toBe('data:image/png;base64,iVBORw==')
  })

  it('rejects parent paths and symlinks escaping the document directory', async () => {
    const root = await dir()
    const outside = await dir()
    await writeFile(join(outside, 'private.png'), 'secret')
    await symlink(join(outside, 'private.png'), join(root, 'link.png'))
    await expect(readLocalImage(join(root, 'note.md'), '../private.png')).rejects.toThrow()
    await expect(readLocalImage(join(root, 'note.md'), 'link.png')).rejects.toThrow()
    expect(await readFile(join(outside, 'private.png'), 'utf8')).toBe('secret')
  })
})
