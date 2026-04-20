import DOMPurify from 'dompurify'
import { cn } from '@/lib/utils'

const ALLOWED_TAGS = ['p', 'ul', 'ol', 'li', 'strong', 'em', 'u', 'br']

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

  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS })

  return (
    <div
      className={cn('prose prose-sm max-w-none leading-relaxed', textStyle, className)}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}
