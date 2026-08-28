/**
 * Scheduling API service. Default-exported object over the shared `api` axios
 * instance, mirroring writeupService. All wall-clock values are 'HH:MM' and all
 * dates are 'YYYY-MM-DD' local strings — never Date instants across the wire.
 */
import { api } from './authService'

// ── Wire types (match backend service payloads) ──────────────────────────────

export interface ApiSegment {
  activity_type_id: number
  label: string
  is_paid: boolean
  color: string | null
  start: string
  end: string
}
export interface ApiShift {
  id: number
  user_id: number
  shift_date: string
  is_day_off: boolean
  start: string | null
  end: string | null
  notes: string | null
  status: 'DRAFT' | 'PUBLISHED'
  source: string
  template_id: number | null
  locked: boolean
  segments: ApiSegment[]
}
export interface ApiException {
  id: number
  user_id: number
  username: string
  department_name: string | null
  exception_date: string
  exception_type_id: number
  label: string
  is_excused: boolean
  is_full_day: boolean
  start: string | null
  end: string | null
  notes: string | null
  /** Owned by the Paychex import — a manual delete returns on the next import. */
  is_imported: boolean
}
export interface ApiRosterUser {
  id: number
  username: string
  department_id: number | null
  department_name: string | null
}
export interface ApiGrid {
  roster: ApiRosterUser[]
  shifts: ApiShift[]
  exceptions: ApiException[]
}

export interface ApiActivityType {
  id: number; label: string; category: string | null; is_paid: boolean; counts_as_coverage: boolean
  color: string | null; sort_order: number; is_active: boolean; is_system: boolean
}
export interface ApiExceptionType {
  id: number; type_key: string; label: string; category: string | null; description: string | null
  paychex_pay_type: string | null
  is_excused: boolean; duration_mode: 'FULL_DAY' | 'WINDOW' | 'EITHER'
  affects_arrival: boolean; affects_departure: boolean; is_system: boolean
  sort_order: number; is_active: boolean
}
export interface ApiCoverageWindow {
  id?: number; start: string; end: string; green_min: number; yellow_min: number
}
export interface ApiCoverageThreshold {
  department_id: number; department_name: string; is_enabled: boolean
  green_min: number; yellow_min: number; configured: boolean
  windows: ApiCoverageWindow[]
}

export interface ApiTemplateSegment { id: number; activity_type_id: number; start_time: string; end_time: string; sort_order: number }
export interface ApiTemplateDay { id: number; day_of_week: number; is_day_off: boolean; start_time: string | null; end_time: string | null; segments: ApiTemplateSegment[] }
export interface ApiTemplate { id: number; template_name: string; description: string | null; is_active: boolean; days: ApiTemplateDay[] }

export interface ApplyPreview { write: number; overwrite: number; clearDays: number; holiday: number; published: number }
export interface BulkExceptionPreview { write: number; unscheduled: number; conflict: number; outside: number }

// What each Paychex Non-Work block became. Classified live on every request, so
// the review always matches what attendance actually scored.
export type TimeOffOutcome =
  | 'FULL_DAY' | 'PARTIAL' | 'NO_SHIFT' | 'DAY_OFF' | 'OUTSIDE_SHIFT' | 'MANUAL_OVERRIDE' | 'UNMAPPED'
export interface TimeOffImportRow {
  user_id: number; username: string; exception_date: string
  pay_type: string; type_label: string | null; outcome: TimeOffOutcome
  block_minutes: number; scheduled_minutes: number
  is_full_day: boolean; start: string | null; end: string | null
}
export interface TimeOffImportReview {
  from: string; to: string; blocks: number; created: number; removed: number
  rows: TimeOffImportRow[]
}

// ── Request payloads ─────────────────────────────────────────────────────────

export interface SegmentInput { activity_type_id: number; start: string; end: string }
export interface ShiftUpsertInput {
  user_id: number; shift_date: string; is_day_off: boolean
  start?: string | null; end?: string | null; notes?: string | null; segments?: SegmentInput[]
}
export interface ApplyInput {
  mode: 'template' | 'copy'; user_ids: number[]; dates: string[]
  template_id?: number; source_week_start?: string; dry_run?: boolean
}
export interface PublishInput { user_ids: number[]; dates: string[]; confirm_elapsed?: boolean }
export interface TemplateDayInput { day_of_week: number; is_day_off: boolean; start?: string | null; end?: string | null; segments?: SegmentInput[] }
export interface TemplateInput { template_name: string; description?: string | null; days: TemplateDayInput[] }
export interface ExceptionInput {
  user_id: number; exception_date: string; exception_type_id: number; is_full_day: boolean
  start?: string | null; end?: string | null; notes?: string | null; paychex_reference?: string | null
}
export interface BulkExceptionInput {
  user_ids: number[]; from: string; to: string; exception_type_id: number
  is_full_day: boolean; start?: string | null; end?: string | null; dry_run?: boolean
}

const unwrap = <T>(raw: unknown): T => (raw as { data?: T })?.data ?? (raw as T)

const schedulingService = {
  // Grid + shifts
  getGrid: async (from: string, to: string): Promise<ApiGrid> => {
    const res = await api.get(`/scheduling/grid?from=${from}&to=${to}`)
    return unwrap<ApiGrid>(res.data)
  },
  /** Business-calendar day types keyed by 'YYYY-MM-DD' (WORKDAY/WEEKEND/HOLIDAY/CLOSURE/ADJUSTMENT). */
  getCalendarDayTypes: async (from: string, to: string): Promise<Record<string, string>> => {
    const res = await api.get(`/scheduling/calendar/day-types?from=${from}&to=${to}`)
    return unwrap<{ dayTypes: Record<string, string> }>(res.data).dayTypes
  },
  getMySchedule: async (from: string, to: string): Promise<ApiShift[]> => {
    const res = await api.get(`/scheduling/my-schedule?from=${from}&to=${to}`)
    return unwrap<ApiShift[]>(res.data)
  },
  upsertShift: async (body: ShiftUpsertInput) => unwrap((await api.put('/scheduling/shifts', body)).data),
  deleteShift: async (id: number) => unwrap((await api.delete(`/scheduling/shifts/${id}`)).data),
  apply: async (body: ApplyInput): Promise<ApplyPreview> => unwrap<ApplyPreview>((await api.post('/scheduling/apply', body)).data),
  publish: async (body: PublishInput) => unwrap((await api.post('/scheduling/publish', body)).data),
  unpublish: async (body: { user_ids: number[]; dates: string[] }) => unwrap((await api.post('/scheduling/unpublish', body)).data),
  unlockShift: async (id: number) => unwrap((await api.post(`/scheduling/shifts/${id}/unlock`, {})).data),

  // Templates
  listTemplates: async (includeInactive = false): Promise<ApiTemplate[]> =>
    unwrap<ApiTemplate[]>((await api.get(`/scheduling/templates?include_inactive=${includeInactive}`)).data),
  getTemplate: async (id: number): Promise<ApiTemplate> => unwrap<ApiTemplate>((await api.get(`/scheduling/templates/${id}`)).data),
  createTemplate: async (body: TemplateInput): Promise<ApiTemplate> => unwrap<ApiTemplate>((await api.post('/scheduling/templates', body)).data),
  updateTemplate: async (id: number, body: TemplateInput): Promise<ApiTemplate> => unwrap<ApiTemplate>((await api.put(`/scheduling/templates/${id}`, body)).data),
  setTemplateActive: async (id: number, is_active: boolean) => unwrap((await api.patch(`/scheduling/templates/${id}/active`, { is_active })).data),
  duplicateTemplate: async (id: number): Promise<ApiTemplate> => unwrap<ApiTemplate>((await api.post(`/scheduling/templates/${id}/duplicate`, {})).data),

  // Exceptions
  listExceptions: async (params: { from?: string; to?: string; user_id?: number } = {}): Promise<ApiException[]> => {
    const q = new URLSearchParams()
    if (params.from) q.set('from', params.from)
    if (params.to) q.set('to', params.to)
    if (params.user_id) q.set('user_id', String(params.user_id))
    const qs = q.toString()
    return unwrap<ApiException[]>((await api.get(`/scheduling/exceptions${qs ? `?${qs}` : ''}`)).data)
  },
  createException: async (body: ExceptionInput) => unwrap((await api.post('/scheduling/exceptions', body)).data),
  deleteException: async (id: number) => unwrap((await api.delete(`/scheduling/exceptions/${id}`)).data),
  bulkException: async (body: BulkExceptionInput): Promise<BulkExceptionPreview> =>
    unwrap<BulkExceptionPreview>((await api.post('/scheduling/exceptions/bulk', body)).data),
  timeOffImportReview: async (from: string, to: string): Promise<TimeOffImportReview> =>
    unwrap<TimeOffImportReview>(
      (await api.get(`/scheduling/exceptions/time-off-import?from=${from}&to=${to}`)).data,
    ),

  // Admin lists
  listActivityTypes: async (includeInactive = false): Promise<ApiActivityType[]> =>
    unwrap<ApiActivityType[]>((await api.get(`/scheduling/activity-types?include_inactive=${includeInactive}`)).data),
  createActivityType: async (body: Record<string, unknown>) => unwrap((await api.post('/scheduling/activity-types', body)).data),
  updateActivityType: async (id: number, body: Record<string, unknown>) => unwrap((await api.put(`/scheduling/activity-types/${id}`, body)).data),
  setActivityTypeActive: async (id: number, is_active: boolean) => unwrap((await api.patch(`/scheduling/activity-types/${id}/active`, { is_active })).data),
  reorderActivityTypes: async (order: Array<{ id: number; sort_order: number }>) => unwrap((await api.post('/scheduling/activity-types/reorder', { order })).data),

  listExceptionTypes: async (includeInactive = false): Promise<ApiExceptionType[]> =>
    unwrap<ApiExceptionType[]>((await api.get(`/scheduling/exception-types?include_inactive=${includeInactive}`)).data),
  createExceptionType: async (body: Record<string, unknown>) => unwrap((await api.post('/scheduling/exception-types', body)).data),
  updateExceptionType: async (id: number, body: Record<string, unknown>) => unwrap((await api.put(`/scheduling/exception-types/${id}`, body)).data),
  setExceptionTypeActive: async (id: number, is_active: boolean) => unwrap((await api.patch(`/scheduling/exception-types/${id}/active`, { is_active })).data),
  reorderExceptionTypes: async (order: Array<{ id: number; sort_order: number }>) => unwrap((await api.post('/scheduling/exception-types/reorder', { order })).data),

  listCoverageThresholds: async (): Promise<ApiCoverageThreshold[]> =>
    unwrap<ApiCoverageThreshold[]>((await api.get('/scheduling/coverage-thresholds')).data),
  upsertCoverageThreshold: async (body: { department_id: number; green_min: number; yellow_min: number; is_enabled?: boolean }) =>
    unwrap((await api.put('/scheduling/coverage-thresholds', body)).data),
  saveCoverageWindows: async (departmentId: number, windows: ApiCoverageWindow[]): Promise<ApiCoverageThreshold[]> =>
    unwrap<ApiCoverageThreshold[]>((await api.put(`/scheduling/coverage-thresholds/${departmentId}/windows`, { windows })).data),
  deleteCoverageThreshold: async (departmentId: number) => unwrap((await api.delete(`/scheduling/coverage-thresholds/${departmentId}`)).data),
}

export default schedulingService
