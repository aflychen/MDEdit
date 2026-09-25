import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { openSearchPanel } from '@codemirror/search'
import iconUrl from '../../assets/icon.svg'
import type { Draft, OpenedDocument, WorkspaceSearchResult } from '../shared/contracts'
import { applyEdit, beginSave, completeSave, failSave, failSaveAs, newSession, sessionFromDocument, type DocumentSession } from './session'
import { activateTab, closeTab, initialWorkspace, openTab, replaceTab, tabIndexForKey, updateTab, type TabWorkspace } from './tabs'
import { blockTemplate, createTable, formatListLines, setHeading, type ListKind, type MarkdownInsertion } from './markdown-commands'
import { precedingIndex } from './outline-navigation'
import type { OutlineHeading } from './preview'
import WorkspaceSidebar from './WorkspaceSidebar'
import { editorTheme } from './editor-theme'
import { parseThemePreference, resolveTheme, type ThemePreference } from './theme'
import { searchResultPosition } from './search-navigation'
import { renderMermaidBlocks } from './mermaid-preview'
import { imageExtension } from '../shared/image-format'

const documentName = (path: string | null) => path ? path.split(/[\\/]/).pop() ?? path : '未命名文档'
const statusLabel = (session: DocumentSession) => ({ editing: '编辑中', saving: '正在保存', saved: '已保存', error: '保存失败', conflict: '磁盘冲突' })[session.saveState]
const needsBackup = (session: DocumentSession) => session.revision !== session.persistedRevision || session.saveState === 'conflict' || session.saveState === 'error'
const draftFor = (session: DocumentSession): Draft => ({ key: session.draftKey, path: session.path, text: session.text, fingerprint: session.diskFingerprint, revision: session.revision, updatedAt: session.editedAt })
const isImageFile = (file: File) => file.type.startsWith('image/') || /\.(?:png|jpe?g|gif|webp|avif)$/i.test(file.name)
const imageAlt = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[\[\]\\\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '图片'
interface PreviewSnapshot { sessionId: number; revision: number; html?: string; outline?: OutlineHeading[]; words?: number; error?: string }
interface EditorSnapshot { state: EditorState; top: number; left: number }

export default function App() {
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const workspaceRef = useRef(workspace)
  const session = workspace.tabs.find(tab => tab.id === workspace.activeId)!
  const [previewVisible, setPreviewVisible] = useState(true)
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    try { return parseThemePreference(localStorage.getItem('mdedit-theme')) }
    catch { return 'system' }
  })
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const resolvedTheme = resolveTheme(themePreference, systemDark)
  const [sidebarView, setSidebarView] = useState<'files' | 'search' | 'outline' | null>('outline')
  const [folderRoot, setFolderRoot] = useState<string | null>(null)
  const [jumpRequest, setJumpRequest] = useState<{ path: string; line: number; column: number } | null>(null)
  const [previews, setPreviews] = useState<Record<number, PreviewSnapshot>>({})
  const previewsRef = useRef(previews)
  const lastPreview = previews[session.id]
  const preview = lastPreview?.revision === session.revision ? lastPreview : undefined
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [recent, setRecent] = useState<string[]>([])
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tableOpen, setTableOpen] = useState(false)
  const [tableColumns, setTableColumns] = useState(3)
  const [tableRows, setTableRows] = useState(2)
  const editorHost = useRef<HTMLDivElement>(null)
  const previewHost = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorView | null>(null)
  const editorId = useRef<number | null>(null)
  const editorStates = useRef(new Map<number, EditorSnapshot>())
  const previewPositions = useRef(new Map<number, number>())
  const editorExtensions = useRef<Extension[]>([])
  const worker = useRef<Worker | null>(null)
  const editability = useRef(new Compartment())
  const editorAppearance = useRef(new Compartment())
  const lockedId = useRef<number | null>(null)
  const operationLock = useRef(false)
  const pendingOpenPaths = useRef<string[]>([])
  const saves = useRef(new Map<number, { revision: number; promise: Promise<boolean> }>())
  const draftWrites = useRef(new Map<number, Promise<void>>())
  const backedUp = useRef(new Map<number, string>())
  const scrollGuard = useRef(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemTheme = () => setSystemDark(media.matches)
    media.addEventListener('change', updateSystemTheme)
    return () => media.removeEventListener('change', updateSystemTheme)
  }, [])
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    try { localStorage.setItem('mdedit-theme', themePreference) } catch { /* Preference storage may be unavailable. */ }
  }, [resolvedTheme, themePreference])
  useEffect(() => {
    editor.current?.dispatch({ effects: editorAppearance.current.reconfigure(editorTheme(resolvedTheme)) })
  }, [resolvedTheme])

  const changeWorkspace = useCallback((change: (current: TabWorkspace) => TabWorkspace) => {
    const next = change(workspaceRef.current)
    workspaceRef.current = next
    setWorkspace(next)
  }, [])
  const getSession = useCallback((id: number) => workspaceRef.current.tabs.find(tab => tab.id === id), [])
  const update = useCallback((id: number, change: (current: DocumentSession) => DocumentSession) => {
    changeWorkspace(current => updateTab(current, id, change))
  }, [changeWorkspace])
  const beginOperation = useCallback((id: number): boolean => {
    if (operationLock.current) return false
    operationLock.current = true
    lockedId.current = id
    setBusy(true)
    editor.current?.dispatch({ effects: editability.current.reconfigure(EditorState.readOnly.of(true)) })
    return true
  }, [])
  const endOperation = useCallback(() => {
    operationLock.current = false
    lockedId.current = null
    setBusy(false)
    editor.current?.dispatch({ effects: editability.current.reconfigure(EditorState.readOnly.of(false)) })
  }, [])
  const backup = useCallback(async (snapshot: DocumentSession) => {
    // Per-tab serialization prevents an older draft from overwriting a newer revision.
    const previous = draftWrites.current.get(snapshot.id)
    const task = (async () => {
      await previous?.catch(() => undefined)
      await window.mdedit.writeDraft(draftFor(snapshot))
      backedUp.current.set(snapshot.id, `${snapshot.path}:${snapshot.revision}:${snapshot.editedAt}`)
    })()
    draftWrites.current.set(snapshot.id, task)
    try { await task } finally { if (draftWrites.current.get(snapshot.id) === task) draftWrites.current.delete(snapshot.id) }
  }, [])

  const saveAs = useCallback(async (id = workspaceRef.current.activeId): Promise<boolean> => {
    if (!beginOperation(id)) return false
    let original: DocumentSession | undefined
    try {
      await saves.current.get(id)?.promise
      original = getSession(id)
      if (!original) return false
      if (needsBackup(original)) await backup(original)
      await draftWrites.current.get(id)
      const opened = await window.mdedit.chooseSave(original.text, { hasBom: original.hasBom, lineEnding: original.lineEnding }, original.path)
      if (!opened) return false
      const current = getSession(id)
      if (!current || current.path !== original.path) return false
      if (workspaceRef.current.tabs.some(tab => tab.id !== id && tab.path === opened.path)) {
        setNotice('目标文件已在其他标签打开，请选择其他位置。当前内容已保留。')
        return false
      }
      const next: DocumentSession = {
        ...current, path: opened.path, draftKey: opened.path, diskFingerprint: opened.fingerprint,
        hasBom: opened.hasBom, lineEnding: opened.lineEnding, persistedRevision: original.revision,
        saveState: current.revision === original.revision ? 'saved' : 'editing', error: null
      }
      update(id, () => next)
      if (needsBackup(next)) await backup(next)
      await window.mdedit.deleteDraft(original.draftKey, { revision: original.revision, updatedAt: original.editedAt })
      if (original.path && original.path !== opened.path) await window.mdedit.releaseDocument(original.path)
      void window.mdedit.recentFiles().then(setRecent)
      setNotice(null)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (original) update(id, current => failSaveAs(current, message))
      setNotice(`另存为失败：${message}`)
      return false
    } finally { endOperation() }
  }, [backup, beginOperation, endOperation, getSession, update])

  const importImages = useCallback(async (files: File[], view: EditorView, from: number, to: number) => {
    const id = editorId.current
    if (id === null || operationLock.current || files.length === 0) return
    if (files.length > 20 || files.some(file => !file.size || file.size > 10 * 1024 * 1024) || files.reduce((total, file) => total + file.size, 0) > 50 * 1024 * 1024) {
      setNotice('一次最多导入 20 张图片；单张不超过 10 MB，总量不超过 50 MB。')
      return
    }
    if (!beginOperation(id)) return
    let images: { bytes: Uint8Array }[]
    try {
      images = await Promise.all(files.map(async file => ({ bytes: new Uint8Array(await file.arrayBuffer()) })))
      if (images.some(image => !imageExtension(image.bytes))) throw new Error('仅支持 PNG、JPEG、GIF、WebP 和 AVIF 图片')
    } catch (error) {
      setNotice(`导入图片失败：${error instanceof Error ? error.message : String(error)}`)
      return
    } finally { endOperation() }
    if (!getSession(id)?.path && !(await saveAs(id))) return
    if (!beginOperation(id)) return
    try {
      const current = getSession(id)
      if (!current?.path || editor.current !== view || editorId.current !== id) return
      const paths = await window.mdedit.importImages(current.path, images)
      const markdown = paths.map((path, index) => `![${imageAlt(files[index].name)}](${path})`).join('\n')
      view.dispatch({ changes: { from, to, insert: markdown }, selection: { anchor: from + markdown.length } })
      setNotice(null)
      view.focus()
    } catch (error) {
      setNotice(`导入图片失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { endOperation() }
  }, [beginOperation, endOperation, getSession, saveAs])

  const saveNow = useCallback(async function saveDocument(id: number, manual = false): Promise<boolean> {
    if (lockedId.current === id || lockedId.current === -1) return false
    const snapshot = getSession(id)
    if (!snapshot) return false
    const pending = saves.current.get(id)
    if (pending) {
      const saved = await pending.promise
      const latest = getSession(id)
      if (!latest || latest.path !== snapshot.path) return false
      return saved && latest.revision > pending.revision ? saveDocument(id, manual) : saved
    }
    if (!snapshot.path) return manual ? saveAs(id) : false
    if (snapshot.saveState === 'conflict') return false
    if (!needsBackup(snapshot) && snapshot.saveState === 'saved') return true
    let allowMixed = false
    if (snapshot.lineEnding === 'mixed') {
      if (!manual) {
        update(id, current => failSave(current, '文件包含混合换行，请手动确认转换为 LF 或另存副本'))
        return false
      }
      allowMixed = window.confirm('文件包含混合换行。保存将统一转换为 LF。继续吗？')
      if (!allowMixed) return false
    }
    update(id, beginSave)
    const task = (async () => {
      try {
        const result = await window.mdedit.save(snapshot.path!, snapshot.text, snapshot.revision, snapshot.editedAt, allowMixed)
        const current = getSession(id)
        if (!current || current.path !== snapshot.path) return false
        update(id, latest => {
          const completed = completeSave(latest, snapshot.revision, result.fingerprint, id)
          return latest.saveState === 'conflict' ? { ...completed, saveState: 'conflict', error: latest.error } : completed
        })
        await draftWrites.current.get(id)?.catch(() => undefined)
        const latest = getSession(id)
        if (latest?.path === snapshot.path && latest.revision === snapshot.revision && latest.saveState === 'saved') {
          await window.mdedit.deleteDraft(snapshot.draftKey, { revision: snapshot.revision, updatedAt: snapshot.editedAt })
        }
        return true
      } catch (error) {
        const current = getSession(id)
        if (!current || current.path !== snapshot.path) return false
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
        update(id, latest => {
          const failed = failSave(latest, error instanceof Error ? error.message : String(error))
          return code === 'CONFLICT' || latest.saveState === 'conflict' ? { ...failed, saveState: 'conflict' } : failed
        })
        return false
      }
    })()
    const entry = { revision: snapshot.revision, promise: task }
    saves.current.set(id, entry)
    try { return await task } finally { if (saves.current.get(id) === entry) saves.current.delete(id) }
  }, [getSession, saveAs, update])

  const openDocument = useCallback(async (operation: () => Promise<OpenedDocument | null>): Promise<OpenedDocument | null> => {
    if (!beginOperation(workspaceRef.current.activeId)) return null
    try {
      const opened = await operation()
      if (!opened) return null
      changeWorkspace(current => openTab(current, sessionFromDocument(opened)))
      setNotice(opened.lineEnding === 'mixed' ? '此文件包含混合换行。写回前需要确认统一为 LF，或另存副本。' : null)
      void window.mdedit.recentFiles().then(setRecent)
      return opened
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); return null }
    finally { endOperation() }
  }, [beginOperation, changeWorkspace, endOperation])
  const chooseFolder = useCallback(async () => {
    try {
      const root = await window.mdedit.chooseWorkspaceFolder()
      if (root) { setFolderRoot(root); setSidebarView('files'); setNotice(null) }
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)) }
  }, [])
  const closeFolder = useCallback(async () => {
    try { await window.mdedit.closeWorkspaceFolder(); setFolderRoot(null) }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)) }
  }, [])
  const openSearchResult = useCallback(async (result: WorkspaceSearchResult, query: string) => {
    const opened = await openDocument(() => window.mdedit.openWorkspaceDocument(result.path))
    if (!opened) return
    const current = workspaceRef.current.tabs.find(tab => tab.path === opened.path)
    const match = searchResultPosition(result, query, opened, current?.text ?? opened.text)
    if (match) setJumpRequest({ path: opened.path, ...match })
    else setNotice('搜索结果对应的内容已改变，请重新搜索。')
  }, [openDocument])
  const newDocument = useCallback(() => {
    if (operationLock.current) return
    changeWorkspace(current => openTab(current, newSession()))
    setNotice(null)
  }, [changeWorkspace])
  const closeDocument = useCallback(async (id: number) => {
    if (!beginOperation(id)) return
    try {
      await saves.current.get(id)?.promise
      const current = getSession(id)
      if (!current) return
      if (needsBackup(current)) await backup(current)
      await draftWrites.current.get(id)
      if (current.path) await window.mdedit.releaseDocument(current.path)
      changeWorkspace(state => closeTab(state, id))
      editorStates.current.delete(id)
      previewPositions.current.delete(id)
      backedUp.current.delete(id)
      setPreviews(state => { const next = { ...state }; delete next[id]; previewsRef.current = next; return next })
      setNotice(needsBackup(current) ? '已关闭标签，未保存内容可从恢复草稿找回。' : null)
      void window.mdedit.listDrafts().then(setDrafts)
    } catch (error) { setNotice(`无法安全关闭标签，内容仍保留：${String(error)}`) }
    finally { endOperation() }
  }, [backup, beginOperation, changeWorkspace, endOperation, getSession])
  const restore = useCallback(async (draft: Draft) => {
    if (!beginOperation(workspaceRef.current.activeId)) return
    try {
      const existing = workspaceRef.current.tabs.find(tab => tab.draftKey === draft.key)
      let base = newSession()
      let sourceMissing = false
      if (draft.path && !existing) {
        try { base = sessionFromDocument(await window.mdedit.openDraft(draft.path)) }
        catch { sourceMissing = true }
      } else if (!draft.path && !existing) base.draftKey = draft.key
      const restored = applyEdit(base, draft.text)
      if (base.path && draft.fingerprint !== base.diskFingerprint) {
        restored.saveState = 'conflict'
        restored.error = '草稿建立后磁盘文件已改变。请重新载入或将草稿另存副本。'
      }
      await backup(restored)
      changeWorkspace(current => openTab(current, restored))
      if (sourceMissing || existing) setNotice(sourceMissing ? '原文件不可用，草稿已作为未命名文档打开。' : '原文档已在其他标签打开，恢复草稿已作为未命名副本打开。')
      if (restored.draftKey !== draft.key) {
        // An already open dirty document still needs its own independent recovery record.
        const original = existing && getSession(existing.id)
        if (original && needsBackup(original)) await backup(original)
        await window.mdedit.deleteDraft(draft.key, { revision: draft.revision, updatedAt: draft.updatedAt })
      }
      setDrafts(items => items.filter(item => item.key !== draft.key))
    } catch (error) { setNotice(`恢复草稿失败：${String(error)}`) }
    finally { endOperation() }
  }, [backup, beginOperation, changeWorkspace, endOperation, getSession])
  const reload = useCallback(async () => {
    const id = workspaceRef.current.activeId
    if (!beginOperation(id)) return
    try {
      await saves.current.get(id)?.promise
      const current = getSession(id)
      if (!current?.path) return
      await draftWrites.current.get(id)
      if (needsBackup(current)) {
        // The independent key survives subsequent successful saves of this disk document.
        await backup({ ...current, draftKey: `untitled:${crypto.randomUUID()}`, path: null })
      }
      const opened = await window.mdedit.reloadDocument(current.path)
      if (getSession(id)?.path !== current.path) return
      await window.mdedit.deleteDraft(current.draftKey, { revision: current.revision, updatedAt: current.editedAt })
      changeWorkspace(state => replaceTab(state, id, sessionFromDocument(opened)))
      editorStates.current.delete(id)
      previewPositions.current.delete(id)
      setNotice(null)
      void window.mdedit.listDrafts().then(setDrafts)
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)) }
    finally { endOperation() }
  }, [backup, beginOperation, changeWorkspace, endOperation, getSession])

  const wrapSelection = useCallback((left: string, right = left) => {
    const view = editor.current
    if (!view || operationLock.current) return
    const range = view.state.selection.main
    const text = view.state.sliceDoc(range.from, range.to) || '文本'
    view.dispatch({ changes: { from: range.from, to: range.to, insert: `${left}${text}${right}` }, selection: { anchor: range.from + left.length, head: range.from + left.length + text.length } })
    view.focus()
  }, [])
  const insertBlock = useCallback((insertion: MarkdownInsertion) => {
    const view = editor.current
    if (!view || operationLock.current) return
    const range = view.state.selection.main
    const before = view.state.sliceDoc(0, range.from)
    const after = view.state.sliceDoc(range.to)
    const prefix = before && !before.endsWith('\n\n') ? before.endsWith('\n') ? '\n' : '\n\n' : ''
    const suffix = after && !after.startsWith('\n\n') ? after.startsWith('\n') ? '\n' : '\n\n' : ''
    view.dispatch({ changes: { from: range.from, to: range.to, insert: prefix + insertion.text + suffix }, selection: { anchor: range.from + prefix.length + insertion.selectionStart, head: range.from + prefix.length + insertion.selectionEnd } })
    view.focus()
    setTableOpen(false)
  }, [])
  const changeHeading = useCallback((level: 0 | 1 | 2 | 3 | 4 | 5) => {
    const view = editor.current
    if (!view || operationLock.current) return
    const range = view.state.selection.main
    const first = view.state.doc.lineAt(range.from)
    const last = view.state.doc.lineAt(range.to > range.from && view.state.doc.lineAt(range.to).from === range.to ? range.to - 1 : range.to)
    const changes = []
    for (let number = first.number; number <= last.number; number++) {
      const line = view.state.doc.line(number)
      const replacement = setHeading(line.text, level)
      const oldPrefix = line.text.match(/^\s{0,3}(?:#{1,6}(?:\s+|$))?/)?.[0] ?? ''
      const newPrefix = replacement.match(/^\s{0,3}(?:#{1,6}(?:\s+|$))?/)?.[0] ?? ''
      if (line.text !== replacement) changes.push({ from: line.from, to: line.from + oldPrefix.length, insert: newPrefix })
    }
    view.dispatch({ changes })
    view.focus()
  }, [])
  const changeList = useCallback((kind: ListKind) => {
    const view = editor.current
    if (!view || operationLock.current) return
    const range = view.state.selection.main
    const first = view.state.doc.lineAt(range.from)
    const end = range.to > range.from && view.state.doc.lineAt(range.to).from === range.to ? range.to - 1 : range.to
    const last = view.state.doc.lineAt(end)
    const replacement = formatListLines(view.state.sliceDoc(first.from, last.to), kind)
    const marker = replacement.match(/^\s*(?:- \[[ x]\] |- |\d+\. )/)?.[0].length ?? 0
    view.dispatch({ changes: { from: first.from, to: last.to, insert: replacement }, selection: range.empty ? { anchor: first.from + marker } : { anchor: first.from, head: first.from + replacement.length } })
    view.focus()
  }, [])
  const syncPreviewToLine = useCallback((line: number) => {
    const root = previewHost.current
    const id = workspaceRef.current.activeId
    const current = getSession(id)
    const rendered = previewsRef.current[id]
    if (!root || !current || rendered?.revision !== current.revision) return
    const outline = rendered.outline ?? []
    const index = precedingIndex(outline.map(item => item.line), line)
    if (index < 0) { root.scrollTop = 0; return }
    const heading = root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')[index]
    if (heading) root.scrollTop += heading.getBoundingClientRect().top - root.getBoundingClientRect().top - 12
  }, [getSession])
  const jumpToHeading = useCallback((heading: OutlineHeading) => {
    const view = editor.current
    if (!view || operationLock.current) return
    const line = view.state.doc.line(Math.min(heading.line, view.state.doc.lines))
    scrollGuard.current = true
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 12 }) })
    syncPreviewToLine(heading.line)
    view.focus()
    requestAnimationFrame(() => { scrollGuard.current = false })
  }, [syncPreviewToLine])

  useLayoutEffect(() => {
    if (!editorHost.current) return
    editorExtensions.current = [basicSetup, markdown(), editability.current.of(EditorState.readOnly.of(false)), editorAppearance.current.of(editorTheme(resolvedTheme)), EditorView.lineWrapping,
      keymap.of([
        { key: 'Mod-b', run: () => { wrapSelection('**'); return true } },
        { key: 'Mod-i', run: () => { wrapSelection('*'); return true } },
        { key: 'Mod-k', run: () => { wrapSelection('[', '](https://)'); return true } }
      ]),
      EditorView.updateListener.of(event => {
        const id = editorId.current
        if (id === null) return
        if (event.docChanged) update(id, current => applyEdit(current, event.state.doc.toString()))
        if (event.selectionSet || event.docChanged) {
          const line = event.state.doc.lineAt(event.state.selection.main.head)
          setCursor({ line: line.number, column: event.state.selection.main.head - line.from + 1 })
        }
      }),
      EditorView.domEventHandlers({ scroll: (_event, view) => {
        if (scrollGuard.current || editorId.current !== workspaceRef.current.activeId) return
        scrollGuard.current = true
        const position = view.lineBlockAtHeight(Math.max(0, view.scrollDOM.scrollTop)).from
        syncPreviewToLine(view.state.doc.lineAt(position).number)
        requestAnimationFrame(() => { scrollGuard.current = false })
      }, paste: (event, view) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter(isImageFile)
        if (!files.length || operationLock.current) return false
        event.preventDefault()
        const { from, to } = view.state.selection.main
        void importImages(files, view, from, to)
        return true
      }, drop: (event, view) => {
        const files = Array.from(event.dataTransfer?.files ?? []).filter(isImageFile)
        if (!files.length || operationLock.current) return false
        event.preventDefault()
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head
        void importImages(files, view, position, position)
        return true
      } })
    ]
    const active = workspaceRef.current.tabs.find(tab => tab.id === workspaceRef.current.activeId)!
    editorId.current = active.id
    const view = new EditorView({ state: EditorState.create({ doc: active.text, extensions: editorExtensions.current }), parent: editorHost.current })
    editor.current = view
    return () => { editor.current = null; editorId.current = null; view.destroy() }
  }, [importImages, syncPreviewToLine, update, wrapSelection])
  useLayoutEffect(() => {
    const view = editor.current
    if (!view || editorId.current === session.id) return
    const oldId = editorId.current
    if (oldId !== null && getSession(oldId)) editorStates.current.set(oldId, { state: view.state, top: view.scrollDOM.scrollTop, left: view.scrollDOM.scrollLeft })
    const saved = editorStates.current.get(session.id)
    editorId.current = session.id
    scrollGuard.current = true
    view.setState(saved?.state ?? EditorState.create({ doc: session.text, extensions: editorExtensions.current }))
    view.dispatch({ effects: editability.current.reconfigure(EditorState.readOnly.of(operationLock.current)) })
    view.dispatch({ effects: editorAppearance.current.reconfigure(editorTheme(resolvedTheme)) })
    view.scrollDOM.scrollTop = saved?.top ?? 0
    view.scrollDOM.scrollLeft = saved?.left ?? 0
    view.requestMeasure({
      read: () => ({ top: saved?.top ?? 0, left: saved?.left ?? 0 }),
      write: (position, measuredView) => {
        if (editorId.current !== session.id) return
        measuredView.scrollDOM.scrollTop = position.top
        measuredView.scrollDOM.scrollLeft = position.left
      }
    })
    const line = view.state.doc.lineAt(view.state.selection.main.head)
    setCursor({ line: line.number, column: view.state.selection.main.head - line.from + 1 })
    setTableOpen(false)
    requestAnimationFrame(() => { scrollGuard.current = false })
  }, [getSession, resolvedTheme, session.id, session.text])
  useLayoutEffect(() => {
    const view = editor.current
    if (!jumpRequest || !view || jumpRequest.path !== session.path || editorId.current !== session.id) return
    const line = view.state.doc.line(Math.min(Math.max(1, jumpRequest.line), view.state.doc.lines))
    const position = line.from + Math.min(Math.max(0, jumpRequest.column - 1), line.length)
    view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'center' }) })
    view.focus()
    setJumpRequest(null)
  }, [jumpRequest, session.id, session.path])
  useEffect(() => {
    const instance = new Worker(new URL('./preview.worker.ts', import.meta.url), { type: 'module' })
    worker.current = instance
    instance.onmessage = (event: MessageEvent<PreviewSnapshot>) => {
      const result = event.data
      const current = getSession(result.sessionId)
      if (!current || current.revision !== result.revision) return
      setPreviews(state => { const next = { ...state, [result.sessionId]: result }; previewsRef.current = next; return next })
    }
    return () => { instance.terminate(); worker.current = null }
  }, [getSession])
  useEffect(() => {
    const timer = setTimeout(() => worker.current?.postMessage({ sessionId: session.id, revision: session.revision, text: session.text }), 150)
    return () => clearTimeout(timer)
  }, [session.id, session.revision, session.text])
  useEffect(() => {
    const timer = setInterval(() => {
      for (const tab of workspaceRef.current.tabs) {
        if (lockedId.current === -1 || lockedId.current === tab.id || !needsBackup(tab)) continue
        const age = Date.now() - tab.editedAt
        const signature = `${tab.path}:${tab.revision}:${tab.editedAt}`
        if (age >= 500 && backedUp.current.get(tab.id) !== signature && !draftWrites.current.has(tab.id)) void backup(tab).catch(error => setNotice(`${documentName(tab.path)} 草稿备份失败：${String(error)}`))
        if (age >= 2000 && tab.path && tab.saveState === 'editing' && !saves.current.has(tab.id)) void saveNow(tab.id)
      }
    }, 250)
    return () => clearInterval(timer)
  }, [backup, saveNow])
  useLayoutEffect(() => {
    const root = previewHost.current
    if (!root) return
    scrollGuard.current = true
    root.scrollTop = previewPositions.current.get(session.id) ?? 0
    requestAnimationFrame(() => { scrollGuard.current = false })
  }, [session.id, previewVisible, lastPreview?.html, resolvedTheme])
  useEffect(() => {
    const root = previewHost.current
    if (!root) return
    let active = true
    for (const block of Array.from(root.querySelectorAll('pre'))) {
      if (block.querySelector('button[data-copy-code]')) continue
      const button = Object.assign(document.createElement('button'), { textContent: '复制', className: 'copy-code' })
      button.dataset.copyCode = 'true'
      button.setAttribute('aria-label', '复制代码块')
      block.append(button)
    }
    for (const image of Array.from(root.querySelectorAll<HTMLImageElement>('img[data-local-src]'))) {
      const source = image.dataset.localSrc
      if (!source || !session.path) {
        image.replaceWith(Object.assign(document.createElement('span'), { textContent: '保存文件后可预览本地图片', className: 'image-placeholder' }))
        continue
      }
      void window.mdedit.readImage(session.path, source).then(data => { if (active) image.src = data }).catch(() => {
        if (active) image.replaceWith(Object.assign(document.createElement('span'), { textContent: `图片无法读取：${image.alt}`, className: 'image-placeholder' }))
      })
    }
    return () => { active = false }
  }, [lastPreview?.html, session.id, session.path, previewVisible, resolvedTheme])
  useEffect(() => {
    const root = previewHost.current
    if (!root) return
    let active = true
    void renderMermaidBlocks(root, resolvedTheme, () => active).catch(error => {
      if (active) setNotice(`图表预览失败：${error instanceof Error ? error.message : String(error)}`)
    })
    return () => { active = false }
  }, [lastPreview?.html, session.id, previewVisible, resolvedTheme])
  useEffect(() => {
    void window.mdedit.recentFiles().then(setRecent)
    void window.mdedit.listDrafts().then(setDrafts)
    const unlistenOpen = window.mdedit.onOpenFile(path => {
      if (operationLock.current) pendingOpenPaths.current.push(path)
      else void openDocument(() => window.mdedit.openSystemFile(path))
    })
    const unlistenChange = window.mdedit.onExternalChange(path => {
      for (const tab of workspaceRef.current.tabs) if (tab.path === path) update(tab.id, current => ({ ...current, saveState: 'conflict', error: '磁盘文件已改变。重新载入或将当前内容另存副本。' }))
    })
    const unlistenClose = window.mdedit.onBeforeClose(async () => {
      if (!beginOperation(workspaceRef.current.activeId)) throw new Error('请等待当前文件操作完成后再关闭窗口')
      // Freeze automatic work for every tab while the close handshake takes its snapshot.
      lockedId.current = -1
      try {
        await Promise.all([...saves.current.values()].map(item => item.promise))
        await Promise.all(workspaceRef.current.tabs.filter(needsBackup).map(backup))
        await Promise.all([...draftWrites.current.values()])
      } catch (error) { setNotice(`关闭前无法备份草稿：${String(error)}`); throw error }
      finally { endOperation() }
    })
    const shortcuts = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (!['s', 'o', 'n', 'w', 'f', 'tab'].includes(key)) return
      event.preventDefault()
      if (operationLock.current) return
      const current = workspaceRef.current
      if (key === 's') void (event.shiftKey ? saveAs() : saveNow(current.activeId, true))
      if (key === 'o') void openDocument(() => window.mdedit.chooseOpen())
      if (key === 'n') newDocument()
      if (key === 'w') void closeDocument(current.activeId)
      if (key === 'f' && editor.current) openSearchPanel(editor.current)
      if (key === 'tab') {
        const index = current.tabs.findIndex(tab => tab.id === current.activeId)
        const next = (index + (event.shiftKey ? -1 : 1) + current.tabs.length) % current.tabs.length
        changeWorkspace(state => activateTab(state, current.tabs[next].id))
      }
    }
    window.addEventListener('keydown', shortcuts)
    return () => { unlistenOpen(); unlistenChange(); unlistenClose(); window.removeEventListener('keydown', shortcuts) }
  }, [backup, beginOperation, changeWorkspace, closeDocument, endOperation, newDocument, openDocument, saveAs, saveNow, update])
  useEffect(() => {
    if (busy || pendingOpenPaths.current.length === 0) return
    const path = pendingOpenPaths.current.shift()!
    void openDocument(() => window.mdedit.openSystemFile(path))
  }, [busy, openDocument])

  const onPreviewClick = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement
    const copy = target.closest<HTMLButtonElement>('button[data-copy-code]')
    if (copy) {
      void navigator.clipboard.writeText(copy.parentElement?.querySelector('code')?.textContent ?? '').then(() => { if (copy.isConnected) copy.textContent = '已复制' }).catch(error => setNotice(`复制失败：${String(error)}`))
      return
    }
    const link = target.closest('a[href]')
    if (link) {
      event.preventDefault()
      const href = link.getAttribute('href') ?? ''
      if (href.startsWith('https:')) void window.mdedit.openExternal(href).catch(error => setNotice(String(error)))
      else if (href && !href.includes(':') && !href.startsWith('#') && session.path) {
        const basePath = session.path
        void openDocument(() => window.mdedit.openRelative(basePath, href))
      }
      return
    }
    const heading = target.closest('h1,h2,h3,h4,h5,h6')
    if (heading && previewHost.current) {
      const index = Array.from(previewHost.current.querySelectorAll('h1,h2,h3,h4,h5,h6')).indexOf(heading)
      if (preview?.outline?.[index]) jumpToHeading(preview.outline[index])
    }
  }
  const onPreviewScroll = () => {
    const root = previewHost.current
    const view = editor.current
    if (!root || !view) return
    previewPositions.current.set(session.id, root.scrollTop)
    if (scrollGuard.current || !preview?.outline?.length) return
    const headings = Array.from(root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'))
    const index = precedingIndex(headings.map(item => item.getBoundingClientRect().top), root.getBoundingClientRect().top + 24)
    if (index < 0) {
      scrollGuard.current = true
      view.scrollDOM.scrollTop = 0
      requestAnimationFrame(() => { scrollGuard.current = false })
      return
    }
    const heading = preview.outline[index]
    if (!heading) return
    scrollGuard.current = true
    const line = view.state.doc.line(Math.min(heading.line, view.state.doc.lines))
    view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 12 }) })
    requestAnimationFrame(() => { scrollGuard.current = false })
  }
  const headingLevel = (session.text.split('\n')[cursor.line - 1] ?? '').match(/^\s{0,3}(#{1,6})(?:\s+|$)/)?.[1].length ?? 0
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = tabIndexForKey(workspace.tabs.length, index, event.key)
    if (next === null) return
    event.preventDefault()
    const target = event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]
    changeWorkspace(state => activateTab(state, workspace.tabs[next].id))
    target?.focus()
  }
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><img className="brand-mark" src={iconUrl} alt="" /><span>MDEdit</span></div>
      <div className="document-title"><strong>{documentName(session.path)}</strong><span className={`save-status status-${session.saveState}`}><i />{statusLabel(session)}</span></div>
      <div className="top-actions"><button disabled={busy} onClick={newDocument} title="新建 (⌘/Ctrl+N)">新建</button><button disabled={busy} onClick={() => void openDocument(() => window.mdedit.chooseOpen())}>打开</button><button disabled={busy} onClick={() => void chooseFolder()}>打开文件夹</button><button disabled={busy} onClick={() => void saveNow(session.id, true)}>保存</button><button disabled={busy} className="primary" onClick={() => void saveAs()}>另存为</button></div>
    </header>
    <nav className="tabbar" aria-label="文档标签"><div role="tablist">{workspace.tabs.map((tab, index) => <div className={`document-tab ${tab.id === session.id ? 'active' : ''}`} key={tab.id}>
      <button role="tab" tabIndex={tab.id === session.id ? 0 : -1} onKeyDown={event => onTabKeyDown(event, index)} aria-selected={tab.id === session.id} aria-controls="document-editor" disabled={busy} title={`${tab.path ?? '未命名文档'} · ${statusLabel(tab)}`} onClick={() => { changeWorkspace(state => activateTab(state, tab.id)); setNotice(null) }}><span className={`tab-indicator status-${tab.saveState}`} aria-label={statusLabel(tab)}>{tab.saveState === 'conflict' || tab.saveState === 'error' ? '!' : tab.saveState === 'saving' ? '↻' : needsBackup(tab) ? '●' : '○'}</span><span>{documentName(tab.path)}</span></button>
      <button disabled={busy} className="close-tab" aria-label={`关闭 ${documentName(tab.path)}`} title="关闭标签 (⌘/Ctrl+W)" onClick={() => void closeDocument(tab.id)}>×</button>
    </div>)}</div><button disabled={busy} className="new-tab" aria-label="新建文档标签" onClick={newDocument}>＋</button></nav>
    {(notice || session.error) && <div className={`notice ${session.saveState === 'conflict' ? 'notice-conflict' : ''}`}><span>{notice || session.error}</span>{session.saveState === 'conflict' ? <div><button disabled={busy} onClick={() => void reload()}>重新载入磁盘文件</button><button disabled={busy} onClick={() => void saveAs()}>将当前内容另存副本</button></div> : session.saveState === 'error' ? <div><button disabled={busy} onClick={() => void saveNow(session.id, true)}>重试</button><button disabled={busy} onClick={() => void saveAs()}>另存为</button></div> : null}{notice && <button className="plain" onClick={() => setNotice(null)}>×</button>}</div>}
    {drafts.length > 0 && <div className="recovery-strip"><span>发现 {drafts.length} 份可恢复草稿</span>{drafts.map(draft => <button disabled={busy} key={draft.key} onClick={() => void restore(draft)}>恢复 {documentName(draft.path)} · {new Date(draft.updatedAt).toLocaleString()}{draft.path ? ` · 磁盘 ${draft.diskModifiedAt ? new Date(draft.diskModifiedAt).toLocaleString() : '文件不可用'}` : ''}</button>)}<button className="plain" onClick={() => setDrafts([])}>稍后</button></div>}
    <div className="toolbar"><div className="tool-group"><button className={sidebarView === 'files' ? 'selected' : ''} aria-expanded={sidebarView === 'files'} onClick={() => setSidebarView(value => value === 'files' ? null : 'files')}>文件</button><button className={sidebarView === 'search' ? 'selected' : ''} aria-expanded={sidebarView === 'search'} onClick={() => setSidebarView(value => value === 'search' ? null : 'search')}>搜索</button><button className={sidebarView === 'outline' ? 'selected' : ''} aria-expanded={sidebarView === 'outline'} onClick={() => setSidebarView(value => value === 'outline' ? null : 'outline')}>目录</button><select aria-label="标题级别" disabled={busy} value={headingLevel} onChange={event => changeHeading(Number(event.target.value) as 0 | 1 | 2 | 3 | 4 | 5)}><option value={0}>正文</option>{[1, 2, 3, 4, 5].map(level => <option key={level} value={level}>H{level}</option>)}{headingLevel === 6 && <option value={6} disabled>H6（当前）</option>}</select><button disabled={busy} onClick={() => wrapSelection('**')} title="粗体 (⌘/Ctrl+B)"><b>B</b></button><button disabled={busy} onClick={() => wrapSelection('*')} title="斜体 (⌘/Ctrl+I)"><i>I</i></button><button disabled={busy} onClick={() => wrapSelection('`')} title="行内代码">{'</>'}</button><button disabled={busy} onClick={() => wrapSelection('[', '](https://)')} title="链接">链接</button>
      <div className="table-tool"><button disabled={busy} aria-expanded={tableOpen} onClick={() => setTableOpen(value => !value)}>表格</button>{tableOpen && <form className="table-picker" onSubmit={event => { event.preventDefault(); insertBlock(createTable(tableColumns, tableRows)) }}><label>列数<input aria-label="表格列数" type="number" min={1} max={20} required value={tableColumns} onChange={event => setTableColumns(Number(event.target.value))} /></label><label>正文行数<input aria-label="表格正文行数" type="number" min={1} max={100} required value={tableRows} onChange={event => setTableRows(Number(event.target.value))} /></label><button type="submit">插入表格</button><button type="button" onClick={() => setTableOpen(false)}>取消</button></form>}</div>
      <select aria-label="列表格式" disabled={busy} value="" onChange={event => changeList(event.target.value as ListKind)}><option value="" disabled>列表</option><option value="unordered">无序列表</option><option value="ordered">有序列表</option><option value="task">任务列表</option></select><button disabled={busy} onClick={() => insertBlock(blockTemplate('quote'))}>引用</button><button disabled={busy} onClick={() => insertBlock(blockTemplate('code'))}>代码块</button><button onClick={() => editor.current && openSearchPanel(editor.current)} title="查找与替换 (⌘/Ctrl+F)">⌕</button></div><div className="toolbar-right"><select aria-label="外观主题" value={themePreference} onChange={event => setThemePreference(event.target.value as ThemePreference)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select><button className={previewVisible ? 'selected' : ''} onClick={() => setPreviewVisible(value => !value)}>{previewVisible ? '隐藏预览' : '显示预览'}</button></div></div>
    <main className={`workspace ${previewVisible ? 'split' : 'editor-only'} ${sidebarView ? 'with-sidebar' : ''}`}>
      {sidebarView && <WorkspaceSidebar key={folderRoot ?? 'no-folder'} view={sidebarView} root={folderRoot} activePath={session.path} outline={preview?.outline} busy={busy} onChooseFolder={() => void chooseFolder()} onCloseFolder={() => void closeFolder()} onOpenFile={path => void openDocument(() => window.mdedit.openWorkspaceDocument(path))} onOpenResult={(result, query) => void openSearchResult(result, query)} onJumpHeading={jumpToHeading} onClose={() => setSidebarView(null)} />}
      <section className="editor-pane" id="document-editor"><div className="pane-label">编辑器 <span>MARKDOWN</span></div><div className="editor-host" ref={editorHost} /></section>
      {previewVisible && <section className="preview-pane"><div className="pane-label">实时预览 <span>{preview ? 'PREVIEW' : '更新中'}</span></div>{preview?.error ? <div className="preview-error">预览失败：{preview.error}</div> : <div key={`${session.id}-${resolvedTheme}`} className="preview-content" ref={previewHost} onClick={onPreviewClick} onScroll={onPreviewScroll} dangerouslySetInnerHTML={{ __html: lastPreview?.html ?? '' }} />}</section>}
    </main>
    <footer className="statusbar"><span>{session.path ?? '本地草稿 · 尚未指定文件'}</span><div><span>{preview?.words ?? '…'} 字</span><span>第 {cursor.line} 行，第 {cursor.column} 列</span><span>UTF-8 · {session.lineEnding.toUpperCase()}</span></div></footer>
    {recent.length > 0 && <aside className="recent-menu"><details><summary>最近文件</summary><div>{recent.map(path => <button disabled={busy} key={path} onClick={() => void openDocument(() => window.mdedit.openRecent(path))}>{documentName(path)}<small>{path}</small></button>)}</div></details></aside>}
  </div>
}
