import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { openSearchPanel, search } from '@codemirror/search'
import { describeAppError, localizeAppError } from '../shared/error-messages'
import { parseLanguage, text, type Language, type MessageKey } from '../shared/language'
import iconUrl from '../../assets/icon.svg'
import type { Draft, OpenedDocument, WorkspaceSearchResult } from '../shared/contracts'
import { applyEdit, beginSave, completeSave, failSave, failSaveAs, newSession, sessionFromDocument, type DocumentSession } from './session'
import { activateTab, closeTab, initialWorkspace, openTab, replaceTab, tabIndexForKey, updateTab, type TabWorkspace } from './tabs'
import { blockTemplate, createTable, formatListLines, setHeading, type ListKind, type MarkdownInsertion } from './markdown-commands'
import { precedingIndex } from './outline-navigation'
import type { OutlineHeading } from './preview'
import WorkspaceSidebar from './WorkspaceSidebar'
import { editorTheme } from './editor-theme'
import { createDocumentSearchPanel, searchLanguage } from './search-panel'
import { parseThemePreference, resolveTheme, type ThemePreference } from './theme'
import { searchResultPosition } from './search-navigation'
import { renderMermaidBlocks } from './mermaid-preview'
import { imageExtension } from '../shared/image-format'
import { focusModeExtension, typewriterModeExtension } from './writing-mode'
import { editTable, navigateTableCell, tableAt, type TableAction, type TableCommand } from './table-editing'
import { DEFAULT_PDF_EXPORT_OPTIONS, parsePdfExportOptions, type PdfExportOptions, type PdfMargin, type PdfPaperSize } from '../shared/pdf-export-options'

const documentName = (path: string | null, language: Language) => path ? path.split(/[\\/]/).pop() ?? path : text(language, 'tabs.untitled')
const draftPreview = (draft: Draft, language: Language) => {
  const lines = draft.text.slice(0, 1600).split(/\r?\n/)
    .map(value => value.trim())
    .filter(value => value && value !== '---' && !value.startsWith('```'))
    .map(value => value.replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, '').trim())
    .filter(Boolean)
  if (draft.path) {
    const directory = draft.path.match(/^(.*)[\\/][^\\/]+$/)?.[1] || draft.path
    return { title: documentName(draft.path, language), detail: directory.split(/[\\/]/).filter(Boolean).slice(-2).join(' / ') || directory }
  }
  const first = lines[0] || text(language, 'recovery.untitled')
  return {
    title: first,
    detail: [first.length > 60 ? first.slice(60, 140) : '', ...lines.slice(1, 3)].filter(Boolean).join(' · ').slice(0, 140)
  }
}
const statusLabel = (session: DocumentSession, language: Language) => text(language, ({ editing: 'status.editing', saving: 'status.saving', saved: 'status.saved', error: 'status.error', conflict: 'status.conflict' } as const)[session.saveState])
const needsBackup = (session: DocumentSession) => session.revision !== session.persistedRevision || session.saveState === 'conflict' || session.saveState === 'error'
const draftFor = (session: DocumentSession): Draft => ({ key: session.draftKey, path: session.path, text: session.text, fingerprint: session.diskFingerprint, revision: session.revision, updatedAt: session.editedAt })
const isImageFile = (file: File) => file.type.startsWith('image/') || /\.(?:png|jpe?g|gif|webp|avif)$/i.test(file.name)
const imageAlt = (name: string, language: Language) => name.replace(/\.[^.]+$/, '').replace(/[\[\]\\\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || text(language, 'common.image')
type AppNotice = { key: MessageKey; values?: Record<string, string | number> } | { raw: string }
const noted = (key: MessageKey, values?: Record<string, string | number>): AppNotice => ({ key, values })
const rawNotice = (error: unknown): AppNotice => ({ raw: error instanceof Error ? error.message : String(error) })
interface PreviewSnapshot { sessionId: number; revision: number; language: Language; html?: string; outline?: OutlineHeading[]; words?: number; error?: string }
interface EditorSnapshot { state: EditorState; top: number; left: number }

function selectedTable(view: EditorView): { source: string; position: number; offset: number } | null {
  const position = view.state.selection.main.head
  const tree = syntaxTree(view.state)
  for (const side of [1, -1] as const) {
    let node: typeof tree.topNode | null = tree.resolveInner(position, side)
    while (node && node.name !== 'Table') node = node.parent
    if (!node) continue
    // A list or blockquote may carry prefixes outside the table node range.
    // Rewriting that range would detach the table from its container.
    if (node.parent?.name !== 'Document') return null
    return { source: view.state.doc.sliceString(node.from, node.to), position: position - node.from, offset: node.from }
  }
  // CodeMirror parses the viewport incrementally and does not recognize every
  // remark-gfm table form. Only the uncommon fallback parses the whole document.
  const doc = view.state.doc
  const currentLine = doc.lineAt(position).number
  let possible = false
  for (let number = currentLine; number > 0; number--) {
    const line = doc.line(number).text
    if (number < currentLine && !line.trim()) break
    if (line.includes('|')) { possible = true; break }
  }
  if (!possible && currentLine < doc.lines) possible = doc.line(currentLine + 1).text.includes('|')
  if (!possible) return null
  const source = doc.toString()
  return tableAt(source, position) ? { source, position, offset: 0 } : null
}

function absoluteTableCommand(command: TableCommand, offset: number): TableCommand {
  return { anchor: command.anchor + offset, changes: command.changes && { from: command.changes.from + offset, to: command.changes.to + offset, insert: command.changes.insert } }
}

function positionMenu(menu: HTMLDetailsElement) {
  const bounds = menu.getBoundingClientRect()
  const below = window.innerHeight - bounds.bottom - 8
  const above = bounds.top - 8
  const openUpward = below < 240 && above > below
  menu.classList.toggle('open-upward', openUpward)
  menu.style.setProperty('--menu-available-height', `${Math.max(64, Math.floor(openUpward ? above : below))}px`)
}

export default function App() {
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const workspaceRef = useRef(workspace)
  const session = workspace.tabs.find(tab => tab.id === workspace.activeId)!
  const [workspaceMode, setWorkspaceMode] = useState<'editor' | 'split' | 'preview'>('split')
  const previewVisible = workspaceMode !== 'editor'
  const [focusMode, setFocusMode] = useState(false)
  const [typewriterMode, setTypewriterMode] = useState(false)
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    try { return parseThemePreference(localStorage.getItem('mdedit-theme')) }
    catch { return 'system' }
  })
  const [language, setLanguage] = useState<Language>(() => {
    try { return parseLanguage(localStorage.getItem('mdedit-language')) }
    catch { return 'en' }
  })
  const languageRef = useRef(language)
  languageRef.current = language
  const t = (key: MessageKey, values?: Record<string, string | number>) => text(language, key, values && 'error' in values ? { ...values, error: localizeAppError(language, String(values.error).replace(/^Error:\s*/, '')) } : values)
  const localizedError = (message: string) => describeAppError(language, message)
  const [pdfOptions, setPdfOptions] = useState<PdfExportOptions>(() => {
    try { return parsePdfExportOptions(JSON.parse(localStorage.getItem('mdedit-pdf-options') ?? 'null')) }
    catch { return { ...DEFAULT_PDF_EXPORT_OPTIONS } }
  })
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const resolvedTheme = resolveTheme(themePreference, systemDark)
  const [sidebarView, setSidebarView] = useState<'files' | 'search' | 'outline' | null>('outline')
  const [folderRoot, setFolderRoot] = useState<string | null>(null)
  const [jumpRequest, setJumpRequest] = useState<{ path: string; line: number; column: number } | null>(null)
  const [previews, setPreviews] = useState<Record<number, PreviewSnapshot>>({})
  const previewsRef = useRef(previews)
  const lastPreview = previews[session.id]
  const preview = lastPreview?.revision === session.revision && lastPreview.language === language ? lastPreview : undefined
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [activeSectionLine, setActiveSectionLine] = useState(1)
  const [recent, setRecent] = useState<string[]>([])
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [notice, setNotice] = useState<AppNotice | null>(null)
  const [busy, setBusy] = useState(false)
  const [tableOpen, setTableOpen] = useState(false)
  const [tableColumns, setTableColumns] = useState(3)
  const [tableRows, setTableRows] = useState(2)
  const fileMenu = useRef<HTMLDetailsElement>(null)
  const insertMenu = useRef<HTMLDetailsElement>(null)
  const viewMenu = useRef<HTMLDetailsElement>(null)
  const recoveryMenu = useRef<HTMLDetailsElement>(null)
  const recoveryFocus = useRef<{ kind: 'delete' | 'clear'; index: number } | null>(null)
  const editorHost = useRef<HTMLDivElement>(null)
  const previewHost = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorView | null>(null)
  const editorId = useRef<number | null>(null)
  const workspaceModeRef = useRef(workspaceMode)
  workspaceModeRef.current = workspaceMode
  const editorStates = useRef(new Map<number, EditorSnapshot>())
  const previewPositions = useRef(new Map<number, number>())
  const editorExtensions = useRef<Extension[]>([])
  const worker = useRef<Worker | null>(null)
  const editability = useRef(new Compartment())
  const editorAppearance = useRef(new Compartment())
  const searchLanguageCompartment = useRef(new Compartment())
  const focusAppearance = useRef(new Compartment())
  const typewriterBehavior = useRef(new Compartment())
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
    document.documentElement.lang = language
    void window.mdedit.setLanguage(language).catch(() => undefined)
    try { localStorage.setItem('mdedit-language', language) } catch { /* Preference storage may be unavailable. */ }
  }, [language])
  useEffect(() => {
    try { localStorage.setItem('mdedit-pdf-options', JSON.stringify(pdfOptions)) } catch { /* Preference storage may be unavailable. */ }
  }, [pdfOptions])
  useEffect(() => {
    editor.current?.dispatch({ effects: searchLanguageCompartment.current.reconfigure(searchLanguage.of(language)) })
  }, [language])
  useEffect(() => {
    editor.current?.dispatch({ effects: editorAppearance.current.reconfigure(editorTheme(resolvedTheme)) })
  }, [resolvedTheme])
  useEffect(() => {
    editor.current?.dispatch({ effects: [
      focusAppearance.current.reconfigure(focusMode ? focusModeExtension : []),
      typewriterBehavior.current.reconfigure(typewriterMode ? typewriterModeExtension : [])
    ] })
  }, [focusMode, typewriterMode])
  useEffect(() => {
    const menus = () => [fileMenu.current, insertMenu.current, viewMenu.current, recoveryMenu.current]
    const onResize = () => menus().forEach(menu => { if (menu?.open) positionMenu(menu) })
    const onPointerDown = (event: PointerEvent) => {
      if (menus().some(menu => menu?.contains(event.target as Node))) return
      menus().forEach(menu => { if (menu) menu.open = false })
      setTableOpen(false)
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const openMenu = menus().find(menu => menu?.open)
      if (!openMenu) return
      event.preventDefault()
      openMenu.open = false
      openMenu.querySelector<HTMLElement>('summary')?.focus()
      setTableOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onEscape)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onEscape)
      window.removeEventListener('resize', onResize)
    }
  }, [])
  useLayoutEffect(() => {
    for (const menu of [fileMenu.current, insertMenu.current, viewMenu.current, recoveryMenu.current]) if (menu?.open) positionMenu(menu)
  }, [notice, session.error, drafts.length])
  useLayoutEffect(() => {
    const next = recoveryFocus.current
    if (!next) return
    recoveryFocus.current = null
    if (drafts.length === 0) { document.querySelector<HTMLButtonElement>('.new-tab')?.focus(); return }
    const menu = recoveryMenu.current
    if (!menu?.open) return
    if (next.kind === 'clear') menu.querySelector<HTMLButtonElement>('.recovery-clear-all')?.focus()
    else {
      const buttons = menu.querySelectorAll<HTMLButtonElement>('.recovery-delete')
      buttons[Math.min(next.index, buttons.length - 1)]?.focus()
    }
  }, [drafts])

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
        setNotice(noted('notice.saveAsCollision'))
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
      setNotice(noted('notice.saveAsFailed', { error: message }))
      return false
    } finally { endOperation() }
  }, [backup, beginOperation, endOperation, getSession, update])

  const exportCurrent = useCallback(async (format: 'html' | 'pdf') => {
    const id = workspaceRef.current.activeId
    if (!beginOperation(id)) return
    try {
      const current = getSession(id)
      if (!current) return
      const { buildExportBody } = await import('./export-content')
      const body = await buildExportBody(current.text, current.path, languageRef.current)
      const target = await window.mdedit.exportDocument(format, documentName(current.path, languageRef.current), body, format === 'pdf' ? pdfOptions : undefined)
      if (target) setNotice(noted('notice.exported', { path: target }))
    } catch (error) {
      setNotice(noted('notice.exportFailed', { format: format.toUpperCase(), error: String(error) }))
    } finally { endOperation() }
  }, [beginOperation, endOperation, getSession, pdfOptions])

  const importImages = useCallback(async (files: File[], view: EditorView, from: number, to: number) => {
    const id = editorId.current
    if (id === null || operationLock.current || files.length === 0) return
    if (files.length > 20 || files.some(file => !file.size || file.size > 10 * 1024 * 1024) || files.reduce((total, file) => total + file.size, 0) > 50 * 1024 * 1024) {
      setNotice(noted('notice.imagesLimit'))
      return
    }
    if (!beginOperation(id)) return
    let images: { bytes: Uint8Array }[]
    try {
      images = await Promise.all(files.map(async file => ({ bytes: new Uint8Array(await file.arrayBuffer()) })))
      if (images.some(image => !imageExtension(image.bytes))) throw new Error(text(languageRef.current, 'notice.imageUnsupported'))
    } catch (error) {
      setNotice(noted('notice.importFailed', { error: String(error) }))
      return
    } finally { endOperation() }
    if (!getSession(id)?.path && !(await saveAs(id))) return
    if (!beginOperation(id)) return
    try {
      const current = getSession(id)
      if (!current?.path || editor.current !== view || editorId.current !== id) return
      const paths = await window.mdedit.importImages(current.path, images)
      const markdown = paths.map((path, index) => `![${imageAlt(files[index].name, languageRef.current)}](${path})`).join('\n')
      view.dispatch({ changes: { from, to, insert: markdown }, selection: { anchor: from + markdown.length } })
      setNotice(null)
      view.focus()
    } catch (error) {
      setNotice(noted('notice.importFailed', { error: String(error) }))
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
        update(id, current => failSave(current, 'MIXED_LINE_ENDING'))
        return false
      }
      allowMixed = window.confirm(text(languageRef.current, 'notice.mixedLineConfirm'))
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
      setNotice(opened.lineEnding === 'mixed' ? noted('notice.mixedLineNotice') : null)
      void window.mdedit.recentFiles().then(setRecent)
      return opened
    } catch (error) { setNotice(rawNotice(error)); return null }
    finally { endOperation() }
  }, [beginOperation, changeWorkspace, endOperation])
  const chooseFolder = useCallback(async () => {
    try {
      const root = await window.mdedit.chooseWorkspaceFolder()
      if (root) { setFolderRoot(root); setSidebarView('files'); setNotice(null) }
    } catch (error) { setNotice(rawNotice(error)) }
  }, [])
  const closeFolder = useCallback(async () => {
    try { await window.mdedit.closeWorkspaceFolder(); setFolderRoot(null) }
    catch (error) { setNotice(rawNotice(error)) }
  }, [])
  const openSearchResult = useCallback(async (result: WorkspaceSearchResult, query: string) => {
    const opened = await openDocument(() => window.mdedit.openWorkspaceDocument(result.path))
    if (!opened) return
    const current = workspaceRef.current.tabs.find(tab => tab.path === opened.path)
    const match = searchResultPosition(result, query, opened, current?.text ?? opened.text)
    if (match) {
      if (workspaceModeRef.current === 'preview') setWorkspaceMode('split')
      setJumpRequest({ path: opened.path, ...match })
    }
    else setNotice(noted('notice.staleSearch'))
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
      setNotice(needsBackup(current) ? noted('notice.closedBackup') : null)
      void window.mdedit.listDrafts().then(setDrafts)
    } catch (error) { setNotice(noted('notice.closeFailed', { error: String(error) })) }
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
        restored.error = 'DRAFT_DISK_CHANGED'
      }
      await backup(restored)
      changeWorkspace(current => openTab(current, restored))
      if (sourceMissing || existing) setNotice(noted(sourceMissing ? 'notice.draftSourceMissing' : 'notice.draftAlreadyOpen'))
      if (restored.draftKey !== draft.key) {
        // An already open dirty document still needs its own independent recovery record.
        const original = existing && getSession(existing.id)
        if (original && needsBackup(original)) await backup(original)
        await window.mdedit.deleteDraft(draft.key, { revision: draft.revision, updatedAt: draft.updatedAt })
      }
      setDrafts(items => items.filter(item => item.key !== draft.key))
    } catch (error) { setNotice(noted('notice.restoreFailed', { error: String(error) })) }
    finally { endOperation() }
  }, [backup, beginOperation, changeWorkspace, endOperation, getSession])
  const deleteRecoveryDrafts = useCallback(async (selected: Draft[], focus: { kind: 'delete' | 'clear'; index: number }) => {
    if (!beginOperation(workspaceRef.current.activeId)) return
    lockedId.current = -1
    try {
      await Promise.allSettled([...draftWrites.current.values()])
      const results = await Promise.allSettled(selected.map(draft => window.mdedit.deleteDraft(draft.key, { revision: draft.revision, updatedAt: draft.updatedAt })))
      const remaining = await window.mdedit.listDrafts()
      recoveryFocus.current = focus
      setDrafts(remaining)
      const failure = results.find(result => result.status === 'rejected')
      if (failure?.status === 'rejected') setNotice(noted('notice.draftDeleteFailed', { error: String(failure.reason) }))
      else if (selected.some(draft => remaining.some(current => current.key === draft.key))) setNotice(noted('notice.draftChangedDuringDelete'))
      else setNotice(null)
    } catch (error) { recoveryFocus.current = null; setNotice(noted('notice.draftDeleteFailed', { error: String(error) })) }
    finally { endOperation() }
  }, [beginOperation, endOperation])
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
    } catch (error) { setNotice(rawNotice(error)) }
    finally { endOperation() }
  }, [backup, beginOperation, changeWorkspace, endOperation, getSession])

  const wrapSelection = useCallback((left: string, right = left) => {
    const view = editor.current
    if (!view || operationLock.current) return
    const range = view.state.selection.main
    const selectedText = view.state.sliceDoc(range.from, range.to) || text(languageRef.current, 'common.text')
    view.dispatch({ changes: { from: range.from, to: range.to, insert: `${left}${selectedText}${right}` }, selection: { anchor: range.from + left.length, head: range.from + left.length + selectedText.length } })
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
  const applyTableCommand = useCallback((view: EditorView, command: TableCommand) => {
    view.dispatch({ ...(command.changes ? { changes: command.changes } : {}), selection: { anchor: command.anchor } })
    view.focus()
  }, [])
  const runTableAction = useCallback((action: TableAction) => {
    const view = editor.current
    if (!view || operationLock.current) return
    const selection = selectedTable(view)
    if (!selection) return
    const command = editTable(selection.source, selection.position, action)
    if (!command) return
    applyTableCommand(view, absoluteTableCommand(command, selection.offset))
    setTableOpen(false)
  }, [applyTableCommand])
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
    if (workspaceModeRef.current === 'preview') {
      setActiveSectionLine(heading.line)
      syncPreviewToLine(heading.line)
      return
    }
    const line = view.state.doc.line(Math.min(heading.line, view.state.doc.lines))
    scrollGuard.current = true
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 12 }) })
    setActiveSectionLine(heading.line)
    syncPreviewToLine(heading.line)
    view.focus()
    requestAnimationFrame(() => { scrollGuard.current = false })
  }, [syncPreviewToLine])

  useLayoutEffect(() => {
    if (!editorHost.current) return
    editorExtensions.current = [basicSetup, markdown(), search({ createPanel: createDocumentSearchPanel }), searchLanguageCompartment.current.of(searchLanguage.of(languageRef.current)), editability.current.of(EditorState.readOnly.of(false)), editorAppearance.current.of(editorTheme(resolvedTheme)), focusAppearance.current.of(focusMode ? focusModeExtension : []), typewriterBehavior.current.of(typewriterMode ? typewriterModeExtension : []), EditorView.lineWrapping,
      Prec.high(keymap.of([
        { key: 'Tab', run: view => {
          if (operationLock.current) return false
          const selection = selectedTable(view)
          if (!selection) return false
          const command = navigateTableCell(selection.source, selection.position)
          if (!command) return false
          applyTableCommand(view, absoluteTableCommand(command, selection.offset))
          return true
        } },
        { key: 'Shift-Tab', run: view => {
          if (operationLock.current) return false
          const selection = selectedTable(view)
          if (!selection) return false
          const command = navigateTableCell(selection.source, selection.position, true)
          if (!command) return false
          applyTableCommand(view, absoluteTableCommand(command, selection.offset))
          return true
        } }
      ])),
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
          setActiveSectionLine(line.number)
        }
      }),
      EditorView.domEventHandlers({ scroll: (_event, view) => {
        if (scrollGuard.current || editorId.current !== workspaceRef.current.activeId) return
        scrollGuard.current = true
        const position = view.lineBlockAtHeight(Math.max(0, view.scrollDOM.scrollTop)).from
        const line = view.state.doc.lineAt(position).number
        setActiveSectionLine(line)
        syncPreviewToLine(line)
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
  }, [applyTableCommand, importImages, syncPreviewToLine, update, wrapSelection])
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
    view.dispatch({ effects: searchLanguageCompartment.current.reconfigure(searchLanguage.of(languageRef.current)) })
    view.dispatch({ effects: focusAppearance.current.reconfigure(focusMode ? focusModeExtension : []) })
    view.dispatch({ effects: typewriterBehavior.current.reconfigure(typewriterMode ? typewriterModeExtension : []) })
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
    setActiveSectionLine(line.number)
    setTableOpen(false)
    requestAnimationFrame(() => { scrollGuard.current = false })
  }, [focusMode, getSession, resolvedTheme, session.id, session.text, typewriterMode])
  useLayoutEffect(() => {
    const view = editor.current
    if (!jumpRequest || !view || jumpRequest.path !== session.path || editorId.current !== session.id) return
    if (workspaceMode === 'preview') { setWorkspaceMode('split'); return }
    const line = view.state.doc.line(Math.min(Math.max(1, jumpRequest.line), view.state.doc.lines))
    const position = line.from + Math.min(Math.max(0, jumpRequest.column - 1), line.length)
    view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'center' }) })
    view.focus()
    setJumpRequest(null)
  }, [jumpRequest, session.id, session.path, workspaceMode])
  useEffect(() => {
    const instance = new Worker(new URL('./preview.worker.ts', import.meta.url), { type: 'module' })
    worker.current = instance
    instance.onmessage = (event: MessageEvent<PreviewSnapshot>) => {
      const result = event.data
      const current = getSession(result.sessionId)
      if (!current || current.revision !== result.revision || result.language !== languageRef.current) return
      setPreviews(state => { const next = { ...state, [result.sessionId]: result }; previewsRef.current = next; return next })
    }
    return () => { instance.terminate(); worker.current = null }
  }, [getSession])
  useEffect(() => {
    const timer = setTimeout(() => worker.current?.postMessage({ sessionId: session.id, revision: session.revision, text: session.text, language }), 150)
    return () => clearTimeout(timer)
  }, [session.id, session.revision, session.text, language])
  useEffect(() => {
    const timer = setInterval(() => {
      for (const tab of workspaceRef.current.tabs) {
        if (lockedId.current === -1 || lockedId.current === tab.id || !needsBackup(tab)) continue
        const age = Date.now() - tab.editedAt
        const signature = `${tab.path}:${tab.revision}:${tab.editedAt}`
        if (age >= 500 && backedUp.current.get(tab.id) !== signature && !draftWrites.current.has(tab.id)) void backup(tab).catch(error => setNotice(noted('notice.draftBackupFailed', { name: documentName(tab.path, languageRef.current), error: String(error) })))
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
  }, [session.id, previewVisible, lastPreview?.html, lastPreview?.language, resolvedTheme, language])
  useLayoutEffect(() => {
    if (workspaceMode !== 'preview') editor.current?.requestMeasure()
  }, [workspaceMode])
  useEffect(() => {
    const root = previewHost.current
    if (!root) return
    let active = true
    for (const block of Array.from(root.querySelectorAll('pre'))) {
      if (block.querySelector('button[data-copy-code]')) continue
      const button = Object.assign(document.createElement('button'), { textContent: text(language, 'pane.copy'), className: 'copy-code' })
      button.dataset.copyCode = 'true'
      button.setAttribute('aria-label', text(language, 'pane.copyCode'))
      block.append(button)
    }
    for (const image of Array.from(root.querySelectorAll<HTMLImageElement>('img[data-local-src]'))) {
      const source = image.dataset.localSrc
      if (!source || !session.path) {
        image.replaceWith(Object.assign(document.createElement('span'), { textContent: text(language, 'pane.imageSaveFirst'), className: 'image-placeholder' }))
        continue
      }
      void window.mdedit.readImage(session.path, source).then(data => { if (active) image.src = data }).catch(() => {
        if (active) image.replaceWith(Object.assign(document.createElement('span'), { textContent: text(language, 'pane.imageUnreadable', { name: image.alt }), className: 'image-placeholder' }))
      })
    }
    return () => { active = false }
  }, [lastPreview?.html, lastPreview?.language, session.id, session.path, previewVisible, resolvedTheme, language])
  useEffect(() => {
    const root = previewHost.current
    if (!root) return
    let active = true
    void renderMermaidBlocks(root, resolvedTheme, () => active, language).catch(error => {
      if (active) setNotice(noted('notice.diagramPreviewFailed', { error: String(error) }))
    })
    return () => { active = false }
  }, [lastPreview?.html, lastPreview?.language, session.id, previewVisible, resolvedTheme, language])
  useEffect(() => {
    void window.mdedit.recentFiles().then(setRecent)
    void window.mdedit.listDrafts().then(setDrafts)
    const unlistenOpen = window.mdedit.onOpenFile(path => {
      if (operationLock.current) pendingOpenPaths.current.push(path)
      else void openDocument(() => window.mdedit.openSystemFile(path))
    })
    const unlistenChange = window.mdedit.onExternalChange(path => {
      for (const tab of workspaceRef.current.tabs) if (tab.path === path) update(tab.id, current => ({ ...current, saveState: 'conflict', error: 'EXTERNAL_CHANGED' }))
    })
    const unlistenClose = window.mdedit.onBeforeClose(async () => {
      if (!beginOperation(workspaceRef.current.activeId)) throw new Error(text(languageRef.current, 'notice.closeBusy'))
      // Freeze automatic work for every tab while the close handshake takes its snapshot.
      lockedId.current = -1
      try {
        await Promise.all([...saves.current.values()].map(item => item.promise))
        await Promise.all(workspaceRef.current.tabs.filter(needsBackup).map(backup))
        await Promise.all([...draftWrites.current.values()])
      } catch (error) { setNotice(noted('notice.beforeCloseBackupFailed', { error: String(error) })); throw error }
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
      if (key === 'f' && editor.current) {
        if (workspaceModeRef.current === 'preview') setWorkspaceMode('split')
        requestAnimationFrame(() => { if (editor.current) openSearchPanel(editor.current) })
      }
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
      void navigator.clipboard.writeText(copy.parentElement?.querySelector('code')?.textContent ?? '').then(() => { if (copy.isConnected) copy.textContent = t('pane.copied') }).catch(error => setNotice(noted('notice.copyFailed', { error: String(error) })))
      return
    }
    const link = target.closest('a[href]')
    if (link) {
      event.preventDefault()
      const href = link.getAttribute('href') ?? ''
      if (href.startsWith('https:')) void window.mdedit.openExternal(href).catch(error => setNotice(rawNotice(error)))
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
      setActiveSectionLine(1)
      if (workspaceMode === 'preview') return
      scrollGuard.current = true
      view.scrollDOM.scrollTop = 0
      requestAnimationFrame(() => { scrollGuard.current = false })
      return
    }
    const heading = preview.outline[index]
    if (!heading) return
    setActiveSectionLine(heading.line)
    if (workspaceMode === 'preview') return
    scrollGuard.current = true
    const line = view.state.doc.line(Math.min(heading.line, view.state.doc.lines))
    view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 12 }) })
    requestAnimationFrame(() => { scrollGuard.current = false })
  }
  const headingLevel = (session.text.split('\n')[cursor.line - 1] ?? '').match(/^\s{0,3}(#{1,6})(?:\s+|$)/)?.[1].length ?? 0
  const tableSelection = tableOpen && editorId.current === session.id && editor.current ? selectedTable(editor.current) : null
  const tableContext = tableSelection ? tableAt(tableSelection.source, tableSelection.position) : null
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = tabIndexForKey(workspace.tabs.length, index, event.key)
    if (next === null) return
    event.preventDefault()
    const target = event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]
    changeWorkspace(state => activateTab(state, workspace.tabs[next].id))
    target?.focus()
  }
  const closeMenus = () => {
    for (const menu of [fileMenu.current, insertMenu.current, viewMenu.current, recoveryMenu.current]) if (menu) menu.open = false
    setTableOpen(false)
  }
  const runFromMenu = (action: () => void) => { closeMenus(); action() }
  const onMenuToggle = (opened: HTMLDetailsElement) => {
    if (!opened.open) return
    positionMenu(opened)
    for (const menu of [fileMenu.current, insertMenu.current, viewMenu.current, recoveryMenu.current]) if (menu && menu !== opened) menu.open = false
    if (opened !== insertMenu.current) setTableOpen(false)
  }
  return <div className={`app-shell mode-${workspaceMode}`}>
    <header className="topbar">
      <div className="brand"><img className="brand-mark" src={iconUrl} alt="" /><span>MDEdit</span></div>
      <span className={`save-status status-${session.saveState}`} role="status" aria-live="polite"><i />{statusLabel(session, language)}</span>
      <div className="top-actions">
        <button disabled={busy} onClick={newDocument} title={`${t('menu.new')} (⌘/Ctrl+N)`}>{t('menu.new')}</button>
        <button disabled={busy} onClick={() => void openDocument(() => window.mdedit.chooseOpen())} title={`${t('menu.open')} (⌘/Ctrl+O)`}>{t('menu.open')}</button>
        <button disabled={busy} className="primary" onClick={() => void saveNow(session.id, true)} title={`${t('menu.save')} (⌘/Ctrl+S)`}>{t('menu.save')}</button>
        <details className="app-menu file-menu" ref={fileMenu} onToggle={event => onMenuToggle(event.currentTarget)}>
          <summary aria-label={t('menu.fileActions')}>{t('menu.file')}</summary>
          <div className="menu-panel">
            <button disabled={busy} onClick={() => runFromMenu(() => void chooseFolder())}>{t('menu.openFolder')}</button>
            <button disabled={busy} onClick={() => runFromMenu(() => void saveAs())}>{t('menu.saveAs')}</button>
            <div className="menu-separator" />
            <button disabled={busy} onClick={() => runFromMenu(() => void exportCurrent('html'))}>{t('menu.exportHtml')}</button>
            <div className="menu-separator" />
            <span className="menu-caption">{t('menu.pdfSettings')}</span>
            <label className="menu-field">{t('menu.paperSize')}<select value={pdfOptions.paperSize} disabled={busy} onChange={event => setPdfOptions(current => ({ ...current, paperSize: event.target.value as PdfPaperSize }))}><option value="A4">A4</option><option value="A5">A5</option><option value="Letter">Letter</option></select></label>
            <label className="menu-field">{t('menu.margin')}<select value={pdfOptions.margin} disabled={busy} onChange={event => setPdfOptions(current => ({ ...current, margin: event.target.value as PdfMargin }))}><option value="narrow">{t('menu.marginNarrow')}</option><option value="normal">{t('menu.marginNormal')}</option><option value="wide">{t('menu.marginWide')}</option></select></label>
            <label className="pdf-page-break"><input type="checkbox" checked={pdfOptions.pageBreakBeforeH1} disabled={busy} onChange={event => setPdfOptions(current => ({ ...current, pageBreakBeforeH1: event.target.checked }))} />{t('menu.pageBreakH1')}</label>
            <button disabled={busy} onClick={() => runFromMenu(() => void exportCurrent('pdf'))}>{t('menu.exportPdf')}</button>
            {recent.length > 0 && <><div className="menu-separator" /><span className="menu-caption">{t('menu.recentFiles')}</span>{recent.map(path => <button disabled={busy} key={path} title={path} onClick={() => runFromMenu(() => void openDocument(() => window.mdedit.openRecent(path)))}>{documentName(path, language)}<small>{path}</small></button>)}</>}
          </div>
        </details>
        <button className="language-toggle" onClick={() => setLanguage(current => current === 'en' ? 'zh-CN' : 'en')} title={t('menu.switchLanguage')} aria-label={t('menu.switchLanguage')}><span aria-hidden="true">🌐</span> {language === 'en' ? '中文' : 'English'}</button>
      </div>
    </header>
    <nav className="tabbar" aria-label={t('tabs.label')}><div role="tablist">{workspace.tabs.map((tab, index) => <div className={`document-tab ${tab.id === session.id ? 'active' : ''}`} key={tab.id}>
      <button role="tab" tabIndex={tab.id === session.id ? 0 : -1} onKeyDown={event => onTabKeyDown(event, index)} aria-selected={tab.id === session.id} aria-controls="document-editor" disabled={busy} title={`${tab.path ?? t('tabs.untitled')} · ${statusLabel(tab, language)}`} onClick={() => { changeWorkspace(state => activateTab(state, tab.id)); setNotice(null) }}><span className={`tab-indicator status-${tab.saveState}`} aria-label={statusLabel(tab, language)}>{tab.saveState === 'conflict' || tab.saveState === 'error' ? '!' : tab.saveState === 'saving' ? '↻' : needsBackup(tab) ? '●' : '○'}</span><span>{documentName(tab.path, language)}</span></button>
      <button disabled={busy} className="close-tab" aria-label={t('tabs.close', { name: documentName(tab.path, language) })} title={t('tabs.closeTitle')} onClick={() => void closeDocument(tab.id)}>×</button>
    </div>)}</div><button disabled={busy} className="new-tab" aria-label={t('tabs.new')} onClick={newDocument}>＋</button>
      {drafts.length > 0 && <details className="app-menu recovery-menu" ref={recoveryMenu} onToggle={event => onMenuToggle(event.currentTarget)}>
        <summary aria-label={t('recovery.count', { count: drafts.length })}>{t('recovery.label')} <strong>{drafts.length}</strong></summary>
        <div className="menu-panel recovery-panel">
          <div className="recovery-heading"><strong>{t('recovery.label')}</strong><button className="recovery-clear-all" disabled={busy} onClick={() => { if (window.confirm(t('recovery.confirmClearAll', { count: drafts.length }))) void deleteRecoveryDrafts(drafts, { kind: 'clear', index: 0 }) }}>{t('recovery.clearAll')}</button></div>
          {drafts.map((draft, index) => {
            const { title, detail } = draftPreview(draft, language)
            const updated = new Date(draft.updatedAt).toLocaleString(language, { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
            const context = `${draft.path ? `, ${t('recovery.path', { path: draft.path })}` : detail ? `, ${detail}` : ''}, ${updated}`
            return <div className="recovery-item" key={draft.key}>
              <button className="recovery-restore" disabled={busy} aria-label={`${t('recovery.restore', { title })}${context}`} title={draft.path ?? title} onClick={() => runFromMenu(() => void restore(draft))}>
                <span className="recovery-title">{title}</span>
                {detail && <span className="recovery-excerpt" title={draft.path ?? detail}>{detail}</span>}
                <small>{draft.path ? (draft.diskModifiedAt === null ? t('recovery.missing') : t('recovery.file')) : t('recovery.untitled')} · {updated} · {t('recovery.characters', { count: draft.text.length })}</small>
              </button>
              <button className="recovery-delete" disabled={busy} aria-label={`${t('recovery.deleteNamed', { title })}${context}`} title={t('recovery.deleteNamed', { title })} onClick={() => { if (window.confirm(t('recovery.confirmDelete', { title: draft.path ?? `${title} · ${updated}` }))) void deleteRecoveryDrafts([draft], { kind: 'delete', index }) }}>{t('recovery.delete')}</button>
            </div>
          })}
        </div>
      </details>}
    </nav>
    {(notice || session.error) && <div className={`notice ${session.saveState === 'conflict' ? 'notice-conflict' : ''}`}><span>{notice ? 'key' in notice ? t(notice.key, notice.values) : localizedError(notice.raw) : session.error === 'MIXED_LINE_ENDING' ? t('notice.mixedLineError') : session.error === 'DRAFT_DISK_CHANGED' ? t('notice.draftDiskChanged') : session.error === 'EXTERNAL_CHANGED' ? t('notice.externalChanged') : session.error ? localizedError(session.error) : null}</span>{session.saveState === 'conflict' ? <div><button disabled={busy} onClick={() => void reload()}>{t('tabs.reloadDisk')}</button><button disabled={busy} onClick={() => void saveAs()}>{t('tabs.saveCopy')}</button></div> : session.saveState === 'error' ? <div><button disabled={busy} onClick={() => void saveNow(session.id, true)}>{t('tabs.retry')}</button><button disabled={busy} onClick={() => void saveAs()}>{t('menu.saveAs')}</button></div> : null}{notice && <button className="plain" onClick={() => setNotice(null)}>×</button>}</div>}
    <div className="toolbar">
      <div className="tool-group sidebar-tools" role="group" aria-label={t('toolbar.sidebar')}>
        <button className={sidebarView === 'files' ? 'selected' : ''} aria-expanded={sidebarView === 'files'} onClick={() => setSidebarView(value => value === 'files' ? null : 'files')}>{t('sidebar.files')}</button>
        <button className={sidebarView === 'search' ? 'selected' : ''} aria-expanded={sidebarView === 'search'} onClick={() => setSidebarView(value => value === 'search' ? null : 'search')}>{t('sidebar.search')}</button>
        <button className={sidebarView === 'outline' ? 'selected' : ''} aria-expanded={sidebarView === 'outline'} onClick={() => setSidebarView(value => value === 'outline' ? null : 'outline')}>{t('sidebar.outline')}</button>
      </div>
      <div className="tool-group format-tools" role="group" aria-label={t('toolbar.format')}>
        <select aria-label={t('toolbar.headingLevel')} disabled={busy} value={headingLevel} onChange={event => changeHeading(Number(event.target.value) as 0 | 1 | 2 | 3 | 4 | 5)}><option value={0}>{t('toolbar.body')}</option>{[1, 2, 3, 4, 5].map(level => <option key={level} value={level}>H{level}</option>)}{headingLevel === 6 && <option value={6} disabled>{t('toolbar.currentH6')}</option>}</select>
        <button disabled={busy} aria-label={t('toolbar.bold')} onClick={() => wrapSelection('**')} title={`${t('toolbar.bold')} (⌘/Ctrl+B)`}><b>B</b></button>
        <button disabled={busy} aria-label={t('toolbar.italic')} onClick={() => wrapSelection('*')} title={`${t('toolbar.italic')} (⌘/Ctrl+I)`}><i>I</i></button>
        <button disabled={busy} onClick={() => wrapSelection('[', '](https://)')}>{t('toolbar.link')}</button>
        <details className="app-menu insert-menu" ref={insertMenu} onToggle={event => onMenuToggle(event.currentTarget)}>
          <summary>{t('menu.insert')}</summary>
          <div className="menu-panel">
            <button disabled={busy} onClick={() => runFromMenu(() => wrapSelection('`'))}>{t('insert.inlineCode')}</button>
            <button disabled={busy} onClick={() => runFromMenu(() => insertBlock(blockTemplate('quote')))}>{t('insert.quote')}</button>
            <button disabled={busy} onClick={() => runFromMenu(() => insertBlock(blockTemplate('code')))}>{t('insert.codeBlock')}</button>
            <label className="menu-field">{t('insert.listFormat')}<select aria-label={t('insert.listFormat')} disabled={busy} value="" onChange={event => runFromMenu(() => changeList(event.target.value as ListKind))}><option value="" disabled>{t('insert.chooseList')}</option><option value="unordered">{t('insert.unordered')}</option><option value="ordered">{t('insert.ordered')}</option><option value="task">{t('insert.task')}</option></select></label>
            <div className="menu-separator" />
            <button disabled={busy} aria-expanded={tableOpen} onClick={() => setTableOpen(value => !value)}>{t('insert.table')} <span aria-hidden="true">{tableOpen ? '▴' : '▾'}</span></button>
            {tableOpen && <div className="table-picker">
              {tableContext && <div className="table-edit-actions">
                <strong>{t('insert.editTable')}</strong>
                {!tableContext.editable && <p>{t('insert.tableCannotEdit')}</p>}
                <div><button type="button" disabled={busy || !tableContext.editable} onClick={() => runFromMenu(() => runTableAction('insert-row'))}>{t('insert.insertRow')}</button><button type="button" disabled={busy || !tableContext.editable || tableContext.row === 0} onClick={() => runFromMenu(() => runTableAction('delete-row'))}>{t('insert.deleteRow')}</button></div>
                <div><button type="button" disabled={busy || !tableContext.editable} onClick={() => runFromMenu(() => runTableAction('insert-column'))}>{t('insert.insertColumn')}</button><button type="button" disabled={busy || !tableContext.editable || tableContext.columns === 1} onClick={() => runFromMenu(() => runTableAction('delete-column'))}>{t('insert.deleteColumn')}</button></div>
                <select aria-label={t('insert.columnAlign')} disabled={busy || !tableContext.editable} value="" onChange={event => runFromMenu(() => runTableAction(event.target.value as TableAction))}><option value="" disabled>{t('insert.setColumnAlign')}</option><option value="align-default">{t('insert.alignDefault')}</option><option value="align-left">{t('insert.alignLeft')}</option><option value="align-center">{t('insert.alignCenter')}</option><option value="align-right">{t('insert.alignRight')}</option></select>
              </div>}
              <form onSubmit={event => { event.preventDefault(); runFromMenu(() => insertBlock(createTable(tableColumns, tableRows, language))) }}><strong>{t('insert.newTable')}</strong><label>{t('insert.columns')}<input aria-label={t('insert.columns')} type="number" min={1} max={20} required value={tableColumns} onChange={event => setTableColumns(Number(event.target.value))} /></label><label>{t('insert.bodyRows')}<input aria-label={t('insert.bodyRows')} type="number" min={1} max={100} required value={tableRows} onChange={event => setTableRows(Number(event.target.value))} /></label><button type="submit">{t('insert.insertTable')}</button><button type="button" onClick={() => setTableOpen(false)}>{t('insert.cancel')}</button></form>
            </div>}
          </div>
        </details>
      </div>
      <div className="toolbar-right">
        <button className="find-tool" onClick={() => { if (workspaceMode === 'preview') setWorkspaceMode('split'); requestAnimationFrame(() => { if (editor.current) openSearchPanel(editor.current) }) }} title={`${t('view.findReplace')} (⌘/Ctrl+F)`} aria-label={t('view.findReplace')}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></svg></button>
        <details className="app-menu view-menu" ref={viewMenu} onToggle={event => onMenuToggle(event.currentTarget)}>
          <summary>{t('menu.view')}</summary>
          <div className="menu-panel">
            <button className={focusMode ? 'selected' : ''} aria-pressed={focusMode} onClick={() => runFromMenu(() => setFocusMode(value => !value))}>{t('view.focusMode')} <span>{focusMode ? '✓' : ''}</span></button>
            <button className={typewriterMode ? 'selected' : ''} aria-pressed={typewriterMode} onClick={() => runFromMenu(() => setTypewriterMode(value => !value))}>{t('view.typewriterMode')} <span>{typewriterMode ? '✓' : ''}</span></button>
            <div className="menu-separator" />
            <label className="menu-field">{t('view.theme')}<select aria-label={t('view.theme')} value={themePreference} onChange={event => runFromMenu(() => setThemePreference(event.target.value as ThemePreference))}><option value="system">{t('view.themeSystem')}</option><option value="light">{t('view.themeLight')}</option><option value="dark">{t('view.themeDark')}</option></select></label>
          </div>
        </details>
        <div className="layout-switch" role="group" aria-label={t('view.layout')}>
          {(['editor', 'split', 'preview'] as const).map(mode => <button key={mode} data-mode={mode} className={workspaceMode === mode ? 'selected' : ''} aria-pressed={workspaceMode === mode} aria-label={mode === 'split' ? t('view.splitDescription') : undefined} title={mode === 'split' ? t('view.splitDescription') : undefined} onClick={() => setWorkspaceMode(mode)}>{t(mode === 'editor' ? 'view.editorOnly' : mode === 'split' ? 'view.splitView' : 'view.previewOnly')}</button>)}
        </div>
      </div>
    </div>
    <main className={`workspace ${workspaceMode === 'editor' ? 'editor-only' : workspaceMode === 'preview' ? 'preview-only' : 'split'} ${sidebarView ? 'with-sidebar' : ''}`}>
      {sidebarView && <WorkspaceSidebar language={language} key={folderRoot ?? 'no-folder'} view={sidebarView} root={folderRoot} activePath={session.path} outline={lastPreview?.outline} documentId={session.id} activeLine={activeSectionLine} busy={busy} onChooseFolder={() => void chooseFolder()} onCloseFolder={() => void closeFolder()} onOpenFile={path => void openDocument(() => window.mdedit.openWorkspaceDocument(path))} onOpenResult={(result, query) => void openSearchResult(result, query)} onJumpHeading={jumpToHeading} onClose={() => setSidebarView(null)} />}
      <section className="editor-pane" id="document-editor"><div className="pane-label">{t('pane.editor')}</div><div className="editor-host" ref={editorHost} /></section>
      {previewVisible && <section className="preview-pane"><div className="pane-label">{t('pane.preview')} {preview ? '' : <span>{t('pane.updating')}</span>}</div>{preview?.error ? <div className="preview-error">{t('pane.previewFailed', { error: preview.error })}</div> : <div key={`${session.id}-${resolvedTheme}-${language}`} className="preview-content" ref={previewHost} onClick={onPreviewClick} onScroll={onPreviewScroll}><article className="preview-article" dangerouslySetInnerHTML={{ __html: lastPreview?.language === language ? lastPreview.html ?? '' : '' }} /></div>}</section>}
    </main>
    <footer className="statusbar"><span>{session.path ?? t('pane.localDraft')}</span><div><span>{t('pane.words', { count: preview?.words ?? '…' })}</span><span>{t('pane.cursor', { line: cursor.line, column: cursor.column })}</span><span>UTF-8 · {session.lineEnding.toUpperCase()}</span></div></footer>
  </div>
}
