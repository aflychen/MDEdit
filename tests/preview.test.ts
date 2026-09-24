import { describe, expect, it } from 'vitest'
import { countWords, renderMarkdown } from '../src/renderer/preview'

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
})
