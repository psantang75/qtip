import { ScoreRenderer } from '@/utils/forms/scoreRenderer'
import { FormRenderer } from '@/utils/forms'
import { CategoryBreakdown } from './SubmissionDetailPrimitives'
import type { SubmissionDetail } from '@/services/qaService'

interface Props {
  score:           number
  disputeAdjusted: boolean
  prevScore:       number | null
  adjScore:        number | null
  resolutionMode:  boolean
  liveScore:       number
  editRenderData:  any
  formData:        any
  answersMap:      Record<number, any>
  roleId:          number
  detail:          SubmissionDetail
  onEditAnswer:    (id: number, value: string, type: string) => void
}

export function ScorePanel({
  score, disputeAdjusted, prevScore, adjScore,
  resolutionMode, liveScore,
  editRenderData, formData, answersMap, roleId, detail,
  onEditAnswer,
}: Props) {
  return (
    <div className="p-3 space-y-2.5">

      {/* ── Overall Score ───────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-[15px] font-semibold text-slate-800">Overall Score</h3>
        </div>

        {disputeAdjusted ? (
          <div className="px-5 py-4">
            <div className="flex items-center gap-6">
              <div className="flex-1 text-center">
                <p className="text-[11px] text-slate-400 mb-1">Original</p>
                <p className="text-[36px] font-bold text-slate-400 leading-none line-through">
                  {prevScore!.toFixed(1)}%
                </p>
              </div>
              <div className="w-px self-stretch bg-slate-100" />
              <div className="flex-1 text-center">
                <p className="text-[11px] text-slate-400 mb-1">Updated</p>
                <p className="text-[36px] font-bold text-slate-900 leading-none">
                  {adjScore!.toFixed(1)}%
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-5 py-4 text-center">
            <div className="text-[44px] font-bold tracking-tight text-slate-900 leading-none">
              {score.toFixed(1)}
              <span className="text-2xl font-semibold ml-0.5 opacity-50">%</span>
            </div>
          </div>
        )}

        {resolutionMode && (
          <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between">
            <span className="text-[12px] font-medium text-amber-800">Live adjusted score</span>
            <span className="text-[20px] font-bold text-slate-900">{liveScore.toFixed(1)}%</span>
          </div>
        )}
      </div>

      {/* ── Score breakdown / editable form ─────────────────────────────── */}
      {resolutionMode && editRenderData ? (
        <div className="rounded-xl overflow-hidden border border-amber-300">
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-200">
            <h3 className="text-[14px] font-semibold text-amber-900">Adjusting Answers</h3>
            <p className="text-[12px] text-amber-700 mt-0.5">
              Change any answers below — the adjusted score updates in real time on the left.
            </p>
          </div>
          <div className="bg-white">
            <FormRenderer
              formRenderData={editRenderData}
              isDisabled={false}
              onAnswerChange={onEditAnswer}
              onNotesChange={() => {}}
            />
          </div>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden border border-slate-200">
          <div className="px-4 py-3 bg-white border-b border-slate-100">
            <h3 className="text-[14px] font-semibold text-slate-800">Score Breakdown</h3>
          </div>
          <div className="bg-white">
            {formData ? (
              <ScoreRenderer
                formData={formData}
                answers={answersMap}
                backendScore={score}
                userRole={roleId}
                showCategoryBreakdown={true}
                showDetailedScores={true}
              />
            ) : (
              <div className="p-4">
                <CategoryBreakdown detail={detail} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
