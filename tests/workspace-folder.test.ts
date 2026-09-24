import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WorkspaceFolder } from '../src/main/workspace-folder'

const temporary: string[] = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mdedit-folder-'))
  temporary.push(root)
  await mkdir(join(root, 'notes'))
  await writeFile(join(root, 'readme.md'), '# Start\nHello world\n')
  await writeFile(join(root, 'notes', 'daily.md'), 'First line\nSearch target here\n')
  await writeFile(join(root, 'ignore.txt'), 'Search target here\n')
  return root
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('workspace folder authorization', () => {
  it('lists Markdown files and folders and opens only files under the selected root', async () => {
    const root = await fixture()
    const workspace = new WorkspaceFolder()
    await workspace.select(root)

    expect((await workspace.list('')).map(entry => `${entry.kind}:${entry.name}`)).toEqual(['directory:notes', 'file:readme.md'])
    expect(await workspace.resolveDocument(join('notes', 'daily.md'))).toBe(join(await realpath(root), 'notes', 'daily.md'))
    await expect(workspace.openDocument('readme.md')).resolves.toMatchObject({ path: join(await realpath(root), 'readme.md'), text: '# Start\nHello world\n' })
    await expect(workspace.resolveDocument('../outside.md')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(workspace.list(root)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(workspace.resolveDocument('ignore.txt')).rejects.toMatchObject({ code: 'UNSUPPORTED_LINK' })
  })

  it('does not follow symbolic links in the tree or through direct requests', async () => {
    const root = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'mdedit-outside-'))
    temporary.push(outside)
    await writeFile(join(outside, 'secret.md'), 'Search target secret')
    await symlink(outside, join(root, 'linked'))
    const workspace = new WorkspaceFolder()
    await workspace.select(root)

    expect((await workspace.list('')).map(entry => entry.name)).not.toContain('linked')
    await expect(workspace.resolveDocument(join('linked', 'secret.md'))).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await workspace.search('secret')).results).toEqual([])
  })

  it('searches Markdown content with a location and excludes other file types', async () => {
    const root = await fixture()
    const workspace = new WorkspaceFolder()
    await workspace.select(root)

    const search = await workspace.search('TARGET')
    expect(search.results).toEqual([{ path: join('notes', 'daily.md'), absolutePath: join(await realpath(root), 'notes', 'daily.md'), line: 2, column: 8, snippet: 'Search target here', fingerprint: (await workspace.openDocument(join('notes', 'daily.md'))).fingerprint }])
    expect(search.skipped).toBe(0)
    expect(search.truncated).toBe(false)
    expect((await workspace.search('  ')).results).toEqual([])
  })

  it('clears the folder authorization', async () => {
    const root = await fixture()
    const workspace = new WorkspaceFolder()
    await workspace.select(root)
    workspace.clear()
    await expect(workspace.list('')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('caps search results and reports unreadable UTF-8 documents', async () => {
    const root = await fixture()
    await writeFile(join(root, 'bad.md'), Buffer.from([0xff, 0xfe]))
    await writeFile(join(root, 'many.md'), Array.from({ length: 101 }, () => 'needle').join('\n'))
    const workspace = new WorkspaceFolder()
    await workspace.select(root)

    const search = await workspace.search('needle')
    expect(search.results).toHaveLength(100)
    expect(search.truncated).toBe(true)
    expect(search.skipped).toBe(1)
  })

  it('returns every occurrence on the same line with its own column', async () => {
    const root = await fixture()
    await writeFile(join(root, 'repeated.md'), 'foo foo')
    const workspace = new WorkspaceFolder()
    await workspace.select(root)

    expect((await workspace.search('foo')).results.map(result => ({ path: result.path, line: result.line, column: result.column }))).toEqual([
      { path: 'repeated.md', line: 1, column: 1 },
      { path: 'repeated.md', line: 1, column: 5 }
    ])
  })

  it('reports columns in the original Unicode text', async () => {
    const root = await fixture()
    await writeFile(join(root, 'unicode.md'), 'İfoo')
    const workspace = new WorkspaceFolder()
    await workspace.select(root)
    expect((await workspace.search('foo')).results.find(result => result.path === 'unicode.md')?.column).toBe(2)
  })
})
