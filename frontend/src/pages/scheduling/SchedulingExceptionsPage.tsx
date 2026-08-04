/**
 * Attendance Exceptions — the flat log of every logged exception, filterable by
 * date range. Managers/admins see their scope; editors can delete. Creating
 * exceptions happens in the calendar (per-day drawer or bulk bar), so this page
 * is a review + cleanup surface, not an entry form.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarX, FileInput, Trash2 } from 'lucide-react'

import { ListPageShell } from '@/components/common/ListPageShell'
import { ListPageHeader } from '@/components/common/ListPageHeader'
import { ListFilterBar } from '@/components/common/ListFilterBar'
import { ListCard } from '@/components/common/ListCard'
import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { t } from '@/lib/t'
import { useScheduleRole } from '@/hooks/useScheduleRole'
import schedulingService from '@/services/schedulingService'
import { parseLocal, toLocalIso, addDays } from '@/components/scheduling/mockScheduleData'

const fmt = (iso: string) => parseLocal(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** The rolling attendance-point window, mirroring attendance.rollup.service. */
const POINT_WINDOW_DAYS = 90

export default function SchedulingExceptionsPage() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { canEdit } = useScheduleRole()

  // Defaults to the rolling 90-day point window, because that is the range these
  // exceptions are actually being scored over. Widen the filter to see leave
  // logged ahead, or anything that has already rolled off.
  const [from, setFrom] = useState(addDays(toLocalIso(new Date()), -(POINT_WINDOW_DAYS - 1)))
  const [to, setTo] = useState(toLocalIso(new Date()))

  const { data, isLoading } = useQuery({
    queryKey: ['schedule-exceptions', from, to],
    queryFn: () => schedulingService.listExceptions({ from, to }),
  })

  const del = useMutation({
    mutationFn: (id: number) => schedulingService.deleteException(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['schedule-exceptions'] }); toast({ title: 'Exception removed' }) },
    onError: (e) => toast(t.fromError(e)),
  })

  const rows = data ?? []

  return (
    <ListPageShell>
      <ListPageHeader
        title="Attendance Exceptions"
        subtitle="Exceptions the rolling 90-day point totals are scored against — every day forgiven, and every one that carries points."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/app/scheduling/time-off-import">
              <FileInput className="mr-1.5 h-4 w-4" /> Time Off Import
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

      <ListCard>
        {isLoading ? (
          <ListLoadingSkeleton rows={8} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-b bg-slate-50">
                <TableHead>Employee</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Window</TableHead>
                <TableHead>Excused</TableHead>
                {canEdit && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableEmptyState colSpan={canEdit ? 7 : 6} icon={CalendarX} title="No exceptions in this range" />
              ) : (
                rows.map(e => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium text-neutral-900">{e.username}</TableCell>
                    <TableCell className="text-slate-600">{e.department_name ?? '\u2014'}</TableCell>
                    <TableCell className="tabular-nums text-slate-700">{fmt(e.exception_date)}</TableCell>
                    <TableCell className="text-slate-700">{e.label}</TableCell>
                    <TableCell className="tabular-nums text-slate-600">
                      {e.is_full_day ? 'Full day' : e.start && e.end ? `${e.start}\u2013${e.end}` : '\u2014'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={e.is_excused ? 'secondary' : 'destructive'}>
                        {e.is_excused ? 'Excused' : 'Not excused'}
                      </Badge>
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <Button
                          variant="ghost" size="sm"
                          className="h-8 w-8 p-0 text-slate-400 hover:text-destructive"
                          disabled={del.isPending}
                          onClick={() => del.mutate(e.id)}
                          aria-label="Remove"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </ListCard>
    </ListPageShell>
  )
}
