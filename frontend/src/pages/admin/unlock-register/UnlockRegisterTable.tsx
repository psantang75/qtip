import { useNavigate } from 'react-router-dom'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { SortableTableHead } from '@/components/common/SortableTableHead'
import { useListSort } from '@/hooks/useListSort'
import { useUnlockReasons } from '@/hooks/useUnlockReasons'
import { type UnlockRegisterRow } from '@/services/unlockService'

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
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function fmtScore(n: number | null) {
  return n == null ? '—' : `${Number(n).toFixed(1)}%`
}

export function UnlockRegisterTable({ rows, isLoading }: { rows: UnlockRegisterRow[]; isLoading: boolean }) {
  const navigate = useNavigate()
  const { labelOf } = useUnlockReasons()
  const { sort, dir, toggle, sorted } = useListSort(rows)

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <Table>
        <TableHeader>
          <StandardTableHeaderRow>
            <SortableTableHead field="unlocked_at" sort={sort} dir={dir} onSort={toggle}>Reopened</SortableTableHead>
            <SortableTableHead field="entity_id" sort={sort} dir={dir} onSort={toggle}>Review Number</SortableTableHead>
            <SortableTableHead field="unlocked_by_name" sort={sort} dir={dir} onSort={toggle}>Reopened by</SortableTableHead>
            <SortableTableHead field="reason_code" sort={sort} dir={dir} onSort={toggle}>Reason</SortableTableHead>
            <TableHead className="py-3">Justification</TableHead>
            <SortableTableHead field="prior_score" sort={sort} dir={dir} onSort={toggle} right>Prior Score</SortableTableHead>
            <SortableTableHead field="new_score" sort={sort} dir={dir} onSort={toggle} right>Current Score</SortableTableHead>
            <SortableTableHead field="score_delta" sort={sort} dir={dir} onSort={toggle} right>Change</SortableTableHead>
            <SortableTableHead field="state" sort={sort} dir={dir} onSort={toggle}>Status</SortableTableHead>
          </StandardTableHeaderRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">Loading…</TableCell>
            </TableRow>
          ) : sorted.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
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
                  <TableCell className="text-[13px] text-slate-700 whitespace-nowrap tabular-nums">#{r.entity_id}</TableCell>
                  <TableCell className="text-[13px] text-slate-700 whitespace-nowrap">
                    {r.unlocked_by_name ?? `User #${r.unlocked_by}`}
                  </TableCell>
                  <TableCell className="text-[13px] text-slate-600 whitespace-nowrap">
                    {labelOf(r.reason_code)}
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
