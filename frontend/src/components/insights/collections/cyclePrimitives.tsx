/**
 * The two shapes every Cycle Performance stage is built from.
 *
 * Stage 1 (outcomes), stage 2 (task coverage, touch bands) and stage 3 (recovery
 * paths) all render the same white stat card and the same labelled share bar, so
 * they live here once instead of three times.
 */
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
export function StatCard({
  label,
  value,
  accent,
  accentClass = 'text-primary',
  note,
  dot,
}: {
  label: string
  value: string
  accent?: string
  accentClass?: string
  note?: string
  dot?: string
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-1.5">
        {dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}
        <span className="text-xs font-medium text-slate-600">{label}</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-2xl font-bold leading-none text-slate-900">{value}</span>
        {accent && <span className={`text-sm font-semibold ${accentClass}`}>{accent}</span>}
      </div>
      {note && <div className="mt-1 text-[11px] text-slate-400">{note}</div>}
    </div>
  )
}

/**
 * A labelled row with a share bar underneath, sized against the section total.
 *
 * `info` explains what the row counts. Per the house tooltip rule the ROW ITSELF is
 * the hover trigger — never an added (i) button — so the thing being explained and
 * the thing you point at are the same element. Needs a `TooltipProvider` above it.
 */
export function BarRow({
  label,
  detail,
  value,
  total,
  info,
}: {
  label: string
  detail: string
  value: number
  total: number
  info?: string
}) {
  const pct = total > 0 ? (value / total) * 100 : 0
  const row = (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12.5px] font-medium text-slate-700">{label}</span>
        <span className="text-[12.5px] text-slate-500">{detail}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
  if (!info) return row

  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="max-w-[320px] rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
      >
        <div className="text-[13px] font-semibold text-slate-900">{label}</div>
        <p className="mt-1 text-[12.5px] leading-snug text-slate-600">{info}</p>
        {/* The basis the bar was drawn from, not a restatement of the row: the reader
            can see the share, this says what it is a share OF. */}
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Basis</div>
          <div className="text-[12px] text-slate-700">
            {value.toLocaleString()} of {total.toLocaleString()} ({pct.toFixed(1)}%)
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}