import { useUnlockReasons } from '@/hooks/useUnlockReasons'
import { formatQualityDate as fmtDate } from '@/utils/dateFormat'
import { fmtScore } from './reopenFormat'

export interface LastReopen {
  id: number
  entity_type: 'SUBMISSION' | 'DISPUTE'
  state: 'CLOSED' | 'AUTO_RELOCKED'
  reason_code: string
  reason_note: string
  unlocked_at: string
  unlocked_by_name: string | null
  closed_at: string | null
  prior_score: number | null
  new_score: number | null
}

/** Shared label/value cell for the reopen cards (this notice + UnlockBanner). */
export function Field({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-[12.5px] text-neutral-900">{value}</p>
    </div>
  )
}

/**
 * Shown once a reopen has finished, so the record carries its own history:
 * this review was reopened on a date, for a stated reason, and the score moved
 * from one number to another. Without it the only trace of a correction is the
 * admin-only Unlock Register, which the agent whose score changed cannot see.
 *
 * Agents get the reason, the date, who did it and the score change — everything
 * needed to understand what happened to their score — but not `reason_note`,
 * which is free text an admin wrote for the register rather than for the
 * reviewee.
 */
export function ReopenedNotice({ reopen, isAgent = false }: { reopen: LastReopen; isAgent?: boolean }) {
  const { labelOf } = useUnlockReasons()
  const isDispute = reopen.entity_type === 'DISPUTE'
  const expired = reopen.state === 'AUTO_RELOCKED'
  const reason = labelOf(reopen.reason_code)

  return (
    <section className="shrink-0 mx-6 mb-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="space-y-2">
          <span className="text-[13px] font-semibold text-neutral-900">
            {isDispute ? 'Dispute reopened' : 'Reopened'}
          </span>

          {/* Reason and note as side-by-side labelled fields, matching the
              metrics row below. The note (admin free text) is hidden from
              agents. */}
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-x-6 gap-y-2">
            <Field label="Reopen reason" value={reason} />
            {!isAgent && reopen.reason_note && (
              <Field label="Note" value={reopen.reason_note} className="sm:col-span-4" />
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-6 gap-y-2 pt-1">
            <Field label="Reopened" value={fmtDate(reopen.unlocked_at)} />
            <Field label={expired ? 'Restored' : 'Corrected'} value={fmtDate(reopen.closed_at)} />
            <Field label="Reopened by" value={reopen.unlocked_by_name ?? '—'} />
            {/* Scoped to this reopen rather than called "previous score": on a
                review reopened more than once, the original score is further
                back than this row. */}
            <Field label="Score before" value={fmtScore(reopen.prior_score)} />
            <Field label="Score after" value={fmtScore(reopen.new_score ?? reopen.prior_score)} />
          </div>
      </div>
    </section>
  )
}
