import { lstat, realpath } from 'node:fs/promises'
import type { ImageImport, OpenedDocument, SaveResult } from '../shared/contracts'
import { importLocalImages, readLocalImage, resolveLocalResource } from './assets'
import { DocumentError, DocumentStore } from './document-io'

export class DocumentAccess {
  private readonly documents = new DocumentStore()

  assertOpen(path: string): void {
    if (!this.documents.has(path)) throw new DocumentError('FORBIDDEN', '文档未打开')
  }

  async open(path: string): Promise<OpenedDocument> {
    const entry = await lstat(path)
    if (entry.isSymbolicLink()) throw new DocumentError('SYMLINK', '符号链接文档只能另存为普通文件')
    return this.documents.open(await realpath(path))
  }

  openSnapshot(document: OpenedDocument): OpenedDocument {
    return this.documents.adopt(document)
  }

  async reload(path: string): Promise<OpenedDocument> {
    this.assertOpen(path)
    return this.documents.reload(path)
  }

  async create(path: string, text: string, format: { hasBom: boolean; lineEnding: 'lf' | 'crlf' | 'mixed' }): Promise<OpenedDocument> {
    const created = await this.documents.create(path, text, format)
    const canonicalPath = await realpath(path)
    if (created.path === canonicalPath) return created
    this.documents.close(created.path)
    return this.documents.open(canonicalPath)
  }

  async openRelative(basePath: string, relativePath: string): Promise<OpenedDocument> {
    this.assertOpen(basePath)
    const target = await resolveLocalResource(basePath, relativePath)
    if (!/\.md$/i.test(target)) throw new DocumentError('UNSUPPORTED_LINK', '只能在编辑器中打开 Markdown 文件')
    return this.open(target)
  }

  async readImage(basePath: string, relativePath: string): Promise<string> {
    this.assertOpen(basePath)
    return readLocalImage(basePath, relativePath)
  }

  async importImages(basePath: string, images: ImageImport[]): Promise<string[]> {
    this.assertOpen(basePath)
    return importLocalImages(basePath, images)
  }

  async save(path: string, text: string, allowMixed = false): Promise<SaveResult> {
    this.assertOpen(path)
    return this.documents.save(path, text, allowMixed)
  }

  fingerprint(path: string): string | null { return this.documents.fingerprint(path) }

  isOpen(path: string): boolean { return this.documents.has(path) }

  close(path: string): void { this.documents.close(path) }

  closeAll(): void { this.documents.closeAll() }
}
