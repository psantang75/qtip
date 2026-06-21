/**
 * QuestionRubricsCard — DB-backed per-question grading rubric editor.
 *
 * Lists every question on the form (grouped by category) with an
 * inline collapsible textarea for the rubric markdown. Save calls
 * `aiReviewerService.upsertFormRubric`; Clear calls `deleteFormRubric`.
 * Rubrics are stored in `ai_form_question_rubric` and rendered as the
 * indented "RUBRIC:" block under each question by the synthesis prompt
 * builder ([backend/src/services/aiReviewerTwoPassPrompts.ts](backend/src/services/aiReviewerTwoPassPrompts.ts)
 * `renderFormSpec`).
 *
 * Design vocabulary mirrors `KbCoverageCard` and `CalibrationMapPanel`:
 * `rounded-xl border border-slate-200 bg-white` card, lucide-react
 * icons, brand tokens. Filled rubrics surface a green pill on the
 * question header so admins see at a glance which questions are
 * covered.
 */

import { useMemo, useState } from 'react'
import { getErrorMessage } from '@/utils/errorHandling'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  ScrollText,
  Trash2,
} from 'lucide-react'
import aiReviewerService, { type QuestionRubric } from '@/services/aiReviewerService'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useIsAdmin } from '@/hooks/useIsAdmin'
import type { Form, FormQuestion } from '@/types/form.types'

interface Props {
  form: Form
}

const QUESTION_TYPE_LABEL: Record<string, string> = {
  YES_NO: 'Yes / No',
  RADIO: 'Radio',
  MULTI_SELECT: 'Multi-select',
  SCALE: 'Scale',
  FREE_TEXT: 'Free text',
  FAITHFULNESS: 'Faithfulness',
}

function questionTypeLabel(t: string): string {
  return QUESTION_TYPE_LABEL[t] ?? t
}

export function QuestionRubricsCard({ form }: Props) {
  const formId = form.id ?? 0
  const qc = useQueryClient()
  const { toast } = useToast()
  const isAdmin = useIsAdmin()

  const rubricsQ = useQuery({
    queryKey: ['ai-reviewer-rubrics', formId],
    queryFn: () => aiReviewerService.getFormRubrics(formId),
    enabled: Number.isFinite(formId) && formId > 0,
    staleTime: 30 * 1000,
  })

  const rubricByQid = useMemo(() => {
    const map = new Map<number, QuestionRubric>()
    for (const r of rubricsQ.data ?? []) map.set(r.question_id, r)
    return map
  }, [rubricsQ.data])

  const upsertMut = useMutation({
    mutationFn: ({ questionId, rubricMd }: { questionId: number; rubricMd: string }) =>
      aiReviewerService.upsertFormRubric(formId, questionId, rubricMd),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-reviewer-rubrics', formId] })
      toast({ title: 'Rubric saved' })
    },
    onError: (e: any) =>
      toast({
        variant: 'destructive',
        title: "Couldn't save rubric",
        description: getErrorMessage(e, 'Try again.'),
      }),
  })

  const deleteMut = useMutation({
    mutationFn: (questionId: number) => aiReviewerService.deleteFormRubric(formId, questionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-reviewer-rubrics', formId] })
      toast({ title: 'Rubric removed' })
    },
    onError: (e: any) =>
      toast({
        variant: 'destructive',
        title: "Couldn't remove rubric",
        description: getErrorMessage(e, 'Try again.'),
      }),
  })

  const totalQuestions = (form.categories ?? []).reduce(
    (n, c) => n + (c.questions?.length ?? 0),
    0,
  )
  const filledCount = rubricByQid.size

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-neutral-900">
            <ScrollText className="h-4 w-4 text-primary" />
            Question rubrics
          </h3>
          <p className="mt-1 text-sm text-neutral-700">
            Add explicit YES / NO / NA grading bars per question. Rubrics
            render as a {`"RUBRIC:"`} block under each question in the AI
            Reviewer{`'`}s synthesis prompt. Most questions don{`'`}t need
            one — author rubrics for the questions you see disagreements
            on.
          </p>
        </div>
        <div className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-neutral-700">
          {filledCount} / {totalQuestions} authored
        </div>
      </header>

      {rubricsQ.isLoading && (
        <div className="flex items-center gap-2 text-sm text-neutral-700">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading rubrics…
        </div>
      )}

      {rubricsQ.isError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          Couldn't load rubrics. Refresh to try again.
        </div>
      )}

      {!rubricsQ.isLoading && !rubricsQ.isError && totalQuestions === 0 && (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-neutral-700">
          This form has no questions yet — add questions in the form
          builder before authoring rubrics.
        </div>
      )}

      {totalQuestions > 0 && (
        <div className="space-y-6">
          {(form.categories ?? []).map((cat) => (
            <div key={cat.id ?? cat.category_name}>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-700">
                {cat.category_name}
              </h4>
              <div className="space-y-2">
                {(cat.questions ?? []).map((q) =>
                  q.id ? (
                    <RubricRow
                      key={q.id}
                      question={q}
                      rubric={rubricByQid.get(q.id)}
                      onSave={(md) =>
                        upsertMut.mutate({ questionId: q.id as number, rubricMd: md })
                      }
                      onDelete={() => deleteMut.mutate(q.id as number)}
                      isSaving={
                        (upsertMut.isPending && upsertMut.variables?.questionId === q.id) ||
                        (deleteMut.isPending && deleteMut.variables === q.id)
                      }
                      readOnly={!isAdmin}
                    />
                  ) : null,
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

interface RubricRowProps {
  question: FormQuestion
  rubric: QuestionRubric | undefined
  onSave: (md: string) => void
  onDelete: () => void
  isSaving: boolean
  readOnly?: boolean
}

function RubricRow({ question, rubric, onSave, onDelete, isSaving, readOnly = false }: RubricRowProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string>(rubric?.rubric_md ?? '')
  const isFilled = (rubric?.rubric_md ?? '').trim().length > 0

  const dirty = (draft ?? '').trim() !== (rubric?.rubric_md ?? '').trim()

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/40">
      <button
        type="button"
        onClick={() => {
          if (!open) setDraft(rubric?.rubric_md ?? '')
          setOpen((v) => !v)
        }}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-100/60"
      >
        <div className="flex min-w-0 items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-neutral-700" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-neutral-700" />
          )}
          <span className="truncate text-sm font-medium text-neutral-900">
            {question.question_text}
          </span>
          <span className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-neutral-700">
            {questionTypeLabel(question.question_type)}
          </span>
        </div>
        {isFilled && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
            <CheckCircle2 className="h-3 w-3" />
            Rubric set
          </span>
        )}
      </button>

      {open && (
        <div className="space-y-2 border-t border-slate-200 px-3 py-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              'YES = at least one verbal acknowledgement of customer frustration.\n' +
              'NO  = transactional only.\n' +
              'NA  = customer was not frustrated.\n' +
              'Common false positive: "no problem" alone is NOT empathy.'
            }
            rows={6}
            disabled={readOnly}
            className="font-mono text-xs"
          />
          <div className="flex items-center justify-end gap-2">
            {isFilled && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onDelete}
                disabled={readOnly || isSaving}
                title={readOnly ? 'Admin only' : undefined}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="mr-1 h-3 w-3" />
                Remove
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDraft(rubric?.rubric_md ?? '')}
              disabled={readOnly || isSaving || !dirty}
              title={readOnly ? 'Admin only' : undefined}
            >
              Reset
            </Button>
            <Button
              size="sm"
              onClick={() => onSave(draft)}
              disabled={readOnly || isSaving || !dirty}
              title={readOnly ? 'Admin only' : undefined}
              className="bg-primary text-white hover:bg-primary/90"
            >
              {isSaving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
