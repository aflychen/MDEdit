import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const app = resolve(process.argv[2] ?? 'dist/mac-arm64/MDEdit.app/Contents/MacOS/MDEdit')
const profile = await mkdtemp(join(tmpdir(), 'mdedit-table-dimensions-smoke-'))
const port = await new Promise((done, fail) => {
  const server = createServer()
  server.once('error', fail)
  server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => done(value)) })
})
const child = spawn(app, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`], { stdio: 'ignore' })
const sleep = ms => new Promise(done => setTimeout(done, ms))
const pending = new Map()
let socket
let nextId = 0

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
  throw new Error(`Timed out waiting for ${label}`)
}

async function replaceNumber(selector, value) {
  await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.focus(); input.select() })()`)
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await sleep(100)
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`), '', `${selector} stays empty while editing`)
  await call('Input.insertText', { text: value })
  await sleep(100)
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`), value, `${selector} has no leading zero`)
}

try {
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
        break
      }
    } catch { /* App and debugger are still starting. */ }
    await sleep(100)
  }
  assert.ok(socket, 'Packaged app debugger opened')
  await waitFor("document.querySelector('.insert-menu summary')", 'insert menu')
  await evaluate("document.querySelector('.insert-menu summary').click()")
  await evaluate("document.querySelector('.insert-menu button[aria-expanded]').click()")
  await waitFor("document.querySelectorAll('.table-picker input[type=number]').length === 2", 'table dimension inputs')
  await replaceNumber('.table-picker label:nth-of-type(1) input', '4')
  await replaceNumber('.table-picker label:nth-of-type(2) input', '3')
  assert.equal(await evaluate("document.querySelector('.table-picker form').checkValidity()"), true)
  console.log('Packaged table dimension input smoke passed')
} finally {
  for (const { fail } of pending.values()) fail(new Error('Smoke stopped'))
  socket?.close()
  child.kill('SIGTERM')
  await sleep(300)
  if (child.exitCode === null) child.kill('SIGKILL')
  await rm(profile, { recursive: true, force: true })
}
