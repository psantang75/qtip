import MetricTooltip from './MetricTooltip'
import { fmtHM } from './productivityModel'
import type { ProductivityRosterRow } from './productivityTypes'
import { useQualityRole } from '@/hooks/useQualityRole'

/**
 * Desk Utilization roster cell. The figure is its own tooltip trigger and the
 * card shows the actual minutes it was built from. Agents get the plain-language
 * description; everyone else also sees how the figure is put together.
 *
 * No target is set yet, so an in-range figure stays neutral. Over 100% is red:
 * desk and warehouse time can only exceed paid time when DeskTime was counting
 * the computer as productive while the phone status said "In Warehouse", so the
 * figure flags an inaccurate phone status rather than exceptional work.
 */
export default function DeskUtilizationCell({ row }: { row: ProductivityRosterRow }) {
  const { isAgent } = useQualityRole()
  const pct = row.deskUtilizationPct
  const known = pct != null
  const overlap = known && pct > 100

  const description = !known
    ? 'DeskTime has no productive time for this agent on this day, so Desk Utilization cannot be calculated.'
    : overlap
      ? isAgent
        ? 'Over 100% means your phone status showed In Warehouse while you were working at your computer. Keep your status current so this reads accurately.'
        : 'Over 100%: DeskTime counted the computer as productive while the phone status said In Warehouse, so that time is counted twice. The phone status is likely not being kept accurate.'
      : isAgent
        ? 'How much of your paid time was spent productively at your desk or working in the warehouse.'
        : 'Productive desk time from DeskTime plus Genesys "In Warehouse" time, as a share of paid time. The two are added, so time in both at once counts twice.'

  const cls = !known
    ? 'text-right tabular-nums text-slate-400'
    : overlap
      ? 'text-right font-semibold tabular-nums text-destructive'
      : 'text-right font-semibold tabular-nums text-slate-700'

  return (
    <MetricTooltip
      title="Desk Utilization"
      description={description}
      rows={[
        { label: 'Productive desk time', value: row.deskProductiveMin != null ? fmtHM(row.deskProductiveMin) : 'No data' },
        { label: 'In Warehouse', value: fmtHM(row.warehouseMin) },
        { label: 'Paid time', value: fmtHM(row.clockedMin) },
      ]}
    >
      <span className={cls}>{known ? `${pct}%` : '—'}</span>
    </MetricTooltip>
  )
}
