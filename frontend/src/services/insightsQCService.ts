import { api } from './authService'

// ── Shared params type ────────────────────────────────────────────────────────

export interface QCParams {
  departments?: string
  period: string
  start?: string
  end?: string
  forms?: string
}

// ── Response types ────────────────────────────────────────────────────────────

export type KpiValues = Record<string, number | null>
export interface KpiMeta       { businessDays: number; paceTarget: number | null; startDate?: string; endDate?: string }
export interface QCKpiResponse { current: KpiValues; prior: KpiValues; meta: KpiMeta; priorMeta: KpiMeta }
export interface TrendRow {
  label: string
  [kpiCode: string]: number | string | null
}

export interface AgentSummary {
  userId: number; name: string; dept: string
  qa: number | null; trend: string
  qaCount: number; coaching: number; writeups: number
}

export interface AgentProfile {
  user: { id: number; name: string; dept: string; title: string | null }
  qaTrend: Array<{ label: string; value: number }>
  recentAudits: Array<{ id: number; form: string; score: number | null; date: string; callDate: string | null; status: string }>
  coachingSessions: Array<{ id: number; date: string; purpose: string; format: string; status: string; topics: string[] }>
  quizzes: Array<{ id: number; quiz: string; score: number; passed: boolean; date: string; attempts: number }>
  writeUps: Array<{
    id: number; type: string; status: string; date: string
    meetingDate: string | null; followUpDate: string | null
    linkedCoaching: boolean; priorCount: number; policies: string[]; managerName: string | null
  }>
  disputeStats: { total: number; upheld: number; adjusted: number; open: number; avgResolutionDays: number | null }
}

export interface ScoreBucket    { bucket: string; count: number }
export interface CategoryScore  { categoryId: number; category: string; formId: number; form: string; audits: number; avgScore: number | null; priorScore: number | null }
export interface MissedQuestionAgent { userId: number; name: string; dept: string; missed: number; total: number }
export interface MissedQuestion { questionId: number; question: string; form: string; missRate: number; missed: number; total: number; agents: MissedQuestionAgent[] }
export interface FormScore { id: number; form: string; submissions: number; avgScore: number | null }
export interface LowScoringAudit { id: number; csrUserId: number; agent: string; form: string; interactionDate: string | null; score: number | null }
export interface FormAgentRow { userId: number; name: string; dept: string; audits: number; avgScore: number | null }
export interface CategoryAgentRow { userId: number; name: string; dept: string; audits: number; avgScore: number | null }
export interface DeptQualityRow { dept: string; audits: number; avgScore: number | null; disputes: number }
export interface QAFormCompletedRow {
  qaUserId: number; qaName: string
  csrUserId: number; csrName: string
  formId: number; form: string
  completed: number; avgScore: number | null
}

export interface CoachingTopic        { topic: string; sessions: number; agents: number }
export interface CoachingTopicAgent   { userId: number; name: string; dept: string; sessions: number; lastCoached: string | null; repeat: boolean }
export interface RepeatOffenderTopic  { topic: string; count: number }
export interface RepeatOffender       { userId: number; name: string; dept: string; sessions: number; uniqueTopics: number; repeatTopics: number; topics: RepeatOffenderTopic[] }
export interface AgentFailedQuizzes   { userId: number; name: string; dept: string; failed: number; quizzes: string[]; avgScore: number | null }
export interface QuizAgentResult       { userId: number; name: string; dept: string; score: number; passed: boolean; failed: number; attempts: number }
export interface QuizBreakdown        { quiz: string; attempts: number; passed: number; avgScore: number | null; passRate: number; agents?: QuizAgentResult[] }
export interface SessionStatusAgent    { userId: number; name: string; dept: string; purpose: string; format: string; sessions: number; topics: string[] }
export interface SessionStatusGroup   { status: string; count: number; topics: string[]; agents: SessionStatusAgent[] }
export interface DeptCoachingRow      { dept: string; sessions: number; completed: number; avgDays: number | null }

export interface WriteUpPipeline {
  byStatus: Record<string, number>; byType: Record<string, number>; total: number
  avgDaysToClose: number | null; pendingFollowUps: number; overdueFollowUps: number
}
export interface ActiveWriteUp {
  id: number; userId: number; agent: string; dept: string; type: string; status: string
  date: string; meetingDate: string | null; followUpDate: string | null; priorCount: number; policies: string[]
}
export interface StepUpCounts {
  verbalToWritten: number
  writtenToFinal:  number
  distinctAgents:  number
}
export interface EscalationData {
  stepUps:       { current: StepUpCounts; prior: StepUpCounts }
  agentsOnFinal: number
}
export interface RepeatWarningAgent {
  userId:       number
  agent:        string
  dept:         string
  inPeriod:     number
  prior90d:     number
  prior12mo:    number
  latestType:   string | null
  latestStatus: string | null
}
export interface PolicyViolationAgent {
  userId:     number
  name:       string
  dept:       string
  violations: number
  type:       string
  status:     string
}
export interface PolicyViolation {
  policy:       string
  count:        number
  agentCount:   number
  agentDetails: PolicyViolationAgent[]
}
export interface DeptWarningsRow { dept: string; writeups: number; closed: number; resolutionRate: number }

export interface FilterOptions { departments: string[]; forms: string[] }

// Combined initial-load bundle for the Agent Profile page. Used as
// placeholderData for the per-section queries so the page renders in one
// round trip; subsequent filter changes still hit the per-section endpoints
// directly so only the affected data refetches.
export interface QCAgentFullResponse {
  profile:         AgentProfile
  kpis:            QCKpiResponse
  trends:          TrendRow[]
  formScores:      FormScore[]
  categoryScores:  CategoryScore[]
  missedQuestions: MissedQuestion[]
}

// ── API factory ───────────────────────────────────────────────────────────────
//
// Every dashboard function is bound to a base path so the SAME page components
// can serve both the standard Quality/Coaching (`/insights/qc`) surface and the
// Internal Research (`/insights/ir`, INTERNAL scope) surface with no duplication.
// `useInsightsApi()` (hooks/useInsightsScope) resolves the base from context.
export function createInsightsApi(base = '/insights/qc') {
  return {
    getFilterOptions: async (p: QCParams): Promise<FilterOptions> =>
      (await api.get(`${base}/filter-options`, { params: p })).data,

    getQCKpis: async (p: QCParams & { userId?: string }): Promise<QCKpiResponse> =>
      (await api.get(`${base}/kpis`, { params: p })).data,

    getQCTrends: async (p: QCParams & { kpis?: string; userId?: string }): Promise<TrendRow[]> =>
      (await api.get(`${base}/trends`, { params: p })).data,

    getQCAgents: async (p: QCParams): Promise<AgentSummary[]> =>
      (await api.get(`${base}/agents`, { params: p })).data,

    getQCAgentProfile: async (userId: number, p: QCParams): Promise<AgentProfile> =>
      (await api.get(`${base}/agent/${userId}`, { params: p })).data,

    getQCAgentFull: async (userId: number, p: QCParams & { kpis?: string }): Promise<QCAgentFullResponse> =>
      (await api.get(`${base}/agent/${userId}/full`, { params: p })).data,

    getScoreDistribution: async (p: QCParams): Promise<ScoreBucket[]> =>
      (await api.get(`${base}/quality/score-distribution`, { params: p })).data,

    getCategoryScores: async (p: QCParams & { form?: number; userId?: string }): Promise<CategoryScore[]> =>
      (await api.get(`${base}/quality/categories`, { params: p })).data,

    getMissedQuestions: async (p: QCParams): Promise<MissedQuestion[]> =>
      (await api.get(`${base}/quality/missed-questions`, { params: p })).data,

    getQualityDeptComparison: async (p: QCParams): Promise<DeptQualityRow[]> =>
      (await api.get(`${base}/quality/dept-comparison`, { params: p })).data,

    getQAFormsCompleted: async (p: QCParams): Promise<QAFormCompletedRow[]> =>
      (await api.get(`${base}/quality/qa-forms-completed`, { params: p })).data,

    getFormScores: async (p: QCParams & { userId?: string }): Promise<FormScore[]> =>
      (await api.get(`${base}/quality/forms`, { params: p })).data,

    getLowScoringAudits: async (p: QCParams): Promise<LowScoringAudit[]> =>
      (await api.get(`${base}/quality/low-scores`, { params: p })).data,

    getFormAgentBreakdown: async (formId: number, p: QCParams): Promise<FormAgentRow[]> =>
      (await api.get(`${base}/quality/forms/${formId}/agents`, { params: p })).data,

    getCategoryAgentBreakdown: async (formId: number, categoryId: number, p: QCParams): Promise<CategoryAgentRow[]> =>
      (await api.get(`${base}/quality/category-agents`, { params: { ...p, formId, categoryId } })).data,

    getCoachingTopics: async (p: QCParams): Promise<CoachingTopic[]> =>
      (await api.get(`${base}/coaching/topics`, { params: p })).data,

    getRepeatOffenders: async (p: QCParams): Promise<RepeatOffender[]> =>
      (await api.get(`${base}/coaching/repeat-offenders`, { params: p })).data,

    getCoachingTopicAgents: async (p: QCParams & { topic: string }): Promise<CoachingTopicAgent[]> =>
      (await api.get(`${base}/coaching/topic-agents`, { params: p })).data,

    getAgentsFailedQuizzes: async (p: QCParams): Promise<AgentFailedQuizzes[]> =>
      (await api.get(`${base}/coaching/failed-quiz-agents`, { params: p })).data,

    getQuizBreakdown: async (p: QCParams): Promise<QuizBreakdown[]> =>
      (await api.get(`${base}/coaching/quizzes`, { params: p })).data,

    getSessionsByStatus: async (p: QCParams): Promise<SessionStatusGroup[]> =>
      (await api.get(`${base}/coaching/sessions-by-status`, { params: p })).data,

    getCoachingDeptComparison: async (p: QCParams): Promise<DeptCoachingRow[]> =>
      (await api.get(`${base}/coaching/dept-comparison`, { params: p })).data,

    getWriteUpPipeline: async (p: QCParams): Promise<WriteUpPipeline> =>
      (await api.get(`${base}/warnings/pipeline`, { params: p })).data,

    getActiveWriteUps: async (p: QCParams): Promise<ActiveWriteUp[]> =>
      (await api.get(`${base}/warnings/active`, { params: p })).data,

    getEscalationData: async (p: QCParams): Promise<EscalationData> =>
      (await api.get(`${base}/warnings/escalation`, { params: p })).data,

    getRepeatWarningAgents: async (p: QCParams): Promise<RepeatWarningAgent[]> =>
      (await api.get(`${base}/warnings/repeat-agents`, { params: p })).data,

    getPolicyViolations: async (p: QCParams): Promise<PolicyViolation[]> =>
      (await api.get(`${base}/warnings/policies`, { params: p })).data,

    getWarningsDeptComparison: async (p: QCParams): Promise<DeptWarningsRow[]> =>
      (await api.get(`${base}/warnings/dept-comparison`, { params: p })).data,
  }
}

export type InsightsApi = ReturnType<typeof createInsightsApi>

// ── Backward-compatible named exports (bound to the standard QC base) ──────────
// QC-only pages (Coaching / Warnings) keep importing these directly.
const qcApi = createInsightsApi('/insights/qc')

export const getFilterOptions          = qcApi.getFilterOptions
export const getQCKpis                 = qcApi.getQCKpis
export const getQCTrends               = qcApi.getQCTrends
export const getQCAgents               = qcApi.getQCAgents
export const getQCAgentProfile         = qcApi.getQCAgentProfile
export const getQCAgentFull            = qcApi.getQCAgentFull
export const getScoreDistribution      = qcApi.getScoreDistribution
export const getCategoryScores         = qcApi.getCategoryScores
export const getMissedQuestions        = qcApi.getMissedQuestions
export const getQualityDeptComparison  = qcApi.getQualityDeptComparison
export const getQAFormsCompleted       = qcApi.getQAFormsCompleted
export const getFormScores             = qcApi.getFormScores
export const getLowScoringAudits       = qcApi.getLowScoringAudits
export const getFormAgentBreakdown     = qcApi.getFormAgentBreakdown
export const getCategoryAgentBreakdown = qcApi.getCategoryAgentBreakdown
export const getCoachingTopics         = qcApi.getCoachingTopics
export const getRepeatOffenders        = qcApi.getRepeatOffenders
export const getCoachingTopicAgents    = qcApi.getCoachingTopicAgents
export const getAgentsFailedQuizzes    = qcApi.getAgentsFailedQuizzes
export const getQuizBreakdown          = qcApi.getQuizBreakdown
export const getSessionsByStatus       = qcApi.getSessionsByStatus
export const getCoachingDeptComparison = qcApi.getCoachingDeptComparison
export const getWriteUpPipeline        = qcApi.getWriteUpPipeline
export const getActiveWriteUps         = qcApi.getActiveWriteUps
export const getEscalationData         = qcApi.getEscalationData
export const getRepeatWarningAgents    = qcApi.getRepeatWarningAgents
export const getPolicyViolations       = qcApi.getPolicyViolations
export const getWarningsDeptComparison = qcApi.getWarningsDeptComparison
