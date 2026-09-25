import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const source = join(dirname(require.resolve('katex/package.json')), 'dist')
const destination = join(process.cwd(), 'out', 'main', 'export-assets')
await mkdir(destination, { recursive: true })
await cp(join(source, 'katex.min.css'), join(destination, 'katex.min.css'))
await cp(join(source, 'fonts'), join(destination, 'fonts'), { recursive: true })
