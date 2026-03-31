import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import trainingService from '@/services/trainingService'
import listService from '@/services/listService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { QuizBuilder, validateQuizBuilder, type QuizBuilderData, type QuizBuilderErrors } from '@/components/training/QuizBuilder'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'

const EMPTY_QUIZ: QuizBuilderData = {
  quiz_title: '',
  pass_score:  80,
  topic_ids:   [],
  questions:   [],
  is_active:   true,
}

export default function LibraryQuizFormPage() {
  const { id }       = useParams<{ id: string }>()
  const isEdit       = !!id
  const navigate     = useNavigate()
  const { toast }    = useToast()
  const qc           = useQueryClient()

  const [builderErrors, setBuilderErrors] = useState<QuizBuilderErrors>({})

  const { setValue, watch, reset } = useForm<QuizBuilderData>({ defaultValues: EMPTY_QUIZ })
  const formData = watch()

  // ── Fetch topic list items for the quiz builder ────────────────────────────
  const { data: topicItems = [] } = useQuery({
    queryKey: ['list-items', 'training_topic'],
    queryFn:  () => listService.getItems('training_topic'),
  })

  const { data: existingDetail } = useQuery({
    queryKey: ['quiz-detail', id],
    queryFn:  () => trainingService.getLibraryQuizDetail(Number(id)),
    enabled:  isEdit,
    staleTime: 0,
  })

  // ── Populate form on edit ─────────────────────────────────────────────────
  useEffect(() => {
    if (!existingDetail || !isEdit) return
    reset({
      quiz_title: existingDetail.quiz_title,
      pass_score: Number(existingDetail.pass_score),
      is_active:  existingDetail.is_active !== false,
      topic_id:   existingDetail.topic_id,
      topic_ids:  (existingDetail.topic_ids ?? []).map(Number),
      questions:  ((existingDetail as any).questions ?? []).map((q: any) => ({
        question_text:  q.question_text,
        options:        Array.isArray(q.options) ? q.options : JSON.parse(q.options || '[]'),
        correct_option: Number(q.correct_option),
      })),
    })
  }, [existingDetail, isEdit, reset])

  // ── Save mutation ─────────────────────────────────────────────────────────
  const saveMut = useMutation({
    mutationFn: (data: QuizBuilderData) => {
      const payload = {
        quiz_title: data.quiz_title,
        pass_score: data.pass_score,
        is_active:  data.is_active !== false,
        topic_ids:  data.topic_ids ?? [],
        topic_id:   data.topic_ids?.[0],
        questions:  data.questions.map(q => ({
          question_text:  q.question_text,
          options:        q.options,
          correct_option: q.correct_option,
        })),
      }
      return isEdit
        ? trainingService.updateLibraryQuiz(Number(id), payload)
        : trainingService.createLibraryQuiz(payload as any)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quiz-detail', id] })
      qc.invalidateQueries({ queryKey: ['quiz-library-all'] })
      toast({ title: isEdit ? 'Quiz updated' : 'Quiz created' })
      navigate('/app/training/library/quizzes')
    },
    onError: (err: any) => toast({ title: 'Save failed', description: err?.message, variant: 'destructive' }),
  })

  const handleSave = () => {
    const errs = validateQuizBuilder(formData)
    if (Object.keys(errs).length) { setBuilderErrors(errs); return }
    setBuilderErrors({})
    saveMut.mutate(formData)
  }

  return (
    <QualityListPage>
      <QualityPageHeader
        title={isEdit ? 'Edit Quiz' : 'New Quiz'}
        action={
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        }
      />

      <div className="max-w-3xl">
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <QuizBuilder
            value={formData}
            onChange={v => {
              (Object.keys(v) as (keyof QuizBuilderData)[]).forEach(k => setValue(k, v[k] as any))
            }}
            errors={builderErrors}
            topics={topicItems.map(t => ({ id: t.id, topic_name: t.label, is_active: t.is_active, sort_order: t.sort_order, category: t.category ?? undefined, created_at: '', updated_at: '' }))}
          />

          {/* Active / Inactive toggle */}
          <div className="flex items-center justify-between pt-5 mt-2 border-t border-slate-100">
            <div>
              <p className="text-[13px] font-medium text-slate-700">Quiz Status</p>
              <p className="text-[12px] text-slate-400 mt-0.5">Inactive quizzes are hidden from coaching sessions</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-slate-500">{formData.is_active !== false ? 'Active' : 'Inactive'}</span>
              <Switch
                checked={formData.is_active !== false}
                onCheckedChange={v => setValue('is_active', v)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-slate-100">
            <Button variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
            <Button
              className="bg-primary hover:bg-primary/90 text-white"
              onClick={handleSave}
              disabled={saveMut.isPending}
            >
              {saveMut.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Quiz'}
            </Button>
          </div>
        </div>
      </div>
    </QualityListPage>
  )
}
