import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { WorkspaceEntry, WorkspaceSearchResponse, WorkspaceSearchResult } from '../shared/contracts'
import type { OutlineHeading } from './preview'
import { precedingIndex, visibleOutlineIndices } from './outline-navigation'
import { describeAppError } from '../shared/error-messages'
import { text, type Language } from '../shared/language'

type SidebarView = 'files' | 'search' | 'outline'

interface Props {
  language: Language
  view: SidebarView
  root: string | null
  activePath: string | null
  outline: OutlineHeading[] | undefined
  documentId: number
  activeLine: number
  busy: boolean
  onChooseFolder: () => void
  onCloseFolder: () => void
  onOpenFile: (path: string) => void
  onOpenResult: (result: WorkspaceSearchResult, query: string) => void
  onJumpHeading: (heading: OutlineHeading) => void
  onClose: () => void
}

const nameOf = (path: string) => path.split(/[\\/]/).pop() ?? path

function FileNode({ entry, activePath, busy, onOpenFile, language }: {
  language: Language
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
      {loading && <li className="sidebar-muted">{text(language, 'sidebar.loading')}</li>}
      {error && <li className="sidebar-error">{describeAppError(language, error)}</li>}
      {children?.length === 0 && <li className="sidebar-muted">{text(language, 'sidebar.noMarkdown')}</li>}
      {children?.map(item => <FileNode key={item.path} entry={item} activePath={activePath} busy={busy} onOpenFile={onOpenFile} language={language} />)}
    </ul>}
  </li>
}

export default function WorkspaceSidebar({ language, view, root, activePath, outline, documentId, activeLine, busy, onChooseFolder, onCloseFolder, onOpenFile, onOpenResult, onJumpHeading, onClose }: Props) {
  const [entries, setEntries] = useState<WorkspaceEntry[]>([])
  const [treeError, setTreeError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [search, setSearch] = useState<WorkspaceSearchResponse | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const searchRequest = useRef(0)
  const [outlineQuery, setOutlineQuery] = useState('')
  const [collapsedHeadings, setCollapsedHeadings] = useState<Set<number>>(() => new Set())
  const outlineStructure = (outline ?? []).map(heading => `${heading.depth}:${heading.text}`).join('\n')
  const previousOutlineStructure = useRef<string | null>(null)

  useEffect(() => { previousOutlineStructure.current = null; setOutlineQuery(''); setCollapsedHeadings(new Set()) }, [documentId])
  useEffect(() => {
    if (outline === undefined) return
    if (previousOutlineStructure.current !== null && previousOutlineStructure.current !== outlineStructure) setCollapsedHeadings(new Set())
    previousOutlineStructure.current = outlineStructure
  }, [outline, outlineStructure])

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

  const title = text(language, ({ files: 'sidebar.files', search: 'sidebar.workspaceSearch', outline: 'sidebar.outline' } as const)[view])
  const headings = outline ?? []
  const visibleHeadings = visibleOutlineIndices(headings, outlineQuery, collapsedHeadings)
  const activeHeading = precedingIndex(headings.map(heading => heading.line), activeLine)
  const visibleActiveHeading = visibleHeadings.includes(activeHeading) ? activeHeading : outlineQuery.trim() ? -1 : visibleHeadings.filter(index => index < activeHeading).at(-1) ?? -1
  const toggleHeading = (index: number) => setCollapsedHeadings(current => {
    const next = new Set(current)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    return next
  })
  return <aside className="outline-pane workspace-sidebar" aria-label={title}>
    <div className="pane-label">{title}<button aria-label={text(language, 'sidebar.collapse', { title })} onClick={onClose}>‹</button></div>
    {view === 'outline' && <><div className="outline-controls"><input aria-label={text(language, 'sidebar.filterHeadings')} placeholder={text(language, 'sidebar.filterPlaceholder')} value={outlineQuery} onChange={event => setOutlineQuery(event.target.value)} /></div><nav aria-label={text(language, 'sidebar.documentHeadings')}>{headings.length ? visibleHeadings.length ? visibleHeadings.map(index => {
      const heading = headings[index]
      const hasChildren = headings[index + 1]?.depth > heading.depth
      return <div key={`${heading.line}:${index}`} className="outline-entry" style={{ paddingLeft: `${5 + (heading.depth - 1) * 12}px` }}>
        {hasChildren ? <button className="outline-toggle" type="button" aria-label={text(language, collapsedHeadings.has(index) ? 'sidebar.expandHeading' : 'sidebar.collapseHeading', { title: heading.text || text(language, 'sidebar.emptyHeading') })} aria-expanded={outlineQuery.trim() ? true : !collapsedHeadings.has(index)} disabled={busy || Boolean(outlineQuery.trim())} onClick={() => toggleHeading(index)}>{collapsedHeadings.has(index) && !outlineQuery.trim() ? '▸' : '▾'}</button> : <span className="outline-toggle-spacer" aria-hidden="true" />}
        <button className={`outline-link ${index === visibleActiveHeading ? 'active' : ''}`} aria-current={index === visibleActiveHeading ? 'location' : undefined} disabled={busy} onClick={() => onJumpHeading(heading)} title={text(language, 'sidebar.headingLine', { level: heading.depth, line: heading.line })}>{heading.text || text(language, 'sidebar.emptyHeading')}</button>
      </div>
    }) : <p>{text(language, 'sidebar.noMatchingHeadings')}</p> : <p>{text(language, 'sidebar.addHeading')}</p>}</nav></>}
    {view === 'files' && <div className="sidebar-body">
      <div className="folder-actions"><button onClick={onChooseFolder} disabled={busy}>{text(language, root ? 'sidebar.switchFolder' : 'sidebar.chooseFolder')}</button>{root && <button onClick={onCloseFolder} disabled={busy}>{text(language, 'sidebar.closeFolder')}</button>}</div>
      {root && <><p className="folder-name" title={root}>{nameOf(root)}</p>{treeError && <p className="sidebar-error">{describeAppError(language, treeError)}</p>}<ul className="file-tree">{entries.map(entry => <FileNode key={`${root}:${entry.path}`} entry={entry} activePath={activePath} busy={busy} onOpenFile={onOpenFile} language={language} />)}</ul>{!treeError && entries.length === 0 && <p className="sidebar-muted">{text(language, 'sidebar.noMarkdown')}</p>}</>}
    </div>}
    {view === 'search' && <div className="sidebar-body">
      {!root ? <div className="folder-actions"><button onClick={onChooseFolder} disabled={busy}>{text(language, 'sidebar.chooseFolderToSearch')}</button></div> : <><form className="workspace-search" onSubmit={event => void submitSearch(event)}><input aria-label={text(language, 'sidebar.searchMarkdown')} value={query} onChange={event => { searchRequest.current++; setQuery(event.target.value); setSearch(null); setSubmittedQuery(''); setSearching(false) }} placeholder={text(language, 'sidebar.searchPlaceholder')} /><button type="submit" disabled={!query.trim() || searching}>{text(language, searching ? 'sidebar.searching' : 'sidebar.searchButton')}</button></form>
        {searchError && <p className="sidebar-error">{describeAppError(language, searchError)}</p>}
        {search && <><p className="search-summary">{text(language, 'sidebar.searchResults', { count: search.results.length })}{search.truncated ? ` · ${text(language, 'sidebar.firstHundred')}` : ''}{search.skipped ? ` · ${text(language, 'sidebar.skipped', { count: search.skipped })}` : ''}</p><ul className="search-results">{search.results.map((result, index) => <li key={`${result.path}:${result.line}:${result.column}:${index}`}><button onClick={() => onOpenResult(result, submittedQuery)} disabled={busy}><strong>{result.path}:{result.line}</strong><span>{result.snippet}</span></button></li>)}</ul></>}
      </>}
    </div>}
  </aside>
}
