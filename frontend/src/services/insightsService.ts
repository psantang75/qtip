import { api } from './authService'

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
  dataScope: 'ALL' | 'DIVISION' | 'DEPARTMENT' | 'SELF' | null
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
  format_type: string
  decimal_places: number
  direction: string
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
}

export interface IePageRoleAccess {
  id: number
  page_id: number
  role_id: number
  role_name: string
  can_access: boolean
  data_scope: string
}

export interface IePageUserOverride {
  id: number
  page_id: number
  user_id: number
  user_name: string
  can_access: boolean
  data_scope: string | null
  granted_by: number
  granter_name: string
  granted_at: string
  expires_at: string | null
  reason: string | null
}

// ── Navigation & Access ───────────────────────────────────────────────────────

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

// ── Admin: Pages & Access ─────────────────────────────────────────────────────

export const listPages = async (): Promise<IePage[]> => {
  const response = await api.get('/insights/admin/pages')
  return response.data
}

export const updatePageAccess = async (
  pageId: number,
  roles: Array<{ role_id: number; can_access: boolean; data_scope: string }>
): Promise<void> => {
  await api.put(`/insights/admin/pages/${pageId}/access`, { roles })
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
