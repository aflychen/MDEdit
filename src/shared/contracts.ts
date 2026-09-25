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
export interface ImageImport { bytes: Uint8Array }

export interface WorkspaceEntry {
  name: string
  path: string
  absolutePath: string
  kind: 'directory' | 'file'
}

export interface WorkspaceSearchResult {
  path: string
  absolutePath: string
  line: number
  column: number
  snippet: string
  fingerprint: string
}

export interface WorkspaceSearchResponse {
  results: WorkspaceSearchResult[]
  truncated: boolean
  skipped: number
}

export interface DesktopApi {
  exportDocument(format: 'html' | 'pdf', title: string, body: string): Promise<string | null>
  chooseWorkspaceFolder(): Promise<string | null>
  listWorkspaceDirectory(path: string): Promise<WorkspaceEntry[]>
  openWorkspaceDocument(path: string): Promise<OpenedDocument>
  searchWorkspace(query: string): Promise<WorkspaceSearchResponse>
  closeWorkspaceFolder(): Promise<void>
  chooseOpen(): Promise<OpenedDocument | null>
  openSystemFile(path: string): Promise<OpenedDocument>
  openRelative(basePath: string, path: string): Promise<OpenedDocument>
  openRecent(path: string): Promise<OpenedDocument>
  chooseSave(text: string, options: { hasBom: boolean; lineEnding: LineEnding }, sourcePath: string | null): Promise<OpenedDocument | null>
  save(path: string, text: string, revision: number, editedAt: number, allowMixed: boolean): Promise<SaveResult>
  writeDraft(draft: Draft): Promise<void>
  listDrafts(): Promise<Draft[]>
  openDraft(path: string): Promise<OpenedDocument>
  reloadDocument(path: string): Promise<OpenedDocument>
  deleteDraft(key: string, expected?: { revision: number; updatedAt: number }): Promise<void>
  recentFiles(): Promise<string[]>
  readImage(basePath: string, relativePath: string): Promise<string>
  importImages(basePath: string, images: ImageImport[]): Promise<string[]>
  releaseDocument(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  onOpenFile(callback: (path: string) => void): () => void
  onExternalChange(callback: (path: string) => void): () => void
  onBeforeClose(callback: () => Promise<void>): () => void
}
