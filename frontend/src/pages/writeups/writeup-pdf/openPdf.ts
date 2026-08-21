import { pdf } from '@react-pdf/renderer'
import { createElement, type ReactElement } from 'react'
import { WriteUpPdfDocument } from './WriteUpPdf'
import type { WriteUpDetail } from '@/services/writeupService'

export async function openWriteUpPdf(writeup: WriteUpDetail) {
  const doc = createElement(WriteUpPdfDocument, { writeup })
  // `pdf()` expects a `ReactElement<DocumentProps>`; the component element's own
  // props type doesn't line up, so widen to the base element type here.
  const blob = await pdf(doc as ReactElement).toBlob()
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
}
