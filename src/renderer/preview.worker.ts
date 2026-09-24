import { countWords, renderMarkdown } from './preview'

self.onmessage = (event: MessageEvent<{ revision: number; text: string }>) => {
  try {
    self.postMessage({ revision: event.data.revision, html: renderMarkdown(event.data.text), words: countWords(event.data.text) })
  } catch (error) {
    self.postMessage({ revision: event.data.revision, error: error instanceof Error ? error.message : String(error) })
  }
}
