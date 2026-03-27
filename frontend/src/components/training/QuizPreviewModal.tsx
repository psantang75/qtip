import { useState } from 'react'
import { CheckCircle, XCircle, HelpCircle, RotateCcw } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { QuizQuestion } from '@/services/trainingService'

interface QuizPreviewQuiz {
  id?: number
  quiz_title: string
  pass_score: number
  questions: (QuizQuestion | { question_text: string; options: string[]; correct_option: number })[]
}

interface QuizPreviewModalProps {
  quiz: QuizPreviewQuiz | null
  open: boolean
  onClose: () => void
}

type Phase = 'intro' | 'taking' | 'result'

interface PreviewResult {
  score: number
  passed: boolean
  correctIds: Set<number>
}

export function QuizPreviewModal({ quiz, open, onClose }: QuizPreviewModalProps) {
  const [phase,           setPhase]           = useState<Phase>('intro')
  const [currentQ,        setCurrentQ]        = useState(0)
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({})
  const [result,          setResult]          = useState<PreviewResult | null>(null)

  const reset = () => {
    setPhase('intro')
    setCurrentQ(0)
    setSelectedAnswers({})
    setResult(null)
  }

  const handleClose = () => { reset(); onClose() }

  const startQuiz = () => { setCurrentQ(0); setSelectedAnswers({}); setResult(null); setPhase('taking') }

  const handleSubmit = () => {
    if (!quiz) return
    const questions = quiz.questions
    let correct = 0
    const correctIds = new Set<number>()
    questions.forEach((q, idx) => {
      const userAnswer = selectedAnswers[idx]
      if (userAnswer === q.correct_option) {
        correct++
        correctIds.add(idx)
      }
    })
    const score  = questions.length ? (correct / questions.length) * 100 : 0
    const passed = score >= Number(quiz.pass_score)
    setResult({ score, passed, correctIds })
    setPhase('result')
  }

  if (!quiz) return null
  const questions = quiz.questions

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent aria-describedby={undefined} className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-primary" />
            Preview: {quiz.quiz_title}
          </DialogTitle>
        </DialogHeader>

        <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Preview mode — answers are not saved. Use this to test your quiz before publishing.
        </p>

        {/* ── INTRO ─────────────────────────────────────────────────── */}
        {phase === 'intro' && (
          <div className="text-center py-6 space-y-4">
            <div>
              <p className="text-[15px] font-semibold text-slate-800">{quiz.quiz_title}</p>
              <p className="text-[13px] text-slate-500 mt-1">
                {questions.length} question{questions.length !== 1 ? 's' : ''} &nbsp;·&nbsp; Pass score: {quiz.pass_score}%
              </p>
            </div>
            {questions.length === 0 ? (
              <p className="text-[13px] text-slate-400">This quiz has no questions yet.</p>
            ) : (
              <Button className="bg-primary hover:bg-primary/90 text-white" onClick={startQuiz}>
                Start Preview
              </Button>
            )}
          </div>
        )}

        {/* ── TAKING ────────────────────────────────────────────────── */}
        {phase === 'taking' && (() => {
          const q       = questions[currentQ]
          const isLast  = currentQ === questions.length - 1
          const hasAns  = selectedAnswers[currentQ] !== undefined
          const progress = (currentQ / questions.length) * 100

          return (
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-[12px] text-slate-500 mb-1.5">
                  <span>Question {currentQ + 1} of {questions.length}</span>
                  <span>{Math.round(progress)}% complete</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>

              <p className="text-[15px] font-medium text-slate-800">{q.question_text}</p>

              <div className="space-y-2">
                {q.options.map((opt, idx) => (
                  <button key={idx}
                    onClick={() => setSelectedAnswers(p => ({ ...p, [currentQ]: idx }))}
                    className={cn(
                      'w-full text-left p-4 rounded-xl border-2 text-[13px] transition-all',
                      selectedAnswers[currentQ] === idx
                        ? 'border-primary bg-blue-50 text-slate-900 font-medium'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
                    )}>
                    <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-slate-100 text-slate-600 text-[12px] font-bold mr-3">
                      {String.fromCharCode(65 + idx)}
                    </span>
                    {opt}
                  </button>
                ))}
              </div>

              <div className="flex justify-between pt-2">
                <Button variant="outline" disabled={currentQ === 0} onClick={() => setCurrentQ(c => c - 1)}>
                  ← Back
                </Button>
                {isLast ? (
                  <Button className="bg-primary hover:bg-primary/90 text-white" disabled={!hasAns} onClick={handleSubmit}>
                    Submit Answers
                  </Button>
                ) : (
                  <Button className="bg-primary hover:bg-primary/90 text-white" disabled={!hasAns} onClick={() => setCurrentQ(c => c + 1)}>
                    Next →
                  </Button>
                )}
              </div>
            </div>
          )
        })()}

        {/* ── RESULT ────────────────────────────────────────────────── */}
        {phase === 'result' && result && (
          <div className="space-y-4">
            <div className={cn('rounded-xl border p-5 text-center', result.passed ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200')}>
              {result.passed
                ? <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto mb-2" />
                : <XCircle    className="h-12 w-12 text-red-400    mx-auto mb-2" />
              }
              <p className={cn('text-lg font-bold', result.passed ? 'text-emerald-800' : 'text-red-700')}>
                {result.passed ? 'Passed!' : 'Not Passed'}
              </p>
              <p className={cn('text-[13px] mt-1', result.passed ? 'text-emerald-700' : 'text-red-600')}>
                Score: {result.score.toFixed(0)}% &nbsp;·&nbsp; Required: {quiz.pass_score}%
              </p>
            </div>

            <div className="space-y-2">
              {questions.map((q, idx) => {
                const userIdx   = selectedAnswers[idx] ?? -1
                const isCorrect = result.correctIds.has(idx)
                return (
                  <div key={idx} className={cn('rounded-xl border p-4', isCorrect ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200')}>
                    <div className="flex items-start gap-2 mb-2">
                      {isCorrect
                        ? <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                        : <XCircle    className="h-4 w-4 text-red-500    shrink-0 mt-0.5" />
                      }
                      <p className="text-[13px] font-medium text-slate-800">{idx + 1}. {q.question_text}</p>
                    </div>
                    <p className="text-[12px] text-slate-600 ml-6">
                      Your answer: {userIdx >= 0 ? q.options[userIdx] : <span className="text-slate-400">No answer</span>}
                    </p>
                    {!isCorrect && (
                      <p className="text-[12px] text-emerald-700 font-medium ml-6 mt-0.5">
                        Correct: {q.options[q.correct_option]}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            <Button variant="outline" className="w-full" onClick={startQuiz}>
              <RotateCcw className="h-4 w-4 mr-2" /> Retake Preview
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
