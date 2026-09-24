import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { LineEnding, OpenedDocument, SaveResult } from '../shared/contracts'

export class DocumentError extends Error {
  constructor(public code: string, message: string) { super(message) }
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function lineEndingOf(text: string): LineEnding {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const bareLf = (text.match(/(?<!\r)\n/g) ?? []).length
  const bareCr = (text.match(/\r(?!\n)/g) ?? []).length
  if ((crlf > 0 && bareLf > 0) || bareCr > 0) return 'mixed'
  return crlf > 0 ? 'crlf' : 'lf'
}

function encode(text: string, format: { lineEnding: LineEnding; hasBom: boolean }): Buffer {
  const normalized = text.replace(/\r\n?/g, '\n')
  const formatted = format.lineEnding === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized
  return Buffer.from(`${format.hasBom ? '\ufeff' : ''}${formatted}`, 'utf8')
}

async function ensureRegularFile(path: string): Promise<void> {
  const entry = await lstat(path)
  if (entry.isSymbolicLink()) throw new DocumentError('SYMLINK', '符号链接文档只能另存为普通文件')
  if (!entry.isFile()) throw new DocumentError('NOT_FILE', '路径不是普通文件')
}

export async function readDocument(path: string): Promise<OpenedDocument> {
  await ensureRegularFile(path)
  const bytes = await readFile(path)
  let decoded: string
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new DocumentError('INVALID_UTF8', '文件不是有效的 UTF-8 文本') }
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  const raw = decoded.startsWith('\ufeff') ? decoded.slice(1) : decoded
  const metadata = await stat(path)
  return {
    path,
    text: raw.replace(/\r\n?/g, '\n'),
    fingerprint: hash(bytes),
    lineEnding: lineEndingOf(raw),
    hasBom,
    modifiedAt: metadata.mtimeMs
  }
}

interface Baseline { fingerprint: string; lineEnding: LineEnding; hasBom: boolean }

export class DocumentStore {
  private baselines = new Map<string, Baseline>()

  async open(path: string): Promise<OpenedDocument> {
    const document = await readDocument(path)
    if (!this.baselines.has(path)) this.baselines.set(path, document)
    return document
  }

  async reload(path: string): Promise<OpenedDocument> {
    if (!this.baselines.has(path)) throw new DocumentError('NOT_OPEN', '文档尚未打开')
    const document = await readDocument(path)
    this.baselines.set(path, document)
    return document
  }

  async create(path: string, text: string, format: { lineEnding: LineEnding; hasBom: boolean }): Promise<OpenedDocument> {
    try {
      await lstat(path)
      throw new DocumentError('EXISTS', '目标文件已存在，请选择其他文件名')
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    const bytes = encode(text, format)
    const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
    try { await handle.writeFile(bytes); await handle.sync() }
    finally { await handle.close() }
    return this.open(path)
  }

  async save(path: string, text: string, allowMixed = false): Promise<SaveResult> {
    const baseline = this.baselines.get(path)
    if (!baseline) throw new DocumentError('NOT_OPEN', '文档尚未打开')
    if (baseline.lineEnding === 'mixed' && !allowMixed) {
      throw new DocumentError('MIXED_LINE_ENDINGS', '混合换行文件需要确认转换或另存副本')
    }
    await ensureRegularFile(path)
    const originalMode = (await stat(path)).mode & 0o777
    const current = await readFile(path)
    if (hash(current) !== baseline.fingerprint) throw new DocumentError('CONFLICT', '磁盘文件已被其他程序修改')
    const bytes = encode(text, baseline)
    const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
    try {
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
      try { await handle.writeFile(bytes); await handle.chmod(originalMode); await handle.sync() }
      finally { await handle.close() }
      await rename(temporary, path)
      try {
        const directory = await open(dirname(path), constants.O_RDONLY)
        try { await directory.sync() } finally { await directory.close() }
      } catch { /* Directory fsync is unsupported on some Windows filesystems. */ }
    } finally { await rm(temporary, { force: true }) }
    const fingerprint = hash(bytes)
    this.baselines.set(path, { ...baseline, fingerprint, lineEnding: baseline.lineEnding === 'mixed' ? 'lf' : baseline.lineEnding })
    return { fingerprint, modifiedAt: (await stat(path)).mtimeMs }
  }

  fingerprint(path: string): string | null { return this.baselines.get(path)?.fingerprint ?? null }

  has(path: string): boolean { return this.baselines.has(path) }

  close(path: string): void { this.baselines.delete(path) }

  closeAll(): void { this.baselines.clear() }
}
