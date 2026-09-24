import { describe, expect, it } from 'vitest'
import { applyEdit, beginSave, completeSave, failSave, newSession, sessionFromDocument } from '../src/renderer/session'

describe('document session', () => {
  it('keeps a newer edit dirty when an older save finishes', () => {
    let session = newSession('first')
    session = applyEdit(session, 'second')
    const saving = beginSave(session)
    session = applyEdit(saving, 'third')
    session = completeSave(session, saving.revision, 'fingerprint', saving.id)
    expect(session.saveState).toBe('editing')
    expect(session.persistedRevision).toBe(1)
    expect(session.revision).toBe(2)
  })

  it('does not mark a failed save as persisted', () => {
    const session = failSave(beginSave(applyEdit(newSession('a'), 'b')), 'disk full')
    expect(session.persistedRevision).toBe(0)
    expect(session.saveState).toBe('error')
    expect(session.error).toBe('disk full')
  })

  it('records LF after a confirmed save of mixed line endings', () => {
    const opened = { path: '/tmp/note.md', text: 'a\nb', fingerprint: 'old', lineEnding: 'mixed' as const, hasBom: false, modifiedAt: 0 }
    const saving = beginSave(applyEdit(sessionFromDocument(opened), 'a\nnew'))
    const session = completeSave(saving, 1, 'new', saving.id)
    expect(session.lineEnding).toBe('lf')
  })

  it('ignores a save response from a previous document session', () => {
    const previous = applyEdit(newSession('old'), 'old edit')
    const current = newSession('new document')
    expect(completeSave(current, previous.revision, 'old fingerprint', previous.id)).toEqual(current)
  })

  it('keeps a detected disk conflict while the user continues editing', () => {
    const conflict = { ...newSession('mine'), saveState: 'conflict' as const, error: 'disk changed' }
    const edited = applyEdit(conflict, 'newer local edit')
    expect(edited.saveState).toBe('conflict')
    expect(edited.error).toBe('disk changed')
  })

  it('gives separate unnamed documents separate recovery keys', () => {
    const first = newSession()
    const second = newSession()
    expect(first.draftKey).not.toBe(second.draftKey)
    expect(first.draftKey).toMatch(/^untitled:/)
  })
})
