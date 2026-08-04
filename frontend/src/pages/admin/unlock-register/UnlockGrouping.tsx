import { useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { UNLOCK_REASON_LABELS, type UnlockStats, type UnlockReasonCode } from '@/services/unlockService'

/**
 * "Who is driving this" panel. Answers the abuse question directly: reopens
 * grouped by the admin performing them, by the person whose work is being
 * reopened, and by reason code.
 */

type GroupKey = 'admin' | 'assignee' | 'reason'

const OPTIONS: Array<{ key: GroupKey; label: string }> = [
  { key: 'admin', label: 'By admin' },
  { key: 'assignee', label: 'By reviewer / manager' },
  { key: 'reason', label: 'By reason' },
]

// Canonical QTIP segmented-picker pill, mirroring `optionCls` in
// utils/forms/formRendererComponents.tsx.
const optionCls = (active: boolean) =>
  `px-3 py-1.5 rounded-lg border text-[13px] font-medium transition-colors ${
    active
      ? 'border-[#00aeef] bg-primary/5 text-primary'
      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
  }`

function fmtDelta(n: number | null): string {
  if (n == null) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(1)} pts`
}

export function UnlockGrouping({ stats }: { stats: UnlockStats }) {
  const [group, setGroup] = useState<GroupKey>('admin')

  const rows =
    group === 'reason'
      ? stats.by_reason.map((r) => ({
          key: r.reason_code,
          name: UNLOCK_REASON_LABELS[r.reason_code as UnlockReasonCode] ?? r.reason_code,
          count: r.count,
          delta: null as number | null,
        }))
      : group === 'admin'
        ? stats.by_admin.map((r) => ({
            key: String(r.user_id),
            name: r.name ?? `User #${r.user_id}`,
            count: r.count,
            delta: r.avg_score_delta,
          }))
        : stats.by_assignee.map((r) => ({
            key: String(r.user_id),
            name: r.name ?? `User #${r.user_id}`,
            count: r.count,
            delta: null as number | null,
          }))

  const max = Math.max(1, ...rows.map((r) => r.count))

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-200">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Who is reopening</h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Concentration is the signal. A handful of reopens spread across many admins is normal; the same admin or the
            same reviewer appearing repeatedly is not.
          </p>
        </div>
        <div className="flex gap-2">
          {OPTIONS.map((o) => (
            <button key={o.key} type="button" className={optionCls(group === o.key)} onClick={() => setGroup(o.key)}>
              {o.label}
            </button>
          ))}
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">Nothing to group in this range.</div>
      ) : (
        <Table>
          <TableHeader>
            <StandardTableHeaderRow>
              <TableHead className="py-3">{group === 'reason' ? 'Reason' : 'Person'}</TableHead>
              <TableHead className="py-3 w-[45%]">Share</TableHead>
              <TableHead className="py-3 text-right">Reopens</TableHead>
              {group === 'admin' && <TableHead className="py-3 text-right">Avg score change</TableHead>}
            </StandardTableHeaderRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key} className="hover:bg-slate-50/50">
                <TableCell className="text-[13px] font-medium text-slate-700">{r.name}</TableCell>
                <TableCell>
                  <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(r.count / max) * 100}%` }} />
                  </div>
                </TableCell>
                <TableCell className="text-[13px] text-slate-700 text-right tabular-nums">{r.count}</TableCell>
                {group === 'admin' && (
                  <TableCell className="text-[13px] text-slate-600 text-right tabular-nums">
                    {fmtDelta(r.delta)}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}
