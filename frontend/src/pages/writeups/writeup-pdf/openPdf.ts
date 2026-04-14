import { pdf } from '@react-pdf/renderer'
import { createElement } from 'react'
import { WriteUpPdfDocument } from './WriteUpPdf'
import type { WriteUpDetail } from '@/services/writeupService'

export async function openWriteUpPdf(writeup: WriteUpDetail) {
  const doc = createElement(WriteUpPdfDocument, { writeup })
  const blob = await pdf(doc).toBlob()
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
}
