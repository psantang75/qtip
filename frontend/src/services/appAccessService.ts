import { api } from './authService'

/**
 * Frontend client for `/api/app-access` — the DB-driven page access system
 * that gates the app shell (Quality, Training, Performance Warnings).
 * Companion to `insightsService.ts` (which gates the Insights section).
 *
 * Access model — a single 4-rung ladder per page per role:
 *   NONE  — no access
 *   OWN   — their own records only (the "My X" self-view)
 *   ALL   — everyone's records, read-only
 *   EDIT  — everyone's records + create / edit / delete
 */

export type AppAccessLevel = 'NONE' | 'OWN' | 'ALL' | 'EDIT'

/** A nav entry the user can reach, with label + route already resolved. */
export interface AppNavPage {
  page_key:   string
  label:      string
  section:    string
  route_path: string
  icon:       string | null
  sort_order: number
  level:      AppAccessLevel
  canEdit:    boolean
}

export interface AppNavSection {
  section: string
  pages:   AppNavPage[]
}

export interface AppAccess {
  level:      AppAccessLevel
  canView:    boolean // OWN+
  canViewAll: boolean // ALL+
  canEdit:    boolean // EDIT
}

export interface AppPageAdminGrant {
  role_id:      number
  access_level: AppAccessLevel
}

export interface AppPageAdmin {
  id:              number
  page_key:        string
  page_name:       string
  section:         string
  route_path:      string
  icon:            string | null
  sort_order:      number
  is_active:       boolean
  supports_self:   boolean
  self_route_path: string | null
  self_label:      string | null
  grants:          AppPageAdminGrant[]
}

/** Sidebar/top-bar nav payload for the current user. */
export async function getAppNavigation(): Promise<AppNavSection[]> {
  const { data } = await api.get<AppNavSection[]>('/app-access/navigation')
  return data
}

/** Per-page access check used by `RequirePageAccess`. */
export async function getAppAccess(pageKey: string): Promise<AppAccess> {
  const { data } = await api.get<AppAccess>(`/app-access/${encodeURIComponent(pageKey)}`)
  return data
}

/** Admin: page catalog + role grants for the matrix UI. */
export async function listAppPages(): Promise<AppPageAdmin[]> {
  const { data } = await api.get<AppPageAdmin[]>('/app-access/admin/pages')
  return data
}

/** Admin: replace the grant set for one page. */
export async function updateAppPageAccess(
  pageId: number,
  grants: AppPageAdminGrant[],
): Promise<void> {
  await api.put(`/app-access/admin/pages/${pageId}/access`, { grants })
}
