/**
 * Shared types for the trainer service domain.
 *
 * Extracted from the old `controllers/trainer.controller.ts` (792 lines)
 * and the now-deleted `services/TrainerService.ts` (431 lines, only
 * `getTrainingStats` and this error class were live) during the
 * pre-production review (item #29). Single source of truth for the DTOs
 * the dashboard / reports / submissions endpoints exchange.
 *
 * Error envelope: trainer endpoints already shipped two slightly
 * different envelopes (some `{ message, code }`, some
 * `{ error, message, code }`). The trainer `respond.ts` keeps both shapes
 * intact — we are not changing client contracts here, only consolidating
 * structure (item #29 is structural only).
 */

/**
 * Errors thrown by trainer services. Re-exported from the legacy
 * `TrainerService` so call sites that imported `TrainerServiceError`
 * keep working without churn.
 */
export class TrainerServiceError extends Error {
  public readonly statusCode: number
  public readonly code: string

  constructor(message: string, statusCode = 500, code = 'TRAINER_SERVICE_ERROR') {
    super(message)
    this.name = 'TrainerServiceError'
    this.statusCode = statusCode
    this.code = code
  }
}

/** Filter-options bundle backing the trainer reports filter bar. */
export interface FilterOptions {
  courses:     Array<{ id: number; course_name: string; description: string; created_by: number; created_at: string }>
  csrs:        Array<{ id: number; name: string; email: string; department?: string }>
  departments: Array<{ id: number; name: string }>
}

/** Filter shape the report builder posts to `/api/trainer/reports`. */
export interface ReportFilters {
  dateRange:    { startDate: string; endDate: string }
  courseIds:    number[]
  csrIds:       number[]
  departmentIds: number[]
}

export interface CompletionRateData {
  label:          string
  completionRate: number
  total:          number
  completed:      number
}

export interface QuizPerformanceData {
  id:          number
  csrName:     string
  courseName:  string
  quizTitle:   string
  score:       number
  passFail:    'PASS' | 'FAIL'
  completedAt: string
}

export interface TraineeFeedbackData {
  id:          number
  csrName:     string
  courseName:  string
  rating:      number
  comment:     string
  submittedAt: string
}

export interface ProgressTrendData {
  date:     string
  progress: number
  label:    string
}

export interface TrainerReportPayload {
  completionRates: CompletionRateData[]
  quizPerformance: QuizPerformanceData[]
  traineeFeedback: TraineeFeedbackData[]
  progressTrends:  ProgressTrendData[]
}

/** Dashboard-stats shape served by `/api/trainer/dashboard-stats`. */
export interface TrainerDashboardStats {
  reviewsCompleted: { thisWeek: number; thisMonth: number }
  disputes:         { thisWeek: number; thisMonth: number }
  coachingSessions: { thisWeek: number; thisMonth: number }
}

/** Per-CSR activity row served by `/api/trainer/csr-activity`. */
export interface TrainerCSRActivityRow {
  id:                       number
  name:                     string
  department:               string
  audits:                   number
  disputes:                 number
  coachingScheduled:        number
  coachingCompleted:        number
  audits_week:              number
  disputes_week:            number
  audits_month:             number
  disputes_month:           number
  coachingScheduled_week:   number
  coachingCompleted_week:   number
  coachingScheduled_month:  number
  coachingCompleted_month:  number
}
