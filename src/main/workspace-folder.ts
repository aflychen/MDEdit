import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { lstat, open, readdir, realpath, stat, type FileHandle } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { OpenedDocument, WorkspaceEntry, WorkspaceSearchResponse } from '../shared/contracts'
import { lineMatches } from '../shared/text-search'
import { DocumentError, readDocumentFromHandle } from './document-io'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_RESULTS = 100

export class WorkspaceFolder {
  private root: string | null = null

  getRoot(): string | null { return this.root }

  async select(path: string): Promise<string> {
    const entry = await lstat(path)
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new DocumentError('FORBIDDEN', '请选择普通文件夹')
    this.root = await realpath(path)
    return this.root
  }

  clear(): void { this.root = null }

  private async checkedPath(path: string, kind: 'directory' | 'file'): Promise<string> {
    const root = this.root
    if (!root) throw new DocumentError('FORBIDDEN', '尚未选择文件夹')
    if (isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path)) throw new DocumentError('FORBIDDEN', '路径不属于已选择的文件夹')
    const parts = path ? sep === '\\' ? path.split(/[\\/]/) : path.split('/') : []
    if (parts.some(part => !part || part === '.' || part === '..')) throw new DocumentError('FORBIDDEN', '路径不属于已选择的文件夹')
    let candidate = root
    for (const part of parts) {
      candidate = join(candidate, part)
      if ((await lstat(candidate)).isSymbolicLink()) throw new DocumentError('FORBIDDEN', '文件夹中的符号链接不可访问')
    }
    const canonical = await realpath(candidate)
    const inside = relative(root, canonical)
    if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new DocumentError('FORBIDDEN', '路径不属于已选择的文件夹')
    const entry = await lstat(canonical)
    if (kind === 'directory' ? !entry.isDirectory() : !entry.isFile()) throw new DocumentError('FORBIDDEN', '路径类型不正确')
    return canonical
  }

  async list(directory = ''): Promise<WorkspaceEntry[]> {
    const absolute = await this.checkedPath(directory, 'directory')
    const before = await stat(absolute)
    const entries = await readdir(absolute, { withFileTypes: true })
    const [current, after] = await Promise.all([realpath(absolute), stat(absolute)])
    if (current !== absolute || before.dev !== after.dev || before.ino !== after.ino) {
      throw new DocumentError('FORBIDDEN', '文件夹已改变，请重新展开')
    }
    return entries.filter(entry => !entry.isSymbolicLink() && (entry.isDirectory() || (entry.isFile() && /\.md$/i.test(entry.name))))
      .map(entry => ({
        name: entry.name,
        path: join(directory, entry.name),
        absolutePath: join(absolute, entry.name),
        kind: entry.isDirectory() ? 'directory' as const : 'file' as const
      }))
      .sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1)
  }

  async resolveDocument(path: string): Promise<string> {
    if (!/\.md$/i.test(path)) throw new DocumentError('UNSUPPORTED_LINK', '只能打开 Markdown 文件')
    return this.checkedPath(path, 'file')
  }

  private async withOpenedFile<T>(path: string, use: (absolute: string, handle: FileHandle, size: number) => Promise<T>): Promise<T> {
    const root = this.root
    if (!root) throw new DocumentError('FORBIDDEN', '尚未选择文件夹')
    const absolute = await this.resolveDocument(path)
    const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const check = async () => {
        const [current, opened, pathEntry] = await Promise.all([realpath(absolute), handle.stat(), stat(absolute)])
        const within = relative(root, current)
        if (this.root !== root || current !== absolute || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within) ||
            !opened.isFile() || opened.dev !== pathEntry.dev || opened.ino !== pathEntry.ino) {
          throw new DocumentError('FORBIDDEN', '文件已改变或不属于已选择的文件夹')
        }
        return opened.size
      }
      const size = await check()
      const result = await use(absolute, handle, size)
      await check()
      return result
    } finally { await handle.close() }
  }

  async openDocument(path: string): Promise<OpenedDocument> {
    return this.withOpenedFile(path, (absolute, handle) => readDocumentFromHandle(absolute, handle))
  }

  async search(query: string): Promise<WorkspaceSearchResponse> {
    if (!this.root) throw new DocumentError('FORBIDDEN', '尚未选择文件夹')
    const needle = query.trim()
    const response: WorkspaceSearchResponse = { results: [], truncated: false, skipped: 0 }
    if (!needle) return response
    if (needle.length > 200) throw new DocumentError('INVALID_QUERY', '搜索内容过长')
    const pending = ['']
    while (pending.length) {
      let entries: WorkspaceEntry[]
      try { entries = await this.list(pending.pop()!) }
      catch { response.skipped++; continue }
      for (const entry of entries) {
        if (entry.kind === 'directory') { pending.push(entry.path); continue }
        try {
          const content = await this.withOpenedFile(entry.path, async (absolute, handle, size) => {
            if (size > MAX_FILE_BYTES) return null
            return { absolute, bytes: await handle.readFile() }
          })
          if (!content) { response.skipped++; continue }
          const { absolute } = content
          const fingerprint = createHash('sha256').update(content.bytes).digest('hex')
          const lines = new TextDecoder('utf-8', { fatal: true }).decode(content.bytes).replace(/^\ufeff/, '').split(/\r\n|\n|\r/)
          for (let index = 0; index < lines.length; index++) {
            const line = lines[index]
            for (const match of lineMatches(line, needle)) {
              const found = match.index
              if (response.results.length === MAX_RESULTS) { response.truncated = true; return response }
              const start = Math.max(0, found - 50)
              const end = Math.min(line.length, found + match.length + 70)
              response.results.push({ path: entry.path, absolutePath: absolute, line: index + 1, column: found + 1,
                snippet: `${start ? '…' : ''}${line.slice(start, end)}${end < line.length ? '…' : ''}`, fingerprint })
            }
          }
        } catch { response.skipped++ }
      }
    }
    return response
  }
}
