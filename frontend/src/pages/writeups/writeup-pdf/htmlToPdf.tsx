import { Text, View } from '@react-pdf/renderer'
import { createElement, type ReactElement } from 'react'

const BODY_SIZE = 9
const BODY_COLOR = '#334155'
const MID_COLOR = '#475569'
const LINE_HEIGHT = 1.5

type PdfNode = ReactElement | string

function isHtml(str: string): boolean {
  return /<[a-z][\s\S]*>/i.test(str)
}

export function htmlToPdfNodes(
  html: string | null | undefined,
  opts?: { fontSize?: number; color?: string },
): ReactElement | null {
  if (!html) return null

  const fs = opts?.fontSize ?? BODY_SIZE
  const clr = opts?.color ?? BODY_COLOR

  if (!isHtml(html)) {
    return plainToPdf(html, fs, clr)
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const nodes = walkChildren(doc.body, fs, clr)
  if (nodes.length === 0) return null
  return createElement(View, { key: 'html-root' }, ...nodes)
}

function plainToPdf(text: string, fs: number, clr: string): ReactElement {
  const lines = text.split('\n')
  return createElement(
    View, null,
    ...lines.map((line, i) =>
      createElement(Text, {
        key: i,
        style: { fontSize: fs, color: clr, lineHeight: LINE_HEIGHT, marginBottom: 2 },
      }, line || ' '),
    ),
  )
}

function walkChildren(parent: Node, fs: number, clr: string): PdfNode[] {
  const result: PdfNode[] = []
  parent.childNodes.forEach((node, idx) => {
    const el = convertNode(node, fs, clr, idx)
    if (el !== null) result.push(el)
  })
  return result
}

function convertNode(node: Node, fs: number, clr: string, key: number): PdfNode | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? ''
    return text.trim() ? text : null
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return null
  const el = node as HTMLElement
  const tag = el.tagName.toLowerCase()

  switch (tag) {
    case 'p':
      return createElement(
        Text,
        { key, style: { fontSize: fs, color: clr, lineHeight: LINE_HEIGHT, marginBottom: 4 } },
        ...inlineChildren(el, fs, clr),
      )

    case 'ul':
      return createElement(
        View, { key, style: { marginBottom: 4 } },
        ...Array.from(el.children).map((li, i) =>
          createElement(
            View,
            { key: i, style: { flexDirection: 'row', marginBottom: 2 } },
            createElement(Text, { style: { fontSize: fs, color: MID_COLOR, width: 12 } }, '\u2022'),
            createElement(
              Text,
              { style: { fontSize: fs, color: clr, lineHeight: LINE_HEIGHT, flex: 1 } },
              ...inlineChildren(li, fs, clr),
            ),
          ),
        ),
      )

    case 'ol':
      return createElement(
        View, { key, style: { marginBottom: 4 } },
        ...Array.from(el.children).map((li, i) =>
          createElement(
            View,
            { key: i, style: { flexDirection: 'row', marginBottom: 2 } },
            createElement(Text, { style: { fontSize: fs, color: MID_COLOR, width: 14 } }, `${i + 1}.`),
            createElement(
              Text,
              { style: { fontSize: fs, color: clr, lineHeight: LINE_HEIGHT, flex: 1 } },
              ...inlineChildren(li, fs, clr),
            ),
          ),
        ),
      )

    case 'br':
      return createElement(Text, { key }, '\n')

    default: {
      const children = walkChildren(el, fs, clr)
      return children.length > 0
        ? createElement(View, { key }, ...children)
        : null
    }
  }
}

function inlineChildren(parent: Node, fs: number, clr: string): PdfNode[] {
  const result: PdfNode[] = []
  parent.childNodes.forEach((node, idx) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      if (text) result.push(text)
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    const tag = el.tagName.toLowerCase()
    const content = el.textContent ?? ''
    if (!content.trim()) return

    switch (tag) {
      case 'strong':
        result.push(createElement(Text, { key: idx, style: { fontFamily: 'Helvetica-Bold' } }, ...inlineChildren(el, fs, clr)))
        break
      case 'em':
        result.push(createElement(Text, { key: idx, style: { fontFamily: 'Helvetica-Oblique' } }, ...inlineChildren(el, fs, clr)))
        break
      case 'u':
        result.push(createElement(Text, { key: idx, style: { textDecoration: 'underline' } }, ...inlineChildren(el, fs, clr)))
        break
      default:
        result.push(...inlineChildren(el, fs, clr))
    }
  })
  return result
}
