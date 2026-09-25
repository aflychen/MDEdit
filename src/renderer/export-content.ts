import { renderMarkdown } from './preview'
import { renderMermaidBlocks } from './mermaid-preview'

/** Produce the same sanitized content as preview, with portable local resources. */
export async function buildExportBody(text: string, documentPath: string | null): Promise<string> {
  const stage = document.createElement('article')
  stage.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;opacity:0;pointer-events:none'
  stage.innerHTML = renderMarkdown(text)
  document.body.append(stage)
  try {
    const images = Array.from(stage.querySelectorAll<HTMLImageElement>('img[data-local-src]'))
    await Promise.all(images.map(async image => {
      const source = image.dataset.localSrc
      if (!source || !documentPath) throw new Error('包含本地图片的文档需要先保存为 Markdown 文件')
      try {
        image.src = await window.mdedit.readImage(documentPath, source)
        await image.decode()
      }
      catch (error) { throw new Error(`无法读取图片「${image.alt || source}」：${error instanceof Error ? error.message : String(error)}`) }
      image.removeAttribute('data-local-src')
    }))
    await renderMermaidBlocks(stage, 'light', () => true)
    return stage.innerHTML
  } finally {
    stage.remove()
  }
}
