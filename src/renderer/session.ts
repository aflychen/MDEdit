import type { LineEnding, SaveState, OpenedDocument } from '../shared/contracts'

export interface DocumentSession {
  id: number
  draftKey: string
  path: string | null
  text: string
  revision: number
  editedAt: number
  persistedRevision: number
  diskFingerprint: string | null
  lineEnding: LineEnding
  hasBom: boolean
  saveState: SaveState
  error: string | null
}

let nextSessionId = 0

export function newSession(text = ''): DocumentSession {
  return { id: ++nextSessionId, draftKey: `untitled:${globalThis.crypto.randomUUID()}`, path: null, text, revision: 0, editedAt: Date.now(), persistedRevision: 0, diskFingerprint: null, lineEnding: 'lf', hasBom: false, saveState: 'saved', error: null }
}

export function sessionFromDocument(document: OpenedDocument): DocumentSession {
  return { ...newSession(document.text), draftKey: document.path, path: document.path, diskFingerprint: document.fingerprint, lineEnding: document.lineEnding, hasBom: document.hasBom }
}

export function applyEdit(session: DocumentSession, text: string): DocumentSession {
  return {
    ...session,
    text,
    revision: session.revision + 1,
    editedAt: Math.max(Date.now(), session.editedAt + 1),
    saveState: session.saveState === 'conflict' ? 'conflict' : 'editing',
    error: session.saveState === 'conflict' ? session.error : null
  }
}

export function beginSave(session: DocumentSession): DocumentSession {
  return { ...session, saveState: 'saving' }
}

export function completeSave(session: DocumentSession, revision: number, fingerprint: string, sessionId: number): DocumentSession {
  if (session.id !== sessionId) return session
  const persistedRevision = Math.max(session.persistedRevision, revision)
  return {
    ...session,
    persistedRevision,
    diskFingerprint: fingerprint,
    lineEnding: session.lineEnding === 'mixed' ? 'lf' : session.lineEnding,
    saveState: session.revision === persistedRevision ? 'saved' : 'editing',
    error: null
  }
}

export function failSave(session: DocumentSession, error: string): DocumentSession {
  return { ...session, saveState: 'error', error }
}

export function failSaveAs(session: DocumentSession, error: string): DocumentSession {
  return session.saveState === 'conflict' ? session : failSave(session, error)
}
