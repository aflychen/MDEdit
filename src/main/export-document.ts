import { BrowserWindow, dialog, session } from 'electron'
import { constants } from 'node:fs'
import { mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export type ExportFormat = 'html' | 'pdf'

const pageStyles = `
@page { size: A4; margin: 18mm; }
* { box-sizing: border-box; }
html { background: #fff; color: #263444; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
body { margin: 0; }
.document { max-width: 860px; margin: 0 auto; padding: 40px 48px 72px; font-size: 14px; line-height: 1.75; overflow-wrap: anywhere; }
.document > :first-child { margin-top: 0; }
h1,h2,h3,h4,h5,h6 { color: #1e2a38; line-height: 1.35; break-after: avoid; }
h1 { font-size: 28px; border-bottom: 1px solid #e8ecf0; padding-bottom: .4em; }
h2 { font-size: 21px; } h3 { font-size: 17px; }
a { color: #2943d6; text-decoration: underline; }
code { background: #f0f2f6; color: #bd3655; padding: 2px 4px; border-radius: 3px; font: 12px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; }
pre { background: #f3f5f8; border: 1px solid #e8ecf1; border-radius: 7px; padding: 14px 16px; overflow-wrap: anywhere; white-space: pre-wrap; break-inside: avoid; }
pre code { color: #2d3c4d; background: none; padding: 0; }
blockquote { border-left: 3px solid #a9b5ea; margin: 20px 0; padding: 1px 17px; color: #697787; background: #f8f9fd; }
table { border-collapse: collapse; width: 100%; margin: 18px 0; } th,td { border: 1px solid #dfe4eb; padding: 7px 11px; } th { background: #f5f7fa; text-align: left; }
tr, img, svg { break-inside: avoid; }
img { max-width: 100%; height: auto; border-radius: 6px; }
hr { border: 0; border-top: 1px solid #e2e6ec; margin: 30px 0; }
.image-placeholder,.mermaid-error > span { color: #a44942; background: #fff1ef; padding: 4px 8px; border-radius: 5px; }
.mermaid { text-align: center; margin: 20px 0; overflow: auto; } .mermaid svg { max-width: 100%; height: auto; }
.katex-display { overflow-x: auto; overflow-y: hidden; padding: 4px 0; } .katex-error { color: #b14544; }
.hljs-comment,.hljs-quote { color: #798594; font-style: italic; }
.hljs-keyword,.hljs-selector-tag,.hljs-literal { color: #9b36b0; }
.hljs-string,.hljs-regexp,.hljs-addition { color: #287347; }
.hljs-number,.hljs-symbol,.hljs-attr,.hljs-variable { color: #b45b13; }
.hljs-title,.hljs-section,.hljs-selector-class { color: #245cca; }
.hljs-built_in,.hljs-type,.hljs-name { color: #0b7b89; }
.hljs-meta { color: #8254a6; } .hljs-deletion { color: #c23a48; }
@media print { .document { max-width: none; padding: 0; } a { color: #2943d6; } }
`

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

async function katexStyles(): Promise<string> {
  const directory = join(__dirname, 'export-assets')
  let css = await readFile(join(directory, 'katex.min.css'), 'utf8')
  const fonts = [...new Set([...css.matchAll(/url\((?:["']?)(fonts\/[^)"']+)(?:["']?)\)/g)].map(match => match[1]))]
  const embedded = await Promise.all(fonts.map(async font => {
    const extension = extname(font).slice(1)
    const bytes = await readFile(join(directory, font))
    return [font, `data:font/${extension};base64,${bytes.toString('base64')}`] as const
  }))
  for (const [font, data] of embedded) css = css.replaceAll(`url(${font})`, `url(${data})`).replaceAll(`url("${font}")`, `url("${data}")`).replaceAll(`url('${font}')`, `url('${data}')`)
  return css
}

async function standaloneHtml(title: string, body: string): Promise<string> {
  const css = await katexStyles()
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title><style>${pageStyles}\n${css}</style></head><body><article class="document">${body}</article></body></html>`
}

async function writeAtomic(path: string, content: string | Buffer): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  try {
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    try { await handle.writeFile(content); await handle.sync() } finally { await handle.close() }
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}

async function renderPdf(html: string): Promise<Buffer> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'mdedit-export-'))
  const htmlPath = join(temporaryDirectory, 'document.html')
  const partition = `mdedit-export-${randomUUID()}`
  const isolatedSession = session.fromPartition(partition)
  isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  const printWindow = new BrowserWindow({ show: false, width: 1000, height: 1400, webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } })
  printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  printWindow.webContents.on('will-navigate', event => event.preventDefault())
  try {
    await writeFile(htmlPath, html, { mode: 0o600 })
    await printWindow.loadFile(htmlPath)
    await printWindow.webContents.executeJavaScript('document.fonts.ready.then(() => Promise.all(Array.from(document.images, image => image.decode())))')
    return await printWindow.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true })
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy()
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

export async function exportDocument(owner: BrowserWindow, format: ExportFormat, title: string, body: string): Promise<string | null> {
  if (format !== 'html' && format !== 'pdf') throw new Error('不支持的导出格式')
  if (typeof title !== 'string' || typeof body !== 'string' || title.length > 500 || body.length > 100_000_000) throw new Error('导出内容无效或过大')
  const extension = `.${format}`
  const name = title.replace(/\.md$/i, '') || '未命名文档'
  const result = await dialog.showSaveDialog(owner, { defaultPath: `${name}${extension}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] })
  if (result.canceled || !result.filePath) return null
  if (extname(result.filePath).toLowerCase() !== extension) throw new Error(`请使用 ${extension} 扩展名保存导出文件`)
  const html = await standaloneHtml(title, body)
  await writeAtomic(result.filePath, format === 'pdf' ? await renderPdf(html) : html)
  return result.filePath
}
