import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface TopicListTooltipProps {
  topics: string[]
  /** Tailwind max-width class for the truncated trigger span (e.g. "max-w-[180px]"). */
  maxWidthClass?: string
}

/**
 * TopicListTooltip — truncated comma-list of topics with a hover tooltip
 * that shows the full bulleted list. Shared across the Training module.
 */
export function TopicListTooltip({
  topics,
  maxWidthClass = 'max-w-[180px]',
}: TopicListTooltipProps) {
  if (topics.length === 0) {
    return <span className="text-[13px] text-slate-300">&mdash;</span>
  }
  const sorted = [...topics].sort()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'text-[13px] text-slate-500 truncate block cursor-default',
            maxWidthClass,
          )}
        >
          {sorted.join(', ')}
        </span>
      </TooltipTrigger>
      <TooltipContent
        className="max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
        sideOffset={6}
      >
        <ul className="space-y-1">
          {sorted.map(t => (
            <li key={t} className="flex items-center gap-2 text-[13px] text-slate-700">
              <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
              {t}
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  )
}
