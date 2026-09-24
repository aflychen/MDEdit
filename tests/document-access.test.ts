import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DocumentAccess } from '../src/main/document-access'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('document access', () => {
  it('uses one canonical path for a file opened through a linked directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mdedit-canonical-'))
    roots.push(root)
    const realDirectory = join(root, 'real')
    await mkdir(realDirectory)
    const path = join(realDirectory, 'note.md')
    await writeFile(path, '# Note')
    const linkedDirectory = join(root, 'linked')
    await symlink(realDirectory, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir')
    const access = new DocumentAccess()

    const opened = await access.open(join(linkedDirectory, 'note.md'))
    const relative = await access.openRelative(opened.path, './note.md')
    const created = await access.create(join(linkedDirectory, 'new.md'), 'new', { hasBom: false, lineEnding: 'lf' })
    const linkedFile = join(root, 'linked-file.md')
    await symlink(path, linkedFile)

    expect(opened.path).toBe(await realpath(path))
    expect(relative.path).toBe(opened.path)
    expect(created.path).toBe(await realpath(join(realDirectory, 'new.md')))
    expect(access.isOpen(opened.path)).toBe(true)
    await expect(access.open(linkedFile)).rejects.toMatchObject({ code: 'SYMLINK' })
  })

  it('revokes all opened paths when the window closes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mdedit-window-access-'))
    roots.push(root)
    const first = join(root, 'first.md')
    const second = join(root, 'second.md')
    await writeFile(first, '# First')
    await writeFile(second, '# Second')
    const access = new DocumentAccess()
    const openedFirst = await access.open(first)
    const openedSecond = await access.open(second)

    access.closeAll()

    expect(access.isOpen(openedFirst.path)).toBe(false)
    expect(access.isOpen(openedSecond.path)).toBe(false)
    await expect(access.save(openedFirst.path, 'changed')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(access.readImage(openedSecond.path, 'image.png')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('revokes document-scoped draft access when a tab closes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mdedit-draft-access-'))
    roots.push(root)
    const path = join(root, 'draft.md')
    await writeFile(path, '# Draft')
    const access = new DocumentAccess()

    expect(() => access.assertOpen(path)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }))
    const opened = await access.open(path)
    expect(() => access.assertOpen(opened.path)).not.toThrow()
    access.close(opened.path)
    expect(() => access.assertOpen(opened.path)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }))
  })

  it('allows relative resources only from an opened document', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mdedit-access-'))
    roots.push(root)
    await mkdir(join(root, 'images'))
    const first = join(root, 'first.md')
    const second = join(root, 'second.md')
    await writeFile(first, '[second](second.md)\n![img](images/p.png)')
    await writeFile(second, '# Second')
    await writeFile(join(root, 'images', 'p.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const access = new DocumentAccess()

    await expect(access.readImage(first, 'images/p.png')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(access.openRelative(first, 'second.md')).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const opened = await access.open(first)
    expect(await access.readImage(opened.path, 'images/p.png')).toMatch(/^data:image\/png;base64,/)
    expect((await access.openRelative(opened.path, 'second.md')).path).toBe(await realpath(second))
    access.close(opened.path)
    await expect(access.readImage(opened.path, 'images/p.png')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
