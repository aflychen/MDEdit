import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeHighlight from 'rehype-highlight'
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

function constrainImages() {
  return (tree: NodeLike): void => {
    const visit = (node: NodeLike): void => {
      if (node.children) {
        node.children = node.children.map(child => {
          if (child.type !== 'element' || child.tagName !== 'img') return child
          const src = String(child.properties?.src ?? '')
          const alt = String(child.properties?.alt ?? '图片')
          if (safeLocalPath(src)) {
            return { ...child, properties: { alt, 'data-local-src': src } }
          }
          return {
            type: 'element', tagName: 'span', properties: { className: ['image-placeholder'] },
            children: [{ type: 'text', value: src.startsWith('https:') || src.startsWith('http:') ? `远程图片未加载：${alt}` : `图片路径受限：${alt}` }]
          }
        })
        node.children.forEach(visit)
      }
    }
    visit(tree)
  }
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeHighlight, { detect: false, languages: highlightLanguages })
  .use(rehypeSanitize, {
    ...defaultSchema,
    attributes: {
      ...defaultSchema.attributes,
      code: [...(defaultSchema.attributes?.code ?? []), ['className', 'hljs']],
      span: [...(defaultSchema.attributes?.span ?? []), ['className', /^hljs-[a-z][a-z0-9_-]*$/]]
    }
  })
  .use(constrainImages)
  .use(rehypeStringify)

export function renderMarkdown(text: string): string {
  return renderPreview(text).html
}

export function renderPreview(text: string): PreviewResult {
  const tree = processor.parse(text)
  const outline: OutlineHeading[] = []
  collectOutline(tree as MarkdownNode, outline)
  return { html: String(processor.stringify(processor.runSync(tree))), outline }
}

export function countWords(text: string): number {
  return [...text.matchAll(/\p{Script=Han}|[\p{L}\p{N}_]+/gu)].length
}
