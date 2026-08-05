import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useUnlockReasons } from '@/hooks/useUnlockReasons'
import { formatQualityDate as fmtDate } from '@/utils/dateFormat'
import { Field, fmtScore } from './ReopenedNotice'

export interface ActiveUnlock {
  id: number
  entity_type: 'SUBMISSION' | 'DISPUTE'
  entity_id: number
  reason_code: string
  reason_note: string
  unlocked_at: string
  unlocked_by_name: string | null
  relock_due_at: string
  prior_status: string
  prior_score: number | null
}

/**
 * Persistent banner shown while a review or its dispute is reopened. It
 * exists as much for the agent as for the reviewer: the score they were
 * shown is currently withdrawn, and they are entitled to see why and by
 * whom without asking.
 */
export function UnlockBanner({
  unlock,
  submissionId,
  canResume,
}: {
  unlock: ActiveUnlock
  submissionId: number
  canResume: boolean
}) {
  const navigate = useNavigate()
  const { labelOf } = useUnlockReasons()
  const isDispute = unlock.entity_type === 'DISPUTE'
  const reason = labelOf(unlock.reason_code)

  return (
    <section className="shrink-0 mx-6 mb-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-2">
          <span className="text-[13px] font-semibold text-neutral-900">
            {isDispute ? 'Dispute reopened' : 'Reopened for correction'}
          </span>

          {/* Reason and note as side-by-side labelled fields, matching the
              metrics row below. */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-x-6 gap-y-2">
            <Field label="Reopen reason" value={reason} />
            {unlock.reason_note && (
              <Field label="Note" value={unlock.reason_note} className="sm:col-span-3" />
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 pt-1">
            <Field label="Reopened" value={fmtDate(unlock.unlocked_at)} />
            <Field label="Reopened by" value={unlock.unlocked_by_name ?? '—'} />
            <Field label="Score on hold" value={fmtScore(unlock.prior_score)} />
            <Field label={isDispute ? 'Re-decide by' : 'Re-submit by'} value={fmtDate(unlock.relock_due_at)} />
          </div>

          <p className="text-[11px] text-slate-500">
            If not {isDispute ? 're-decided' : 're-submitted'} in time, the score is automatically restored to {unlock.prior_status}.
          </p>
        </div>

        {canResume && !isDispute && (
          <Button
            size="sm"
            className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white"
            onClick={() => navigate(`/app/quality/audit?resumeDraft=${submissionId}`)}
          >
            Correct Review
          </Button>
        )}
      </div>
    </section>
  )
}
