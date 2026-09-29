import { unified } from 'unified'
import { text, type Language } from '../shared/language'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import { all as highlightLanguages } from 'lowlight'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'

interface NodeLike {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: NodeLike[]
  value?: string
}

interface MarkdownNode {
  type: string
  depth?: number
  value?: string
  alt?: string
  children?: MarkdownNode[]
  position?: { start: { line: number } }
}

export interface OutlineHeading {
  depth: number
  text: string
  line: number
}

export interface PreviewResult {
  html: string
  outline: OutlineHeading[]
}

function headingText(node: MarkdownNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? ''
  if (node.type === 'image') return node.alt ?? ''
  if (node.type === 'break') return ' '
  return (node.children ?? []).map(headingText).join('')
}

function collectOutline(node: MarkdownNode, outline: OutlineHeading[]): void {
  if (node.type === 'heading' && node.depth && node.position) {
    outline.push({ depth: node.depth, text: headingText(node).replace(/\s+/g, ' ').trim(), line: node.position.start.line })
  }
  node.children?.forEach(child => collectOutline(child, outline))
}

function safeLocalPath(value: string): boolean {
  const decoded = (() => { try { return decodeURIComponent(value) } catch { return '' } })()
  return Boolean(decoded) && !decoded.startsWith('/') && !decoded.includes('\\') &&
    !/^[a-z][a-z\d+.-]*:/i.test(decoded) && !decoded.split('/').includes('..')
}

function constrainImages(language: Language) {
  return (tree: NodeLike): void => {
    const visit = (node: NodeLike): void => {
      if (node.children) {
        node.children = node.children.map(child => {
          if (child.type !== 'element' || child.tagName !== 'img') return child
          const src = String(child.properties?.src ?? '')
          const alt = String(child.properties?.alt ?? text(language, 'common.image'))
          if (safeLocalPath(src)) {
            return { ...child, properties: { alt, 'data-local-src': src } }
          }
          return {
            type: 'element', tagName: 'span', properties: { className: ['image-placeholder'] },
            children: [{ type: 'text', value: src.startsWith('https:') || src.startsWith('http:') ? text(language, 'pane.remoteImageBlocked', { name: alt }) : text(language, 'pane.imagePathBlocked', { name: alt }) }]
          }
        })
        node.children.forEach(visit)
      }
    }
    visit(tree)
  }
}

function createProcessor(language: Language) {
  return unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype)
  .use(rehypeHighlight, { detect: false, languages: highlightLanguages, plainText: ['math', 'mermaid'] })
  .use(rehypeSanitize, {
    ...defaultSchema,
    attributes: {
      ...defaultSchema.attributes,
      code: [...(defaultSchema.attributes?.code ?? []), ['className', 'hljs', 'math-inline', 'math-display']],
      span: [...(defaultSchema.attributes?.span ?? []), ['className', /^hljs-[a-z][a-z0-9_-]*$/]]
    }
  })
  .use(() => constrainImages(language))
  .use(rehypeKatex, { trust: false, maxSize: 20, maxExpand: 1000 })
  .use(rehypeStringify)
}

const processors = { en: createProcessor('en'), 'zh-CN': createProcessor('zh-CN') }

export function renderMarkdown(source: string, language: Language = 'zh-CN'): string {
  return renderPreview(source, language).html
}

export function renderPreview(source: string, language: Language = 'zh-CN'): PreviewResult {
  const processor = processors[language]
  const tree = processor.parse(source)
  const outline: OutlineHeading[] = []
  collectOutline(tree as MarkdownNode, outline)
  return { html: String(processor.stringify(processor.runSync(tree))), outline }
}

export function countWords(text: string): number {
  return [...text.matchAll(/\p{Script=Han}|[\p{L}\p{N}_]+/gu)].length
}
