import { ArrowLeft, AlertTriangle, CheckCircle, Edit3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/common/StatusBadge'
import type { SubmissionDetail } from '@/services/qaService'

interface Props {
  detail:          SubmissionDetail
  backLabel:       string
  resolutionMode:  boolean
  canAcceptReview: boolean
  canDispute:      boolean
  finalizing:      boolean
  finalizeSuccess: boolean
  showDisputeForm: boolean
  onBack:          () => void
  onFinalize:      () => void
  onShowDispute:   () => void
}

export function SubmissionHeader({
  detail, backLabel, resolutionMode,
  canAcceptReview, canDispute,
  finalizing, finalizeSuccess, showDisputeForm,
  onBack, onFinalize, onShowDispute,
}: Props) {
  return (
    <div className="shrink-0 px-6 pb-5">
      <div className="flex flex-col gap-1 mb-5">
        <button onClick={onBack}
          className="self-start flex items-center gap-1 text-[11px] text-slate-400 hover:text-primary transition-colors">
          <ArrowLeft className="h-3 w-3" />
          {backLabel}
        </button>

        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold text-slate-900">Completed Review</h1>
          <div className="flex items-center gap-2 shrink-0 mt-0.5">
            {resolutionMode && (
              <span className="flex items-center gap-1 text-[12px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full">
                <Edit3 className="h-3.5 w-3.5" /> Resolving
              </span>
            )}
            {canAcceptReview && !finalizeSuccess && (
              <Button size="sm" disabled={finalizing} onClick={onFinalize}
                className="bg-primary hover:bg-primary/90 text-white">
                <CheckCircle className="h-4 w-4 mr-1.5" />
                {finalizing ? 'Accepting…' : 'Accept Review'}
              </Button>
            )}
            {canDispute && !showDisputeForm && !finalizeSuccess && (
              <Button size="sm" variant="outline"
                className="border-primary text-slate-600 hover:bg-primary/5"
                onClick={onShowDispute}>
                <AlertTriangle className="h-4 w-4 mr-1.5" /> Dispute Score
              </Button>
            )}
            {finalizeSuccess && (
              <span className="flex items-center gap-1.5 text-[13px] text-primary font-semibold pr-2">
                <CheckCircle className="h-4 w-4" /> Accepted
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 pl-4 pr-11 py-3 flex items-center justify-between">
        <span className="text-[15px] font-semibold text-slate-900 truncate">
          Review #: {detail.id} — {detail.form_name}
        </span>
        <StatusBadge status={detail.status} />
      </div>
    </div>
  )
}
