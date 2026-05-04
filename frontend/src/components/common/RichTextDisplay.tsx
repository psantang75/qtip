import DOMPurify from 'dompurify'
import { cn } from '@/lib/utils'

const ALLOWED_TAGS = ['p', 'ul', 'ol', 'li', 'strong', 'em', 'u', 'br', 'a']
const ALLOWED_ATTR = ['href', 'target', 'rel']

interface RichTextDisplayProps {
  html: string | null | undefined
  placeholder?: string
  className?: string
  bold?: boolean
}

function isHtml(str: string): boolean {
  return /<[a-z][\s\S]*>/i.test(str)
}

/** Strip HTML tags and collapse whitespace — useful for truncated previews. */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return ''
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Convert HTML to plain text while preserving paragraph / line breaks
 * and decoding entities. For when we want to display the readable text
 * content of a rich-HTML field (e.g. CRM email/note bodies) without any
 * markup but also without collapsing the whole thing onto one line.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return ''
  if (!isHtml(html)) return html

  const withBreaks = html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|li|tr|h[1-6]|blockquote)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')

  let text: string
  if (typeof window !== 'undefined' && typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(withBreaks, 'text/html')
    text = doc.body?.textContent ?? ''
  } else {
    text = withBreaks
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&ndash;/gi, '–')
      .replace(/&mdash;/gi, '—')
  }

  return text
    .split('\n')
    .map((l) => l.replace(/[ \t\r]+/g, ' ').trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1].length > 0))
    .join('\n')
    .trim()
}

export function RichTextDisplay({ html, placeholder, className, bold }: RichTextDisplayProps) {
  const textStyle = bold ? 'text-[14px] font-semibold text-slate-900' : 'text-[14px] text-slate-700'

  if (!html) {
    return placeholder
      ? <p className={cn('text-[14px] text-slate-400 italic', className)}>{placeholder}</p>
      : null
  }

  if (!isHtml(html)) {
    return <p className={cn(textStyle, 'whitespace-pre-wrap leading-relaxed', className)}>{html}</p>
  }

  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR })

  return (
    <div
      className={cn(
        'prose prose-sm max-w-none leading-relaxed',
        '[&_a]:text-primary [&_a]:underline [&_a:hover]:text-primary/80',
        textStyle,
        className,
      )}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}
