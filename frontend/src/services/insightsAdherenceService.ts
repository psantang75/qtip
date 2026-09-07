/**
 * API layer for CSR Adherence — the break/lunch/phone twin of the Attendance
 * report. Split out from insightsCsrService (which is already near the file-size
 * ceiling) but follows the same shapes. Reads are scoped server-side; rule/config
 * edits go through the Admin -> List Management -> Adherence surface below.
 */
import { api } from './authService'
import type { AttendanceParams } from './insightsCsrService'

export type { AttendanceParams as AdherenceParams }

export type AdherenceKind =
  | 'BREAK_DURATION' | 'LUNCH_DURATION'
  | 'BREAK_START' | 'LUNCH_START'
  | 'BREAK_PHONE_START' | 'BREAK_PHONE_STOP'
  | 'LUNCH_PHONE_START' | 'LUNCH_PHONE_STOP'
  | 'BREAK_MISSED' | 'LUNCH_MISSED'

export interface AdherenceAgentRow {
  userId: number
  name: string
  dept: string
  points0to30: number
  points31to60: number
  points61to90: number
  rolling90: number
  /** Projected rolling-90 points by category, bucketed by age (shown during
   *  report-only). Total = the three age bands summed. */
  punchPoints0to30: number
  punchPoints31to60: number
  punchPoints61to90: number
  punchPoints90: number
  phonePoints0to30: number
  phonePoints31to60: number
  phonePoints61to90: number
  phonePoints90: number
  durationEvents: number
  startEvents: number
  missedEvents: number
  /** Phone deviations split by edge: Start = before the punch, Stop = after. */
  phoneStartEvents: number
  phoneStopEvents: number
  phoneEvents: number
  daysMeasured: number
  scheduledSec: number
  adherentSec: number
  actualSec: number
  phoneExtraSec: number
  /** Gross punch overrun seconds (only breaks/lunches that ran long, each
   *  segment independent — never netted against a short one). */
  punchOverrunSec: number
  /** Punch adherence (schedule-vs-punch). */
  compliancePct: number | null
  /** Phone adherence: punched / (punched + off-queue overhang). */
  phoneAdherencePct: number | null
  /** Total: adherent / (scheduled + overhang) — one blended number. */
  totalAdherencePct: number | null
  trend: number
  trajectory: 'better' | 'worse' | 'flat'
  pointsActive: boolean
  level: string | null
  levelKey: string | null
}

export interface AdherencePointBand {
  ruleKey: string
  label: string
  kind: AdherenceKind
  minSeconds: number
  maxSeconds: number | null
  points: number
}

export interface AdherenceWarningLevel {
  levelKey: string
  label: string
  pointsThreshold: number
}

/** Red/yellow/green cut-offs (percent) for the compliance columns. */
export interface ComplianceThresholds {
  greenMin: number
  yellowMin: number
}

export interface AdherenceSummaryResponse {
  asOf: string
  asOfClamped: boolean
  windowFrom: string
  /** False while occurrences are report-only (points not yet switched on). */
  pointsActive: boolean
  complianceThresholds: ComplianceThresholds
  isSelfView: boolean
  rows: AdherenceAgentRow[]
  availableUsers: string[]
  availableDepartments: string[]
  pointBands: AdherencePointBand[]
  warningLevels: AdherenceWarningLevel[]
}

export interface AdherenceOccurrence {
  workDate: string
  seq: number
  kind: AdherenceKind
  reason: string
  deviationSeconds: number
  /** 'HH:MM' wall-clock, or null when the pair does not apply to this kind
   *  (a missed segment has no punch; a duration/start row has no phone span). */
  scheduledStart: string | null
  scheduledEnd: string | null
  actualStart: string | null
  actualEnd: string | null
  phoneStart: string | null
  phoneEnd: string | null
  points: number
  /** True only when the point actually counted (on/after the points-active date). */
  counted: boolean
}

export const getAdherenceSummary = async (p: AttendanceParams): Promise<AdherenceSummaryResponse> => {
  const response = await api.get('/insights/csr/adherence/summary', { params: p })
  return response.data
}

export const getAdherenceOccurrences = async (
  userId: number,
  p: AttendanceParams,
): Promise<{ userId: number; asOf: string; occurrences: AdherenceOccurrence[] }> => {
  const response = await api.get('/insights/csr/adherence/occurrences', { params: { ...p, userId } })
  return response.data
}

// ── Admin config (Admin -> List Management -> Adherence) ─────────────────────
// Effective-dated like attendance: saving inserts a new version from
// `effectiveFrom` rather than rewriting history.

export interface AdherencePointRuleConfig {
  id: number
  ruleKey: string
  label: string
  kind: AdherenceKind
  minSeconds: number
  maxSeconds: number | null
  points: number
  effectiveFrom: string
  effectiveTo: string | null
  isActive: boolean
}

export interface AdherenceThresholdConfig {
  levelKey: string
  label: string
  pointsThreshold: number
  sortOrder: number
  effectiveFrom: string
  effectiveTo: string | null
  isActive: boolean
}

export interface AdherenceSettings {
  startDate: string
  pointsActiveFrom: string
  phoneGraceBeforeSec: number
  phoneGraceAfterSec: number
  complianceGreenMin: number
  complianceYellowMin: number
}

export interface AdherenceConfigResponse {
  rules: AdherencePointRuleConfig[]
  thresholds: AdherenceThresholdConfig[]
  settings: AdherenceSettings
  pointsActive: boolean
}

export const getAdherenceConfig = async (): Promise<AdherenceConfigResponse> => {
  const response = await api.get('/insights/admin/adherence/config')
  return response.data
}

export interface AdherencePointRuleSavePayload {
  ruleKey: string
  label: string
  kind: AdherenceKind
  minSeconds: number
  maxSeconds: number | null
  points: number
  sortOrder: number
  isActive: boolean
}

export const saveAdherenceRules = async (
  effectiveFrom: string,
  rules: AdherencePointRuleSavePayload[],
): Promise<void> => {
  await api.put('/insights/admin/adherence/rules', { effectiveFrom, rules })
}

export interface AdherenceThresholdSavePayload {
  levelKey: string
  label: string
  pointsThreshold: number
  sortOrder: number
  isActive: boolean
}

export const saveAdherenceThresholds = async (
  effectiveFrom: string,
  thresholds: AdherenceThresholdSavePayload[],
): Promise<void> => {
  await api.put('/insights/admin/adherence/thresholds', { effectiveFrom, thresholds })
}

export const saveAdherenceSettings = async (settings: AdherenceSettings): Promise<void> => {
  await api.put('/insights/admin/adherence/settings', settings)
}

export const recalculateAdherence = async (
  from: string,
  to: string,
): Promise<{ from: string; to: string; daysScored: number; occurrences: number }> => {
  const response = await api.post('/insights/admin/adherence/recalculate', { from, to })
  return response.data
}
