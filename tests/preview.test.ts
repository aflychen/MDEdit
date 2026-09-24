import { describe, expect, it } from 'vitest'
import { countWords, renderMarkdown, renderPreview } from '../src/renderer/preview'

describe('Markdown preview', () => {
  it('renders GFM tables, tasks and fenced code', () => {
    const html = renderMarkdown('| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n\n```js\nconst a = 1\n```')
    expect(html).toContain('<table>')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('<code class="language-js">')
  })

  it('does not emit executable HTML, dangerous links or remote image sources', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n![remote](https://example.com/a.png)')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('src="https:')
    expect(html).toContain('远程图片未加载')
  })

  it('marks local images for a controlled resource lookup', () => {
    const html = renderMarkdown('![chart](images/chart.png)')
    expect(html).toContain('data-local-src="images/chart.png"')
    expect(html).not.toMatch(/<img[^>]*\ssrc=/)
  })

  it('counts Han characters and English words for the status bar', () => {
    expect(countWords('你好 world 123')).toBe(4)
  })

  it('highlights explicitly declared JavaScript and common aliases', () => {
    const js = renderMarkdown('```js\nconst x = 1\n```')
    const ts = renderMarkdown('```ts\nconst x: number = 1\n```')
    expect(js).toContain('class="language-js"')
    expect(js).toMatch(/class="hljs-keyword"[^>]*>const<\/span>/)
    expect(ts).toContain('class="language-ts"')
    expect(ts).toMatch(/class="hljs-keyword"[^>]*>const<\/span>/)
  })

  it('keeps safe compound token classes used by CSS highlighting', () => {
    const css = renderMarkdown('```css\n.card { color: red; }\n```')
    expect(css).toContain('hljs-selector-class')
  })

  it('highlights an explicitly marked language outside the common preset', () => {
    const haskell = renderMarkdown('```haskell\nmain = putStrLn "hi"\n```')
    expect(haskell).toContain('language-haskell')
    expect(haskell).toContain('hljs-title')
    expect(haskell).toContain('hljs-string')
  })

  it('leaves unknown and undeclared languages as escaped plain text', () => {
    const unknown = renderMarkdown('```madeup\n<script>alert(1)</script>\n```')
    const undeclared = renderMarkdown('```\nconst x = 1\n```')
    expect(unknown).toContain('&#x3C;script>alert(1)&#x3C;/script>')
    expect(unknown).not.toContain('hljs-')
    expect(undeclared).not.toContain('hljs-')
  })

  it('extracts visible headings and source lines without treating fences as headings', () => {
    const result = renderPreview('intro\n# Hello *world*\n\n```md\n# Fake\n```\n\n###### Last `code`')
    expect(result.outline).toEqual([
      { depth: 1, text: 'Hello world', line: 2 },
      { depth: 6, text: 'Last code', line: 8 }
    ])
  })

  it('separates words across a hard line break in an outline heading', () => {
    const result = renderPreview('Hello  \nworld\n=====')
    expect(result.outline).toEqual([{ depth: 1, text: 'Hello world', line: 1 }])
  })

  it('keeps highlighted code safe after sanitizing', () => {
    const html = renderMarkdown('```js\nconst x = "<img src=x onerror=alert(1)>"\n```')
    expect(html).toContain('hljs-keyword')
    expect(html).not.toContain('<img')
    expect(html).toContain('&#x3C;img src=x onerror=alert(1)>')
  })
})
