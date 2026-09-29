import { text, type Language } from '../shared/language'
import { renderMarkdown } from './preview'
import { renderMermaidBlocks } from './mermaid-preview'

/** Produce the same sanitized content as preview, with portable local resources. */
export async function buildExportBody(sourceText: string, documentPath: string | null, language: Language = 'zh-CN'): Promise<string> {
  const stage = document.createElement('article')
  stage.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;opacity:0;pointer-events:none'
  stage.innerHTML = renderMarkdown(sourceText, language)
  document.body.append(stage)
  try {
    const images = Array.from(stage.querySelectorAll<HTMLImageElement>('img[data-local-src]'))
    await Promise.all(images.map(async image => {
      const source = image.dataset.localSrc
      if (!source || !documentPath) throw new Error(text(language, 'export.saveMarkdownFirst'))
      try {
        image.src = await window.mdedit.readImage(documentPath, source)
        await image.decode()
      }
      catch (error) { throw new Error(text(language, 'export.imageReadFailed', { name: image.alt || source, error: error instanceof Error ? error.message : String(error) })) }
      image.removeAttribute('data-local-src')
    }))
    await renderMermaidBlocks(stage, 'light', () => true, language)
    return stage.innerHTML
  } finally {
    stage.remove()
  }
}
