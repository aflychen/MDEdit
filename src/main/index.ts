import { app, BrowserWindow, dialog, ipcMain, shell, session } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DocumentAccess } from './document-access'
import { DocumentError, readDocument } from './document-io'
import { DocumentOperationQueue } from './document-operations'
import { DraftStore } from './drafts'
import { WorkspaceFolder } from './workspace-folder'
import { exportDocument, type ExportFormat } from './export-document'
import type { Draft, ImageImport, OpenedDocument } from '../shared/contracts'

const documents = new DocumentAccess()
const workspaceFolder = new WorkspaceFolder()
let drafts: DraftStore
let window: BrowserWindow | null = null
const watchers = new Map<string, FSWatcher>()
const watchTimers = new Map<string, NodeJS.Timeout>()
const documentOperations = new DocumentOperationQueue()
let recent: string[] = []
let closing = false
const pendingSystemPaths = new Set<string>()

function errorPayload(error: unknown): { code: string; message: string } {
  if (error instanceof DocumentError) return { code: error.code, message: error.message }
  if (error instanceof Error) return { code: 'IO_ERROR', message: error.message }
  return { code: 'IO_ERROR', message: String(error) }
}

function register<T extends unknown[], R>(name: string, handler: (...args: T) => Promise<R>): void {
  ipcMain.handle(name, async (event, ...args: T) => {
    if (!window || event.sender !== window.webContents) return { ok: false, error: { code: 'FORBIDDEN', message: '无效的窗口请求' } }
    try { return { ok: true, value: await handler(...args) } }
    catch (error) { return { ok: false, error: errorPayload(error) } }
  })
}

async function remember(path: string): Promise<void> {
  recent = [path, ...recent.filter(item => item !== path)].slice(0, 10)
  await writeFile(join(app.getPath('userData'), 'recent.json'), JSON.stringify(recent))
}

function watchDocument(path: string): void {
  stopWatching(path)
  try {
    const watcher = watch(path, () => {
      const previous = watchTimers.get(path)
      if (previous) clearTimeout(previous)
      watchTimers.set(path, setTimeout(async () => {
        watchTimers.delete(path)
        if (!documents.isOpen(path)) return
        try {
          const disk = await readDocument(path)
          if (disk.fingerprint !== documents.fingerprint(path)) window?.webContents.send('external-change', path)
        } catch { window?.webContents.send('external-change', path) }
      }, 250))
    })
    watchers.set(path, watcher)
  } catch { /* Saving still checks the fingerprint before replacing the file. */ }
}

function stopWatching(path: string): void {
  watchers.get(path)?.close()
  watchers.delete(path)
  const timer = watchTimers.get(path)
  if (timer) clearTimeout(timer)
  watchTimers.delete(path)
}

async function activate(path: string): Promise<OpenedDocument> {
  const opened = await documents.open(path)
  await remember(opened.path)
  watchDocument(opened.path)
  return opened
}

function requestedFile(path: string): void {
  pendingSystemPaths.add(path)
  if (window && !window.webContents.isLoading()) window.webContents.send('open-file', path)
}

function createWindow(): void {
  closing = false
  window = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 760,
    minHeight: 520,
    title: 'MDEdit',
    backgroundColor: '#f7f8fa',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('did-finish-load', () => {
    for (const path of pendingSystemPaths) window?.webContents.send('open-file', path)
  })
  window.on('close', event => {
    if (closing) return
    event.preventDefault()
    window?.webContents.send('before-close')
  })
  window.on('closed', () => {
    window = null
    for (const path of watchers.keys()) stopWatching(path)
    documents.closeAll()
    workspaceFolder.clear()
  })
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void window.loadURL(devUrl)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}

app.on('open-file', (event, path) => { event.preventDefault(); requestedFile(path) })
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', (_event, argv) => {
    const path = argv.find(arg => /\.md$/i.test(arg))
    if (path) requestedFile(path)
    window?.show()
    window?.focus()
  })
  void app.whenReady().then(async () => {
    await mkdir(app.getPath('userData'), { recursive: true })
    drafts = new DraftStore(join(app.getPath('userData'), 'drafts'))
    try { recent = JSON.parse(await readFile(join(app.getPath('userData'), 'recent.json'), 'utf8')) as string[] }
    catch { recent = [] }
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    createWindow()
    const cliPath = process.argv.slice(1).find(arg => /\.md$/i.test(arg))
    if (cliPath) requestedFile(cliPath)
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })
}

register('choose-workspace-folder', async () => {
  const result = await dialog.showOpenDialog(window!, { properties: ['openDirectory'] })
  return result.canceled ? null : workspaceFolder.select(result.filePaths[0])
})
register('list-workspace-directory', async (path: string) => workspaceFolder.list(path))
register('open-workspace-document', async (path: string) => {
  const opened = documents.openSnapshot(await workspaceFolder.openDocument(path))
  await remember(opened.path)
  watchDocument(opened.path)
  return opened
})
register('search-workspace', async (query: string) => workspaceFolder.search(query))
register('close-workspace-folder', async () => { workspaceFolder.clear() })
register('choose-open', async () => {
  const result = await dialog.showOpenDialog(window!, { properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md'] }] })
  return result.canceled ? null : activate(result.filePaths[0])
})
register('open-recent', async (path: string) => {
  if (!recent.includes(path)) throw new DocumentError('FORBIDDEN', '文件不在最近列表中')
  return activate(path)
})
register('open-system-file', async (path: string) => {
  if (!pendingSystemPaths.delete(path)) throw new DocumentError('FORBIDDEN', '文件不是系统打开请求')
  return activate(path)
})
register('open-relative', async (basePath: string, path: string) => {
  const opened = await documents.openRelative(basePath, path)
  await remember(opened.path)
  watchDocument(opened.path)
  return opened
})
register('choose-save', async (text: string, format: { hasBom: boolean; lineEnding: 'lf' | 'crlf' | 'mixed' }, sourcePath: string | null) => {
  if (sourcePath && !documents.isOpen(sourcePath)) throw new DocumentError('FORBIDDEN', '文档未打开')
  const result = await dialog.showSaveDialog(window!, {
    defaultPath: sourcePath ? basename(sourcePath).replace(/\.md$/i, '-copy.md') : '未命名.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  })
  if (result.canceled || !result.filePath) return null
  const opened = await documents.create(result.filePath, text, {
    hasBom: format.hasBom,
    lineEnding: format.lineEnding === 'mixed' ? 'lf' : format.lineEnding
  })
  await remember(opened.path)
  watchDocument(opened.path)
  return opened
})
register('export-document', async (format: ExportFormat, title: string, body: string) => exportDocument(window!, format, title, body))
register('save', async (path: string, text: string, revision: number, editedAt: number, allowMixed: boolean) => {
  const result = await documentOperations.run(async () => {
    documents.assertOpen(path)
    await drafts.write({ key: path, path, text, fingerprint: documents.fingerprint(path), revision, updatedAt: editedAt })
    return documents.save(path, text, allowMixed)
  })
  if (documents.isOpen(path) && window) watchDocument(path)
  return result
})
register('write-draft', async (draft: Draft) => {
  const validKey = draft.path ? draft.key === draft.path : draft.key === 'untitled' || /^untitled:[0-9a-f-]{36}$/.test(draft.key)
  if (typeof draft.text !== 'string' || draft.text.length > 50_000_000 || !validKey || !Number.isSafeInteger(draft.revision) || !Number.isFinite(draft.updatedAt)) {
    throw new DocumentError('INVALID_DRAFT', '草稿数据无效')
  }
  if (draft.path) documents.assertOpen(draft.path)
  await drafts.write(draft)
})
register('list-drafts', async () => {
  const items = await drafts.list()
  const recoverable: Draft[] = []
  for (const draft of items) {
    if (draft.path) {
      try {
        const disk = await readDocument(draft.path)
        if (disk.text === draft.text) {
          await drafts.delete(draft.key, { revision: draft.revision, updatedAt: draft.updatedAt })
          continue
        }
        recoverable.push({ ...draft, diskModifiedAt: disk.modifiedAt })
        continue
      } catch { /* Missing files still have recoverable drafts. */ }
    }
    recoverable.push({ ...draft, diskModifiedAt: draft.path ? null : undefined })
  }
  return recoverable
})
register('open-draft', async (path: string) => {
  if (!(await drafts.list()).some(draft => draft.path === path)) throw new DocumentError('FORBIDDEN', '没有该文档的恢复草稿')
  return activate(path)
})
register('reload-document', async (path: string) => {
  const opened = await documentOperations.run(() => documents.reload(path))
  if (documents.isOpen(path) && window) watchDocument(path)
  return opened
})
register('delete-draft', async (key: string, expected?: { revision: number; updatedAt: number }) => drafts.delete(key, expected))
register('recent-files', async () => recent)
register('read-image', async (basePath: string, relativePath: string) => documents.readImage(basePath, relativePath))
register('import-images', async (basePath: string, images: ImageImport[]) => documentOperations.run(() => documents.importImages(basePath, images)))
register('release-document', async (path: string) => {
  await documentOperations.run(async () => {
    stopWatching(path)
    documents.close(path)
  })
})
register('open-external', async (url: string) => {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new DocumentError('FORBIDDEN', '只允许打开 HTTPS 链接')
  await shell.openExternal(parsed.toString())
})

ipcMain.on('close-ready', event => {
  if (window && event.sender === window.webContents && !closing) { closing = true; window.close() }
})
