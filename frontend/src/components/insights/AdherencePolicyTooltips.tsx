/**
 * Adherence policy, stated on the columns it governs — the twin of
 * AttendancePolicyTooltips. The point bands hang off the Rolling-90 Points
 * header, the discipline ladder off Standing. Reuses the shared HeaderTooltip so
 * the two reports read identically, and every figure comes from the summary
 * response so both show the version in force on the as-of date.
 */
import { HeaderTooltip } from './AttendancePolicyTooltips'
import { LEVEL_VARIANT, fmtDuration } from './attendancePolicy'
import StatusBadge from './StatusBadge'
import type { AdherenceKind, AdherencePointBand, AdherenceWarningLevel } from '@/services/insightsAdherenceService'

/** Bands grouped by what they measure: punch timing first, then phone, so the
 *  table reads Break/Lunch start → long → missed, then the phone edges. */
const KIND_ORDER: Record<AdherenceKind, number> = {
  BREAK_START: 0,
  BREAK_DURATION: 1,
  BREAK_MISSED: 2,
  LUNCH_START: 3,
  LUNCH_DURATION: 4,
  LUNCH_MISSED: 5,
  BREAK_PHONE_START: 6,
  BREAK_PHONE_STOP: 7,
  LUNCH_PHONE_START: 8,
  LUNCH_PHONE_STOP: 9,
}

const isMissed = (kind: AdherenceKind) => kind === 'BREAK_MISSED' || kind === 'LUNCH_MISSED'

/** Thresholds are whole points in practice; only show cents when there are any. */
function fmtThreshold(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

/**
 * Rolling-90 Points is a sum of banded charges, so the bands are what explains it
 * — break/lunch duration and start time against the schedule, plus phone-vs-punch.
 */
export function AdherencePointsHeader({ bands, label = 'Rolling-90 Points' }: {
  bands: AdherencePointBand[]
  label?: string
}) {
  const ordered = [...bands].sort(
    (a, b) => (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99) || a.minSeconds - b.minSeconds,
  )

  return (
    <HeaderTooltip
      label={label}
      description="Every adherence point charged in the last 90 days. Each occurrence is charged the full value of the band it falls into, and ranges are inclusive on both ends."
      width="w-[420px]"
    >
      {ordered.length === 0 ? (
        <p className="text-[11.5px] text-slate-400">No point bands configured.</p>
      ) : (
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-slate-400 border-b border-slate-200">
              <th className="text-left pb-1 font-medium">Band</th>
              <th className="text-right pb-1 px-2 font-medium">From</th>
              <th className="text-right pb-1 px-2 font-medium">To</th>
              <th className="text-right pb-1 font-medium">Points</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map(b => (
              <tr key={b.ruleKey} className="border-b border-slate-100 last:border-0">
                <td className="py-1 text-slate-700">{b.label}</td>
                {/* A missed break/lunch has no deviation range: the whole segment
                    is the miss. */}
                {isMissed(b.kind) ? (
                  <td className="py-1 px-2 text-center text-slate-500" colSpan={2}>Whole segment</td>
                ) : (
                  <>
                    <td className="py-1 px-2 text-right tabular-nums text-slate-600">{fmtDuration(b.minSeconds)}</td>
                    <td className="py-1 px-2 text-right tabular-nums text-slate-600">
                      {b.maxSeconds === null ? 'No limit' : fmtDuration(b.maxSeconds)}
                    </td>
                  </>
                )}
                <td className="py-1 text-right tabular-nums text-slate-900 font-medium">{b.points.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </HeaderTooltip>
  )
}

/**
 * The discipline ladder behind Standing. Ascends, because it is read as a
 * progression toward separation. While points are report-only the ladder is shown
 * but nobody is charged yet, so the tooltip says so.
 */
export function AdherenceStandingHeader({ levels, pointsActive }: {
  levels: AdherenceWarningLevel[]
  pointsActive: boolean
}) {
  const ladder = [...levels].sort((a, b) => a.pointsThreshold - b.pointsThreshold)

  return (
    <HeaderTooltip
      label="Standing"
      description={pointsActive
        ? 'Where the rolling 90-day total triggers each step. A person stands at the highest step their total has reached.'
        : 'Where the rolling 90-day total would trigger each step. Points are report-only right now, so nobody is charged yet — every row reads Report-only.'}
      width="w-72"
    >
      {ladder.length === 0 ? (
        <p className="text-[11.5px] text-slate-400">No thresholds configured.</p>
      ) : (
        <div className="space-y-1">
          {ladder.map(l => (
            <div key={l.levelKey} className="flex items-center justify-between gap-3 py-0.5">
              <StatusBadge label={l.label} variant={LEVEL_VARIANT[l.levelKey] ?? 'warning'} />
              <span className="text-[11.5px] tabular-nums text-slate-900 font-medium">
                {fmtThreshold(l.pointsThreshold)} pts
              </span>
            </div>
          ))}
        </div>
      )}
    </HeaderTooltip>
  )
}
