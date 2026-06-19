import { api } from './authService'

// ── Shared enums ─────────────────────────────────────────────────────────────

export type DataScope = 'ALL' | 'DIVISION' | 'DEPARTMENT' | 'SELF'
export type KpiDirection = 'UP_IS_GOOD' | 'DOWN_IS_GOOD' | 'NEUTRAL'
export type KpiFormatType = 'PERCENT' | 'NUMBER'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InsightsNavItem {
  page_key: string
  page_name: string
  category: string
  route_path: string
  icon: string | null
  sort_order: number
}

export interface InsightsNavCategory {
  category: string
  pages: InsightsNavItem[]
}

export interface InsightsAccessResult {
  canAccess: boolean
  dataScope: DataScope | null
}

export interface DataFreshnessEntry {
  source_system: string
  last_success_at: string | null
  hours_since: number | null
}

export interface IeKpi {
  id: number
  kpi_code: string
  kpi_name: string
  description: string | null
  category: string
  formula_type: string
  formula: string
  source_table: string | null
  format_type: KpiFormatType
  decimal_places: number
  direction: KpiDirection
  unit_label: string | null
  is_active: boolean
  sort_order: number
  threshold_count?: number
}

export interface IeKpiThreshold {
  id: number
  kpi_id: number
  department_key: number | null
  department_name: string | null
  goal_value: number | null
  warning_value: number | null
  critical_value: number | null
  effective_from: string
  effective_to: string | null
}

export interface IePage {
  id: number
  page_key: string
  page_name: string
  description: string | null
  category: string
  route_path: string
  icon: string | null
  sort_order: number
  is_active: boolean
  requires_section: string | null
  role_access: IePageRoleAccess[]
  department_access: IePageDepartmentAccess[]
}

export interface IePageRoleAccess {
  id: number
  page_id: number
  role_id: number
  role_name: string
  can_access: boolean
  data_scope: DataScope
}

export interface IePageDepartmentAccess {
  id: number
  page_id: number
  department_key: number
  department_name: string
  hierarchy_path: string | null
  can_access: boolean
  data_scope: DataScope
}

export interface IeDepartmentOption {
  department_key: number
  department_id: number
  department_name: string
  parent_id: number | null
  hierarchy_path: string | null
}

export interface IePageUserOverride {
  id: number
  page_id: number
  user_id: number
  user_name: string
  can_access: boolean
  data_scope: DataScope | null
  granted_by: number
  granter_name: string
  granted_at: string
  expires_at: string | null
  reason: string | null
}

// ── KPI Config (live thresholds from ie_kpi + ie_kpi_threshold) ──────────────

export interface KpiConfigEntry {
  name:           string
  format:         KpiFormatType
  direction:      KpiDirection
  decimal_places: number
  goal:           number | null
  warn:           number | null
  crit:           number | null
  /** Plain-language description, sourced from ie_kpi.description. */
  description:    string | null
  /** Formula (typically SQL-ish), sourced from ie_kpi.formula. */
  formula:        string | null
  /** Source table(s) hint, sourced from ie_kpi.source_table. */
  source:         string | null
}

export type KpiConfig = Record<string, KpiConfigEntry>

// ── Navigation & Access ───────────────────────────────────────────────────────

export const getKpiConfig = async (): Promise<KpiConfig> => {
  const response = await api.get('/insights/kpi-config')
  return response.data
}

export const getInsightsNavigation = async (): Promise<InsightsNavCategory[]> => {
  const response = await api.get('/insights/navigation')
  return response.data
}

export const getInsightsAccess = async (pageKey: string): Promise<InsightsAccessResult> => {
  const response = await api.get(`/insights/access/${pageKey}`)
  return response.data
}

export const getDataFreshness = async (): Promise<DataFreshnessEntry[]> => {
  const response = await api.get('/insights/data-freshness')
  return response.data
}

// ── Admin: KPIs ───────────────────────────────────────────────────────────────

export const listKpis = async (): Promise<IeKpi[]> => {
  const response = await api.get('/insights/admin/kpis')
  return response.data
}

export const createKpi = async (data: Partial<IeKpi>): Promise<IeKpi> => {
  const response = await api.post('/insights/admin/kpis', data)
  return response.data
}

export const updateKpi = async (id: number, data: Partial<IeKpi>): Promise<IeKpi> => {
  const response = await api.put(`/insights/admin/kpis/${id}`, data)
  return response.data
}

export const getThresholds = async (kpiId: number): Promise<IeKpiThreshold[]> => {
  const response = await api.get(`/insights/admin/kpis/${kpiId}/thresholds`)
  return response.data
}

export const setThreshold = async (kpiId: number, data: Partial<IeKpiThreshold>): Promise<IeKpiThreshold> => {
  const response = await api.post(`/insights/admin/kpis/${kpiId}/thresholds`, data)
  return response.data
}

export const updateThreshold = async (kpiId: number, thresholdId: number, data: Partial<IeKpiThreshold>): Promise<IeKpiThreshold> => {
  const response = await api.put(`/insights/admin/kpis/${kpiId}/thresholds/${thresholdId}`, data)
  return response.data
}

export const deleteThreshold = async (kpiId: number, thresholdId: number): Promise<void> => {
  await api.delete(`/insights/admin/kpis/${kpiId}/thresholds/${thresholdId}`)
}

// ── Admin: Pages & Access ─────────────────────────────────────────────────────

export const listPages = async (): Promise<IePage[]> => {
  const response = await api.get('/insights/admin/pages')
  return response.data
}

export const updatePageAccess = async (
  pageId: number,
  roles: Array<{ role_id: number; can_access: boolean; data_scope: DataScope }>
): Promise<void> => {
  await api.put(`/insights/admin/pages/${pageId}/access`, { roles })
}

export const updatePageDepartmentAccess = async (
  pageId: number,
  departments: Array<{ department_key: number; can_access: boolean; data_scope: DataScope }>
): Promise<void> => {
  await api.put(`/insights/admin/pages/${pageId}/department-access`, { departments })
}

export const listInsightsDepartments = async (): Promise<IeDepartmentOption[]> => {
  const response = await api.get('/insights/admin/departments')
  return response.data
}

export const listOverrides = async (pageId: number): Promise<IePageUserOverride[]> => {
  const response = await api.get(`/insights/admin/pages/${pageId}/overrides`)
  return response.data
}

export const createOverride = async (
  pageId: number,
  data: { user_id: number; can_access: boolean; data_scope?: string; expires_at?: string; reason?: string }
): Promise<void> => {
  await api.post(`/insights/admin/pages/${pageId}/overrides`, data)
}

export const deleteOverride = async (pageId: number, overrideId: number): Promise<void> => {
  await api.delete(`/insights/admin/pages/${pageId}/overrides/${overrideId}`)
}

// ── Business Calendar ─────────────────────────────────────────────────────────

export type BusinessDayType = 'WORKDAY' | 'WEEKEND' | 'HOLIDAY' | 'CLOSURE' | 'ADJUSTMENT'

export interface CalendarDayEntry {
  calendar_date:   string           // YYYY-MM-DD
  day_type:        BusinessDayType
  is_business_day: boolean
  note:            string | null
  is_stored:       boolean          // false = synthesized default
}

export interface BusinessDaySummary {
  totalDays:       number
  businessDays:    number
  nonBusinessDays: number
}

export interface CalendarMonthResponse {
  days:    CalendarDayEntry[]
  summary: BusinessDaySummary
}

export interface CalendarUpdatePayload {
  day_type: BusinessDayType
  note?:    string | null
}

export const getCalendar = async (
  year: number,
  month: number,
): Promise<CalendarMonthResponse> => {
  const response = await api.get('/insights/admin/calendar', { params: { year, month } })
  return response.data
}

export const updateCalendarDay = async (
  date:    string,
  payload: CalendarUpdatePayload,
): Promise<CalendarDayEntry> => {
  const response = await api.put(`/insights/admin/calendar/${date}`, payload)
  return response.data
}

export const saveCalendarMonthDefaults = async (
  year:  number,
  month: number,
): Promise<{ year: number; month: number; daysCreated: number; summary: BusinessDaySummary }> => {
  const response = await api.post('/insights/admin/calendar/save-month', { year, month })
  return response.data
}

// ── Agent Activity — Email (Phase 1 live data) ────────────────────────────────

export interface AAParams {
  users?:       string   // CSV of agent names
  departments?: string   // CSV of department names
  period:       string
  start?:       string
  end?:         string
}

export interface EmailSummaryRow { agent: string; department: string; totalSent: number }
export interface EmailByDayRow   { agent: string; date: string; totalSent: number }
export interface EmailByDayGroup { agent: string; department: string; rows: EmailByDayRow[]; total: { totalSent: number } }

export interface EmailActivityResponse {
  summary:              EmailSummaryRow[]
  summaryTotal:         EmailSummaryRow
  byDay:                EmailByDayGroup[]
  availableUsers:       string[]
  availableDepartments: string[]
  dataLastUpdated:      string | null
  dataNextUpdate:       string | null
  updateEveryMinutes:   number | null
}

export const getEmailActivity = async (p: AAParams): Promise<EmailActivityResponse> => {
  const response = await api.get('/insights/agent-activity/email', { params: p })
  return response.data
}

// ── Agent Activity — Call (Phase 2 live data) ─────────────────────────────────

export interface CallSummaryRow {
  agent: string; department: string; businessDays: number; totalCalls: number
  avgCallsPerDay: number; totalMin: number; avgMinPerDay: number; avgMinPerCall: number
  callsOver3Min: number
}
export interface CallByDayRow {
  agent: string; date: string; inbound: number; outbound: number; total: number
  inboundMin: number; outboundMin: number; totalMin: number; callsOver3Min: number
}
export interface CallByDayGroup {
  agent: string; department: string; rows: CallByDayRow[]
  total: { inbound: number; outbound: number; total: number; inboundMin: number; outboundMin: number; totalMin: number; callsOver3Min: number }
}
export interface CallDualPoint { label: string; left: number; right: number }

export interface CallActivityResponse {
  businessDays:         number
  kpis:                 Record<string, number>
  dailyCalls:           CallDualPoint[]
  dailyMinutes:         CallDualPoint[]
  summary:              CallSummaryRow[]
  summaryTotal:         CallSummaryRow
  byDay:                CallByDayGroup[]
  availableUsers:       string[]
  availableDepartments: string[]
  dataLastUpdated:      string | null
  dataNextUpdate:       string | null
  updateEveryMinutes:   number | null
}

export const getCallActivity = async (p: AAParams): Promise<CallActivityResponse> => {
  const response = await api.get('/insights/agent-activity/call', { params: p })
  return response.data
}

// ── Agent Activity — Tickets & Tasks (Phase 3 live data) ──────────────────────
// SNAPSHOT report: no period — only the agent/department filters are sent.

export interface TicketRow {
  agent: string; department: string; classification: string
  current: number; dueToday: number; pastDue: number
}
export interface TicketGroup {
  agent: string; department: string; rows: TicketRow[]
  total: { current: number; dueToday: number; pastDue: number }
}

export interface TicketsTasksResponse {
  groups:               TicketGroup[]
  grandTotal:           { current: number; dueToday: number; pastDue: number }
  availableUsers:       string[]
  availableDepartments: string[]
  dataLastUpdated:      string | null
  dataNextUpdate:       string | null
  updateEveryMinutes:   number | null
}

export const getTicketsTasks = async (p: AAParams): Promise<TicketsTasksResponse> => {
  const { users, departments } = p
  const response = await api.get('/insights/agent-activity/tickets', { params: { users, departments } })
  return response.data
}

// ── Agent Activity — Leads (Phase 4 live data) ────────────────────────────────

export interface LeadCatSourceRow {
  category: string; source: string; totalLeads: number; conversions: number
  pctConverted: number; bizDaysElapsed: number; leadPace: number; conversionPace: number
}

export interface LeadsResponse {
  businessDays:         number
  kpis:                 Record<string, number>
  rows:                 LeadCatSourceRow[]
  availableUsers:       string[]
  availableDepartments: string[]
  dataLastUpdated:      string | null
  dataNextUpdate:       string | null
  updateEveryMinutes:   number | null
}

export const getLeads = async (p: AAParams): Promise<LeadsResponse> => {
  const response = await api.get('/insights/agent-activity/leads', { params: p })
  return response.data
}

// ── Agent Activity — Sales Margin (Phase 5 live data) ─────────────────────────
// Four tables: Leads by Salesperson (reuses the lead fact), Deals & Subs, Margin
// by Salesperson, and a Margin-by-Customer leaderboard.

export interface MarginLeadsRow { agent: string; totalLeads: number; totalConversions: number; conversionPct: number }
export interface MarginDealsRow {
  agent: string; deals: number; totalSubs: number; subPace: number
  subOnlyDeals: number; subOnly: number; subOnlyPct: number
}
export interface MarginRow {
  agent: string; product: number; install: number; shipping: number; warranty: number
  total: number; pace: number; perDeal: number; perSub: number; warrantyPct: number; shippingPct: number
}
export interface MarginCustomerRow {
  agent: string; customer: string; product: number; install: number; shipping: number
  warranty: number; total: number; deals: number; subs: number
}

export interface MarginResponse {
  leads:                MarginLeadsRow[]
  deals:                MarginDealsRow[]
  margin:               MarginRow[]
  customers:            MarginCustomerRow[]
  availableUsers:       string[]
  availableDepartments: string[]
  dataLastUpdated:      string | null
  dataNextUpdate:       string | null
  updateEveryMinutes:   number | null
}

export const getMargin = async (p: AAParams): Promise<MarginResponse> => {
  const response = await api.get('/insights/agent-activity/margin', { params: p })
  return response.data
}

// ── Admin: Source Report Schedules (ie_source_report) ─────────────────────────

export type SourceReportLoadMode = 'INCREMENTAL_WINDOW' | 'FULL_RELOAD_WINDOW' | 'SNAPSHOT'
export type SourceReportStatusValue = 'SUCCESS' | 'PARTIAL' | 'FAILED'

export interface SourceReport {
  id:                number
  report_code:       string
  report_name:       string
  source_pool:       string
  load_mode:         SourceReportLoadMode
  window_months:     number
  incremental_days:  number
  frequency_minutes: number
  run_only_hours:    string | null
  is_active:         boolean
  target_fact_table: string
  last_run_at:       string | null
  next_run_at:       string | null
  last_status:       SourceReportStatusValue | null
}

export interface SourceReportUpdate {
  frequency_minutes?: number
  run_only_hours?:    string | null
  is_active?:         boolean
}

export const getSourceReports = async (): Promise<SourceReport[]> => {
  const response = await api.get('/insights/admin/source-reports')
  return response.data
}

export const updateSourceReport = async (id: number, data: SourceReportUpdate): Promise<SourceReport> => {
  const response = await api.put(`/insights/admin/source-reports/${id}`, data)
  return response.data
}

export const runSourceReportNow = async (id: number): Promise<{ started: boolean }> => {
  const response = await api.post(`/insights/admin/source-reports/${id}/run-now`)
  return response.data
}
