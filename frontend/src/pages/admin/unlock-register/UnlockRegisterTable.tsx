import { useNavigate } from 'react-router-dom'
import { AlertTriangle, UserCheck } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useListSort } from '@/hooks/useListSort'
import { UNLOCK_REASON_LABELS, type UnlockRegisterRow } from '@/services/unlockService'

const STATE_STYLES: Record<string, string> = {
  OPEN: 'bg-amber-50 text-amber-700 border-amber-200',
  CLOSED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  AUTO_RELOCKED: 'bg-slate-50 text-slate-600 border-slate-200',
}

const STATE_LABELS: Record<string, string> = {
  OPEN: 'Awaiting fix',
  CLOSED: 'Corrected',
  AUTO_RELOCKED: 'Auto re-locked',
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtScore(n: number | null) {
  return n == null ? '—' : `${Number(n).toFixed(1)}%`
}

export function UnlockRegisterTable({ rows, isLoading }: { rows: UnlockRegisterRow[]; isLoading: boolean }) {
  const navigate = useNavigate()
  const { sort, dir, toggle, sorted } = useListSort(rows)

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <Table>
        <TableHeader>
          <StandardTableHeaderRow>
            <SortableTableHead field="unlocked_at" sort={sort} dir={dir} onSort={toggle}>Reopened</SortableTableHead>
            <SortableTableHead field="entity_type" sort={sort} dir={dir} onSort={toggle}>Record</SortableTableHead>
            <SortableTableHead field="form_name" sort={sort} dir={dir} onSort={toggle}>Form</SortableTableHead>
            <SortableTableHead field="agent_name" sort={sort} dir={dir} onSort={toggle}>Agent</SortableTableHead>
            <SortableTableHead field="assigned_to_name" sort={sort} dir={dir} onSort={toggle}>Assigned to</SortableTableHead>
            <SortableTableHead field="unlocked_by_name" sort={sort} dir={dir} onSort={toggle}>Reopened by</SortableTableHead>
            <SortableTableHead field="reason_code" sort={sort} dir={dir} onSort={toggle}>Reason</SortableTableHead>
            <TableHead className="py-3">Justification</TableHead>
            <SortableTableHead field="prior_score" sort={sort} dir={dir} onSort={toggle} right>Was</SortableTableHead>
            <SortableTableHead field="new_score" sort={sort} dir={dir} onSort={toggle} right>Now</SortableTableHead>
            <SortableTableHead field="score_delta" sort={sort} dir={dir} onSort={toggle} right>Change</SortableTableHead>
            <SortableTableHead field="state" sort={sort} dir={dir} onSort={toggle}>State</SortableTableHead>
          </StandardTableHeaderRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={12} className="text-center py-12 text-muted-foreground">Loading…</TableCell>
            </TableRow>
          ) : sorted.length === 0 ? (
            <TableRow>
              <TableCell colSpan={12} className="text-center py-12 text-muted-foreground">
                No reopens match these filters.
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((r) => {
              const delta = r.score_delta == null ? null : Number(r.score_delta)
              return (
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-slate-50/50"
                  onClick={() => navigate(`/app/quality/submissions/${r.submission_id}`)}
                >
                  <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">{fmtDate(r.unlocked_at)}</TableCell>
                  <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">
                    {r.entity_type === 'DISPUTE' ? 'Dispute' : 'Review'} #{r.entity_id}
                  </TableCell>
                  <TableCell className="text-[13px] text-slate-600">{r.form_name ?? '—'}</TableCell>
                  <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">{r.agent_name ?? '—'}</TableCell>
                  <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">{r.assigned_to_name ?? '—'}</TableCell>
                  <TableCell className="text-[13px] text-slate-700 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      {r.unlocked_by_name ?? `User #${r.unlocked_by}`}
                      {r.self_service ? <Flag icon={UserCheck} text="Self-service: the admin who reopened this is also the person expected to fix it." /> : null}
                      {r.beyond_window ? <Flag icon={AlertTriangle} text="Out of window: reopened past the configured window with a break-glass confirm." /> : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">
                    {UNLOCK_REASON_LABELS[r.reason_code] ?? r.reason_code}
                  </TableCell>
                  <TableCell className="text-[13px] text-slate-600 max-w-[280px]">
                    <span className="line-clamp-2" title={r.reason_note}>{r.reason_note}</span>
                  </TableCell>
                  <TableCell className="text-[13px] text-slate-600 text-right tabular-nums">{fmtScore(r.prior_score)}</TableCell>
                  <TableCell className="text-[13px] text-slate-600 text-right tabular-nums">{fmtScore(r.new_score)}</TableCell>
                  <TableCell
                    className={`text-[13px] text-right tabular-nums ${
                      delta == null ? 'text-slate-400' : delta === 0 ? 'text-slate-500' : 'text-slate-900 font-semibold'
                    }`}
                  >
                    {delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                        STATE_STYLES[r.state] ?? 'bg-slate-50 text-slate-600'
                      }`}
                    >
                      {STATE_LABELS[r.state] ?? r.state}
                    </span>
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function Flag({ icon: Icon, text }: { icon: typeof AlertTriangle; text: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span onClick={(e) => e.stopPropagation()} className="inline-flex text-amber-600">
            <Icon className="h-3.5 w-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[240px] text-xs leading-snug">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
