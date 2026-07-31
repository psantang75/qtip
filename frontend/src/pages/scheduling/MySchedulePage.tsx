/**
 * My Schedule — the self view (OWN access). Read-only, published shifts only,
 * a fortnight at a time. Agents never see drafts; the backend enforces that,
 * this page just renders what it is given.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock, ChevronLeft, ChevronRight, Coffee, UtensilsCrossed } from 'lucide-react'

import { ListPageShell } from '@/components/common/ListPageShell'
import { ListPageHeader } from '@/components/common/ListPageHeader'
import { ListCard } from '@/components/common/ListCard'
import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import schedulingService, { type ApiShift } from '@/services/schedulingService'
import { addDays, parseLocal, startOfWeek, toLocalIso } from '@/components/scheduling/mockScheduleData'

const fmtLong = (iso: string) =>
  parseLocal(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

export default function MySchedulePage() {
  const [anchor, setAnchor] = useState(startOfWeek(toLocalIso(new Date())))
  const from = anchor
  const to = addDays(anchor, 13)

  const { data, isLoading } = useQuery({
    queryKey: ['my-schedule', from, to],
    queryFn: () => schedulingService.getMySchedule(from, to),
  })

  const byDate = useMemo(() => {
    const m = new Map<string, ApiShift>()
    for (const s of data ?? []) m.set(s.shift_date, s)
    return m
  }, [data])

  const days = Array.from({ length: 14 }, (_, i) => addDays(anchor, i))

  const rangeLabel = `${parseLocal(from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} \u2013 ${parseLocal(to).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  return (
    <ListPageShell>
      <ListPageHeader
        title="My Schedule"
        subtitle="Your published shifts, breaks and lunches."
        actions={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-9 w-9 p-0" onClick={() => setAnchor(a => addDays(a, -14))} aria-label="Previous">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[170px] text-center text-[13px] font-medium text-slate-700">{rangeLabel}</span>
            <Button variant="outline" size="sm" className="h-9 w-9 p-0" onClick={() => setAnchor(a => addDays(a, 14))} aria-label="Next">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <ListCard>
        {isLoading ? (
          <ListLoadingSkeleton rows={7} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-b bg-slate-50">
                <TableHead>Day</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Breaks &amp; Lunch</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {days.every(d => !byDate.has(d)) ? (
                <TableEmptyState colSpan={3} icon={CalendarClock} title="No published shifts in this range" />
              ) : (
                days.map(d => {
                  const s = byDate.get(d)
                  if (!s) return null
                  return (
                    <TableRow key={d}>
                      <TableCell className="font-medium text-neutral-900">{fmtLong(d)}</TableCell>
                      <TableCell className="tabular-nums text-slate-700">
                        {s.is_day_off || !s.start ? <span className="text-slate-400">Day off</span> : `${s.start} \u2013 ${s.end}`}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {s.segments.map((seg, i) => (
                            <span key={i} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600">
                              {seg.label.toLowerCase().includes('lunch')
                                ? <UtensilsCrossed className="h-3 w-3 text-warning" />
                                : <Coffee className="h-3 w-3 text-warning" />}
                              {`${seg.start}\u2013${seg.end}`}
                            </span>
                          ))}
                          {s.segments.length === 0 && !s.is_day_off && <span className="text-slate-400 text-[12px]">None</span>}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        )}
      </ListCard>
    </ListPageShell>
  )
}
