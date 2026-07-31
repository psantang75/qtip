/**
 * MOCKUP — Phase 1 design probe only.
 *
 * The colour language is load-bearing once exceptions recolour the timeline,
 * so it gets stated rather than inferred. Escalation runs planned to
 * unplanned: working, scheduled away, excused, unexcused.
 */
import { cn } from '@/lib/utils'

const ITEMS: { cls: string; label: string }[] = [
  { cls: 'bg-primary/45 border border-primary/40', label: 'Working' },
  { cls: 'bg-slate-300', label: 'Break' },
  { cls: 'bg-slate-400', label: 'Lunch' },
  { cls: 'bg-warning', label: 'Excused' },
  { cls: 'bg-destructive', label: 'Not excused' },
]

/** The coverage strip has its own scale — it grades a headcount, not a status. */
const COVERAGE_ITEMS: { cls: string; label: string }[] = [
  { cls: 'bg-success/40', label: 'Covered' },
  { cls: 'bg-warning/45', label: 'Thin' },
  { cls: 'bg-destructive/35', label: 'Below minimum' },
  { cls: 'bg-destructive/70', label: 'Nobody working' },
]

export function ScheduleLegend({
  className, showCoverage,
}: { className?: string; showCoverage?: boolean }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      {ITEMS.map(item => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span className={cn('h-2.5 w-4 rounded-sm', item.cls)} />
          <span className="text-[11px] text-slate-500">{item.label}</span>
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-sm border border-dashed border-slate-300 bg-slate-100" />
        <span className="text-[11px] text-slate-500">Draft</span>
      </span>

      {showCoverage && (
        <>
          <span className="h-3 w-px bg-slate-200" />
          <span className="text-[11px] font-medium text-slate-400">Coverage</span>
          {COVERAGE_ITEMS.map(item => (
            <span key={item.label} className="flex items-center gap-1.5">
              <span className={cn('h-2.5 w-4 rounded-sm', item.cls)} />
              <span className="text-[11px] text-slate-500">{item.label}</span>
            </span>
          ))}
        </>
      )}
    </div>
  )
}
