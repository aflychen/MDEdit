import { describe, expect, it } from 'vitest'
import { searchResultPosition } from '../src/renderer/search-navigation'
import type { WorkspaceSearchResult } from '../src/shared/contracts'

const result: WorkspaceSearchResult = { path: 'note.md', absolutePath: '/notes/note.md', line: 2, column: 1, snippet: 'target', fingerprint: 'disk-a' }
const opened = { path: '/notes/note.md', text: 'first\ntarget\ntarget', fingerprint: 'disk-a' }

describe('search result navigation', () => {
  it('uses the recorded position when the disk and buffer still match', () => {
    expect(searchResultPosition(result, 'target', opened, opened.text)).toEqual({ line: 2, column: 1 })
  })

  it('rejects a result if the disk changed since the search', () => {
    expect(searchResultPosition(result, 'target', { ...opened, fingerprint: 'disk-b' }, opened.text)).toBeNull()
  })

  it('does not jump to another identical word after unsaved edits shift the target', () => {
    expect(searchResultPosition(result, 'target', opened, 'inserted\nfirst\ntarget\ntarget')).toBeNull()
  })

  it('allows edits elsewhere when the recorded line is still unchanged', () => {
    expect(searchResultPosition(result, 'target', opened, 'changed\ntarget\ntarget')).toEqual({ line: 2, column: 1 })
  })

  it('rejects an obsolete position even when the fingerprint matches', () => {
    expect(searchResultPosition({ ...result, column: 4 }, 'target', opened, opened.text)).toBeNull()
  })
})
