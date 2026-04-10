import { InsightsSection, StatusBadge, KpiTile, ExpandableRow } from '@/components/insights'
import { resolveThresholds } from '@/hooks/useKpiConfig'

interface QuizAgent {
  userId: number
  name: string
  dept: string
  score: number
  passed: boolean
  attempts: number
}

interface QuizRow {
  quiz: string
  attempts: number
  passed: number
  passRate: number
  agents: QuizAgent[]
}

interface Props {
  cur: Record<string, number | null>
  prv: Record<string, number | undefined>
  kpiConfig: unknown
  sortedQuizzes: QuizRow[]
  visibleQuizzes: QuizRow[]
  maxQuizAttempts: number
  expandedQuiz: string | null
  onToggleQuiz: (quiz: string) => void
  showAllQuizzes: boolean
  onToggleShowAll: () => void
  onNavAgent: (userId: number) => void
}

function fmt(v: number | null | undefined, suffix = ''): string {
  if (v === null || v === undefined) return '—'
  return `${v.toFixed(1)}${suffix}`
}

export default function CoachingQuizSection({
  cur, prv, kpiConfig, sortedQuizzes, visibleQuizzes, maxQuizAttempts,
  expandedQuiz, onToggleQuiz, showAllQuizzes, onToggleShowAll, onNavAgent,
}: Props) {
  const quizScoreThresh = resolveThresholds('avg_quiz_score', kpiConfig)

  return (
    <InsightsSection title="Quiz Performance">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        {['quizzes_assigned','quizzes_passed','quiz_pass_rate','avg_quiz_score','avg_attempts_to_pass'].map(code => (
          <KpiTile key={code} kpiCode={code} small value={cur[code] ?? null} priorValue={prv[code] ?? undefined}
            thresholds={resolveThresholds(code, kpiConfig)} />
        ))}
      </div>
      <div className="text-[13px] font-semibold text-slate-700 mb-3">Quiz Breakdown</div>
      {sortedQuizzes.length === 0 && <p className="text-sm text-slate-400 py-4 text-center">No quiz data for this period.</p>}
      {visibleQuizzes.map(q => {
        const fails = q.attempts - q.passed
        const barPct = maxQuizAttempts > 0 ? Math.round((q.attempts / maxQuizAttempts) * 100) : 0
        const agents = q.agents ?? []
        return (
          <ExpandableRow
            key={q.quiz}
            isExpanded={expandedQuiz === q.quiz}
            onToggle={() => onToggleQuiz(q.quiz)}
            summary={
              <div className="flex items-center flex-1 min-w-0">
                <span className="text-[13px] font-medium text-slate-800 flex-1 truncate">{q.quiz}</span>
                <span className="text-xs text-slate-700 w-24 text-right shrink-0">{fmt(q.passRate, '%')} Pass Rate</span>
                <div className="w-28 bg-slate-100 rounded-full h-2 overflow-hidden shrink-0 ml-4">
                  <div className="h-full rounded-full bg-primary/70" style={{ width: `${barPct}%` }} />
                </div>
                <span className="text-xs text-slate-700 w-20 text-right shrink-0 ml-4">{q.attempts} Attempts</span>
                <span className={`text-xs font-semibold w-14 text-right shrink-0 ml-4 ${fails > 10 ? 'text-red-600' : fails > 5 ? 'text-orange-500' : 'text-slate-700'}`}>{fails} Fails</span>
              </div>
            }
            detail={
              <div className="pt-1">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4.5rem_5rem_4rem] text-[11px] text-slate-400 font-medium border-b border-slate-200 pb-1.5 mb-0.5 gap-x-5">
                  <span>Agent</span><span>Department</span><span className="text-right">Score</span><span className="text-right">Status</span><span className="text-right">Attempts</span>
                </div>
                {agents.map(a => (
                  <div key={a.userId}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4.5rem_5rem_4rem] items-center text-xs py-2 border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer gap-x-5"
                    onClick={() => onNavAgent(a.userId)}
                  >
                    <span className="text-primary hover:underline font-medium truncate">{a.name}</span>
                    <span className="text-slate-500 truncate">{a.dept}</span>
                    <span className={`text-right font-semibold ${a.score >= (quizScoreThresh.goal ?? 80) ? 'text-emerald-600' : a.score >= (quizScoreThresh.warn ?? 65) ? 'text-orange-500' : 'text-red-600'}`}>{a.score.toFixed(0)}%</span>
                    <span className="text-right"><StatusBadge label={a.passed ? 'Passed' : 'Failed'} variant={a.passed ? 'good' : 'bad'} /></span>
                    <span className="text-slate-600 text-right">{a.attempts}</span>
                  </div>
                ))}
                {agents.length === 0 && <p className="text-xs text-slate-400 py-2">No agent data available.</p>}
              </div>
            }
          />
        )
      })}
      {sortedQuizzes.length > 5 && (
        <button onClick={onToggleShowAll} className="mt-3 text-xs text-primary hover:underline">
          {showAllQuizzes ? 'Show top 5 only' : `Show all ${sortedQuizzes.length} quizzes`}
        </button>
      )}
    </InsightsSection>
  )
}
