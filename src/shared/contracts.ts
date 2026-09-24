export type LineEnding = 'lf' | 'crlf' | 'mixed'
export type SaveState = 'editing' | 'saving' | 'saved' | 'error' | 'conflict'

export interface OpenedDocument {
  path: string
  text: string
  fingerprint: string
  lineEnding: LineEnding
  hasBom: boolean
  modifiedAt: number
}

export interface Draft {
  key: string
  path: string | null
  text: string
  fingerprint: string | null
  revision: number
  updatedAt: number
  diskModifiedAt?: number | null
}

export interface SaveResult { fingerprint: string; modifiedAt: number }
export interface AppError { code: string; message: string }

export interface DesktopApi {
  chooseOpen(): Promise<OpenedDocument | null>
  openSystemFile(path: string): Promise<OpenedDocument>
  openRelative(path: string): Promise<OpenedDocument>
  openRecent(path: string): Promise<OpenedDocument>
  chooseSave(text: string, options?: { hasBom: boolean; lineEnding: LineEnding }): Promise<OpenedDocument | null>
  save(path: string, text: string, revision: number, editedAt: number, allowMixed: boolean): Promise<SaveResult>
  writeDraft(draft: Draft): Promise<void>
  listDrafts(): Promise<Draft[]>
  openDraft(path: string): Promise<OpenedDocument>
  deleteDraft(key: string, expected?: { revision: number; updatedAt: number }): Promise<void>
  recentFiles(): Promise<string[]>
  readImage(relativePath: string): Promise<string>
  openExternal(url: string): Promise<void>
  onOpenFile(callback: (path: string) => void): () => void
  onExternalChange(callback: (path: string) => void): () => void
  onBeforeClose(callback: () => Promise<void>): () => void
}
