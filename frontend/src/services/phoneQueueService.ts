/**
 * Phone Queue API service. Default-exported object over the shared `api` axios
 * instance, mirroring campaignService. Dates are 'YYYY-MM-DD' local strings and
 * times are 'HH:MM' wall clock.
 *
 * Three surfaces:
 *   - Library — the global set of queues, admin-writeable, edited in List
 *     Management.
 *   - Department configuration — which queues a department staffs, its numbers
 *     for each, its policy, and who may take them.
 *   - Coverage — the solved plan for one department-day, computed on read, plus
 *     the manual overrides that beat it.
 *
 * Errors come back in the `AppError` envelope (`{ error }`), which `t.fromError`
 * already reads, so there is no per-call error mapping here.
 */
import { api } from './authService'

export interface ApiQueueDepartmentRef {
  department_id: number
  department_name: string
  fill_priority: number
  min_agents: number
  target_agents: number
  max_agents: number | null
  is_active: boolean
}

export interface ApiPhoneQueue {
  id: number
  queue_name: string
  queue_code: string | null
  description: string | null
  color: string
  sort_order: number
  is_active: boolean
  departments: ApiQueueDepartmentRef[]
}

export interface ApiQueueWindow {
  start: string
  end: string
  min_agents: number
  target_agents: number
  max_agents: number | null
}

export interface ApiDepartmentQueue {
  queue_id: number
  queue_name: string
  queue_code: string | null
  color: string
  assigned: boolean
  is_active: boolean
  fill_priority: number
  min_agents: number
  target_agents: number
  max_agents: number | null
  windows: ApiQueueWindow[]
}

export interface ApiDepartmentQueues {
  department_id: number
  department_name: string
  queues: ApiDepartmentQueue[]
}

export type FillStrategy = 'PRIORITY' | 'ROUND_ROBIN'

export interface ApiQueuePolicy {
  department_id: number
  is_enabled: boolean
  max_queues_per_person: number
  require_min_one_per_queue: boolean
  respect_pins: boolean
  fill_strategy: FillStrategy
  configured: boolean
}

export interface ApiRosterQueue {
  queue_id: number
  queue_name: string
  color: string
  is_home: boolean
  person_priority: number
  is_pinned: boolean
  is_active: boolean
}

export interface ApiRosterPerson {
  user_id: number
  username: string
  queues: ApiRosterQueue[]
  home_queue_id: number | null
}

export interface ApiDepartmentRoster {
  department_id: number
  department_name: string
  people: ApiRosterPerson[]
}

export interface ApiQueueMember {
  user_id: number
  username: string
  department_id: number | null
  is_home: boolean
  person_priority: number
  is_pinned: boolean
  is_active: boolean
}

// ── Solved coverage ──────────────────────────────────────────────────────────
// The unit is a 15-minute slot: a lunch is an hour long, so anything coarser
// cannot see the thing the plan exists to arrange cover for.

export type SeatReason = 'HOME' | 'PINNED' | 'COVER' | 'OVERRIDE'
export type GapReason = 'UNSTAFFABLE' | 'BELOW_MIN' | 'BELOW_TARGET' | 'NO_ELIGIBLE_MEMBERS'
/** Keys match `CoverageLevel` in scheduling/scheduleTime, so COVERAGE_CLS applies directly. */
export type QueueLevel = 'closed' | 'none' | 'red' | 'yellow' | 'green'

export interface ApiQueueTargets { min: number; target: number; max: number | null }

export interface ApiAwayBand {
  start: string
  end: string
  kind: 'BREAK' | 'TIME_OFF'
  label: string
}

export interface ApiPersonDayRow {
  userId: number
  username: string
  shift: { start: string; end: string } | null
  /** 'PTO', 'Not scheduled' — set when the whole day is written off. */
  offLabel: string | null
  away: ApiAwayBand[]
  homeQueueId: number | null
  memberOf: number[]
}

export interface ApiSlotAssignment {
  userId: number
  queueId: number
  reason: SeatReason
  /** False when they only cover part of the slot — a lunch starting at :35. */
  fullSlot: boolean
}

export interface ApiSlotQueueState {
  queueId: number
  targets: ApiQueueTargets
  assigned: number
  /** The fewest assigned people on coverage at any moment in the slot. */
  trough: number
  level: QueueLevel
}

export interface ApiSlotSolution {
  start: string
  end: string
  startMin: number
  assignments: ApiSlotAssignment[]
  queues: ApiSlotQueueState[]
  spare: number[]
}

export interface ApiQueueMeta {
  queueId: number
  queueName: string
  color: string
  fillPriority: number
  targets: ApiQueueTargets
}

export interface ApiDayWarning {
  queueId: number
  queueName: string
  reason: GapReason
  start: string
  end: string
  message: string
}

export interface ApiQueueDay {
  departmentId: number
  departmentName: string
  date: string
  publishedOnly: boolean
  notConfigured: boolean
  slotMinutes: number
  axis: { startMin: number; endMin: number } | null
  queues: ApiQueueMeta[]
  people: ApiPersonDayRow[]
  slots: ApiSlotSolution[]
  warnings: ApiDayWarning[]
}

export interface ApiWeekCell {
  queueId: number
  /** The worst grade across the day, with the headcount at that same moment. */
  level: QueueLevel
  trough: number
}

export interface ApiWeekDay {
  date: string
  hasSchedule: boolean
  axis: { startMin: number; endMin: number } | null
  /** Same rows and slots the day view draws, so the week can render per-person bars. */
  people: ApiPersonDayRow[]
  slots: ApiSlotSolution[]
  /** Per-queue worst-of-day roll-up for the coverage summary under the grid. */
  cells: ApiWeekCell[]
}

export interface ApiQueueWeek {
  departmentId: number
  departmentName: string
  publishedOnly: boolean
  notConfigured: boolean
  queues: ApiQueueMeta[]
  days: ApiWeekDay[]
}

export interface ApiQueueOverride {
  id: number
  department_id: number
  assignment_date: string
  user_id: number
  username: string
  queue_id: number
  queue_name: string
  action: 'ASSIGN' | 'EXCLUDE'
  /** Null means the whole day. */
  start: string | null
  end: string | null
}

const unwrap = <T>(raw: unknown): T => (raw as { data?: T })?.data ?? (raw as T)
const BASE = '/scheduling/queues'

const phoneQueueService = {
  // ── Library (admin writes) ─────────────────────────────────────────────────
  getLibrary: async (includeInactive = false): Promise<ApiPhoneQueue[]> =>
    unwrap<{ queues: ApiPhoneQueue[] }>((await api.get(`${BASE}/library?include_inactive=${includeInactive}`)).data).queues,
  createQueue: async (body: { queue_name: string; queue_code?: string | null; description?: string | null; color?: string }) =>
    unwrap((await api.post(`${BASE}/library`, body)).data),
  updateQueue: async (id: number, body: { queue_name?: string; queue_code?: string | null; description?: string | null; color?: string }) =>
    unwrap((await api.put(`${BASE}/library/${id}`, body)).data),
  setQueueActive: async (id: number, is_active: boolean) =>
    unwrap((await api.patch(`${BASE}/library/${id}/active`, { is_active })).data),
  reorderQueues: async (order: Array<{ id: number; sort_order: number }>) =>
    unwrap((await api.post(`${BASE}/library/reorder`, { order })).data),

  // ── Department configuration ───────────────────────────────────────────────
  listDepartments: async (): Promise<Array<{ id: number; department_name: string }>> =>
    unwrap<{ departments: Array<{ id: number; department_name: string }> }>((await api.get(`${BASE}/departments`)).data).departments,
  getDepartmentQueues: async (departmentId: number): Promise<ApiDepartmentQueues> =>
    unwrap<ApiDepartmentQueues>((await api.get(`${BASE}/departments/${departmentId}/queues`)).data),
  saveDepartmentQueues: async (
    departmentId: number,
    queues: Array<Omit<ApiDepartmentQueue, 'queue_name' | 'queue_code' | 'color' | 'assigned'>>,
  ): Promise<ApiDepartmentQueues> =>
    unwrap<ApiDepartmentQueues>((await api.put(`${BASE}/departments/${departmentId}/queues`, { queues })).data),

  getPolicy: async (departmentId: number): Promise<ApiQueuePolicy> =>
    unwrap<{ policy: ApiQueuePolicy }>((await api.get(`${BASE}/departments/${departmentId}/policy`)).data).policy,
  savePolicy: async (departmentId: number, body: Partial<Omit<ApiQueuePolicy, 'department_id' | 'configured'>>): Promise<ApiQueuePolicy> =>
    unwrap<{ policy: ApiQueuePolicy }>((await api.put(`${BASE}/departments/${departmentId}/policy`, body)).data).policy,

  getRoster: async (departmentId: number): Promise<ApiDepartmentRoster> =>
    unwrap<ApiDepartmentRoster>((await api.get(`${BASE}/departments/${departmentId}/roster`)).data),

  // ── Membership ─────────────────────────────────────────────────────────────
  getQueueMembers: async (queueId: number): Promise<{ queue_id: number; queue_name: string; members: ApiQueueMember[] }> =>
    unwrap((await api.get(`${BASE}/${queueId}/members`)).data),
  saveQueueMembers: async (
    queueId: number,
    members: Array<{ user_id: number; is_home: boolean; person_priority: number; is_pinned: boolean; is_active?: boolean }>,
  ) => unwrap((await api.put(`${BASE}/${queueId}/members`, { members })).data),

  // ── Solved coverage + overrides ────────────────────────────────────────────
  getCoverage: async (departmentId: number, date: string, includeDraft = false): Promise<ApiQueueDay> =>
    unwrap<ApiQueueDay>(
      (await api.get(`${BASE}/coverage?department_id=${departmentId}&date=${date}&include_draft=${includeDraft ? 1 : 0}`)).data,
    ),
  getWeekCoverage: async (departmentId: number, start: string, includeDraft = false): Promise<ApiQueueWeek> =>
    unwrap<ApiQueueWeek>(
      (await api.get(`${BASE}/coverage/week?department_id=${departmentId}&start=${start}&include_draft=${includeDraft ? 1 : 0}`)).data,
    ),
  getOverrides: async (departmentId: number, date: string): Promise<ApiQueueOverride[]> =>
    unwrap<{ overrides: ApiQueueOverride[] }>((await api.get(`${BASE}/overrides?department_id=${departmentId}&date=${date}`)).data).overrides,
  /** Omit start/end for the whole day. */
  setOverride: async (body: {
    department_id: number; assignment_date: string; user_id: number; queue_id: number
    action: 'ASSIGN' | 'EXCLUDE'; start?: string | null; end?: string | null
  }): Promise<ApiQueueOverride[]> =>
    unwrap<{ overrides: ApiQueueOverride[] }>((await api.put(`${BASE}/overrides`, body)).data).overrides,
  /** Hand a window back to the solver. Omit queue_id to clear every queue. */
  clearOverrides: async (body: {
    department_id: number; assignment_date: string; user_id: number
    queue_id?: number | null; start?: string | null; end?: string | null
  }): Promise<ApiQueueOverride[]> =>
    unwrap<{ overrides: ApiQueueOverride[] }>((await api.put(`${BASE}/overrides/clear`, body)).data).overrides,
  deleteOverride: async (id: number) => unwrap((await api.delete(`${BASE}/overrides/${id}`)).data),
}

export default phoneQueueService
