/**
 * Time Off Import — what the Paychex punch feed's Non-Work blocks became.
 *
 * Paychex owns time off; scheduling reads it off the punch export and writes the
 * exceptions that stop approved leave from earning attendance points. This page
 * is the audit of that translation, and it is deliberately read-only: fixing a
 * row means fixing it in Paychex, or logging a manual exception in the calendar,
 * which always wins over an imported one.
 *
 * The classification runs live on every request rather than being stored, so
 * what is shown here is by construction what attendance actually scored.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarX } from 'lucide-react'

import { ListPageShell } from '@/components/common/ListPageShell'
import { ListPageHeader } from '@/components/common/ListPageHeader'
import { ListFilterBar } from '@/components/common/ListFilterBar'
import { ListCard } from '@/components/common/ListCard'
import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import schedulingService, { type TimeOffOutcome } from '@/services/schedulingService'
import { parseLocal, toLocalIso, addDays } from '@/components/scheduling/mockScheduleData'

const fmtDate = (iso: string) =>
  parseLocal(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const fmtHours = (min: number) => (min === 0 ? '\u2014' : `${(min / 60).toFixed(2)}h`)

/** 12-hour display, matching the attendance roster. */
const fmtTime = (hm: string) => {
  const [h, m] = hm.split(':').map(Number)
  const suffix = h < 12 ? 'AM' : 'PM'
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`
}

interface OutcomeMeta { label: string; tone: 'applied' | 'skipped' | 'attention'; help: string }

const OUTCOMES: Record<TimeOffOutcome, OutcomeMeta> = {
  FULL_DAY: {
    label: 'Full day', tone: 'applied',
    help: 'The leave covers the whole shift, so the day is out of attendance entirely.',
  },
  PARTIAL: {
    label: 'Partial day', tone: 'applied',
    help: 'The leave covers part of the shift. Only the hours in the window are forgiven.',
  },
  MANUAL_OVERRIDE: {
    label: 'Manual entry wins', tone: 'skipped',
    help: 'Somebody already logged an exception for this day by hand, so the import left it alone.',
  },
  NO_SHIFT: {
    label: 'Not scheduled', tone: 'skipped',
    help: 'No published shift that day, so there is no attendance to forgive.',
  },
  DAY_OFF: {
    label: 'Day off', tone: 'skipped',
    help: 'A scheduled day off or a company closure. Nothing was expected of them.',
  },
  OUTSIDE_SHIFT: {
    label: 'Outside the shift', tone: 'attention',
    help: 'The leave falls entirely outside the hours they were scheduled, so it forgives nothing. Usually means the schedule and Paychex disagree about that day.',
  },
  UNMAPPED: {
    label: 'Pay type not linked', tone: 'attention',
    help: 'No exception type is linked to this Paychex pay type, so the leave was ignored. Link it in Admin > List Management > Exception Types.',
  },
}

const TONE_CLS: Record<OutcomeMeta['tone'], string> = {
  applied: 'border-success/30 bg-success/10 text-success',
  skipped: 'border-slate-200 bg-slate-50 text-slate-500',
  attention: 'border-warning/40 bg-warning/10 text-warning',
}

function SummaryTile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-center">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tabular-nums text-neutral-900">{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>
    </div>
  )
}

export default function TimeOffImportReviewPage() {
  const [from, setFrom] = useState(addDays(toLocalIso(new Date()), -30))
  const [to, setTo] = useState(toLocalIso(new Date()))

  const { data, isLoading } = useQuery({
    queryKey: ['time-off-import-review', from, to],
    queryFn: () => schedulingService.timeOffImportReview(from, to),
  })

  const rows = useMemo(() => data?.rows ?? [], [data])
  const counts = useMemo(() => {
    const applied = rows.filter(r => r.outcome === 'FULL_DAY' || r.outcome === 'PARTIAL').length
    const attention = rows.filter(r => OUTCOMES[r.outcome].tone === 'attention').length
    return { applied, attention, skipped: rows.length - applied - attention }
  }, [rows])

  // Anything needing a human first, then newest day first.
  const ordered = useMemo(() => [...rows].sort((a, b) => {
    const rank = (o: TimeOffOutcome) => (OUTCOMES[o].tone === 'attention' ? 0 : 1)
    return rank(a.outcome) - rank(b.outcome) || b.exception_date.localeCompare(a.exception_date)
  }), [rows])

  return (
    <ListPageShell>
      <ListPageHeader
        title="Time Off Import"
        subtitle="Every time-off block in the Paychex feed and what became of it — including the ones that produced no exception."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/app/scheduling/exceptions">
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Attendance Exceptions
            </Link>
          </Button>
        }
      />

      <ListFilterBar hasFilters={false} onReset={() => {}} resultCount={{ filtered: rows.length, total: rows.length }}>
        <div className="flex items-center gap-2">
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 w-[160px]" />
          <span className="text-[12px] text-slate-400">to</span>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 w-[160px]" />
        </div>
      </ListFilterBar>

      <div className="mb-4 flex gap-3">
        <SummaryTile label="Blocks read" value={String(data?.blocks ?? 0)} hint="Non-work punches in range" />
        <SummaryTile label="Exceptions applied" value={String(counts.applied)} hint="Leave now forgiven" />
        <SummaryTile label="Nothing to forgive" value={String(counts.skipped)} hint="Days off, closures, manual entries" />
        <SummaryTile label="Needs a look" value={String(counts.attention)} hint="Unlinked pay type or schedule mismatch" />
      </div>

      <ListCard>
        {isLoading ? (
          <ListLoadingSkeleton rows={8} />
        ) : (
          <TooltipProvider delayDuration={150}>
            <Table>
              <TableHeader>
                <StandardTableHeaderRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Paychex Pay Type</TableHead>
                  <TableHead>Exception Type</TableHead>
                  <TableHead className="text-right">Leave</TableHead>
                  <TableHead className="text-right">Scheduled</TableHead>
                  <TableHead>Applied To</TableHead>
                  <TableHead>Result</TableHead>
                </StandardTableHeaderRow>
              </TableHeader>
              <TableBody>
                {ordered.length === 0 ? (
                  <TableEmptyState colSpan={8} icon={CalendarX} title="No time off in this range" />
                ) : (
                  ordered.map((r, i) => {
                    const meta = OUTCOMES[r.outcome]
                    return (
                      <TableRow key={`${r.user_id}-${r.exception_date}-${r.pay_type}-${i}`}>
                        <TableCell className="font-medium text-neutral-900">{r.username}</TableCell>
                        <TableCell className="tabular-nums text-slate-700">{fmtDate(r.exception_date)}</TableCell>
                        <TableCell className="text-slate-700">{r.pay_type}</TableCell>
                        <TableCell className="text-slate-600">{r.type_label ?? '\u2014'}</TableCell>
                        <TableCell className="text-right tabular-nums text-slate-600">{fmtHours(r.block_minutes)}</TableCell>
                        <TableCell className="text-right tabular-nums text-slate-600">{fmtHours(r.scheduled_minutes)}</TableCell>
                        <TableCell className="tabular-nums text-slate-600">
                          {r.is_full_day
                            ? 'Whole shift'
                            : r.start && r.end ? `${fmtTime(r.start)} \u2013 ${fmtTime(r.end)}` : '\u2014'}
                        </TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className={cn('cursor-default font-medium', TONE_CLS[meta.tone])}>
                                {meta.label}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-[280px] rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                              <p className="text-[13px] font-semibold text-neutral-900">{meta.label}</p>
                              <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">{meta.help}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </TooltipProvider>
        )}
      </ListCard>
    </ListPageShell>
  )
}
