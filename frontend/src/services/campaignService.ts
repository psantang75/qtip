/**
 * Call Campaign API service. Default-exported object over the shared `api` axios
 * instance, mirroring schedulingService. Dates are 'YYYY-MM-DD' local strings.
 *
 * Two surfaces:
 *   - Library (categories + campaign items) — global, admin-writeable, edited in
 *     List Management.
 *   - Schedules — department-scoped named calendars, their membership, the month
 *     projection (computed on read), and per-day overrides.
 */
import { api } from './authService'

export type CampaignAnchorType = 'BD_FROM_START' | 'BD_FROM_END' | 'RELATIVE_TO_CAMPAIGN'

export interface ApiCampaignItem {
  id: number
  category_id: number
  label: string
  anchor_type: CampaignAnchorType
  anchor_offset: number
  anchor_ref_item_id: number | null
  not_on_friday: boolean
  sort_order: number
  is_active: boolean
}
export interface ApiCampaignCategory {
  id: number
  name: string
  color: string
  sort_order: number
  is_active: boolean
  items: ApiCampaignItem[]
}

export type CampaignPublishStatus = 'DRAFT' | 'PUBLISHED'

export interface ApiScheduleDepartment { id: number; department_name: string }

export interface ApiCampaignSchedule {
  id: number
  name: string
  /** Every department the calendar is shown to, by name. Never empty. */
  departments: ApiScheduleDepartment[]
  is_active: boolean
  status: CampaignPublishStatus
  /** Released months as 'YYYY-MM', ascending. Agents may only open these. */
  published_months: string[]
}

export interface ApiMembershipRow {
  campaign_item_id: number
  label: string
  category_id: number
  category_name: string
  color: string
  category_sort: number
  item_sort: number
  is_enabled: boolean
}

export interface ApiDayChip {
  campaign_item_id: number
  label: string
  category_id: number
  category_name: string
  color: string
  source: 'GENERATED' | 'ADDED'
}
export interface ApiProjectedDay {
  date: string
  day_type: string
  is_workday: boolean
  chips: ApiDayChip[]
}
export interface ApiMonthProjection {
  schedule_id: number
  year: number
  month: number
  is_published: boolean
  schedule_status: CampaignPublishStatus
  days: ApiProjectedDay[]
}

const unwrap = <T>(raw: unknown): T => (raw as { data?: T })?.data ?? (raw as T)
const BASE = '/scheduling/campaigns'

const campaignService = {
  // ── Library ────────────────────────────────────────────────────────────────
  getLibrary: async (includeInactive = false): Promise<ApiCampaignCategory[]> =>
    unwrap<ApiCampaignCategory[]>((await api.get(`${BASE}/library?include_inactive=${includeInactive}`)).data),

  createCategory: async (body: { name: string; color?: string }) => unwrap((await api.post(`${BASE}/categories`, body)).data),
  updateCategory: async (id: number, body: { name?: string; color?: string }) => unwrap((await api.put(`${BASE}/categories/${id}`, body)).data),
  setCategoryActive: async (id: number, is_active: boolean) => unwrap((await api.patch(`${BASE}/categories/${id}/active`, { is_active })).data),
  reorderCategories: async (order: Array<{ id: number; sort_order: number }>) => unwrap((await api.post(`${BASE}/categories/reorder`, { order })).data),

  createItem: async (body: Record<string, unknown>) => unwrap((await api.post(`${BASE}/items`, body)).data),
  updateItem: async (id: number, body: Record<string, unknown>) => unwrap((await api.put(`${BASE}/items/${id}`, body)).data),
  setItemActive: async (id: number, is_active: boolean) => unwrap((await api.patch(`${BASE}/items/${id}/active`, { is_active })).data),
  reorderItems: async (order: Array<{ id: number; sort_order: number }>) => unwrap((await api.post(`${BASE}/items/reorder`, { order })).data),

  // ── Schedules + membership ───────────────────────────────────────────────────
  /** includeInactive is honoured for editors only — agents never see retired ones. */
  listSchedules: async (includeInactive = false): Promise<ApiCampaignSchedule[]> =>
    unwrap<ApiCampaignSchedule[]>((await api.get(`${BASE}/schedules?include_inactive=${includeInactive}`)).data),
  listWritableDepartments: async (): Promise<ApiScheduleDepartment[]> =>
    unwrap<ApiScheduleDepartment[]>((await api.get(`${BASE}/departments`)).data),
  createSchedule: async (body: { name: string; department_ids: number[] }): Promise<ApiCampaignSchedule> =>
    unwrap<ApiCampaignSchedule>((await api.post(`${BASE}/schedules`, body)).data),
  updateSchedule: async (id: number, body: { name?: string; is_active?: boolean; department_ids?: number[] }): Promise<ApiCampaignSchedule> =>
    unwrap<ApiCampaignSchedule>((await api.put(`${BASE}/schedules/${id}`, body)).data),
  deleteSchedule: async (id: number) => unwrap((await api.delete(`${BASE}/schedules/${id}`)).data),

  getMembership: async (id: number): Promise<ApiMembershipRow[]> =>
    unwrap<ApiMembershipRow[]>((await api.get(`${BASE}/schedules/${id}/membership`)).data),
  setMembership: async (id: number, campaign_item_id: number, is_enabled: boolean) =>
    unwrap((await api.put(`${BASE}/schedules/${id}/membership`, { campaign_item_id, is_enabled })).data),

  // ── Publishing (Admin/Manager) — releasing a month releases the schedule too ──
  setMonthPublished: async (id: number, year: number, month: number, is_published: boolean) =>
    unwrap((await api.put(`${BASE}/schedules/${id}/month/publish`, { year, month, is_published })).data),

  // ── Month projection + overrides ─────────────────────────────────────────────
  getMonth: async (id: number, year: number, month: number): Promise<ApiMonthProjection> =>
    unwrap<ApiMonthProjection>((await api.get(`${BASE}/schedules/${id}/month?year=${year}&month=${month}`)).data),
  setDayCampaign: async (id: number, occurrence_date: string, campaign_item_id: number, is_on: boolean) =>
    unwrap((await api.put(`${BASE}/schedules/${id}/day`, { occurrence_date, campaign_item_id, is_on })).data),
}

export default campaignService
