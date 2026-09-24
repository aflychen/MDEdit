import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeSanitize from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'

interface NodeLike {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: NodeLike[]
  value?: string
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
  .use(rehypeSanitize)
  .use(constrainImages)
  .use(rehypeStringify)

export function renderMarkdown(text: string): string {
  return String(processor.processSync(text))
}

export function countWords(text: string): number {
  return [...text.matchAll(/\p{Script=Han}|[\p{L}\p{N}_]+/gu)].length
}
