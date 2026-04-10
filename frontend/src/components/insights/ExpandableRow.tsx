import { useId } from 'react'
import { cn } from '@/lib/utils'
import { ChevronRight, ChevronDown } from 'lucide-react'

interface ExpandableRowProps {
  isExpanded: boolean
  onToggle: () => void
  summary: React.ReactNode
  detail: React.ReactNode
  highlightColor?: string
}

export default function ExpandableRow({
  isExpanded,
  onToggle,
  summary,
  detail,
  highlightColor = 'hover:bg-slate-50',
}: ExpandableRowProps) {
  const panelId = useId()

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden mb-2">
      <button
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={panelId}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors',
          isExpanded ? 'bg-slate-50' : highlightColor,
        )}
      >
        <span className="shrink-0 text-slate-400">
          {isExpanded
            ? <ChevronDown size={14} />
            : <ChevronRight size={14} />
          }
        </span>
        <span className="flex-1 min-w-0">{summary}</span>
      </button>

      {isExpanded && (
        <div id={panelId} role="region" className="bg-slate-50 border-t border-slate-200 p-3 mx-0">
          {detail}
        </div>
      )}
    </div>
  )
}
