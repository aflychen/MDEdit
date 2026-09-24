import { app, BrowserWindow, dialog, ipcMain, shell, session } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readLocalImage, resolveLocalResource } from './assets'
import { DocumentError, DocumentStore, readDocument } from './document-io'
import { DraftStore } from './drafts'
import type { Draft, OpenedDocument } from '../shared/contracts'

const documents = new DocumentStore()
let drafts: DraftStore
let window: BrowserWindow | null = null
let activePath: string | null = null
let watcher: FSWatcher | null = null
let watchTimer: NodeJS.Timeout | null = null
let saveQueue: Promise<unknown> = Promise.resolve()
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
  watcher?.close()
  if (watchTimer) clearTimeout(watchTimer)
  try {
    watcher = watch(path, () => {
      if (watchTimer) clearTimeout(watchTimer)
      watchTimer = setTimeout(async () => {
        try {
          const disk = await readDocument(path)
          if (disk.fingerprint !== documents.fingerprint(path)) window?.webContents.send('external-change', path)
        } catch { window?.webContents.send('external-change', path) }
      }, 250)
    })
  } catch { watcher = null }
}

async function activate(path: string): Promise<OpenedDocument> {
  const opened = await documents.open(path)
  activePath = path
  await remember(path)
  watchDocument(path)
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
  window.on('closed', () => { window = null; watcher?.close() })
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
register('open-relative', async (path: string) => {
  if (!activePath) throw new DocumentError('NO_DOCUMENT', '未命名文档无法打开相对链接')
  const target = await resolveLocalResource(activePath, path)
  if (!/\.md$/i.test(target)) throw new DocumentError('UNSUPPORTED_LINK', '只能在编辑器中打开 Markdown 文件')
  return activate(target)
})
register('choose-save', async (text: string, format: { hasBom: boolean; lineEnding: 'lf' | 'crlf' | 'mixed' }) => {
  const result = await dialog.showSaveDialog(window!, {
    defaultPath: activePath ? basename(activePath).replace(/\.md$/i, '-copy.md') : '未命名.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  })
  if (result.canceled || !result.filePath) return null
  const opened = await documents.create(result.filePath, text, {
    hasBom: format.hasBom,
    lineEnding: format.lineEnding === 'mixed' ? 'lf' : format.lineEnding
  })
  activePath = opened.path
  await remember(opened.path)
  watchDocument(opened.path)
  return opened
})
register('save', async (path: string, text: string, revision: number, editedAt: number, allowMixed: boolean) => {
  if (path !== activePath) throw new DocumentError('FORBIDDEN', '只能保存当前文档')
  const work = saveQueue.catch(() => undefined).then(async () => {
    await drafts.write({ key: path, path, text, fingerprint: documents.fingerprint(path), revision, updatedAt: editedAt })
    return documents.save(path, text, allowMixed)
  })
  saveQueue = work
  const result = await work
  watchDocument(path)
  return result
})
register('write-draft', async (draft: Draft) => {
  const validKey = draft.path ? draft.key === draft.path : draft.key === 'untitled' || /^untitled:[0-9a-f-]{36}$/.test(draft.key)
  if (typeof draft.text !== 'string' || draft.text.length > 50_000_000 || !validKey || !Number.isSafeInteger(draft.revision) || !Number.isFinite(draft.updatedAt)) {
    throw new DocumentError('INVALID_DRAFT', '草稿数据无效')
  }
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
register('delete-draft', async (key: string, expected?: { revision: number; updatedAt: number }) => drafts.delete(key, expected))
register('recent-files', async () => recent)
register('read-image', async (relativePath: string) => {
  if (!activePath) throw new DocumentError('NO_DOCUMENT', '未命名文档无法读取相对图片')
  return readLocalImage(activePath, relativePath)
})
register('open-external', async (url: string) => {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new DocumentError('FORBIDDEN', '只允许打开 HTTPS 链接')
  await shell.openExternal(parsed.toString())
})

ipcMain.on('close-ready', event => {
  if (window && event.sender === window.webContents && !closing) { closing = true; window.close() }
})
