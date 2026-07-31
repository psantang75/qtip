/**
 * MOCKUP — Phase 1 design probe only. Static props, no data fetching.
 *
 * Every exception in the visible period, for the departments on screen. The
 * two-week grid shows where exceptions fall; this answers "what happened and
 * to whom" without hunting for coloured cells.
 *
 * Excused/not-excused is the only judgement shown. Points, bands and
 * thresholds belong to the attendance KPI, not here.
 */
import { CalendarCheck } from 'lucide-react'
import { ListCard } from '@/components/common/ListCard'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { MockException, MockPerson } from './mockScheduleData'
import { parseLocal } from './mockScheduleData'
import { fmtCompact } from './scheduleTime'

interface Row extends MockException {
  personName: string
  department: string | null
}

export function ExceptionSummary({
  people, from, to,
}: { people: MockPerson[]; from: string; to: string }) {
  const rows: Row[] = people
    .flatMap(p => p.exceptions
      .filter(e => e.date >= from && e.date <= to)
      .map(e => ({ ...e, personName: p.name, department: p.department })))
    .sort((a, b) => a.date.localeCompare(b.date) || a.personName.localeCompare(b.personName))

  const excused = rows.filter(r => r.excused).length
  const notExcused = rows.length - excused

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-[15px] font-semibold text-slate-900">Exceptions this period</h2>
        {rows.length > 0 && (
          <span className="text-[12px] text-slate-500">
            <span className="font-semibold text-warning">{excused}</span> excused
            {' \u00b7 '}
            <span className="font-semibold text-destructive">{notExcused}</span> not excused
          </span>
        )}
      </div>

      <ListCard>
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 hover:bg-slate-50">
              <TableHead className="h-9 min-w-[180px] text-[11px] uppercase tracking-wide">Employee</TableHead>
              <TableHead className="h-9 min-w-[160px] text-[11px] uppercase tracking-wide">Department</TableHead>
              <TableHead className="h-9 min-w-[120px] text-[11px] uppercase tracking-wide">Date</TableHead>
              <TableHead className="h-9 min-w-[180px] text-[11px] uppercase tracking-wide">Type</TableHead>
              <TableHead className="h-9 min-w-[150px] text-[11px] uppercase tracking-wide">Excused window</TableHead>
              <TableHead className="h-9 w-[130px] text-[11px] uppercase tracking-wide">Counts against</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center">
                  <CalendarCheck className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                  <div className="text-[13px] font-medium text-slate-500">No exceptions this period</div>
                  <div className="text-[12px] text-slate-400">
                    Everyone on screen worked their posted schedule.
                  </div>
                </TableCell>
              </TableRow>
            ) : rows.map((r, i) => (
              <TableRow key={i} className="hover:bg-slate-50/50">
                <TableCell className="py-2 font-medium">{r.personName}</TableCell>
                <TableCell className="py-2 text-slate-500">
                  {r.department ?? <span className="text-warning">Unassigned</span>}
                </TableCell>
                <TableCell className="py-2 whitespace-nowrap text-slate-600">
                  {parseLocal(r.date).toLocaleDateString('en-US', {
                    weekday: 'short', month: 'short', day: 'numeric',
                  })}
                </TableCell>
                <TableCell className="py-2">
                  <span className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
                    r.excused ? 'bg-warning/15 text-warning' : 'bg-destructive/10 text-destructive',
                  )}>
                    {r.typeLabel}
                  </span>
                </TableCell>
                <TableCell className="py-2 whitespace-nowrap tabular-nums text-slate-600">
                  {r.isFullDay
                    ? 'Full day'
                    : `${fmtCompact(r.start!)} \u2013 ${fmtCompact(r.end!)}`}
                </TableCell>
                <TableCell className="py-2">
                  <span className={cn(
                    'text-[12px] font-medium',
                    r.excused ? 'text-slate-400' : 'text-destructive',
                  )}>
                    {r.excused ? 'No' : 'Employee'}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ListCard>
    </div>
  )
}
