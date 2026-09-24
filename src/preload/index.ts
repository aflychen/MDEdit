import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from '../shared/contracts'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = await ipcRenderer.invoke(channel, ...args) as { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
  if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code })
  return result.value
}

const api: DesktopApi = {
  chooseOpen: () => invoke('choose-open'),
  openRecent: path => invoke('open-recent', path),
  openSystemFile: path => invoke('open-system-file', path),
  openRelative: (basePath, path) => invoke('open-relative', basePath, path),
  chooseSave: (text, format, sourcePath) => invoke('choose-save', text, format, sourcePath),
  save: (path, text, revision, editedAt, allowMixed) => invoke('save', path, text, revision, editedAt, allowMixed),
  writeDraft: draft => invoke('write-draft', draft),
  listDrafts: () => invoke('list-drafts'),
  openDraft: path => invoke('open-draft', path),
  reloadDocument: path => invoke('reload-document', path),
  deleteDraft: (key, expected) => invoke('delete-draft', key, expected),
  recentFiles: () => invoke('recent-files'),
  readImage: (basePath, relativePath) => invoke('read-image', basePath, relativePath),
  releaseDocument: path => invoke('release-document', path),
  openExternal: url => invoke('open-external', url),
  onOpenFile: callback => {
    const listener = (_event: Electron.IpcRendererEvent, path: string) => callback(path)
    ipcRenderer.on('open-file', listener)
    return () => ipcRenderer.removeListener('open-file', listener)
  },
  onExternalChange: callback => {
    const listener = (_event: Electron.IpcRendererEvent, path: string) => callback(path)
    ipcRenderer.on('external-change', listener)
    return () => ipcRenderer.removeListener('external-change', listener)
  },
  onBeforeClose: callback => {
    const listener = () => { void Promise.resolve().then(callback).then(() => ipcRenderer.send('close-ready')).catch(() => undefined) }
    ipcRenderer.on('before-close', listener)
    return () => ipcRenderer.removeListener('before-close', listener)
  }
}

contextBridge.exposeInMainWorld('mdedit', api)
