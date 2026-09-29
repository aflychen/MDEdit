import { text, type Language } from './language'

// Messages produced by application code are mapped in both directions so a
// visible error can change language without repeating the failed operation.
const pairs = [
  ['无效的窗口请求', 'Invalid window request'],
  ['文件不在最近列表中', 'The file is not in the recent files list'],
  ['文件不是系统打开请求', 'The file was not opened by the system'],
  ['文档未打开', 'The document is not open'],
  ['草稿数据无效', 'Invalid draft data'],
  ['没有该文档的恢复草稿', 'No recoverable draft exists for this document'],
  ['只允许打开 HTTPS 链接', 'Only HTTPS links can be opened'],
  ['请选择普通文件夹', 'Choose a regular folder'],
  ['尚未选择文件夹', 'No folder has been selected'],
  ['路径不属于已选择的文件夹', 'The path is outside the selected folder'],
  ['文件夹中的符号链接不可访问', 'Symbolic links in the folder cannot be accessed'],
  ['路径类型不正确', 'Incorrect path type'],
  ['文件夹已改变，请重新展开', 'The folder changed. Expand it again'],
  ['只能打开 Markdown 文件', 'Only Markdown files can be opened'],
  ['文件已改变或不属于已选择的文件夹', 'The file changed or is outside the selected folder'],
  ['搜索内容过长', 'Search text is too long'],
  ['符号链接文档只能另存为普通文件', 'Save this symbolic link document as a regular file'],
  ['路径不是普通文件', 'The path is not a regular file'],
  ['文件不是有效的 UTF-8 文本', 'The file is not valid UTF-8 text'],
  ['文档路径已改变，请另存为普通文件', 'The document path changed. Save it as a regular file'],
  ['文档尚未打开', 'The document is not open yet'],
  ['目标文件已存在，请选择其他文件名', 'The target file already exists. Choose another name'],
  ['混合换行文件需要确认转换或另存副本', 'Confirm mixed line ending conversion or save a copy'],
  ['磁盘文件已被其他程序修改', 'Another program changed the file on disk'],
  ['文档目录已改变，请另存为普通文件', 'The document folder changed. Save it as a regular file'],
  ['只能在编辑器中打开 Markdown 文件', 'Only Markdown files can be opened in the editor'],
  ['一次只能导入 1～20 张图片', 'Import 1 to 20 images at a time'],
  ['图片数据无效', 'Invalid image data'],
  ['单张图片不能超过 10 MB', 'Each image must be 10 MB or less'],
  ['仅支持 PNG、JPEG、GIF、WebP 和 AVIF 图片', 'Only PNG, JPEG, GIF, WebP and AVIF images are supported'],
  ['一次导入的图片不能超过 50 MB', 'Images in one import must total 50 MB or less'],
  ['文档路径已改变，请重新打开', 'The document path changed. Open it again'],
  ['图片目录必须是普通文件夹', 'The image folder must be a regular folder'],
  ['图片目录已改变', 'The image folder changed'],
  ['图片路径无效', 'Invalid image path'],
  ['图片位于文档目录之外或路径不受支持', 'The image is outside the document folder or its path is unsupported'],
  ['图片位于文档目录之外', 'The image is outside the document folder'],
  ['不支持此图片格式', 'This image format is unsupported'],
  ['图片路径已改变', 'The image path changed'],
  ['图片超过 10 MB', 'The image exceeds 10 MB'],
  ['不支持的导出格式', 'Unsupported export format'],
  ['导出内容无效或过大', 'Export content is invalid or too large'],
  ['PDF 导出设置无效', 'Invalid PDF export settings'],
  ['包含本地图片的文档需要先保存为 Markdown 文件', 'Save the document as Markdown before exporting local images']
] as const

const byChinese = new Map<string, string>(pairs)
const byEnglish = new Map<string, string>(pairs.map(([chinese, english]) => [english, chinese]))

export function localizeAppError(language: Language, message: string): string {
  return language === 'en' ? byChinese.get(message) ?? message : byEnglish.get(message) ?? message
}

export function describeAppError(language: Language, message: string): string {
  const raw = message.replace(/^Error:\s*/, '')
  if (byChinese.has(raw) || byEnglish.has(raw)) return localizeAppError(language, raw)
  return text(language, 'notice.unknownError', { error: raw })
}

export function defaultUntitledFileName(language: Language): string {
  return language === 'en' ? 'Untitled.md' : '未命名.md'
}
