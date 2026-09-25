import type { ResolvedTheme } from './theme'

function showDiagramError(target: HTMLElement, source: string, error: unknown): void {
  const wrapper = document.createElement('div')
  wrapper.className = 'mermaid-error'
  const message = document.createElement('span')
  message.textContent = `图表无法渲染：${(error instanceof Error ? error.message : String(error)).slice(0, 240)}`
  const code = document.createElement('pre')
  code.textContent = source
  wrapper.append(message, code)
  target.replaceWith(wrapper)
}

let renderQueue: Promise<void> = Promise.resolve()

export function renderMermaidBlocks(root: HTMLElement, theme: ResolvedTheme, isActive: () => boolean): Promise<void> {
  const current = renderQueue.then(() => renderBlocks(root, theme, isActive))
  renderQueue = current.catch(() => undefined)
  return current
}

async function renderBlocks(root: HTMLElement, theme: ResolvedTheme, isActive: () => boolean): Promise<void> {
  if (!isActive()) return
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('pre')).filter(block => block.querySelector('code.language-mermaid'))
  if (!blocks.length) return
  let mermaid: (typeof import('mermaid'))['default']
  try {
    mermaid = (await import('mermaid')).default
    if (!isActive()) return
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme === 'dark' ? 'dark' : 'default', suppressErrorRendering: true, maxTextSize: 50_000 })
  } catch (error) {
    if (isActive()) for (const block of blocks) showDiagramError(block, block.querySelector('code')?.textContent ?? '', error)
    return
  }
  for (const block of blocks) {
    if (!isActive() || !block.isConnected) return
    const source = block.querySelector('code')?.textContent ?? ''
    const diagram = document.createElement('div')
    diagram.className = 'mermaid'
    diagram.textContent = source
    block.replaceWith(diagram)
    try {
      if (!source.trim() || source.length > 50_000) throw new Error('图表内容为空或超过 50,000 字符')
      await mermaid.run({ nodes: [diagram], suppressErrors: true })
      if (isActive() && diagram.isConnected && !diagram.querySelector('svg')) throw new Error('语法无效')
    } catch (error) {
      if (isActive() && diagram.isConnected) showDiagramError(diagram, source, error)
    }
  }
}
