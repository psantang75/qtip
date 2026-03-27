import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import trainingService from '@/services/trainingService'
import topicService from '@/services/topicService'
import { QualityListPage } from '@/components/common/QualityListPage'
import { QualityPageHeader } from '@/components/common/QualityPageHeader'
import { TableLoadingSkeleton } from '@/components/common/TableLoadingSkeleton'
import { TableEmptyState } from '@/components/common/TableEmptyState'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { LibraryTabNav } from '@/components/training/LibraryTabNav'
import { QuizBuilder, validateQuizBuilder, type QuizBuilderData, type QuizBuilderErrors } from '@/components/training/QuizBuilder'

const EMPTY_QUIZ: QuizBuilderData = { quiz_title: '', pass_score: 80, topic_id: undefined, questions: [] }

export default function LibraryQuizzesPage() {
  const qc        = useQueryClient()
  const { toast } = useToast()

  const [open,        setOpen]        = useState(false)
  const [editingId,   setEditingId]   = useState<number | null>(null)
  const [formData,    setFormData]    = useState<QuizBuilderData>(EMPTY_QUIZ)
  const [errors,      setErrors]      = useState<QuizBuilderErrors>({})
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  const { data: quizData,   isLoading } = useQuery({ queryKey: ['quiz-library-all'], queryFn: () => trainingService.getQuizLibrary({ limit: 200 }) })
  const { data: topicsData }            = useQuery({ queryKey: ['topics'],            queryFn: () => topicService.getTopics(1, 200) })

  const quizzes = quizData?.items ?? []
  const topics  = (topicsData as any)?.items ?? []

  const invalidate = () => qc.invalidateQueries({ queryKey: ['quiz-library-all'] })

  const openCreate = () => { setEditingId(null); setFormData(EMPTY_QUIZ); setErrors({}); setOpen(true) }

  const openEdit = async (id: number) => {
    try {
      const detail = await trainingService.getLibraryQuizDetail(id)
      setFormData({
        quiz_title: detail.quiz_title,
        pass_score: detail.pass_score,
        topic_id:   detail.topic_id,
        questions:  (detail as any).questions?.map((q: any) => ({
          question_text:  q.question_text,
          options:        q.options,
          correct_option: q.correct_option,
        })) ?? [],
      })
      setEditingId(id)
      setErrors({})
      setOpen(true)
    } catch {
      toast({ title: 'Failed to load quiz', variant: 'destructive' })
    }
  }

  const saveMut = useMutation({
    mutationFn: async (data: QuizBuilderData) => {
      const payload = {
        ...data,
        questions: data.questions.map(q => ({
          question_text:  q.question_text,
          options:        q.options,
          correct_option: q.correct_option,
        })),
      }
      return editingId
        ? trainingService.updateLibraryQuiz(editingId, payload)
        : trainingService.createLibraryQuiz(payload as any)
    },
    onSuccess: () => {
      invalidate()
      setOpen(false)
      toast({ title: editingId ? 'Quiz updated' : 'Quiz created' })
    },
    onError: (err: any) => toast({ title: 'Save failed', description: err?.message, variant: 'destructive' }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => trainingService.deleteLibraryQuiz(id),
    onSuccess: () => { invalidate(); setDeleteConfirm(null); toast({ title: 'Quiz deleted' }) },
    onError: (err: any) => toast({ title: err?.response?.data?.message ?? 'Cannot delete quiz', variant: 'destructive' }),
  })

  const handleSave = () => {
    const errs = validateQuizBuilder(formData)
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    saveMut.mutate(formData)
  }

  return (
    <QualityListPage>
      <QualityPageHeader title="Library"
        actions={
          <Button className="bg-primary hover:bg-primary/90 text-white" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> New Quiz
          </Button>
        }
      />
      <LibraryTabNav />

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? <TableLoadingSkeleton rows={6} /> : (
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 border-b border-slate-200">
                <TableHead>Quiz Title</TableHead>
                <TableHead>Topic</TableHead>
                <TableHead className="text-center">Questions</TableHead>
                <TableHead className="text-center">Pass Score</TableHead>
                <TableHead className="text-center">Times Used</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {quizzes.length === 0 ? (
                <TableEmptyState colSpan={6} title="No quizzes yet" description="Create your first quiz" />
              ) : quizzes.map((q: any) => (
                <TableRow key={q.id} className="hover:bg-slate-50/50">
                  <TableCell className="text-[13px] font-medium text-slate-900">{q.quiz_title}</TableCell>
                  <TableCell className="text-[13px] text-slate-500">{q.topic_name ?? 'â€”'}</TableCell>
                  <TableCell className="text-center text-[13px] text-slate-600">{q.question_count}</TableCell>
                  <TableCell className="text-center text-[13px] text-slate-600">{q.pass_score}%</TableCell>
                  <TableCell className="text-center text-[13px] text-slate-600">{q.times_used}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(q.id)}>
                        <Pencil className="h-3.5 w-3.5 text-slate-400" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
                        disabled={q.times_used > 0}
                        title={q.times_used > 0 ? 'In use â€” cannot delete' : 'Delete'}
                        onClick={() => setDeleteConfirm(q.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-slate-400 hover:text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Quiz Builder Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined} className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Quiz' : 'New Quiz'}</DialogTitle>
          </DialogHeader>
          <QuizBuilder value={formData} onChange={setFormData} errors={errors} topics={topics} />
          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 mt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="bg-primary hover:bg-primary/90 text-white" onClick={handleSave} disabled={saveMut.isPending}>
              {saveMut.isPending ? 'Savingâ€¦' : 'Save Quiz'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={deleteConfirm !== null} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent aria-describedby={undefined} className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Quiz?</DialogTitle></DialogHeader>
          <p className="text-[13px] text-slate-600">This cannot be undone.</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteMut.mutate(deleteConfirm!)} disabled={deleteMut.isPending}>
              {deleteMut.isPending ? 'Deletingâ€¦' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </QualityListPage>
  )
}

