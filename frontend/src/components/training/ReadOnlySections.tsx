import { useState } from 'react'
import { ExternalLink, BookOpen, HelpCircle, ClipboardCheck, RotateCw, Eye } from 'lucide-react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { StandardTableHeaderRow } from '@/components/common/StandardTableHeaderRow'
import { Sub } from '@/components/common/DetailLayout'
import { resourceHref } from '@/utils/trainingHelpers'

// ── Reference Materials (read-only table) ───────────────────────────────────

interface Resource {
  id: number
  title: string
  description?: string | null
  resource_type?: string
  url?: string
}

export function ResourcesTable({ resources, forAgent = false }: {
  resources: Resource[]
  forAgent?: boolean
}) {
  return (
    <Sub title="Reference Materials" icon={BookOpen}>
      {resources.length > 0 ? (
        <Table className="text-xs">
          <TableHeader>
            <StandardTableHeaderRow className="text-slate-400">
              <TableHead className="text-left py-1.5 font-medium pr-4 w-[40%]">Title</TableHead>
              <TableHead className="text-left py-1.5 font-medium pr-4">Description</TableHead>
              <TableHead className="text-left py-1.5 font-medium pr-2 w-[60px]" />
            </StandardTableHeaderRow>
          </TableHeader>
          <TableBody>
            {resources.map(r => (
              <TableRow key={r.id} className="border-b border-slate-100 last:border-0">
                <TableCell className="py-2 pr-4 font-semibold text-slate-900">{r.title}</TableCell>
                <TableCell className="py-2 pr-4 text-slate-600">{r.description || '—'}</TableCell>
                <TableCell className="py-2 pr-2">
                  <a href={resourceHref(r, forAgent)} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline">
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-[13px] text-slate-400 italic">No resources assigned</p>
      )}
    </Sub>
  )
}

// ── Quiz Assignment (read-only summary table) ───────────────────────────────

interface Quiz {
  id: number
  quiz_title: string
  pass_score: number
}

interface QuizAttempt {
  id: number
  quiz_id: number
  score: number | string
  passed: boolean
  submitted_at: string
}

interface QuizSummaryTableProps {
  quizzes: Quiz[]
  attempts: QuizAttempt[]
  /** When provided, renders an Action column with Take/Review Quiz.
   *  The callback receives the quiz id and returns the inline content (QuizPlayer or QuizReview). */
  renderAction?: (quizId: number) => React.ReactNode
}

export function QuizSummaryTable({ quizzes, attempts, renderAction }: QuizSummaryTableProps) {
  const [expandedQuizId, setExpandedQuizId] = useState<number | null>(null)
  const hasActions = !!renderAction

  return (
    <Sub title="Quiz Assignment" icon={HelpCircle}>
      {quizzes.length > 0 ? (
        <Table className="text-xs">
          <TableHeader>
            <StandardTableHeaderRow className="text-slate-400">
              <TableHead className="text-left py-1.5 font-medium pr-6 w-[30%]">Quiz</TableHead>
              <TableHead className="text-left py-1.5 font-medium pr-6 w-[12%]">Pass Score</TableHead>
              <TableHead className="text-left py-1.5 font-medium pr-6 w-[12%]">Attempts</TableHead>
              <TableHead className="text-left py-1.5 font-medium pr-6 w-[10%]">Best</TableHead>
              <TableHead className="text-left py-1.5 font-medium pr-4 w-[14%]">Result</TableHead>
              {hasActions && <TableHead className="text-left py-1.5 font-medium" />}
            </StandardTableHeaderRow>
          </TableHeader>
          <TableBody>
            {quizzes.map(quiz => {
              const qa = attempts.filter(a => a.quiz_id === quiz.id)
              const passed = !!qa.find(a => a.passed)
              const best = qa.length > 0 ? Math.max(...qa.map(a => Number(a.score))) : null
              const isExpanded = expandedQuizId === quiz.id

              return (
                <QuizRow
                  key={quiz.id}
                  quiz={quiz}
                  qa={qa}
                  passed={passed}
                  best={best}
                  hasActions={hasActions}
                  isExpanded={isExpanded}
                  onToggle={() => setExpandedQuizId(isExpanded ? null : quiz.id)}
                  renderAction={renderAction}
                />
              )
            })}
          </TableBody>
        </Table>
      ) : (
        <p className="text-[13px] text-slate-400 italic">No quizzes assigned</p>
      )}
    </Sub>
  )
}

function QuizRow({ quiz, qa, passed, best, hasActions, isExpanded, onToggle, renderAction }: {
  quiz: Quiz
  qa: QuizAttempt[]
  passed: boolean
  best: number | null
  hasActions: boolean
  isExpanded: boolean
  onToggle: () => void
  renderAction?: (quizId: number) => React.ReactNode
}) {
  const actionLabel = passed
    ? { icon: Eye, text: 'Review Quiz' }
    : qa.length > 0
      ? { icon: RotateCw, text: 'Retake Quiz' }
      : { icon: ClipboardCheck, text: 'Take Quiz' }

  const Icon = actionLabel.icon
  const resultText = passed ? 'Passed' : qa.length > 0 ? 'Failed' : 'Not started'

  return (
    <>
      <TableRow className="border-b border-slate-100 last:border-0">
        <TableCell className="py-2.5 pr-6 font-semibold text-slate-900">{quiz.quiz_title}</TableCell>
        <TableCell className="py-2.5 pr-6 text-slate-500">{quiz.pass_score}%</TableCell>
        <TableCell className="py-2.5 pr-6 text-slate-600">{qa.length}</TableCell>
        <TableCell className="py-2.5 pr-6 text-slate-600">
          {best != null ? `${best.toFixed(0)}%` : '—'}
        </TableCell>
        <TableCell className="py-2.5 pr-4 text-[13px] text-slate-600">{resultText}</TableCell>
        {hasActions && (
          <TableCell className="py-2.5">
            <button
              onClick={onToggle}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary hover:text-primary/80 transition-colors whitespace-nowrap"
            >
              <Icon className="h-3.5 w-3.5" />
              {isExpanded ? 'Close' : actionLabel.text}
            </button>
          </TableCell>
        )}
      </TableRow>
      {hasActions && isExpanded && (
        <TableRow className="border-b border-slate-100">
          <TableCell colSpan={hasActions ? 6 : 5} className="p-4 bg-slate-50/50">
            {renderAction?.(quiz.id)}
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
