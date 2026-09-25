import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rmdir, unlink } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ImageImport } from '../shared/contracts'
import { imageExtension } from '../shared/image-format'

const mimeTypes: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif'
}

const maxImageBytes = 10 * 1024 * 1024
const maxBatchBytes = 50 * 1024 * 1024

export async function importLocalImages(documentPath: string, images: ImageImport[]): Promise<string[]> {
  if (!Array.isArray(images) || images.length === 0 || images.length > 20) throw new Error('一次只能导入 1～20 张图片')
  let total = 0
  const entries = images.map(image => {
    if (!image || !(image.bytes instanceof Uint8Array)) throw new Error('图片数据无效')
    const size = image.bytes.byteLength
    total += size
    if (!size || size > maxImageBytes) throw new Error('单张图片不能超过 10 MB')
    const extension = imageExtension(image.bytes)
    if (!extension) throw new Error('仅支持 PNG、JPEG、GIF、WebP 和 AVIF 图片')
    return { bytes: image.bytes, extension }
  })
  if (total > maxBatchBytes) throw new Error('一次导入的图片不能超过 50 MB')

  const root = await realpath(dirname(documentPath))
  if (await realpath(documentPath) !== documentPath) throw new Error('文档路径已改变，请重新打开')
  const directory = join(root, 'images')
  let createdDirectory = false
  try { await mkdir(directory); createdDirectory = true }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  const createdFiles: string[] = []
  try {
    const directoryEntry = await lstat(directory)
    const actualDirectory = await realpath(directory)
    const folderName = relative(root, actualDirectory)
    if (!directoryEntry.isDirectory() || directoryEntry.isSymbolicLink() || folderName.toLowerCase() !== 'images') {
      throw new Error('图片目录必须是普通文件夹')
    }
    const paths: string[] = []
    for (const entry of entries) {
      const current = await lstat(directory)
      if (!current.isDirectory() || current.isSymbolicLink() || await realpath(directory) !== actualDirectory) throw new Error('图片目录已改变')
      const filename = `${randomUUID()}${entry.extension}`
      const target = join(actualDirectory, filename)
      const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600)
      createdFiles.push(target)
      try { await handle.writeFile(entry.bytes) }
      finally { await handle.close() }
      paths.push(`${folderName}/${filename}`)
    }
    return paths
  } catch (error) {
    await Promise.all(createdFiles.map(path => unlink(path).catch(() => undefined)))
    if (createdDirectory) await rmdir(directory).catch(() => undefined)
    throw error
  }
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
