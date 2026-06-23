import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Shared column header for "pace" metrics across the Agent Activity reports.
 *
 * The label itself is the hover trigger (no info-icon / question-mark), and the
 * tooltip content mirrors the KPI info card layout used by the Quality
 * "Audits Completed" tile (KpiInfoCard): a bold title, a description
 * paragraph, then labelled Formula / Days-Used rows inside a white rounded
 * card. Keeping this in one component means every pace column (Sub Pace,
 * Margin Pace, Lead Pace, …) reads identically.
 *
 * Role behaviour also mirrors KpiInfoCard: the self-scoped agent (CSR) view
 * gets the title + plain-language description (phrased as the agent's own
 * numbers) and the day basis, but not the raw formula row.
 *
 * The label sits inside SortableTable's clickable <th>; the tooltip opens on
 * hover and a click still bubbles up to toggle the column sort.
 */
interface PaceHeaderProps {
  /** Column label, e.g. "Sub Pace". */
  label: string
  /** Full noun for the description, e.g. "subscriptions" / "total margin". */
  metric: string
  /** Short noun for the formula line; defaults to `metric`. */
  metricShort?: string
  /** Business days that actually have data (the numerator basis). */
  elapsed?: number
  /** Total business days in the period (the multiplier). */
  total?: number
  /** Latest date with data (ISO YYYY-MM-DD); shown as "(through MM-DD-YYYY)". */
  throughDate?: string | null
  /** Self-scoped agent view — phrases the metric as the agent's own. */
  agentView?: boolean
}

// ISO (YYYY-MM-DD) -> MM-DD-YYYY, matching the filter bar / Prior Date Range display.
function fmtThrough(iso?: string | null): string | null {
  if (!iso) return null
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${m}-${d}-${y}` : iso
}

export default function PaceHeader({
  label, metric, metricShort, elapsed, total, throughDate, agentView = false,
}: PaceHeaderProps) {
  const short = metricShort ?? metric
  const owner = agentView ? 'your ' : ''
  const through = fmtThrough(throughDate)
  const haveDays = elapsed != null && total != null

  const description =
    `Projected ${owner}${metric} for the full period. Business days with data stop at the ` +
    `latest loaded date, so a partial or not-yet-loaded day won't drag the projection down.`

  const formula = `(${short} so far \u00F7 business days with data) \u00D7 business days in the period`
  const daysUsed = haveDays
    ? `${elapsed} of ${total} business days${through ? ` (through ${through})` : ''}`
    : null

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>{label}</span>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          sideOffset={6}
          className="w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
        >
          <div className="space-y-3 text-left">
            <p className="text-[13px] font-semibold text-slate-900 leading-tight">{label}</p>

            <p className="text-[12.5px] text-slate-600 leading-relaxed">{description}</p>

            <div className="space-y-2.5 pt-2 border-t border-slate-100">
              {/* Raw formula is manager/admin-level detail; the agent view omits it. */}
              {!agentView && (
                <Row label="Formula">
                  <span className="font-mono text-[11px] text-slate-600">{formula}</span>
                </Row>
              )}
              {daysUsed && (
                <Row label="Days Used">
                  <span className="text-[11.5px] text-slate-600">{daysUsed}</span>
                </Row>
              )}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// Label/value row — mirrors KpiInfoCard's Row so pace tooltips read identically
// to the Quality KPI info cards.
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[10px] uppercase tracking-wide text-slate-400 w-[88px] shrink-0 whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 min-w-0 break-words">{children}</div>
    </div>
  )
}
