import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const directory = fileURLToPath(new URL('../out/renderer/assets/', import.meta.url))
const workerName = (await readdir(directory)).find(name => name.startsWith('preview.worker-') && name.endsWith('.js'))
assert.ok(workerName, 'built preview worker is missing')
const code = await readFile(join(directory, workerName), 'utf8')
const messages = []
const self = { postMessage: message => messages.push(message) }
runInNewContext(code, { self, TextDecoder, TextEncoder, URL, console }, { filename: workerName })
self.onmessage({ data: { revision: 7, text: '# Worker ready' } })
assert.equal(messages[0].revision, 7)
assert.match(messages[0].html, /<h1>Worker ready<\/h1>/)
console.log('Preview worker runs without a DOM')
