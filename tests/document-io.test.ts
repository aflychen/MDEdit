import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DocumentStore, readDocument } from '../src/main/document-io'

const paths: string[] = []
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'mdedit-'))
  paths.push(dir)
  return join(dir, 'note.md')
}
afterEach(async () => { await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('document IO', () => {
  it('preserves BOM and CRLF when saving', async () => {
    const path = await fixture()
    await writeFile(path, Buffer.from('\ufeffone\r\ntwo\r\n'))
    const store = new DocumentStore()
    const opened = await store.open(path)
    expect(opened.text).toBe('one\ntwo\n')
    expect(opened.hasBom).toBe(true)
    expect(opened.lineEnding).toBe('crlf')
    await store.save(path, 'new\nline\n')
    expect(await readFile(path, 'utf8')).toBe('\ufeffnew\r\nline\r\n')
  })

  it('refuses invalid UTF-8 instead of replacing it', async () => {
    const path = await fixture()
    await writeFile(path, Buffer.from([0xff, 0xfe]))
    await expect(readDocument(path)).rejects.toThrow(/UTF-8/)
  })

  it('preserves an externally changed file', async () => {
    const path = await fixture()
    await writeFile(path, 'original')
    const store = new DocumentStore()
    await store.open(path)
    await writeFile(path, 'external')
    await expect(store.save(path, 'mine')).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await readFile(path, 'utf8')).toBe('external')
  })

  it('keeps each opened file baseline when another tab or the same file is opened', async () => {
    const first = await fixture()
    const second = join(paths[paths.length - 1], 'second.md')
    await writeFile(first, 'first')
    await writeFile(second, 'second')
    const store = new DocumentStore()
    await store.open(first)
    await store.open(second)
    await store.save(second, 'second edit')
    await writeFile(first, 'external edit')
    await store.open(first)
    await expect(store.save(first, 'my edit')).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await readFile(first, 'utf8')).toBe('external edit')
  })

  it('revokes a closed document until it is opened again', async () => {
    const path = await fixture()
    await writeFile(path, 'original')
    const store = new DocumentStore()
    await store.open(path)
    store.close(path)
    await expect(store.save(path, 'unauthorized')).rejects.toMatchObject({ code: 'NOT_OPEN' })
    await store.open(path)
    await store.save(path, 'authorized')
    expect(await readFile(path, 'utf8')).toBe('authorized')
  })

  it('rebases only the chosen document after an explicit reload', async () => {
    const first = await fixture()
    const second = join(paths[paths.length - 1], 'second.md')
    await writeFile(first, 'first')
    await writeFile(second, 'second')
    const store = new DocumentStore()
    await store.open(first)
    await store.open(second)
    await writeFile(first, 'external first')
    await writeFile(second, 'external second')
    expect((await store.reload(first)).text).toBe('external first')
    await store.save(first, 'new first')
    await expect(store.save(second, 'new second')).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('refuses to replace a symbolic link', async () => {
    const path = await fixture()
    const target = join(paths[paths.length - 1], 'target.md')
    await writeFile(target, 'target')
    await symlink(target, path)
    const store = new DocumentStore()
    await expect(store.open(path)).rejects.toMatchObject({ code: 'SYMLINK' })
  })

  it('refuses saving when a parent directory becomes a symbolic link', async () => {
    const file = await fixture()
    const root = paths[paths.length - 1]
    const inside = join(root, 'inside')
    const outside = join(root, 'outside')
    await mkdir(inside)
    await mkdir(outside)
    const original = join(inside, 'note.md')
    const other = join(outside, 'note.md')
    await writeFile(original, 'same')
    await writeFile(other, 'same')
    const store = new DocumentStore()
    await store.open(original)
    await rename(inside, join(root, 'moved'))
    await symlink(outside, inside)

    await expect(store.save(original, 'new')).rejects.toMatchObject({ code: 'SYMLINK' })
    expect(await readFile(other, 'utf8')).toBe('same')
  })

  it('keeps the file permissions after atomic replacement', async () => {
    const path = await fixture()
    await writeFile(path, 'before')
    await chmod(path, 0o644)
    const originalMode = (await stat(path)).mode & 0o777
    const store = new DocumentStore()
    await store.open(path)
    await store.save(path, 'after')
    expect((await stat(path)).mode & 0o777).toBe(originalMode)
  })
})
