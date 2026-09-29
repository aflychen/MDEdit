import { describe, expect, it } from 'vitest'
import { defaultUntitledFileName, localizeAppError } from '../src/shared/error-messages'

describe('application error localization', () => {
  it('translates a document error in both directions', () => {
    expect(localizeAppError('en', '文件不是有效的 UTF-8 文本')).toBe('The file is not valid UTF-8 text')
    expect(localizeAppError('zh-CN', 'The file is not valid UTF-8 text')).toBe('文件不是有效的 UTF-8 文本')
  })

  it('keeps raw OS errors unchanged and chooses the default file name by language', () => {
    expect(localizeAppError('en', 'EACCES: permission denied')).toBe('EACCES: permission denied')
    expect(defaultUntitledFileName('en')).toBe('Untitled.md')
    expect(defaultUntitledFileName('zh-CN')).toBe('未命名.md')
  })
})
