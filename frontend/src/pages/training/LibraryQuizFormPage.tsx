import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import trainingService from '@/services/trainingService'
import topicService from '@/services/topicService'
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

  const [formData,    setFormData]    = useState<QuizBuilderData>(EMPTY_QUIZ)
  const [errors,      setErrors]      = useState<QuizBuilderErrors>({})
  const [initialized, setInitialized] = useState(false)

  const { data: topicsData } = useQuery({
    queryKey: ['topics-active'],
    queryFn:  () => topicService.getTopics(1, 200, { is_active: true }),
  })
  const topics = (topicsData as any)?.items ?? []

  const { data: existingDetail } = useQuery({
    queryKey: ['quiz-detail', id],
    queryFn:  () => trainingService.getLibraryQuizDetail(Number(id)),
    enabled:  isEdit,
    staleTime: 0,
  })

  // Populate form once both the quiz detail and topics list have loaded
  useEffect(() => {
    if (!isEdit || initialized || !existingDetail || topics.length === 0) return
    setFormData({
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
    setInitialized(true)
  }, [existingDetail, topics, isEdit, initialized])

  const saveMut = useMutation({
    mutationFn: async (data: QuizBuilderData) => {
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
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
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
            onChange={setFormData}
            errors={errors}
            topics={topics}
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
                onCheckedChange={v => setFormData(d => ({ ...d, is_active: v }))}
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
