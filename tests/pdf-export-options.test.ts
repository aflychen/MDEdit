import { describe, expect, it } from 'vitest'
import { DEFAULT_PDF_EXPORT_OPTIONS, parsePdfExportOptions, pdfPageStyles } from '../src/shared/pdf-export-options'

describe('PDF export options', () => {
  it('keeps the existing A4 and 18 mm layout when no settings were saved', () => {
    expect(parsePdfExportOptions(undefined)).toEqual(DEFAULT_PDF_EXPORT_OPTIONS)
    expect(pdfPageStyles(DEFAULT_PDF_EXPORT_OPTIONS)).toContain('@page { size: A4; margin: 18mm; }')
    expect(pdfPageStyles(DEFAULT_PDF_EXPORT_OPTIONS)).not.toContain('break-before: page')
  })

  it('generates selected paper and margin presets without accepting CSS input', () => {
    expect(pdfPageStyles({ paperSize: 'A5', margin: 'narrow', pageBreakBeforeH1: false })).toContain('@page { size: A5; margin: 10mm; }')
    expect(pdfPageStyles({ paperSize: 'Letter', margin: 'wide', pageBreakBeforeH1: false })).toContain('@page { size: Letter; margin: 25mm; }')
    expect(() => parsePdfExportOptions({ paperSize: 'A4; color:red', margin: 'normal', pageBreakBeforeH1: false })).toThrow('PDF 导出设置无效')
  })

  it('starts later level-one headings on a new page when requested', () => {
    const css = pdfPageStyles({ paperSize: 'A4', margin: 'normal', pageBreakBeforeH1: true })
    expect(css).toContain('.document > h1:not(:first-child) { break-before: page; }')
    expect(css).not.toContain('page-break-before')
  })

  it('rejects incomplete and incorrectly typed settings before printing', () => {
    expect(() => parsePdfExportOptions({ paperSize: 'A4', margin: 'normal' })).toThrow('PDF 导出设置无效')
    expect(() => parsePdfExportOptions({ paperSize: 'A4', margin: 'normal', pageBreakBeforeH1: 'yes' })).toThrow('PDF 导出设置无效')
    expect(() => parsePdfExportOptions(null)).toThrow('PDF 导出设置无效')
  })
})
