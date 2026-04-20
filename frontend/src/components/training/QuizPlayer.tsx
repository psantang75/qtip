import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle, XCircle, HelpCircle, Eye } from 'lucide-react'
import trainingService, { type QuizQuestion, type QuizAttemptResult } from '@/services/trainingService'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

// ── Read-only review for passed quizzes ────────────────────────────────────

interface QuizReviewProps {
  quiz: { quiz_title: string; pass_score: number; questions: QuizQuestion[] }
  /** When true, renders the question list immediately (used inside table expansion) */
  defaultOpen?: boolean
}

export function QuizReview({ quiz, defaultOpen = false }: QuizReviewProps) {
  const [open, setOpen] = useState(defaultOpen)
  const { questions } = quiz

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="gap-1.5 text-[12px]" onClick={() => setOpen(true)}>
        <Eye className="h-3.5 w-3.5" /> Review Quiz
      </Button>
    )
  }

  return (
    <div className="space-y-3">
      {!defaultOpen && (
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-semibold text-slate-700">{quiz.quiz_title}</p>
          <Button variant="ghost" size="sm" className="text-[12px] text-slate-500" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      )}
      {questions.map((q, idx) => (
        <div key={q.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-[13px] font-medium text-slate-800 mb-2">{idx + 1}. {q.question_text}</p>
          <div className="space-y-1.5 ml-1">
            {q.options.map((opt, optIdx) => (
              <div key={optIdx} className={cn(
                'flex items-center gap-2 text-[12px] rounded-lg px-2.5 py-1.5',
                optIdx === q.correct_option
                  ? 'bg-emerald-50 text-emerald-800 font-medium'
                  : 'text-slate-600',
              )}>
                <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-slate-200/60 text-slate-600 text-[11px] font-bold shrink-0">
                  {String.fromCharCode(65 + optIdx)}
                </span>
                {opt}
                {optIdx === q.correct_option && (
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-600 ml-auto shrink-0" />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

interface QuizPlayerProps {
  quiz: { id: number; quiz_title: string; pass_score: number; questions: QuizQuestion[] }
  coachingSessionId: number
  onPassed: () => void
}

type Phase = 'intro' | 'taking' | 'result'

export function QuizPlayer({ quiz, coachingSessionId, onPassed }: QuizPlayerProps) {
  const { toast } = useToast()
  const [phase, setPhase]                   = useState<Phase>('intro')
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({})
  const [result, setResult]                 = useState<QuizAttemptResult | null>(null)

  const { questions } = quiz
  const q = questions[currentQuestion]

  const resetTaking = () => {
    setCurrentQuestion(0)
    setSelectedAnswers({})
    setPhase('taking')
  }

  const submitMut = useMutation({
    mutationFn: (answers: { question_id: number; selected_option: number }[]) =>
      trainingService.submitQuizAttempt(quiz.id, { coaching_session_id: coachingSessionId, answers }),
    onSuccess: (r) => {
      setResult(r)
      setPhase('result')
      if (r.passed) onPassed()
    },
    onError: () => toast({ title: 'Quiz submission failed', description: 'Please try again.', variant: 'destructive' }),
  })

  const handleSubmit = () => {
    submitMut.mutate(questions.map(q => ({
      question_id:     q.id,
      selected_option: selectedAnswers[q.id] ?? -1,
    })))
  }

  // ── INTRO ─────────────────────────────────────────────────────────────────
  if (phase === 'intro') {
    return (
      <div className="text-center py-4 space-y-4">
        <HelpCircle className="h-10 w-10 text-primary mx-auto opacity-70" />
        <div>
          <p className="text-[15px] font-semibold text-slate-800">{quiz.quiz_title}</p>
          <p className="text-[13px] text-slate-500 mt-1">
            {questions.length} question{questions.length !== 1 ? 's' : ''} · Pass score: {quiz.pass_score}%
          </p>
        </div>
        <Button className="bg-primary hover:bg-primary/90 text-white" onClick={resetTaking}>
          Start Quiz
        </Button>
      </div>
    )
  }

  // ── RESULT ────────────────────────────────────────────────────────────────
  if (phase === 'result' && result) {
    return (
      <div className="space-y-4">
        <div className={cn(
          'rounded-xl border p-5 text-center',
          result.passed ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200',
        )}>
          {result.passed
            ? <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto mb-2" />
            : <XCircle    className="h-12 w-12 text-red-400    mx-auto mb-2" />
          }
          <p className={cn('text-lg font-bold', result.passed ? 'text-emerald-800' : 'text-red-700')}>
            {result.passed ? 'Passed!' : 'Not Passed'}
          </p>
          <p className={cn('text-[13px] mt-1', result.passed ? 'text-emerald-700' : 'text-red-600')}>
            {result.passed
              ? <>Score: {Number(result.score).toFixed(0)}% &nbsp;·&nbsp; Required: {quiz.pass_score}%</>
              : <>Required score: {quiz.pass_score}%</>
            }
          </p>
        </div>

        {result.passed && (
          <div className="space-y-2">
            {questions.map((qItem, idx) => {
              const userIdx    = selectedAnswers[qItem.id] ?? -1
              const isCorrect  = result.correct_answers.includes(qItem.id)
              return (
                <div key={qItem.id}
                  className={cn('rounded-xl border p-4', isCorrect ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200')}>
                  <div className="flex items-start gap-2 mb-2">
                    {isCorrect
                      ? <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                      : <XCircle    className="h-4 w-4 text-red-500    shrink-0 mt-0.5" />
                    }
                    <p className="text-[13px] font-medium text-slate-800">{idx + 1}. {qItem.question_text}</p>
                  </div>
                  <p className="text-[12px] text-slate-600 ml-6">
                    Your answer: {userIdx >= 0 ? qItem.options[userIdx] : <span className="text-slate-400">No answer</span>}
                  </p>
                  {!isCorrect && (
                    <p className="text-[12px] text-emerald-700 font-medium ml-6 mt-0.5">
                      Correct: {qItem.options[qItem.correct_option]}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {!result.passed && (
          <Button variant="outline" className="w-full" onClick={resetTaking}>
            Retake Quiz
          </Button>
        )}
      </div>
    )
  }

  // ── TAKING ────────────────────────────────────────────────────────────────
  const isLast     = currentQuestion === questions.length - 1
  const hasAnswer  = selectedAnswers[q?.id] !== undefined
  const progress   = (currentQuestion / questions.length) * 100

  return (
    <div className="space-y-4">
      {/* Progress */}
      <div>
        <div className="flex justify-between text-[12px] text-slate-500 mb-1.5">
          <span>Question {currentQuestion + 1} of {questions.length}</span>
          <span>{Math.round(progress)}% complete</span>
        </div>
        <div className="h-1.5 bg-slate-100 rounded-full">
          <div className="h-full bg-primary rounded-full transition-all"
               style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Question */}
      {q && (
        <div>
          <p className="text-[15px] font-medium text-slate-800 mb-4">{q.question_text}</p>
          {q.options.map((opt, idx) => (
            <Button
              key={idx}
              variant="outline"
              onClick={() => setSelectedAnswers(p => ({ ...p, [q.id]: idx }))}
              className={cn(
                'w-full justify-start text-left p-4 h-auto rounded-xl border-2 text-[13px] transition-all mb-2',
                selectedAnswers[q.id] === idx
                  ? 'border-primary bg-blue-50 text-slate-900 font-medium hover:bg-blue-50'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
              )}
            >
              <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-slate-100 text-slate-600 text-[12px] font-bold mr-3 shrink-0">
                {String.fromCharCode(65 + idx)}
              </span>
              {opt}
            </Button>
          ))}
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button variant="outline" disabled={currentQuestion === 0}
          onClick={() => setCurrentQuestion(c => c - 1)}>
          ← Back
        </Button>

        {isLast ? (
          <Button className="bg-primary hover:bg-primary/90 text-white"
            disabled={!hasAnswer || submitMut.isPending}
            onClick={handleSubmit}>
            {submitMut.isPending ? 'Submitting…' : 'Submit Answers'}
          </Button>
        ) : (
          <Button className="bg-primary hover:bg-primary/90 text-white"
            disabled={!hasAnswer}
            onClick={() => setCurrentQuestion(c => c + 1)}>
            Next →
          </Button>
        )}
      </div>
    </div>
  )
}
