import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const app = resolve(process.argv[2] ?? 'dist/mac-arm64/MDEdit.app/Contents/MacOS/MDEdit')
const profile = await mkdtemp(join(tmpdir(), 'mdedit-language-smoke-'))
const port = await new Promise((done, fail) => {
  const server = createServer()
  server.once('error', fail)
  server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => done(value)) })
})
const child = spawn(app, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`], { stdio: 'ignore' })
let socket
let nextId = 0
const pending = new Map()
const sleep = ms => new Promise(done => setTimeout(done, ms))

async function connect() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Packaged app exited with ${child.exitCode}`)
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = tabs.find(tab => tab.type === 'page' && tab.url.includes('index.html'))
      if (page) {
        socket = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((done, fail) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', fail, { once: true }) })
        socket.addEventListener('message', event => {
          const reply = JSON.parse(event.data)
          if (!reply.id || !pending.has(reply.id)) return
          const { done, fail } = pending.get(reply.id)
          pending.delete(reply.id)
          reply.error ? fail(new Error(reply.error.message)) : done(reply.result)
        })
        return
      }
    } catch { /* App and debugger are still starting. */ }
    await sleep(100)
  }
  throw new Error('Timed out waiting for the packaged app debugger')
}

function call(method, params = {}) {
  return new Promise((done, fail) => {
    const id = ++nextId
    pending.set(id, { done, fail })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

async function waitFor(expression, label) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if (await evaluate(`Boolean(${expression})`)) return } catch { /* Navigation can replace the execution context. */ }
    await sleep(100)
  }
  throw new Error(`Missing ${label}`)
}

async function setInput(selector, value) {
  const result = await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); if (!input) return false; input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  assert.equal(result, true, `Input ${selector} exists`)
}

async function click(selector) {
  assert.equal(await evaluate(`(() => { const button = document.querySelector(${JSON.stringify(selector)}); if (!button) return false; button.click(); return true })()`), true, `Click ${selector}`)
}

async function assertToolbarFits(label) {
  const geometry = await evaluate("(() => { const toolbar = document.querySelector('.toolbar'); const controls = document.querySelector('.layout-switch'); const buttons = [...controls.querySelectorAll('button')]; return { toolbarRight: toolbar.getBoundingClientRect().right, controlsRight: controls.getBoundingClientRect().right, buttonOverflow: buttons.some(button => button.scrollWidth > button.clientWidth + 1), page: document.documentElement.scrollWidth, viewport: innerWidth } })()")
  assert.ok(geometry.controlsRight <= geometry.toolbarRight + 1 && !geometry.buttonOverflow && geometry.page <= geometry.viewport + 1, `${label} toolbar overflows: ${JSON.stringify(geometry)}`)
}

try {
  await connect()
  await waitFor("document.querySelector('.cm-content') && document.querySelector('.view-menu')", 'editor')
  if (await evaluate('document.documentElement.lang') !== 'en') {
    await evaluate("localStorage.setItem('mdedit-language', 'en')")
    await call('Page.reload', { ignoreCache: true })
    await waitFor("document.documentElement.lang === 'en' && document.querySelector('.cm-content')", 'English startup')
  }
  assert.equal(await evaluate('document.documentElement.lang'), 'en')
  assert.equal(await evaluate("document.querySelector('.view-menu summary').textContent.trim()"), 'View')
  assert.equal(await evaluate("document.querySelector('.language-toggle').textContent.trim().endsWith('English')"), true)
  assert.equal(await evaluate("document.querySelector('.layout-switch button[aria-pressed=true]').dataset.mode"), 'split')
  assert.equal(await evaluate("document.querySelector('.layout-switch button[data-mode=split]').textContent"), 'Split')
  assert.equal(await evaluate("document.querySelector('.layout-switch button[data-mode=split]').getAttribute('aria-label')"), 'Show editor and preview side by side')
  await call('Emulation.setDeviceMetricsOverride', { width: 760, height: 520, deviceScaleFactor: 1, mobile: false })
  await assertToolbarFits('English split')
  const searchGeometry = await evaluate("(() => { const button = document.querySelector('.find-tool'); const icon = button.querySelector('svg'); return { button: button.getBoundingClientRect().width, icon: icon?.getBoundingClientRect().width ?? 0 } })()")
  assert.ok(searchGeometry.button >= 34 && searchGeometry.icon >= 18, `Search icon is too small: ${JSON.stringify(searchGeometry)}`)
  await evaluate("document.querySelector('.cm-content').focus()")
  await call('Input.insertText', { text: '# Heading\n\nalpha alpha\n\n```js\nconst alpha = 1\n```' })
  await waitFor("document.querySelector('button[data-copy-code]')", 'preview copy button')
  await click('.layout-switch button[data-mode=preview]')
  await waitFor("getComputedStyle(document.querySelector('.editor-pane')).display === 'none'", 'preview-only mode')
  await assertToolbarFits('English preview')
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.format-tools')).display"), 'none', 'format tools hidden in preview-only mode')
  const cursorBeforePreviewClick = await evaluate("document.querySelector('.statusbar').textContent")
  await click('.preview-content h1')
  assert.equal(await evaluate("document.querySelector('.workspace.preview-only') !== null && !document.activeElement.closest('.editor-pane')"), true, 'preview heading does not focus hidden editor')
  assert.equal(await evaluate("document.querySelector('.statusbar').textContent"), cursorBeforePreviewClick, 'preview heading keeps editor cursor')
  if (process.env.SMOKE_PREVIEW_SCREENSHOT) {
    const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(process.env.SMOKE_PREVIEW_SCREENSHOT, Buffer.from(shot.data, 'base64'))
  }
  assert.equal(await evaluate("document.querySelector('.preview-pane').getBoundingClientRect().width > 600"), true)
  await click('.layout-switch button[data-mode=editor]')
  await waitFor("!document.querySelector('.preview-pane') && getComputedStyle(document.querySelector('.editor-pane')).display !== 'none'", 'editor-only mode')
  await assertToolbarFits('English editor')
  await click('.layout-switch button[data-mode=split]')
  await waitFor("document.querySelector('.preview-pane') && document.querySelector('.editor-pane')", 'split mode')
  await assertToolbarFits('English restored split')
  assert.equal(await evaluate("document.querySelector('.cm-content').textContent.includes('alpha alpha')"), true, 'editor content survives mode switching')
  assert.equal(await evaluate("document.querySelector('button[data-copy-code]').textContent"), 'Copy')
  await click('.find-tool')
  await waitFor("document.querySelector('.md-search-panel input[name=find]')", 'custom search panel')
  assert.equal(await evaluate("document.querySelector('.md-search-panel input[name=find]').getAttribute('aria-label')"), 'Find in document')
  await setInput('.md-search-panel input[name=find]', 'alpha')
  await click('.md-search-panel button[data-action=next]')
  await click('.md-search-panel button[data-action=previous]')
  for (const name of ['case', 'regexp', 'word']) {
    await click(`.md-search-panel input[name=${name}]`)
    assert.equal(await evaluate(`document.querySelector('.md-search-panel input[name=${name}]').checked`), true)
    await click(`.md-search-panel input[name=${name}]`)
  }
  await evaluate("document.querySelector('.md-search-panel input[name=find]').focus()")
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 8 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 8 })
  await click('.md-search-panel button[data-action=toggle-replace]')
  await setInput('.md-search-panel input[name=replace]', 'beta')
  await click('.md-search-panel button[data-action=replace]')
  await click('.md-search-panel button[data-action=replace-all]')
  await waitFor("document.querySelector('.cm-content').textContent.includes('beta beta')", 'replacement result')
  await setInput('.md-search-panel input[name=find]', '(')
  await click('.md-search-panel input[name=regexp]')
  await waitFor("!document.querySelector('.md-search-panel .md-search-error').hidden", 'invalid regular expression warning')
  assert.equal(await evaluate("document.querySelector('.md-search-panel button[data-action=replace-all]').disabled"), true)
  await click('.md-search-panel input[name=regexp]')
  await setInput('.md-search-panel input[name=find]', 'alpha')
  await call('Emulation.setDeviceMetricsOverride', { width: 760, height: 520, deviceScaleFactor: 1, mobile: false })
  await sleep(150)
  if (process.env.SMOKE_LIGHT_SCREENSHOT) {
    const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(process.env.SMOKE_LIGHT_SCREENSHOT, Buffer.from(shot.data, 'base64'))
  }
  await click('.new-tab')
  await waitFor("document.querySelectorAll('.document-tab').length === 2", 'second tab')
  await click('.find-tool')
  await waitFor("document.querySelector('.md-search-panel input[name=find]')", 'second tab search')
  await setInput('.md-search-panel input[name=find]', 'gamma')
  await click('.document-tab:nth-child(1) [role=tab]')
  await waitFor("document.querySelector('.md-search-panel input[name=find]')?.value === 'alpha'", 'first tab query')
  await click('.language-toggle')
  await waitFor("document.documentElement.lang === 'zh-CN' && document.querySelector('.md-search-panel input[name=find]').getAttribute('aria-label') === '在文档中查找'", 'Chinese panel translation')
  assert.equal(await evaluate("document.querySelector('.layout-switch button[data-mode=split]').textContent"), '双栏')
  assert.equal(await evaluate("document.querySelector('.layout-switch button[data-mode=split]').getAttribute('aria-label')"), '同时显示编辑与预览')
  await assertToolbarFits('Chinese split')
  await click('.layout-switch button[data-mode=editor]')
  await assertToolbarFits('Chinese editor')
  await click('.layout-switch button[data-mode=preview]')
  await assertToolbarFits('Chinese preview')
  await click('.layout-switch button[data-mode=split]')
  assert.equal(await evaluate("document.querySelector('.md-search-panel input[name=find]').value"), 'alpha')
  assert.equal(await evaluate("document.querySelector('.md-search-panel input[name=replace]').value"), 'beta')
  await waitFor("document.querySelector('button[data-copy-code]')?.textContent === '复制'", 'localized preview copy button')
  await click('.document-tab:nth-child(2) [role=tab]')
  await waitFor("document.querySelector('.md-search-panel input[name=find]')?.value === 'gamma' && document.querySelector('.md-search-panel input[name=find]')?.getAttribute('aria-label') === '在文档中查找'", 'second tab query and language')
  await click('.document-tab:nth-child(1) [role=tab]')
  await waitFor("document.querySelector('.md-search-panel input[name=find]')?.value === 'alpha'", 'first tab restored query')
  await call('Emulation.setDeviceMetricsOverride', { width: 760, height: 520, deviceScaleFactor: 1, mobile: false })
  await sleep(300)
  assert.equal(await evaluate("Boolean(document.querySelector('.workspace.with-sidebar.split'))"), true, 'Sidebar and preview are both open')
  const geometry = await evaluate("(() => { const pane = document.querySelector('.md-search-panel'); const rect = pane.getBoundingClientRect(); return { pane: rect.width, scroll: pane.scrollWidth, viewport: window.innerWidth, page: document.documentElement.scrollWidth } })()")
  assert.ok(geometry.scroll <= geometry.pane + 1, `Search panel overflows: ${JSON.stringify(geometry)}`)
  assert.ok(geometry.page <= geometry.viewport + 1, `Page overflows: ${JSON.stringify(geometry)}`)
  await click('.view-menu summary')
  await evaluate("(() => { const select = document.querySelector('select[aria-label=外观主题]'); select.value = 'dark'; select.dispatchEvent(new Event('change', { bubbles: true })) })()")
  await waitFor("document.documentElement.dataset.theme === 'dark'", 'dark theme')
  if (process.env.SMOKE_SCREENSHOT) {
    const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(process.env.SMOKE_SCREENSHOT, Buffer.from(shot.data, 'base64'))
  }
  await evaluate("document.querySelector('.md-search-panel input[name=find]').focus()")
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await waitFor("!document.querySelector('.md-search-panel')", 'panel close on Escape')
  await click('.find-tool')
  await waitFor("document.querySelector('.md-search-panel')", 'panel reopen')
  assert.equal(await evaluate("document.querySelector('.md-search-panel input[name=find]').getAttribute('aria-label')"), '在文档中查找')
  await call('Page.reload', { ignoreCache: true })
  await waitFor("document.documentElement.lang === 'zh-CN' && document.querySelector('.view-menu summary')", 'persisted Chinese language')
  await evaluate("localStorage.setItem('mdedit-language', 'invalid')")
  await call('Page.reload', { ignoreCache: true })
  await waitFor("document.documentElement.lang === 'en' && document.querySelector('.view-menu summary')?.textContent.trim() === 'View'", 'invalid language fallback')
  await click('.layout-switch button[data-mode=preview]')
  await waitFor("getComputedStyle(document.querySelector('.editor-pane')).display === 'none'", 'preview-only before Cmd+F')
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, modifiers: 4 })
  await waitFor("document.querySelector('.workspace.split .md-search-panel input[name=find]')", 'Cmd+F opens search and split mode from preview-only')
  console.log('Packaged search and language smoke passed')
} finally {
  for (const { fail } of pending.values()) fail(new Error('Smoke stopped'))
  socket?.close()
  child.kill('SIGTERM')
  await sleep(300)
  if (child.exitCode === null) child.kill('SIGKILL')
  await rm(profile, { recursive: true, force: true })
}
