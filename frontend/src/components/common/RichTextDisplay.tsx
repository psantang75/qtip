import DOMPurify from 'dompurify'
import { cn } from '@/lib/utils'
import { isHtml } from '@/utils/htmlText'

const ALLOWED_TAGS = ['p', 'ul', 'ol', 'li', 'strong', 'em', 'u', 'br', 'a']
const ALLOWED_ATTR = ['href', 'target', 'rel']

interface RichTextDisplayProps {
  html: string | null | undefined
  placeholder?: string
  className?: string
  bold?: boolean
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
