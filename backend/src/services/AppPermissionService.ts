/**
 * AppPermissionService — DB-driven role access for the app shell.
 *
 * Companion to `InsightsPermissionService` (which gates Insights pages via
 * `ie_page_*`). This service gates the rest of the app: Quality, Training,
 * and Performance Warnings.
 *
 * ── Access model: a single 4-rung ladder per page per role ──────────────────
 *
 *   NONE  — no access (hidden in nav, route redirects, API 403s)
 *   OWN   — their own records only (the "My X" self-view experience)
 *   ALL   — everyone's records, read-only (editor / manager view)
 *   EDIT  — everyone's records + create / edit / delete
 *
 * Page rows are static (added by migration). The per-role level is
 * admin-toggleable via the "Page Access" admin screen.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ INVARIANT — defense-in-depth                                            │
 * │ This service answers "what can the user reach / do on this page?". It   │
 * │ does NOT replace data scoping. CSR (role_id=3) isolation is enforced    │
 * │ again at the service layer (assertCsrSelfScope, canSeeAll). Even if a   │
 * │ row here said CSR=ALL, the entity queries still self-scope CSR rows.    │
 * │ CSR is additionally capped at OWN both in the admin UI and in           │
 * │ `updatePageAccess` below.                                               │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import prisma from '../config/prisma'
import { AppAccessLevel } from '../generated/prisma/client'

const CSR_ROLE_ID = 3

/** Rank for "at least" comparisons. Higher = more access. */
const LEVEL_RANK: Record<AppAccessLevel, number> = {
  NONE: 0,
  OWN:  1,
  ALL:  2,
  EDIT: 3,
}

/** Minimum level a caller (route guard / middleware) requires. */
export type RequiredLevel = 'view' | 'viewAll' | 'edit'

const REQUIRED_RANK: Record<RequiredLevel, number> = {
  view:    LEVEL_RANK.OWN,  // OWN, ALL or EDIT
  viewAll: LEVEL_RANK.ALL,  // ALL or EDIT
  edit:    LEVEL_RANK.EDIT, // EDIT only
}

export interface AppAccessResult {
  level:      AppAccessLevel
  canView:    boolean // OWN+ — can reach the page at all
  canViewAll: boolean // ALL+ — sees everyone's data (not just their own)
  canEdit:    boolean // EDIT — can mutate
  pageId:     number | null
  section:    string | null
}

const NO_ACCESS: AppAccessResult = {
  level:      'NONE',
  canView:    false,
  canViewAll: false,
  canEdit:    false,
  pageId:     null,
  section:    null,
}

function toResult(level: AppAccessLevel, pageId: number | null, section: string | null): AppAccessResult {
  const rank = LEVEL_RANK[level]
  return {
    level,
    canView:    rank >= LEVEL_RANK.OWN,
    canViewAll: rank >= LEVEL_RANK.ALL,
    canEdit:    rank >= LEVEL_RANK.EDIT,
    pageId,
    section,
  }
}

/** True when `level` satisfies the `required` minimum. */
export function levelSatisfies(level: AppAccessLevel, required: RequiredLevel): boolean {
  return LEVEL_RANK[level] >= REQUIRED_RANK[required]
}

export interface AppPageWithGrants {
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
  grants:          Array<{ role_id: number; access_level: AppAccessLevel }>
}

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

class AppPermissionService {
  /**
   * Resolve access for a single page. Returns NONE for unknown / inactive
   * pages or roles with no grant.
   */
  async resolveAccess(roleId: number, pageKey: string): Promise<AppAccessResult> {
    const page = await prisma.appPage.findUnique({
      where:  { page_key: pageKey },
      select: { id: true, section: true, is_active: true },
    })
    if (!page || !page.is_active) return NO_ACCESS

    const grant = await prisma.appPageRoleAccess.findUnique({
      where:  { uq_app_page_role: { page_id: page.id, role_id: roleId } },
      select: { access_level: true },
    })
    return toResult(grant?.access_level ?? 'NONE', page.id, page.section)
  }

  /**
   * Every active page the role can reach, ordered by section then
   * `sort_order`, with the label + route resolved for their level:
   *   - OWN  on a self-supporting page → self_label + self_route_path
   *   - ALL/EDIT (or OWN on a non-self page) → page_name + route_path
   *
   * Drives the server-rendered sidebar and the TopBar section filter.
   */
  async resolveAccessForAllPages(roleId: number): Promise<AppNavPage[]> {
    const rows = await prisma.appPage.findMany({
      where:   { is_active: true },
      orderBy: [{ section: 'asc' }, { sort_order: 'asc' }],
      select: {
        page_key:        true,
        page_name:       true,
        section:         true,
        route_path:      true,
        icon:            true,
        sort_order:      true,
        supports_self:   true,
        self_route_path: true,
        self_label:      true,
        self_icon:       true,
        role_access: {
          where:  { role_id: roleId },
          select: { access_level: true },
        },
      },
    })

    const out: AppNavPage[] = []
    for (const r of rows) {
      const level = r.role_access[0]?.access_level ?? 'NONE'
      if (level === 'NONE') continue

      const isOwnView = level === 'OWN' && r.supports_self
      out.push({
        page_key:   r.page_key,
        label:      isOwnView ? (r.self_label ?? r.page_name) : r.page_name,
        section:    r.section,
        route_path: isOwnView ? (r.self_route_path ?? r.route_path) : r.route_path,
        icon:       isOwnView ? (r.self_icon ?? r.icon) : r.icon,
        sort_order: r.sort_order,
        level,
        canEdit:    LEVEL_RANK[level] >= LEVEL_RANK.EDIT,
      })
    }
    return out
  }

  /** Admin view: every page (active or not) with its full role grant matrix. */
  async listPagesWithGrants(): Promise<AppPageWithGrants[]> {
    const rows = await prisma.appPage.findMany({
      where:   { is_active: true },
      orderBy: [{ section: 'asc' }, { sort_order: 'asc' }],
      include: {
        role_access: {
          select:  { role_id: true, access_level: true },
          orderBy: { role_id: 'asc' },
        },
      },
    })

    return rows.map((r) => ({
      id:              r.id,
      page_key:        r.page_key,
      page_name:       r.page_name,
      section:         r.section,
      route_path:      r.route_path,
      icon:            r.icon,
      sort_order:      r.sort_order,
      is_active:       r.is_active,
      supports_self:   r.supports_self,
      self_route_path: r.self_route_path,
      self_label:      r.self_label,
      grants:          r.role_access.map((g) => ({ role_id: g.role_id, access_level: g.access_level })),
    }))
  }

  /**
   * Admin write: replace the grant set for one page. Pass the complete list
   * of role levels — missing roles are removed.
   *
   * CSR INVARIANT: CSR (role 3) is clamped to at most OWN here. ALL/EDIT for
   * CSR is silently downgraded to OWN. OWN is kept on pages that expose a
   * self-view (`supports_self`) OR that already grant CSR OWN — the latter
   * covers department-scoped read-only pages like Call Campaigns, where a CSR
   * sees their own department's data on the shared page. Otherwise CSR falls to
   * NONE. The data-layer self-scope still wins regardless; this just keeps the
   * table honest without silently destroying a legitimate seeded grant.
   */
  async updatePageAccess(
    pageId: number,
    grants: Array<{ role_id: number; access_level: AppAccessLevel }>,
  ): Promise<void> {
    const page = await prisma.appPage.findUnique({
      where:  { id: pageId },
      select: {
        supports_self: true,
        role_access: { where: { role_id: CSR_ROLE_ID }, select: { access_level: true } },
      },
    })
    const supportsSelf = page?.supports_self ?? false
    const csrOwnAllowed = supportsSelf || page?.role_access[0]?.access_level === 'OWN'

    const clamped = grants.map((g) => {
      if (g.role_id !== CSR_ROLE_ID) return g
      // CSR cap.
      if (g.access_level === 'NONE') return g
      return { ...g, access_level: (csrOwnAllowed ? 'OWN' : 'NONE') as AppAccessLevel }
    })

    await prisma.$transaction(async (tx) => {
      await tx.appPageRoleAccess.deleteMany({ where: { page_id: pageId } })
      if (clamped.length > 0) {
        await tx.appPageRoleAccess.createMany({
          data: clamped.map((g) => ({
            page_id:      pageId,
            role_id:      g.role_id,
            access_level: g.access_level,
            // Keep the deprecated booleans roughly in sync for any reader
            // still looking at them during the transition.
            can_access:   g.access_level !== 'NONE',
            can_write:    g.access_level === 'EDIT',
          })),
        })
      }
    })
  }
}

export const appPermissionService = new AppPermissionService()
export default appPermissionService
