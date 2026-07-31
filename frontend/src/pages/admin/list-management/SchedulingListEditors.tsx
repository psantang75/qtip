/**
 * Scheduling list editors surfaced inside List Management. These lists live in
 * their own tables (schedule_exception_type / schedule_activity_type /
 * schedule_coverage_threshold) with richer fields than the generic list-items
 * system, so they can't ride GenericListEditor — but they present the same
 * view/activate/create affordances and sit in the same catalogue. Read-open,
 * admin-write; the backend re-checks admin on every mutation.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Plus } from 'lucide-react'

import { ListLoadingSkeleton } from '@/components/common/ListLoadingSkeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { t } from '@/lib/t'
import schedulingService from '@/services/schedulingService'

const CARD = 'bg-white rounded-xl border border-slate-200 p-4'

export function ExceptionTypesEditor() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['admin-exc-types'], queryFn: () => schedulingService.listExceptionTypes(true) })
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => schedulingService.setExceptionTypeActive(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-exc-types'] }),
    onError: (e) => toast(t.fromError(e)),
  })

  return (
    <div className={CARD}>
      {isLoading ? <ListLoadingSkeleton rows={8} /> : (
        <Table>
          <TableHeader>
            <TableRow className="border-b bg-slate-50">
              <TableHead>Label</TableHead>
              <TableHead>Excused</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).map(x => (
              <TableRow key={x.id} className={x.is_active ? '' : 'opacity-50'}>
                <TableCell className="font-medium text-neutral-900">{x.label}</TableCell>
                <TableCell><Badge variant={x.is_excused ? 'secondary' : 'destructive'}>{x.is_excused ? 'Excused' : 'Not excused'}</Badge></TableCell>
                <TableCell className="text-slate-600">{x.duration_mode}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400"
                    disabled={x.is_system && x.is_active}
                    onClick={() => toggle.mutate({ id: x.id, active: !x.is_active })}
                    aria-label={x.is_active ? 'Deactivate' : 'Activate'}
                  >
                    {x.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

export function ActivityTypesEditor() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['admin-act-types'], queryFn: () => schedulingService.listActivityTypes(true) })
  const [label, setLabel] = useState('')
  const add = useMutation({
    mutationFn: () => schedulingService.createActivityType({ label: label.trim(), is_paid: true }),
    onSuccess: () => { setLabel(''); qc.invalidateQueries({ queryKey: ['admin-act-types'] }) },
    onError: (e) => toast(t.fromError(e)),
  })
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => schedulingService.setActivityTypeActive(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-act-types'] }),
    onError: (e) => toast(t.fromError(e)),
  })

  return (
    <div className={CARD}>
      <div className="mb-3 flex items-center gap-2">
        <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="New activity label" className="h-9 w-[220px]" />
        <Button variant="outline" size="sm" disabled={!label.trim() || add.isPending} onClick={() => add.mutate()}>
          <Plus className="mr-1 h-4 w-4" /> Add
        </Button>
      </div>
      {isLoading ? <ListLoadingSkeleton rows={4} /> : (
        <Table>
          <TableHeader>
            <TableRow className="border-b bg-slate-50">
              <TableHead>Label</TableHead>
              <TableHead>Paid</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).map(a => (
              <TableRow key={a.id} className={a.is_active ? '' : 'opacity-50'}>
                <TableCell className="font-medium text-neutral-900">{a.label}</TableCell>
                <TableCell className="text-slate-600">{a.is_paid ? 'Paid' : 'Unpaid'}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400"
                    disabled={a.is_system && a.is_active}
                    onClick={() => toggle.mutate({ id: a.id, active: !a.is_active })}
                    aria-label={a.is_active ? 'Deactivate' : 'Activate'}
                  >
                    {a.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

export function CoverageThresholdsEditor() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['admin-coverage'], queryFn: () => schedulingService.listCoverageThresholds() })
  const save = useMutation({
    mutationFn: (body: { department_id: number; green_min: number; yellow_min: number }) => schedulingService.upsertCoverageThreshold(body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-coverage'] }); toast({ title: 'Threshold saved' }) },
    onError: (e) => toast(t.fromError(e)),
  })

  return (
    <div className={CARD}>
      {isLoading ? <ListLoadingSkeleton rows={4} /> : (
        <Table>
          <TableHeader>
            <TableRow className="border-b bg-slate-50">
              <TableHead>Department</TableHead>
              <TableHead>Green at</TableHead>
              <TableHead>Yellow at</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).map(c => (
              <TableRow key={c.id}>
                <TableCell className="font-medium text-neutral-900">{c.department?.department_name ?? `#${c.department_id}`}</TableCell>
                <TableCell>
                  <Input
                    type="number" defaultValue={c.green_min} className="h-8 w-20"
                    onBlur={e => save.mutate({ department_id: c.department_id, green_min: Number(e.target.value), yellow_min: c.yellow_min })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number" defaultValue={c.yellow_min} className="h-8 w-20"
                    onBlur={e => save.mutate({ department_id: c.department_id, green_min: c.green_min, yellow_min: Number(e.target.value) })}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
