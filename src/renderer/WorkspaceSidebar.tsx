import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { WorkspaceEntry, WorkspaceSearchResponse, WorkspaceSearchResult } from '../shared/contracts'
import type { OutlineHeading } from './preview'

type SidebarView = 'files' | 'search' | 'outline'

interface Props {
  view: SidebarView
  root: string | null
  activePath: string | null
  outline: OutlineHeading[] | undefined
  busy: boolean
  onChooseFolder: () => void
  onCloseFolder: () => void
  onOpenFile: (path: string) => void
  onOpenResult: (result: WorkspaceSearchResult, query: string) => void
  onJumpHeading: (heading: OutlineHeading) => void
  onClose: () => void
}

const nameOf = (path: string) => path.split(/[\\/]/).pop() ?? path

function FileNode({ entry, activePath, busy, onOpenFile }: {
  entry: WorkspaceEntry
  activePath: string | null
  busy: boolean
  onOpenFile: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<WorkspaceEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const activeBelow = entry.kind === 'directory' && !!activePath && (activePath.startsWith(`${entry.absolutePath}/`) || activePath.startsWith(`${entry.absolutePath}\\`))

  useEffect(() => {
    if (activeBelow) setExpanded(true)
  }, [activeBelow])
  useEffect(() => {
    if (!expanded || entry.kind !== 'directory' || children) return
    let active = true
    setLoading(true)
    void window.mdedit.listWorkspaceDirectory(entry.path).then(items => {
      if (active) { setChildren(items); setError(null) }
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [expanded, entry.kind, entry.path, children])

  return <li>
    <button className={`tree-entry ${activePath === entry.absolutePath ? 'active' : ''}`} aria-expanded={entry.kind === 'directory' ? expanded : undefined} disabled={busy} onClick={() => entry.kind === 'directory' ? setExpanded(value => !value) : onOpenFile(entry.path)} title={entry.absolutePath}>
      <span aria-hidden="true">{entry.kind === 'directory' ? expanded ? '▾' : '▸' : '·'}</span>{entry.name}
    </button>
    {expanded && entry.kind === 'directory' && <ul className="tree-children">
      {loading && <li className="sidebar-muted">读取中…</li>}
      {error && <li className="sidebar-error">{error}</li>}
      {children?.length === 0 && <li className="sidebar-muted">没有 Markdown 文件</li>}
      {children?.map(item => <FileNode key={item.path} entry={item} activePath={activePath} busy={busy} onOpenFile={onOpenFile} />)}
    </ul>}
  </li>
}

export default function WorkspaceSidebar({ view, root, activePath, outline, busy, onChooseFolder, onCloseFolder, onOpenFile, onOpenResult, onJumpHeading, onClose }: Props) {
  const [entries, setEntries] = useState<WorkspaceEntry[]>([])
  const [treeError, setTreeError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [search, setSearch] = useState<WorkspaceSearchResponse | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const searchRequest = useRef(0)

  useEffect(() => {
    setEntries([])
    setTreeError(null)
    setSearch(null)
    setSubmittedQuery('')
    setSearchError(null)
    searchRequest.current++
    if (!root) return
    let active = true
    void window.mdedit.listWorkspaceDirectory('').then(items => { if (active) setEntries(items) })
      .catch(cause => { if (active) setTreeError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [root])

  async function submitSearch(event: FormEvent) {
    event.preventDefault()
    if (!root || !query.trim() || searching) return
    const request = ++searchRequest.current
    const term = query.trim()
    setSearching(true)
    setSearchError(null)
    try {
      const response = await window.mdedit.searchWorkspace(term)
      if (searchRequest.current === request) { setSearch(response); setSubmittedQuery(term) }
    } catch (cause) {
      if (searchRequest.current === request) setSearchError(cause instanceof Error ? cause.message : String(cause))
    } finally { if (searchRequest.current === request) setSearching(false) }
  }

  const title = { files: '文件', search: '跨文件搜索', outline: '目录' }[view]
  return <aside className="outline-pane workspace-sidebar" aria-label={title}>
    <div className="pane-label">{title}<button aria-label={`收起${title}`} onClick={onClose}>‹</button></div>
    {view === 'outline' && <nav aria-label="当前文档标题">{outline?.length ? outline.map((heading, index) => <button key={`${heading.line}:${index}`} disabled={busy} style={{ paddingLeft: `${14 + (heading.depth - 1) * 12}px` }} onClick={() => onJumpHeading(heading)} title={`H${heading.depth} · 第 ${heading.line} 行`}>{heading.text || '空标题'}</button>) : <p>添加标题后在这里导航</p>}</nav>}
    {view === 'files' && <div className="sidebar-body">
      <div className="folder-actions"><button onClick={onChooseFolder} disabled={busy}>{root ? '切换文件夹' : '选择文件夹'}</button>{root && <button onClick={onCloseFolder} disabled={busy}>关闭文件夹</button>}</div>
      {root && <><p className="folder-name" title={root}>{nameOf(root)}</p>{treeError && <p className="sidebar-error">{treeError}</p>}<ul className="file-tree">{entries.map(entry => <FileNode key={`${root}:${entry.path}`} entry={entry} activePath={activePath} busy={busy} onOpenFile={onOpenFile} />)}</ul>{!treeError && entries.length === 0 && <p className="sidebar-muted">没有 Markdown 文件</p>}</>}
    </div>}
    {view === 'search' && <div className="sidebar-body">
      {!root ? <div className="folder-actions"><button onClick={onChooseFolder} disabled={busy}>选择文件夹后搜索</button></div> : <><form className="workspace-search" onSubmit={event => void submitSearch(event)}><input aria-label="搜索文件夹内的 Markdown" value={query} onChange={event => { searchRequest.current++; setQuery(event.target.value); setSearch(null); setSubmittedQuery(''); setSearching(false) }} placeholder="搜索 Markdown 内容" /><button type="submit" disabled={!query.trim() || searching}>{searching ? '搜索中…' : '搜索'}</button></form>
        {searchError && <p className="sidebar-error">{searchError}</p>}
        {search && <><p className="search-summary">{search.results.length} 条结果{search.truncated ? ' · 仅显示前 100 条' : ''}{search.skipped ? ` · 跳过 ${search.skipped} 项` : ''}</p><ul className="search-results">{search.results.map((result, index) => <li key={`${result.path}:${result.line}:${result.column}:${index}`}><button onClick={() => onOpenResult(result, submittedQuery)} disabled={busy}><strong>{result.path}:{result.line}</strong><span>{result.snippet}</span></button></li>)}</ul></>}
      </>}
    </div>}
  </aside>
}
