import { useCallback, useEffect, useRef, useState } from 'react'
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { openSearchPanel } from '@codemirror/search'
import type { Draft, OpenedDocument } from '../shared/contracts'
import { applyEdit, beginSave, completeSave, failSave, newSession, sessionFromDocument, type DocumentSession } from './session'

function documentName(path: string | null): string {
  return path ? path.split(/[\\/]/).pop() ?? path : '未命名文档'
}

function statusLabel(session: DocumentSession): string {
  return ({ editing: '编辑中', saving: '正在保存', saved: '已保存', error: '保存失败', conflict: '磁盘冲突' })[session.saveState]
}

function draftFor(session: DocumentSession): Draft {
  return { key: session.draftKey, path: session.path, text: session.text, fingerprint: session.diskFingerprint, revision: session.revision, updatedAt: session.editedAt }
}

export default function App() {
  const [session, setSession] = useState<DocumentSession>(() => newSession())
  const sessionRef = useRef(session)
  const [previewVisible, setPreviewVisible] = useState(true)
  const [html, setHtml] = useState('')
  const [words, setWords] = useState(0)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [recent, setRecent] = useState<string[]>([])
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)
  const editorHost = useRef<HTMLDivElement>(null)
  const previewHost = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorView | null>(null)
  const worker = useRef<Worker | null>(null)
  const syncing = useRef(false)
  const switchLock = useRef(false)
  const pendingOpenPaths = useRef<string[]>([])
  const editability = useRef(new Compartment())
  const latestSave = useRef<{ id: number; revision: number; promise: Promise<boolean> } | null>(null)

  const update = useCallback((next: DocumentSession) => {
    sessionRef.current = next
    setSession(next)
  }, [])

  const beginSwitch = useCallback((): boolean => {
    if (switchLock.current) return false
    switchLock.current = true
    setSwitching(true)
    editor.current?.dispatch({ effects: editability.current.reconfigure(EditorState.readOnly.of(true)) })
    return true
  }, [])

  const endSwitch = useCallback(() => {
    switchLock.current = false
    setSwitching(false)
    editor.current?.dispatch({ effects: editability.current.reconfigure(EditorState.readOnly.of(false)) })
  }, [])

  const setEditorText = useCallback((text: string) => {
    const view = editor.current
    if (!view || view.state.doc.toString() === text) return
    syncing.current = true
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
    syncing.current = false
  }, [])

  const loadDocument = useCallback((opened: OpenedDocument) => {
    update(sessionFromDocument(opened))
    setEditorText(opened.text)
    setNotice(opened.lineEnding === 'mixed' ? '此文件包含混合换行。写回前需要确认统一为 LF，或另存副本。' : null)
    void window.mdedit.recentFiles().then(setRecent)
  }, [setEditorText, update])

  const saveAs = useCallback(async (fromSwitch = false): Promise<boolean> => {
    if (switchLock.current && !fromSwitch) return false
    const snapshot = sessionRef.current
    let resultSessionId = snapshot.id
    try {
      const opened = await window.mdedit.chooseSave(snapshot.text, { hasBom: snapshot.hasBom, lineEnding: snapshot.lineEnding })
      if (!opened) return false
      const current = sessionRef.current
      if (current.id !== snapshot.id) return false
      const next = current.text === snapshot.text ? sessionFromDocument(opened) : applyEdit(sessionFromDocument(opened), current.text)
      update(next)
      resultSessionId = next.id
      if (next.revision !== next.persistedRevision) await window.mdedit.writeDraft(draftFor(next))
      await window.mdedit.deleteDraft(snapshot.draftKey)
      void window.mdedit.recentFiles().then(setRecent)
      setNotice(null)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (sessionRef.current.id === resultSessionId) update(failSave(sessionRef.current, message))
      return false
    }
  }, [update])

  const saveNow = useCallback(async (manual = false): Promise<boolean> => {
    const activeId = sessionRef.current.id
    const inFlight = latestSave.current
    if (inFlight?.id === activeId) {
      if (sessionRef.current.revision <= inFlight.revision) return inFlight.promise
      return inFlight.promise.then(() => sessionRef.current.id === activeId ? saveNow(manual) : false)
    }
    const task = (async () => {
      const snapshot = sessionRef.current
      if (!snapshot.path) return manual ? saveAs(true) : false
      if (snapshot.saveState === 'conflict') return false
      if (snapshot.revision === snapshot.persistedRevision && snapshot.saveState === 'saved') return true
      let allowMixed = false
      if (snapshot.lineEnding === 'mixed') {
        if (!manual) {
          update(failSave(snapshot, '文件包含混合换行，请手动确认转换为 LF 或另存副本'))
          return false
        }
        allowMixed = window.confirm('文件包含混合换行。保存将统一转换为 LF。继续吗？')
        if (!allowMixed) return false
      }
      update(beginSave(snapshot))
      try {
        const result = await window.mdedit.save(snapshot.path, snapshot.text, snapshot.revision, snapshot.editedAt, allowMixed)
        const current = sessionRef.current
        if (current.id !== snapshot.id) return false
        update(completeSave(current, snapshot.revision, result.fingerprint, snapshot.id))
        if (sessionRef.current.id === snapshot.id && sessionRef.current.revision === snapshot.revision) {
          await window.mdedit.deleteDraft(snapshot.draftKey, { revision: snapshot.revision, updatedAt: snapshot.editedAt })
        }
        return true
      } catch (error) {
        if (sessionRef.current.id !== snapshot.id) return false
        const code = error instanceof Error && 'code' in error ? String(error.code) : ''
        const message = error instanceof Error ? error.message : String(error)
        const next = failSave(sessionRef.current, message)
        update(code === 'CONFLICT' ? { ...next, saveState: 'conflict' } : next)
        return false
      }
    })()
    const pending = { id: activeId, revision: sessionRef.current.revision, promise: task }
    latestSave.current = pending
    try { return await task } finally { if (latestSave.current === pending) latestSave.current = null }
  }, [saveAs, update])

  const ensureSwitch = useCallback(async (): Promise<boolean> => {
    const current = sessionRef.current
    if (current.revision === current.persistedRevision && current.saveState === 'saved') return true
    try { await window.mdedit.writeDraft(draftFor(current)) }
    catch (error) { setNotice(`草稿备份失败，无法安全切换文档：${String(error)}`); return false }
    if (await saveNow(true)) {
      const latest = sessionRef.current
      if (latest.revision === latest.persistedRevision && latest.saveState === 'saved') return true
    }
    return window.confirm('当前内容已写入恢复草稿。仍要切换文档吗？')
  }, [saveNow])

  const preserveLatest = useCallback(async (sessionId: number): Promise<boolean> => {
    const latest = sessionRef.current
    if (latest.id !== sessionId) return false
    if (latest.revision !== latest.persistedRevision || latest.saveState !== 'saved') {
      try { await window.mdedit.writeDraft(draftFor(latest)) }
      catch (error) { setNotice(`草稿备份失败，无法安全切换文档：${String(error)}`); return false }
    }
    return sessionRef.current.id === sessionId && sessionRef.current.revision === latest.revision
  }, [])

  const openDocument = useCallback(async (operation: () => Promise<OpenedDocument | null>) => {
    if (!beginSwitch()) return
    try {
      if (!(await ensureSwitch())) return
      const sessionId = sessionRef.current.id
      const opened = await operation()
      if (opened && await preserveLatest(sessionId)) loadDocument(opened)
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)) }
    finally { endSwitch() }
  }, [beginSwitch, endSwitch, ensureSwitch, loadDocument, preserveLatest])

  const newDocument = useCallback(async () => {
    if (!beginSwitch()) return
    try {
      if (!(await ensureSwitch()) || !(await preserveLatest(sessionRef.current.id))) return
      update(newSession())
      setEditorText('')
      setNotice(null)
    } finally { endSwitch() }
  }, [beginSwitch, endSwitch, ensureSwitch, preserveLatest, setEditorText, update])

  const restore = useCallback(async (draft: Draft) => {
    if (!beginSwitch()) return
    try {
      if (!(await ensureSwitch())) return
      const sessionId = sessionRef.current.id
      let base = newSession()
      let sourceMissing = false
      if (draft.path) {
        try { base = sessionFromDocument(await window.mdedit.openDraft(draft.path)) }
        catch { sourceMissing = true; setNotice('原文件不可用，草稿将作为未命名文档打开') }
      } else base.draftKey = draft.key
      if (!(await preserveLatest(sessionId))) return
      const restored = applyEdit(base, draft.text)
      if (base.path && draft.fingerprint !== base.diskFingerprint) {
        restored.saveState = 'conflict'
        restored.error = '草稿建立后磁盘文件已改变。请重新载入或将草稿另存副本。'
      }
      update(restored)
      setEditorText(draft.text)
      if (sourceMissing) {
        try {
          await window.mdedit.writeDraft(draftFor(restored))
          await window.mdedit.deleteDraft(draft.key)
        } catch (error) { setNotice(`恢复草稿备份失败：${String(error)}`) }
      }
      setDrafts(items => items.filter(item => item.key !== draft.key))
    } finally { endSwitch() }
  }, [beginSwitch, endSwitch, ensureSwitch, preserveLatest, setEditorText, update])

  const reload = useCallback(async () => {
    if (!beginSwitch()) return
    const current = sessionRef.current
    try {
      if (!current.path) return
      await window.mdedit.writeDraft(draftFor(current))
      const opened = await window.mdedit.openRecent(current.path)
      if (await preserveLatest(current.id)) loadDocument(opened)
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)) }
    finally { endSwitch() }
  }, [beginSwitch, endSwitch, loadDocument, preserveLatest])

  const wrapSelection = useCallback((left: string, right = left) => {
    if (switchLock.current) return
    const view = editor.current
    if (!view) return
    const range = view.state.selection.main
    const selected = view.state.sliceDoc(range.from, range.to)
    const replacement = `${left}${selected || '文本'}${right}`
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: replacement },
      selection: { anchor: range.from + left.length, head: range.from + left.length + (selected || '文本').length }
    })
    view.focus()
  }, [])

  useEffect(() => {
    const host = editorHost.current
    if (!host) return
    const view = new EditorView({
      state: EditorState.create({
        doc: sessionRef.current.text,
        extensions: [
          basicSetup,
          markdown(),
          editability.current.of(EditorState.readOnly.of(false)),
          EditorView.lineWrapping,
          keymap.of([
            { key: 'Mod-b', run: () => { wrapSelection('**'); return true } },
            { key: 'Mod-i', run: () => { wrapSelection('*'); return true } },
            { key: 'Mod-k', run: () => { wrapSelection('[', '](https://)'); return true } }
          ]),
          EditorView.updateListener.of(event => {
            if (event.docChanged && !syncing.current) update(applyEdit(sessionRef.current, event.state.doc.toString()))
            if (event.selectionSet || event.docChanged) {
              const position = event.state.doc.lineAt(event.state.selection.main.head)
              setCursor({ line: position.number, column: event.state.selection.main.head - position.from + 1 })
            }
          })
        ]
      }),
      parent: host
    })
    editor.current = view
    return () => { editor.current = null; view.destroy() }
  }, [update, wrapSelection])

  useEffect(() => {
    const instance = new Worker(new URL('./preview.worker.ts', import.meta.url), { type: 'module' })
    worker.current = instance
    instance.onmessage = (event: MessageEvent<{ revision: number; html?: string; words?: number; error?: string }>) => {
      if (event.data.revision !== sessionRef.current.revision) return
      setPreviewError(event.data.error ?? null)
      setHtml(event.data.html ?? '')
      if (event.data.words !== undefined) setWords(event.data.words)
    }
    return () => { instance.terminate(); worker.current = null }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => worker.current?.postMessage({ revision: session.revision, text: session.text }), 150)
    return () => clearTimeout(timer)
  }, [session.text, session.revision])

  useEffect(() => {
    if (session.revision === session.persistedRevision) return
    const draft = setTimeout(() => {
      void window.mdedit.writeDraft(draftFor(sessionRef.current)).catch(error => setNotice(`草稿备份失败：${String(error)}`))
    }, 500)
    const save = session.path && session.saveState === 'editing' ? setTimeout(() => { void saveNow(false) }, 2000) : null
    return () => { clearTimeout(draft); if (save) clearTimeout(save) }
  }, [session.revision, session.text, session.path, session.saveState, session.persistedRevision, saveNow])

  useEffect(() => {
    const root = previewHost.current
    if (!root) return
    let active = true
    for (const image of Array.from(root.querySelectorAll<HTMLImageElement>('img[data-local-src]'))) {
      const source = image.dataset.localSrc
      if (!source || !session.path) {
        image.replaceWith(Object.assign(document.createElement('span'), { textContent: '保存文件后可预览本地图片', className: 'image-placeholder' }))
        continue
      }
      void window.mdedit.readImage(source).then(data => { if (active) image.src = data }).catch(() => {
        if (active) image.replaceWith(Object.assign(document.createElement('span'), { textContent: `图片无法读取：${image.alt}`, className: 'image-placeholder' }))
      })
    }
    return () => { active = false }
  }, [html, session.path, previewVisible])

  useEffect(() => {
    void window.mdedit.recentFiles().then(setRecent)
    void window.mdedit.listDrafts().then(setDrafts)
    const unlistenOpen = window.mdedit.onOpenFile(path => {
      if (switchLock.current) pendingOpenPaths.current.push(path)
      else void openDocument(() => window.mdedit.openSystemFile(path))
    })
    const unlistenChange = window.mdedit.onExternalChange(path => {
      if (path !== sessionRef.current.path) return
      update({ ...sessionRef.current, saveState: 'conflict', error: '磁盘文件已改变。重新载入或将当前内容另存副本。' })
    })
    const unlistenClose = window.mdedit.onBeforeClose(async () => {
      const current = sessionRef.current
      if (current.revision !== current.persistedRevision) {
        try { await window.mdedit.writeDraft(draftFor(current)) }
        catch (error) { setNotice(`关闭前无法备份草稿：${String(error)}`); throw error }
      }
    })
    const shortcuts = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (switchLock.current) { event.preventDefault(); return }
      const key = event.key.toLowerCase()
      if (key === 's') { event.preventDefault(); void (event.shiftKey ? saveAs() : saveNow(true)) }
      if (key === 'o') { event.preventDefault(); void openDocument(() => window.mdedit.chooseOpen()) }
      if (key === 'n') { event.preventDefault(); void newDocument() }
      if (key === 'f') { event.preventDefault(); if (editor.current) openSearchPanel(editor.current) }
    }
    window.addEventListener('keydown', shortcuts)
    return () => { unlistenOpen(); unlistenChange(); unlistenClose(); window.removeEventListener('keydown', shortcuts) }
  }, [newDocument, openDocument, saveAs, saveNow, update])

  useEffect(() => {
    if (switching || pendingOpenPaths.current.length === 0) return
    const path = pendingOpenPaths.current.shift()!
    void openDocument(() => window.mdedit.openSystemFile(path))
  }, [openDocument, switching])

  const onPreviewClick = (event: React.MouseEvent) => {
    const link = (event.target as HTMLElement).closest('a[href]')
    if (!link) return
    event.preventDefault()
    const href = link.getAttribute('href') ?? ''
    if (href.startsWith('https:')) void window.mdedit.openExternal(href)
    else if (href && !href.includes(':') && !href.startsWith('#')) void openDocument(() => window.mdedit.openRelative(href))
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">M</span><span>MDEdit</span></div>
      <div className="document-title"><strong>{documentName(session.path)}</strong><span className={`save-status status-${session.saveState}`}><i />{statusLabel(session)}</span></div>
      <div className="top-actions">
        <button disabled={switching} onClick={() => void newDocument()} title="新建 (⌘/Ctrl+N)">新建</button>
        <button disabled={switching} onClick={() => void openDocument(() => window.mdedit.chooseOpen())} title="打开 (⌘/Ctrl+O)">打开</button>
        <button disabled={switching} onClick={() => void saveNow(true)} title="保存 (⌘/Ctrl+S)">保存</button>
        <button disabled={switching} className="primary" onClick={() => void saveAs()} title="另存为 (⌘/Ctrl+Shift+S)">另存为</button>
      </div>
    </header>

    {(notice || session.error || session.saveState === 'conflict') && <div className={`notice ${session.saveState === 'conflict' ? 'notice-conflict' : ''}`}>
      <span>{notice || session.error}</span>
      {session.saveState === 'conflict' ? <div><button disabled={switching} onClick={() => void reload()}>重新载入磁盘文件</button><button disabled={switching} onClick={() => void saveAs()}>将当前内容另存副本</button></div> : session.saveState === 'error' ? <div><button disabled={switching} onClick={() => void saveNow(true)}>重试</button><button disabled={switching} onClick={() => void saveAs()}>另存为</button></div> : null}
      {notice && <button className="plain" onClick={() => setNotice(null)}>×</button>}
    </div>}

    {drafts.length > 0 && <div className="recovery-strip"><span>发现 {drafts.length} 份可恢复草稿</span>{drafts.slice(0, 3).map(draft => <button disabled={switching} key={draft.key} onClick={() => void restore(draft)}>恢复 {documentName(draft.path)} · 草稿 {new Date(draft.updatedAt).toLocaleString()}{draft.path ? ` · 磁盘 ${draft.diskModifiedAt ? new Date(draft.diskModifiedAt).toLocaleString() : '文件不可用'}` : ''}</button>)}<button className="plain" onClick={() => setDrafts([])}>稍后</button></div>}

    <div className="toolbar">
      <div className="tool-group"><button onClick={() => wrapSelection('**')} title="粗体 (⌘/Ctrl+B)"><b>B</b></button><button onClick={() => wrapSelection('*')} title="斜体 (⌘/Ctrl+I)"><i>I</i></button><button onClick={() => wrapSelection('`')} title="行内代码">{'</>'}</button><button onClick={() => wrapSelection('[', '](https://)')} title="链接">🔗</button><button onClick={() => wrapSelection('## ', '')} title="二级标题">H₂</button><button onClick={() => editor.current && openSearchPanel(editor.current)} title="查找与替换 (⌘/Ctrl+F)">⌕</button></div>
      <div className="toolbar-right"><span>Markdown</span><button className={previewVisible ? 'selected' : ''} onClick={() => setPreviewVisible(value => !value)}>{previewVisible ? '隐藏预览' : '显示预览'}</button></div>
    </div>

    <main className={`workspace ${previewVisible ? 'split' : 'editor-only'}`}>
      <section className="editor-pane"><div className="pane-label">编辑器 <span>MARKDOWN</span></div><div className="editor-host" ref={editorHost} /></section>
      {previewVisible && <section className="preview-pane"><div className="pane-label">实时预览 <span>PREVIEW</span></div>{previewError ? <div className="preview-error">预览失败：{previewError}</div> : <div className="preview-content" ref={previewHost} onClick={onPreviewClick} dangerouslySetInnerHTML={{ __html: html }} />}</section>}
    </main>

    <footer className="statusbar"><span>{session.path ?? '本地草稿 · 尚未指定文件'}</span><div><span>{words} 字</span><span>第 {cursor.line} 行，第 {cursor.column} 列</span><span>UTF-8 · {session.lineEnding.toUpperCase()}</span></div></footer>
    {recent.length > 0 && <aside className="recent-menu"><details><summary>最近文件</summary><div>{recent.map(path => <button key={path} onClick={() => void openDocument(() => window.mdedit.openRecent(path))}>{documentName(path)}<small>{path}</small></button>)}</div></details></aside>}
  </div>
}
