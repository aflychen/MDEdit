import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, sep } from 'node:path'

const mimeTypes: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif'
}

export async function resolveLocalResource(documentPath: string, resource: string): Promise<string> {
  let decoded: string
  try { decoded = decodeURIComponent(resource.split(/[?#]/, 1)[0]) }
  catch { throw new Error('图片路径无效') }
  const segments = decoded.replace(/\\/g, '/').split('/')
  if (!decoded || isAbsolute(decoded) || /^[a-z][a-z\d+.-]*:/i.test(decoded) || segments.includes('..') || decoded.includes('\\')) {
    throw new Error('图片位于文档目录之外或路径不受支持')
  }
  const root = await realpath(dirname(documentPath))
  const target = await realpath(join(root, decoded))
  const inside = relative(root, target)
  if (inside.startsWith(`..${sep}`) || inside === '..' || isAbsolute(inside)) throw new Error('图片位于文档目录之外')
  return target
}

export async function readLocalImage(documentPath: string, resource: string): Promise<string> {
  const target = await resolveLocalResource(documentPath, resource)
  const mime = mimeTypes[extname(target).toLowerCase()]
  if (!mime) throw new Error('不支持此图片格式')
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    const entry = await lstat(target)
    if (!opened.isFile() || !entry.isFile() || opened.dev !== entry.dev || opened.ino !== entry.ino) {
      throw new Error('图片路径已改变')
    }
    const root = await realpath(dirname(documentPath))
    const checked = await realpath(target)
    const inside = relative(root, checked)
    if (inside.startsWith(`..${sep}`) || inside === '..' || isAbsolute(inside)) throw new Error('图片位于文档目录之外')
    if (opened.size > 10 * 1024 * 1024) throw new Error('图片超过 10 MB')
    return `data:${mime};base64,${(await handle.readFile()).toString('base64')}`
  } finally { await handle.close() }
}
