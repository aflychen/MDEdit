export type PdfPaperSize = 'A4' | 'A5' | 'Letter'
export type PdfMargin = 'narrow' | 'normal' | 'wide'

export interface PdfExportOptions {
  paperSize: PdfPaperSize
  margin: PdfMargin
  pageBreakBeforeH1: boolean
}

export const DEFAULT_PDF_EXPORT_OPTIONS: PdfExportOptions = {
  paperSize: 'A4',
  margin: 'normal',
  pageBreakBeforeH1: false
}

const marginMillimeters: Record<PdfMargin, number> = { narrow: 10, normal: 18, wide: 25 }

export function parsePdfExportOptions(input: unknown): PdfExportOptions {
  if (input === undefined) return { ...DEFAULT_PDF_EXPORT_OPTIONS }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('PDF 导出设置无效')
  const value = input as Record<string, unknown>
  if (value.paperSize !== 'A4' && value.paperSize !== 'A5' && value.paperSize !== 'Letter') throw new Error('PDF 导出设置无效')
  if (value.margin !== 'narrow' && value.margin !== 'normal' && value.margin !== 'wide') throw new Error('PDF 导出设置无效')
  if (typeof value.pageBreakBeforeH1 !== 'boolean') throw new Error('PDF 导出设置无效')
  return { paperSize: value.paperSize, margin: value.margin, pageBreakBeforeH1: value.pageBreakBeforeH1 }
}

export function pdfPageStyles(options: PdfExportOptions): string {
  const { paperSize, margin, pageBreakBeforeH1 } = parsePdfExportOptions(options)
  const page = `@page { size: ${paperSize}; margin: ${marginMillimeters[margin]}mm; }`
  const headings = pageBreakBeforeH1
    ? '\n@media print { .document > h1:not(:first-child) { break-before: page; } }'
    : ''
  return page + headings
}
