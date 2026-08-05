/**
 * API layer for the "Agent Activity - CSR" Insights section. Named for the
 * SECTION rather than the Attendance page so later CSR pages share it, mirroring
 * how insightsService.ts serves all of Agent Activity - Sales.
 *
 * All read-only. Attendance rules are edited through Admin -> List Management,
 * which talks to insightsAdminService.
 */
import { api } from './authService'
import type { PastDueItem, PastDueQuery, TicketsTasksResponse } from './insightsService'

export interface AttendanceParams {
  users?: string
  departments?: string
  period: string
  start?: string
  end?: string
  /** Overrides the period's end date; the server clamps it to the punch watermark. */
  asOf?: string
}

export type AttendanceKind = 'LATE' | 'EARLY_LEAVE' | 'ABSENT' | 'EXCEPTION'

export interface AttendanceAgentRow {
  userId: number
  name: string
  dept: string
  points0to30: number
  points31to60: number
  points61to90: number
  rolling90: number
  absences: number
  lates: number
  earlyLeaves: number
  graceUsed: number
  daysMeasured: number
  scheduledMinutes: number
  adherentMinutes: number
  compliancePct: number | null
  trend: number
  trendBasisDays: number
  trendTargetDays: number
  trajectory: 'better' | 'worse' | 'flat'
  rollOffDate: string | null
  rollOffPoints: number
  rollOffTotal: number
  level: string | null
  levelKey: string | null
}

export interface AttendancePointBand {
  ruleKey: string
  label: string
  kind: AttendanceKind
  minSeconds: number
  maxSeconds: number | null
  points: number
}

export interface AttendanceWarningLevel {
  levelKey: string
  label: string
  pointsThreshold: number
}

export interface AttendanceSummaryResponse {
  asOf: string
  asOfClamped: boolean
  windowFrom: string
  isSelfView: boolean
  rows: AttendanceAgentRow[]
  /** Filter-bar options, scoped but NOT narrowed by the agent filter itself. */
  availableUsers: string[]
  availableDepartments: string[]
  pointBands: AttendancePointBand[]
  warningLevels: AttendanceWarningLevel[]
}

export interface AttendanceOccurrence {
  workDate: string
  kind: AttendanceKind
  reason: string
  deviationSeconds: number
  points: number
  /** The schedule the day was measured against, 'HH:MM'. */
  scheduledStart: string | null
  scheduledEnd: string | null
  /** Actual arrival and departure, 'HH:MM'. Null on an absence. */
  punchIn: string | null
  punchOut: string | null
}

export interface ComplianceCell {
  month: string
  scheduledMinutes: number
  adherentMinutes: number
  pct: number | null
}

export interface ComplianceRow {
  userId: number
  name: string
  dept: string
  cells: ComplianceCell[]
  totalScheduled: number
  totalAdherent: number
  totalPct: number | null
}

export interface ComplianceMatrixResponse {
  months: string[]
  rows: ComplianceRow[]
  columnTotals: ComplianceCell[]
  grandTotalPct: number | null
}

export interface DayOfWeekRow {
  dayOfWeek: number
  label: string
  absences: number
  lates: number
  scheduledDays: number
}

export const getAttendanceSummary = async (p: AttendanceParams): Promise<AttendanceSummaryResponse> => {
  const response = await api.get('/insights/csr/attendance/summary', { params: p })
  return response.data
}

export const getAttendanceOccurrences = async (
  userId: number,
  p: AttendanceParams,
): Promise<{ userId: number; asOf: string; occurrences: AttendanceOccurrence[] }> => {
  const response = await api.get('/insights/csr/attendance/occurrences', { params: { ...p, userId } })
  return response.data
}

export const getAttendanceCompliance = async (
  p: AttendanceParams & { months?: number },
): Promise<ComplianceMatrixResponse> => {
  const response = await api.get('/insights/csr/attendance/compliance', { params: p })
  return response.data
}

export const getAttendanceDayOfWeek = async (
  p: AttendanceParams,
): Promise<{ asOf: string; windowFrom: string; days: DayOfWeekRow[] }> => {
  const response = await api.get('/insights/csr/attendance/day-of-week', { params: p })
  return response.data
}

// ── Tickets & Tasks ──────────────────────────────────────────────────────────
// The CSR twin of the Sales report: identical response shape, so the types come
// from insightsService rather than being redeclared. SNAPSHOT report — only the
// agent/department filters are sent.

export const getCsrTicketsTasks = async (p: AttendanceParams): Promise<TicketsTasksResponse> => {
  const { users, departments } = p
  const response = await api.get('/insights/csr/tickets', { params: { users, departments } })
  return response.data
}

export const getCsrTicketsPastDue = async (q: PastDueQuery): Promise<PastDueItem[]> => {
  const response = await api.get('/insights/csr/tickets/past-due', { params: q })
  return response.data
}

// ── Admin config (Admin -> List Management -> Attendance) ────────────────────
// Point bands and the discipline ladder are effective-dated: saving inserts a new
// version starting on `effectiveFrom` rather than rewriting history, so a warning
// already issued stays reproducible.

export interface AttendancePointRuleConfig {
  id: number
  ruleKey: string
  label: string
  kind: AttendanceKind
  minSeconds: number
  maxSeconds: number | null
  points: number
  exceptionTypeId: number | null
  effectiveFrom: string
  effectiveTo: string | null
  isActive: boolean
}

export interface AttendanceThresholdConfig {
  levelKey: string
  label: string
  pointsThreshold: number
  sortOrder: number
  effectiveFrom: string
  effectiveTo: string | null
  isActive: boolean
}

export interface AttendanceConfigResponse {
  rules: AttendancePointRuleConfig[]
  thresholds: AttendanceThresholdConfig[]
  exceptionTypes: Array<{ id: number; type_key: string; label: string }>
  // The day the point policy took effect; days before it are never counted.
  pointsStartDate: string
}

export const getAttendanceConfig = async (): Promise<AttendanceConfigResponse> => {
  const response = await api.get('/insights/admin/attendance/config')
  return response.data
}

export const savePointsStartDate = async (pointsStartDate: string): Promise<void> => {
  await api.put('/insights/admin/attendance/points-start', { pointsStartDate })
}

export interface PointRuleSavePayload {
  ruleKey: string
  label: string
  kind: AttendanceKind
  minSeconds: number
  maxSeconds: number | null
  points: number
  exceptionTypeId: number | null
  sortOrder: number
  isActive: boolean
}

export const savePointRules = async (effectiveFrom: string, rules: PointRuleSavePayload[]): Promise<void> => {
  await api.put('/insights/admin/attendance/rules', { effectiveFrom, rules })
}

export interface ThresholdSavePayload {
  levelKey: string
  label: string
  pointsThreshold: number
  sortOrder: number
  isActive: boolean
}

export const saveWarningThresholds = async (
  effectiveFrom: string,
  thresholds: ThresholdSavePayload[],
): Promise<void> => {
  await api.put('/insights/admin/attendance/thresholds', { effectiveFrom, thresholds })
}

export const recalculateAttendance = async (
  from: string,
  to: string,
): Promise<{ from: string; to: string; daysScored: number; occurrences: number }> => {
  const response = await api.post('/insights/admin/attendance/recalculate', { from, to })
  return response.data
}
