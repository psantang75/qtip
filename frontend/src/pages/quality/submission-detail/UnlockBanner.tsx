import { useNavigate } from 'react-router-dom'
import { Unlock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { UNLOCK_REASON_LABELS, type UnlockReasonCode } from '@/services/unlockService'
import { formatQualityDate as fmtDate } from '@/utils/dateFormat'

export interface ActiveUnlock {
  id: number
  entity_type: 'SUBMISSION' | 'DISPUTE'
  entity_id: number
  reason_code: UnlockReasonCode
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
  const isDispute = unlock.entity_type === 'DISPUTE'

  return (
    <div className="shrink-0 bg-amber-50 border border-amber-200 rounded-xl mx-6 px-4 py-3 flex items-start gap-3 mb-2">
      <Unlock className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-[12px] font-medium text-amber-800">
          <span className="font-bold">{isDispute ? 'Dispute reopened' : 'Reopened for correction'}</span>
          {' — '}
          {UNLOCK_REASON_LABELS[unlock.reason_code] ?? unlock.reason_code}
          {unlock.unlocked_by_name ? ` by ${unlock.unlocked_by_name}` : ''} on {fmtDate(unlock.unlocked_at)}.
          {unlock.prior_score != null && ` The ${unlock.prior_score}% score is on hold.`}
        </p>
        <p className="text-[12px] text-amber-700">{unlock.reason_note}</p>
        <p className="text-[11px] text-amber-600">
          {isDispute ? 'Re-decide' : 'Re-submit'} by {fmtDate(unlock.relock_due_at)} or it is automatically restored to{' '}
          {unlock.prior_status}.
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
  )
}
