import { describe, expect, it } from 'vitest'
import { newSession, type DocumentSession } from '../src/renderer/session'
import { activateTab, closeTab, initialWorkspace, openTab, replaceTab, tabIndexForKey, updateTab } from '../src/renderer/tabs'

function document(path: string | null, text = ''): DocumentSession {
  const session = newSession(text)
  return path === null ? session : { ...session, path, draftKey: path }
}

describe('tab workspace', () => {
  it('starts with one unnamed active document', () => {
    const workspace = initialWorkspace()
    expect(workspace.tabs).toHaveLength(1)
    expect(workspace.activeId).toBe(workspace.tabs[0].id)
    expect(workspace.tabs[0].path).toBeNull()
  })

  it('opens a new session and makes it active', () => {
    const first = initialWorkspace()
    const second = document('/tmp/second.md', 'second')
    const workspace = openTab(first, second)
    expect(workspace.tabs).toEqual([...first.tabs, second])
    expect(workspace.activeId).toBe(second.id)
  })

  it('focuses an existing tab when opening the same path', () => {
    const original = document('/tmp/same.md', 'unsaved')
    const workspace = { tabs: [original, document('/tmp/other.md')], activeId: original.id }
    const duplicate = document('/tmp/same.md', 'disk version')
    const result = openTab(workspace, duplicate)
    expect(result.tabs).toEqual(workspace.tabs)
    expect(result.activeId).toBe(original.id)
  })

  it('updates a background document without switching active tabs', () => {
    const active = document('/tmp/active.md')
    const background = document('/tmp/background.md', 'before')
    const workspace = { tabs: [active, background], activeId: active.id }
    const result = updateTab(workspace, background.id, session => ({ ...session, text: 'after', saveState: 'error', error: 'failed' }))
    expect(result.activeId).toBe(active.id)
    expect(result.tabs[1]).toMatchObject({ text: 'after', saveState: 'error', error: 'failed' })
    expect(workspace.tabs[1].text).toBe('before')
  })

  it('activates only an existing tab', () => {
    const workspace = initialWorkspace()
    expect(activateTab(workspace, -1)).toBe(workspace)
  })

  it('replaces the selected session and keeps its tab active', () => {
    const current = document('/tmp/current.md', 'old')
    const workspace = { tabs: [current], activeId: current.id }
    const replacement = document('/tmp/replacement.md', 'new')
    const result = replaceTab(workspace, current.id, replacement)
    expect(result.tabs).toEqual([replacement])
    expect(result.activeId).toBe(replacement.id)
  })

  it('chooses the right neighbor when closing the active tab', () => {
    const left = document('/tmp/left.md')
    const active = document('/tmp/active.md')
    const right = document('/tmp/right.md')
    const result = closeTab({ tabs: [left, active, right], activeId: active.id }, active.id)
    expect(result.tabs).toEqual([left, right])
    expect(result.activeId).toBe(right.id)
  })

  it('chooses the left neighbor when closing the last tab', () => {
    const left = document('/tmp/left.md')
    const active = document('/tmp/active.md')
    const result = closeTab({ tabs: [left, active], activeId: active.id }, active.id)
    expect(result.activeId).toBe(left.id)
  })

  it('creates a fresh unnamed document when the last tab closes', () => {
    const only = document('/tmp/only.md')
    const result = closeTab({ tabs: [only], activeId: only.id }, only.id)
    expect(result.tabs).toHaveLength(1)
    expect(result.tabs[0].path).toBeNull()
    expect(result.activeId).toBe(result.tabs[0].id)
  })

  it('leaves workspace unchanged when closing a missing tab', () => {
    const workspace = initialWorkspace()
    expect(closeTab(workspace, -1)).toBe(workspace)
  })

  it('moves through tabs with arrow, Home and End keys', () => {
    expect(tabIndexForKey(3, 0, 'ArrowLeft')).toBe(2)
    expect(tabIndexForKey(3, 2, 'ArrowRight')).toBe(0)
    expect(tabIndexForKey(3, 1, 'Home')).toBe(0)
    expect(tabIndexForKey(3, 1, 'End')).toBe(2)
    expect(tabIndexForKey(3, 1, 'Enter')).toBeNull()
  })
})
