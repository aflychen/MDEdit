import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const app = resolve(process.argv[2] ?? 'dist/mac-arm64/MDEdit.app/Contents/MacOS/MDEdit')
const profile = await mkdtemp(join(tmpdir(), 'mdedit-draft-delete-smoke-'))
const draftsDirectory = join(profile, 'drafts')
await mkdir(draftsDirectory)
const savedFile = join(profile, 'saved-note.md')
await writeFile(savedFile, 'saved Markdown content')
const drafts = await Promise.all(['same draft', 'same draft', 'third draft'].map(async (content, index) => {
  const key = index === 2 ? savedFile : `untitled:${randomUUID()}`
  const path = join(draftsDirectory, `${createHash('sha256').update(key).digest('hex')}.json`)
  const draft = { key, path: index === 2 ? savedFile : null, text: content, fingerprint: null, revision: 1, updatedAt: Date.now() - index * 1000 }
  await writeFile(path, JSON.stringify(draft))
  return { ...draft, file: path }
}))

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
    if (await evaluate(`Boolean(${expression})`)) return
    await sleep(100)
  }
  throw new Error(`Missing ${label}`)
}

async function click(selector) {
  assert.equal(await evaluate(`(() => { const button = document.querySelector(${JSON.stringify(selector)}); if (!button) return false; button.click(); return true })()`), true, `Click ${selector}`)
}

try {
  await connect()
  await waitFor("document.querySelector('.recovery-menu strong')?.textContent === '3'", 'three recoverable drafts')
  await click('.recovery-menu summary')
  await waitFor("document.querySelectorAll('.recovery-item').length === 3", 'draft rows with separate actions')
  await call('Emulation.setDeviceMetricsOverride', { width: 680, height: 520, deviceScaleFactor: 1, mobile: false })
  const geometry = await evaluate("(() => { const panel = document.querySelector('.recovery-panel'); const bounds = panel.getBoundingClientRect(); return { left: bounds.left, right: bounds.right, viewport: innerWidth, scroll: panel.scrollWidth, width: panel.clientWidth } })()")
  assert.ok(geometry.left >= 0 && geometry.right <= geometry.viewport + 1 && geometry.scroll <= geometry.width + 1, `Recovery actions overflow the minimum window: ${JSON.stringify(geometry)}`)
  if (process.env.SMOKE_DRAFT_SCREENSHOT) {
    const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(process.env.SMOKE_DRAFT_SCREENSHOT, Buffer.from(shot.data, 'base64'))
  }
  assert.equal(await evaluate("document.querySelectorAll('.recovery-delete').length"), 3)
  const deleteLabels = await evaluate("[...document.querySelectorAll('.recovery-delete')].map(button => button.getAttribute('aria-label'))")
  assert.notEqual(deleteLabels[0], deleteLabels[1], 'same-title drafts need distinct accessible delete names')
  assert.equal(await evaluate("document.querySelectorAll('.document-tab').length"), 1, 'deleting does not restore a draft')

  await evaluate("window.__confirmMessages = []; window.confirm = message => { window.__confirmMessages.push(message); return false }")
  await evaluate("document.querySelector('.recovery-delete').focus()")
  await click('.recovery-item .recovery-delete')
  assert.equal(await evaluate("document.querySelector('.recovery-menu strong').textContent"), '3', 'cancel keeps one draft')
  assert.equal((await readFile(drafts[0].file, 'utf8')).includes('same draft'), true)

  await evaluate("window.confirm = message => { window.__confirmMessages.push(message); return true }")
  await click('.recovery-item .recovery-delete')
  await waitFor("document.querySelector('.recovery-menu strong')?.textContent === '2'", 'single draft deleted')
  assert.equal(await evaluate("document.activeElement?.matches('.recovery-delete')"), true, 'focus moves to the next delete action')
  assert.equal(await evaluate("document.querySelectorAll('.document-tab').length"), 1, 'delete action does not restore')
  await assert.rejects(readFile(drafts[0].file, 'utf8'), { code: 'ENOENT' })
  assert.equal((await readFile(drafts[1].file, 'utf8')).includes('same draft'), true)

  await evaluate("window.confirm = message => { window.__confirmMessages.push(message); return false }")
  await evaluate("document.querySelector('.recovery-clear-all').focus()")
  await click('.recovery-clear-all')
  assert.equal(await evaluate("document.querySelector('.recovery-menu strong').textContent"), '2', 'cancel keeps all drafts')

  const newer = { key: drafts[1].key, path: null, text: 'updated second draft', fingerprint: null, revision: 2, updatedAt: drafts[1].updatedAt + 10000 }
  await writeFile(drafts[1].file, JSON.stringify(newer))
  await evaluate("window.confirm = message => { window.__confirmMessages.push(message); return true }")
  await click('.recovery-clear-all')
  await waitFor("document.querySelector('.recovery-menu strong')?.textContent === '1'", 'newer draft kept during clear all')
  assert.equal(await evaluate("document.activeElement?.matches('.recovery-clear-all')"), true, 'focus remains on clear all when a newer draft survives')
  assert.equal((await readFile(drafts[1].file, 'utf8')).includes('updated second draft'), true)
  await assert.rejects(readFile(drafts[2].file, 'utf8'), { code: 'ENOENT' })
  await click('.recovery-clear-all')
  await waitFor("!document.querySelector('.recovery-menu')", 'all drafts deleted')
  assert.equal(await evaluate("document.activeElement?.matches('.new-tab')"), true, 'focus returns to new tab after clearing all drafts')
  await assert.rejects(readFile(drafts[1].file, 'utf8'), { code: 'ENOENT' })
  assert.equal(await readFile(savedFile, 'utf8'), 'saved Markdown content', 'deleting a recovery draft keeps its Markdown file')
  assert.equal(await evaluate("window.__confirmMessages.length"), 5, 'both destructive actions require confirmation')
  console.log('Packaged draft deletion smoke passed')
} finally {
  for (const { fail } of pending.values()) fail(new Error('Smoke stopped'))
  socket?.close()
  child.kill('SIGTERM')
  await sleep(300)
  if (child.exitCode === null) child.kill('SIGKILL')
  await rm(profile, { recursive: true, force: true })
}
