/**
 * The attendance policy, stated on the columns it governs: the point bands hang
 * off Rolling 90, the discipline ladder off Level, and the grace boundary off
 * Grace. Policy belongs on the number it explains — a separate card makes the
 * reader hold two places in their head, and a hardcoded table would drift the
 * day somebody edits a band.
 *
 * Every figure comes from the summary response, so all three show the version in
 * force on the as-of date.
 *
 * Also the home of the shared policy vocabulary (level → badge colour, seconds →
 * the H:MM:SS the policy is written in) so the roster and the page read it from
 * one place.
 */
import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import StatusBadge from './StatusBadge'
import type { AttendancePointBand, AttendanceWarningLevel } from '@/services/insightsCsrService'

export const LEVEL_VARIANT: Record<string, 'warning' | 'bad'> = {
  coaching: 'warning',
  verbal: 'warning',
  written: 'bad',
  final: 'bad',
  separation: 'bad',
}

/** 'H:MM:SS' from seconds, matching how the policy table is written. */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Bands are grouped by what they measure, worst-case last. */
const KIND_ORDER: Record<AttendancePointBand['kind'], number> = {
  LATE: 0,
  EARLY_LEAVE: 1,
  ABSENT: 2,
  EXCEPTION: 3,
}

/** Thresholds are whole points in practice; only show cents when there are any. */
function fmtThreshold(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

// ── Header tooltips ──────────────────────────────────────────────────────────
// The circled "i" is the trigger, matching how every other Insights section
// carries its explanation. Content states the basis actually used rather than a
// generic formula, per docs/design.md §6.6.

function HeaderTooltip({ label, description, rows, width = 'w-80', children }: {
  label: string
  description: string
  /** Label/value supporting detail, rendered below the description. */
  rows?: Array<[string, string]>
  width?: string
  children?: React.ReactNode
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center justify-end gap-1 cursor-help">
            {label}
            <Info aria-label={`About ${label}`} className="h-3.5 w-3.5 shrink-0 text-slate-400 hover:text-primary transition-colors" />
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          sideOffset={6}
          className={cn(width, 'rounded-xl border border-slate-200 bg-white p-3 shadow-lg')}
        >
          <div className="space-y-3 text-left">
            <p className="text-[13px] font-semibold text-slate-900 leading-tight">{label}</p>
            <p className="text-[12.5px] text-slate-600 leading-relaxed">{description}</p>
            {rows && (
              <div className="space-y-2 pt-2 border-t border-slate-100">
                {rows.map(([k, v]) => (
                  <div key={k} className="flex items-baseline gap-3">
                    <span className="text-[10px] uppercase tracking-wide text-slate-400 w-[88px] shrink-0">{k}</span>
                    <span className="text-[11.5px] text-slate-600 flex-1">{v}</span>
                  </div>
                ))}
              </div>
            )}
            {children && <div className="pt-2 border-t border-slate-100">{children}</div>}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** Rolling 90 is a sum of banded charges, so the bands are what explains it. */
export function RollingPointsHeader({ bands, graceCeilingSeconds }: {
  bands: AttendancePointBand[]
  graceCeilingSeconds: number | null
}) {
  const ordered = [...bands].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.minSeconds - b.minSeconds,
  )

  return (
    <HeaderTooltip
      label="Rolling 90"
      description="Every point charged in the last 90 days. Each occurrence is charged the full value of the band it falls into, and ranges are inclusive on both ends."
      width="w-[400px]"
    >
      {ordered.length === 0 ? (
        <p className="text-[11.5px] text-slate-400">No point bands configured.</p>
      ) : (
        <>
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
                  {/* A full-day occurrence has no deviation range to state: the
                      whole shift is the deviation. */}
                  {b.kind === 'ABSENT' || b.kind === 'EXCEPTION' ? (
                    <td className="py-1 px-2 text-center text-slate-500" colSpan={2}>Full day</td>
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
          {graceCeilingSeconds !== null && (
            <p className="text-[11px] text-slate-500 mt-2">
              Grace: late by 1 second up to {fmtDuration(graceCeilingSeconds)} earns no points.
            </p>
          )}
        </>
      )}
    </HeaderTooltip>
  )
}

/** The ladder ascends, because it is read as a progression toward separation. */
export function LevelHeader({ levels }: { levels: AttendanceWarningLevel[] }) {
  const ladder = [...levels].sort((a, b) => a.pointsThreshold - b.pointsThreshold)

  return (
    <HeaderTooltip
      label="Level"
      description="Where the rolling 90-day total triggers each step. A person stands at the highest step their total has reached."
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

/**
 * Grace is defined by the bands themselves — it is the gap below the lowest one,
 * not a separate setting. Stating the boundary from the live config means the
 * tooltip cannot drift from policy after somebody edits a band.
 */
export function GraceHeader({ ceilingSeconds }: { ceilingSeconds: number | null }) {
  const boundary = ceilingSeconds === null ? null : fmtDuration(ceilingSeconds)
  return (
    <HeaderTooltip
      label="Grace"
      description="Grace is the allowance below the first point band: arriving late, but not late enough to be charged. This column counts how many days a person used it. It is tracked because a point total on its own cannot see somebody who is two minutes late every single day."
      rows={[
        ['Definition', boundary
          ? `Late by 1 second up to ${boundary}, inclusive`
          : 'Late by any amount below the first point band'],
        ['Charged At', boundary
          ? `One second past ${boundary} — that is the first band, and it charges the full band`
          : 'The start of the first point band'],
        ['Points', 'None. This column is informational and never disciplinary.'],
      ]}
    />
  )
}
