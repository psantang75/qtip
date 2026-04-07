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
export interface QCKpiResponse  { current: KpiValues; prior: KpiValues }
export type TrendRow            = Record<string, number | string | null>

export interface AgentSummary {
  userId: number; name: string; dept: string
  qa: number | null; trend: string
  coaching: number; quiz: number; disputes: number; writeups: number
  risk: boolean; cadence: number; expected: number
}

export interface AgentProfile {
  user: { id: number; name: string; dept: string; title: string | null }
  recentAudits: Array<{ id: number; form: string; score: number | null; date: string; callDate: string | null; status: string }>
  coachingSessions: Array<{ id: number; date: string; purpose: string; status: string; topics: string[] }>
  quizzes: Array<{ id: number; quiz: string; score: number; passed: boolean; date: string; attempts: number }>
  writeUps: Array<{
    id: number; type: string; status: string; date: string
    meetingDate: string | null; followUpDate: string | null
    linkedCoaching: boolean; priorCount: number; policies: string[]; managerName: string | null
  }>
  disputeStats: { total: number; upheld: number; rejected: number; adjusted: number; avgResolutionDays: number | null }
}

export interface ScoreBucket    { bucket: string; count: number }
export interface CategoryScore  { category: string; audits: number; avgScore: number | null }
export interface MissedQuestionAgent { userId: number; name: string; dept: string }
export interface MissedQuestion { questionId: number; question: string; form: string; missRate: number; agents: MissedQuestionAgent[] }
export interface FormScore { id: number; form: string; submissions: number; avgScore: number | null }
export interface DeptQualityRow { dept: string; audits: number; avgScore: number | null; disputes: number }

export interface CoachingTopic        { topic: string; sessions: number; agents: number }
export interface CoachingTopicAgent   { userId: number; name: string; dept: string; sessions: number; lastCoached: string | null; repeat: boolean }
export interface RepeatOffenderTopic  { topic: string; count: number }
export interface RepeatOffender       { userId: number; name: string; dept: string; sessions: number; uniqueTopics: number; repeatTopics: number; topics: RepeatOffenderTopic[] }
export interface AgentFailedQuizzes   { userId: number; name: string; dept: string; failed: number; quizzes: string[]; avgScore: number | null }
export interface QuizBreakdown        { quiz: string; attempts: number; passed: number; avgScore: number | null; passRate: number }
export interface DeptCoachingRow      { dept: string; sessions: number; completed: number; avgDays: number | null }

export interface WriteUpPipeline {
  byStatus: Record<string, number>; byType: Record<string, number>; total: number
  avgDaysToClose: number | null; pendingFollowUps: number; overdueFollowUps: number
}
export interface ActiveWriteUp {
  id: number; userId: number; agent: string; dept: string; type: string; status: string
  date: string; meetingDate: string | null; followUpDate: string | null; priorCount: number; policies: string[]
}
export interface EscalationData  { verbal: number; written: number; final: number }
export interface PolicyViolationAgent { userId: number; name: string; dept: string; type: string; status: string }
export interface PolicyViolation { policy: string; count: number; agentCount: number; agentDetails: PolicyViolationAgent[] }
export interface DeptWarningsRow { dept: string; writeups: number; closed: number; resolutionRate: number }

// ── API functions ─────────────────────────────────────────────────────────────

export const getQCKpis = async (p: QCParams): Promise<QCKpiResponse> =>
  (await api.get('/insights/qc/kpis', { params: p })).data

export const getQCTrends = async (p: QCParams & { kpis?: string }): Promise<TrendRow[]> =>
  (await api.get('/insights/qc/trends', { params: p })).data

export const getQCAgents = async (p: QCParams): Promise<AgentSummary[]> =>
  (await api.get('/insights/qc/agents', { params: p })).data

export const getQCAgentProfile = async (userId: number, p: QCParams): Promise<AgentProfile> =>
  (await api.get(`/insights/qc/agent/${userId}`, { params: p })).data

export const getScoreDistribution = async (p: QCParams): Promise<ScoreBucket[]> =>
  (await api.get('/insights/qc/quality/score-distribution', { params: p })).data

export const getCategoryScores = async (p: QCParams & { form?: number }): Promise<CategoryScore[]> =>
  (await api.get('/insights/qc/quality/categories', { params: p })).data

export const getMissedQuestions = async (p: QCParams): Promise<MissedQuestion[]> =>
  (await api.get('/insights/qc/quality/missed-questions', { params: p })).data

export const getQualityDeptComparison = async (p: QCParams): Promise<DeptQualityRow[]> =>
  (await api.get('/insights/qc/quality/dept-comparison', { params: p })).data

export const getFormScores = async (p: QCParams): Promise<FormScore[]> =>
  (await api.get('/insights/qc/quality/forms', { params: p })).data

export const getCoachingTopics = async (p: QCParams): Promise<CoachingTopic[]> =>
  (await api.get('/insights/qc/coaching/topics', { params: p })).data

export const getRepeatOffenders = async (p: QCParams): Promise<RepeatOffender[]> =>
  (await api.get('/insights/qc/coaching/repeat-offenders', { params: p })).data

export const getCoachingTopicAgents = async (p: QCParams & { topic: string }): Promise<CoachingTopicAgent[]> =>
  (await api.get('/insights/qc/coaching/topic-agents', { params: p })).data

export const getAgentsFailedQuizzes = async (p: QCParams): Promise<AgentFailedQuizzes[]> =>
  (await api.get('/insights/qc/coaching/failed-quiz-agents', { params: p })).data

export const getQuizBreakdown = async (p: QCParams): Promise<QuizBreakdown[]> =>
  (await api.get('/insights/qc/coaching/quizzes', { params: p })).data

export const getCoachingDeptComparison = async (p: QCParams): Promise<DeptCoachingRow[]> =>
  (await api.get('/insights/qc/coaching/dept-comparison', { params: p })).data

export const getWriteUpPipeline = async (p: QCParams): Promise<WriteUpPipeline> =>
  (await api.get('/insights/qc/warnings/pipeline', { params: p })).data

export const getActiveWriteUps = async (p: QCParams): Promise<ActiveWriteUp[]> =>
  (await api.get('/insights/qc/warnings/active', { params: p })).data

export const getEscalationData = async (p: QCParams): Promise<EscalationData> =>
  (await api.get('/insights/qc/warnings/escalation', { params: p })).data

export const getPolicyViolations = async (p: QCParams): Promise<PolicyViolation[]> =>
  (await api.get('/insights/qc/warnings/policies', { params: p })).data

export const getWarningsDeptComparison = async (p: QCParams): Promise<DeptWarningsRow[]> =>
  (await api.get('/insights/qc/warnings/dept-comparison', { params: p })).data
