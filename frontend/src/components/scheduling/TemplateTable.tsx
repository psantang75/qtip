/**
 * MOCKUP — Phase 1 design probe only.
 *
 * One table for both jobs: managing templates and picking one to apply. Picking
 * from the same rows you manage means the choice is made against the shape of
 * the week — which days, what shift, how many paid hours — instead of against a
 * name in a dropdown.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { Copy, Eye, Pencil, RotateCcw, Trash2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { MockTemplate } from './mockScheduleData'
import { fmtCompact, fmtHours, templateDayPaid } from './scheduleTime'

const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** "8:00a-5:00p" when every working day is identical, otherwise "Varies". */
function shiftSummary(t: MockTemplate) {
  const working = t.days.filter(d => d.working)
  if (!working.length) return 'No working days'
  const same = working.every(d => d.start === working[0].start && d.end === working[0].end)
  return same
    ? `${fmtCompact(working[0].start)}\u2013${fmtCompact(working[0].end)}`
    : 'Varies by day'
}

interface Props {
  templates: MockTemplate[]
  /** Pick mode — swaps the actions column for a single-select column. */
  pickedId?: number
  onPick?: (t: MockTemplate) => void
  onView?: (t: MockTemplate) => void
  onEdit?: (t: MockTemplate) => void
  onDuplicate?: (t: MockTemplate) => void
  /** Toggle active/inactive. Omitted rows show a disabled control. */
  onToggleActive?: (t: MockTemplate) => void
  /** Rendered on the search row, right aligned. */
  action?: ReactNode
}

export function TemplateTable({
  templates, pickedId, onPick, onView, onEdit, onDuplicate, onToggleActive, action,
}: Props) {
  const [q, setQ] = useState('')
  const picking = !!onPick

  const rows = useMemo(() => {
    const pool = picking ? templates.filter(t => t.isActive) : templates
    const needle = q.trim().toLowerCase()
    if (!needle) return pool
    return pool.filter(t =>
      t.name.toLowerCase().includes(needle) || t.description.toLowerCase().includes(needle))
  }, [templates, q, picking])

  const cols = 4 + (picking ? 1 : 1)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={'Search templates\u2026'}
          className="h-9 max-w-xs"
        />
        {action && <div className="ml-auto">{action}</div>}
      </div>

      <div className="max-h-[46vh] overflow-y-auto rounded-lg border border-slate-200">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-slate-50">
            <TableRow>
              {picking && <TableHead className="w-11" />}
              <TableHead className="w-[46%]">Template</TableHead>
              <TableHead className="w-[150px]">Days</TableHead>
              <TableHead>Shift</TableHead>
              <TableHead className="text-right">Paid / week</TableHead>
              {!picking && <TableHead className="w-[150px] text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(t => {
              const weekly = t.days.reduce((s, d) => s + templateDayPaid(d), 0)
              const picked = pickedId === t.id
              return (
                <TableRow
                  key={t.id}
                  onClick={picking ? () => onPick?.(t) : undefined}
                  className={cn('align-top', picking && 'cursor-pointer', picked && 'bg-primary/[0.06]')}
                >
                  {picking && (
                    <TableCell className="pt-3.5">
                      <Checkbox
                        checked={picked}
                        onCheckedChange={() => onPick?.(t)}
                        aria-label={`Apply ${t.name}`}
                      />
                    </TableCell>
                  )}

                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-neutral-900">{t.name}</span>
                      {!t.isActive && (
                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">Inactive</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-[12px] leading-snug text-slate-500">{t.description}</p>
                  </TableCell>

                  <TableCell>
                    <div className="flex gap-0.5">
                      {t.days.map((d, i) => (
                        <span
                          key={i}
                          className={cn(
                            'flex h-5 w-5 items-center justify-center rounded text-[10px] font-semibold',
                            d.working ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-300',
                          )}
                        >
                          {DAY_LETTER[i]}
                        </span>
                      ))}
                    </div>
                  </TableCell>

                  <TableCell className="whitespace-nowrap text-[12.5px] tabular-nums text-slate-600">
                    {shiftSummary(t)}
                  </TableCell>

                  <TableCell className="whitespace-nowrap text-right text-[12.5px] font-semibold tabular-nums text-neutral-900">
                    {fmtHours(weekly)}
                  </TableCell>

                  {!picking && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-0.5">
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-500" title="View week" onClick={() => onView?.(t)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-500" title="Edit" onClick={() => onEdit?.(t)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-500" title="Duplicate" onClick={() => onDuplicate?.(t)}>
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn('h-8 w-8 p-0 text-slate-400', t.isActive ? 'hover:text-destructive' : 'hover:text-success')}
                          title={t.isActive ? 'Deactivate' : 'Reactivate'}
                          onClick={() => onToggleActive?.(t)}
                        >
                          {t.isActive ? <Trash2 className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              )
            })}

            {!rows.length && (
              <TableRow>
                <TableCell colSpan={cols} className="py-10 text-center text-[13px] text-slate-500">
                  No templates match that search.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
