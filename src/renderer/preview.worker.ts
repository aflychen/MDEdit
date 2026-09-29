import { countWords, renderPreview } from './preview'
import type { Language } from '../shared/language'

self.onmessage = (event: MessageEvent<{ sessionId: number; revision: number; text: string; language: Language }>) => {
  const { sessionId, revision, text, language } = event.data
  try {
    const { html, outline } = renderPreview(text, language)
    self.postMessage({ sessionId, revision, language, html, outline, words: countWords(text) })
  } catch (error) {
    self.postMessage({ sessionId, revision, language, error: error instanceof Error ? error.message : String(error) })
  }
}
