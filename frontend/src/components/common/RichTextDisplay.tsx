import DOMPurify from 'dompurify'
import { cn } from '@/lib/utils'

const ALLOWED_TAGS = ['p', 'ul', 'ol', 'li', 'strong', 'em', 'u', 'br']

interface RichTextDisplayProps {
  html: string | null | undefined
  placeholder?: string
  className?: string
}

function isHtml(str: string): boolean {
  return /<[a-z][\s\S]*>/i.test(str)
}

export function RichTextDisplay({ html, placeholder, className }: RichTextDisplayProps) {
  if (!html) {
    return placeholder
      ? <p className={cn('text-[13px] text-slate-400 italic', className)}>{placeholder}</p>
      : null
  }

  if (!isHtml(html)) {
    return <p className={cn('text-[13px] text-slate-700 whitespace-pre-wrap leading-relaxed', className)}>{html}</p>
  }

  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS })

  return (
    <div
      className={cn('prose prose-sm max-w-none text-[13px] text-slate-700 leading-relaxed', className)}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}
