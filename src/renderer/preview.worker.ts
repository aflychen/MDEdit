import { countWords, renderPreview } from './preview'

self.onmessage = (event: MessageEvent<{ sessionId: number; revision: number; text: string }>) => {
  const { sessionId, revision, text } = event.data
  try {
    const { html, outline } = renderPreview(text)
    self.postMessage({ sessionId, revision, html, outline, words: countWords(text) })
  } catch (error) {
    self.postMessage({ sessionId, revision, error: error instanceof Error ? error.message : String(error) })
  }
}
