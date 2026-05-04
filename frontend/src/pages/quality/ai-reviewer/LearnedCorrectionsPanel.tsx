/**
 * LearnedCorrectionsPanel — read-only preview of the human corrections
 * that will be injected into the next AI run on this form, plus the
 * absorb lifecycle UI.
 *
 * Default view shows ACTIVE corrections (rows still being injected as
 * few-shot examples). The "Show absorbed" toggle reveals corrections
 * whose lesson has been baked into a rule pack or per-form guidance —
 * those rows still count for stats but no longer cost prompt tokens.
 *
 * Each active row has a "Mark absorbed" button that opens a small
 * dialog asking WHERE the lesson was baked in (typically a pack name +
 * version). That free-text reason is the audit trail for why we
 * stopped teaching this lesson live.
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, GraduationCap, Loader2 } from 'lucide-react'
import aiReviewerService, {
  type AbsorbedCorrection,
  type CalibrationCorrection,
} from '@/services/aiReviewerService'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'

interface Props {
  formId: number
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function LearnedCorrectionsPanel({ formId }: Props) {
  const [showAbsorbed, setShowAbsorbed] = useState(false)
  const qc = useQueryClient()
  const { toast } = useToast()

  const activeQ = useQuery({
    queryKey: ['ai-reviewer-corrections-preview', formId],
    queryFn: () => aiReviewerService.getCorrectionsPreview(formId),
    staleTime: 30 * 1000,
    enabled: Number.isFinite(formId) && formId > 0,
  })

  const absorbedQ = useQuery({
    queryKey: ['ai-reviewer-absorbed', formId],
    queryFn: () => aiReviewerService.getAbsorbedCorrections(formId),
    staleTime: 30 * 1000,
    enabled: showAbsorbed && Number.isFinite(formId) && formId > 0,
  })

  const absorbMut = useMutation({
    mutationFn: ({ dataPointId, reason }: { dataPointId: number; reason: string }) =>
      aiReviewerService.absorbCalibrationRow(dataPointId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-reviewer-corrections-preview', formId] })
      qc.invalidateQueries({ queryKey: ['ai-reviewer-absorbed', formId] })
      toast({ title: 'Marked absorbed' })
    },
    onError: (e: any) => {
      toast({
        title: 'Could not mark absorbed',
        description: e?.response?.data?.error ?? e?.message ?? 'Unknown error',
        variant: 'destructive',
      })
    },
  })

  const activeItems = activeQ.data ?? []
  const absorbedItems = absorbedQ.data ?? []

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900 flex items-center gap-1.5">
            <GraduationCap className="h-4 w-4 text-primary" />
            What the AI is currently learning from
          </h2>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Human corrections injected as few-shot lessons in the next AI run on this form. Newest correction wins per
            question. "Mark absorbed" stops a row from costing prompt tokens once you've baked its lesson into a rule
            pack — it stays in stats and audit.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-500 whitespace-nowrap shrink-0">
          {activeItems.length > 0 && (
            <span>
              {activeItems.length} active
            </span>
          )}
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showAbsorbed}
              onChange={(e) => setShowAbsorbed(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Show absorbed
          </label>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {activeQ.isLoading ? (
          <div className="h-12 bg-slate-100 animate-pulse rounded" />
        ) : activeQ.isError ? (
          <p className="text-[13px] text-red-600">Failed to load corrections preview.</p>
        ) : activeItems.length === 0 ? (
          <p className="text-[12px] text-slate-400 italic">
            No corrections injected yet. Promote an AI draft (Calibrating mode) or re-audit a sampled AI submission
            (Trusted mode) and the diff will appear here on the next run.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {activeItems.map((c) => (
              <CorrectionRow
                key={c.data_point_id + ':' + c.question_id}
                c={c}
                onAbsorb={(reason) => absorbMut.mutate({ dataPointId: c.data_point_id, reason })}
                isAbsorbing={absorbMut.isPending && absorbMut.variables?.dataPointId === c.data_point_id}
              />
            ))}
          </ul>
        )}

        {showAbsorbed && (
          <div className="border-t border-dashed border-slate-200 pt-3">
            <h3 className="text-[12px] font-semibold text-slate-600 mb-1.5 flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-emerald-600" />
              Absorbed (no longer in prompt, still in stats)
            </h3>
            {absorbedQ.isLoading ? (
              <div className="h-12 bg-slate-100 animate-pulse rounded" />
            ) : absorbedQ.isError ? (
              <p className="text-[13px] text-red-600">Failed to load absorbed corrections.</p>
            ) : absorbedItems.length === 0 ? (
              <p className="text-[12px] text-slate-400 italic">No absorbed corrections yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {absorbedItems.map((c) => (
                  <AbsorbedRow key={c.data_point_id + ':' + c.question_id} c={c} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function CorrectionRow({
  c,
  onAbsorb,
  isAbsorbing,
}: {
  c: CalibrationCorrection
  onAbsorb: (reason: string) => void
  isAbsorbing: boolean
}) {
  const [showAbsorbForm, setShowAbsorbForm] = useState(false)
  const [reason, setReason] = useState('')

  const submitAbsorb = () => {
    const trimmed = reason.trim()
    if (!trimmed) return
    onAbsorb(trimmed)
  }

  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[13px] text-slate-800 leading-snug">{c.question_text}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
            <span className="text-slate-500">
              AI: <span className="font-mono text-red-700">{c.ai_value || '(empty)'}</span>
            </span>
            <span className="text-slate-500">
              Human: <span className="font-mono text-emerald-700">{c.human_value || '(empty)'}</span>
            </span>
            <span className="text-slate-400">
              ticket #{c.ticket_id} · {fmtDate(c.created_at)}
            </span>
          </div>
          {c.correction_reason && (
            <p className="mt-1 text-[12px] text-slate-700 italic leading-snug">
              <span className="not-italic font-semibold text-slate-600">Reviewer&rsquo;s reason:</span>{' '}
              {c.correction_reason}
            </p>
          )}
        </div>
        {!showAbsorbForm && (
          <Button
            size="sm"
            variant="ghost"
            className="text-[11px] text-slate-500 hover:text-slate-800 shrink-0"
            onClick={() => setShowAbsorbForm(true)}
            title="Stop injecting this correction into prompts (it stays in stats and audit)"
          >
            Mark absorbed
          </Button>
        )}
      </div>
      {showAbsorbForm && (
        <div className="mt-2 flex flex-col gap-1.5 rounded-md border border-slate-200 bg-slate-50 p-2.5">
          <label className="text-[11px] text-slate-600">
            Where did you bake this lesson in? (e.g. "tech-ticket-process pack v3" or "form guidance: NA rules")
          </label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={255}
            placeholder="Required — short audit trail of where the rule now lives"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="text-[11px]"
              onClick={() => {
                setShowAbsorbForm(false)
                setReason('')
              }}
              disabled={isAbsorbing}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="text-[11px] bg-primary hover:bg-primary/90 text-white"
              onClick={submitAbsorb}
              disabled={isAbsorbing || !reason.trim()}
            >
              {isAbsorbing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
              Absorb
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

function AbsorbedRow({ c }: { c: AbsorbedCorrection }) {
  return (
    <li className="py-2 first:pt-0 last:pb-0 opacity-75">
      <p className="text-[12.5px] text-slate-700 leading-snug">{c.question_text}</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
        <span className="text-slate-500">
          AI: <span className="font-mono text-red-700">{c.ai_value || '(empty)'}</span> → Human:{' '}
          <span className="font-mono text-emerald-700">{c.human_value || '(empty)'}</span>
        </span>
        <span className="text-slate-400">absorbed {fmtDate(c.absorbed_at)}</span>
      </div>
      {c.absorbed_reason && (
        <p className="mt-0.5 text-[11px] text-slate-500 italic">
          <span className="not-italic font-semibold text-slate-600">Baked into:</span> {c.absorbed_reason}
        </p>
      )}
    </li>
  )
}
