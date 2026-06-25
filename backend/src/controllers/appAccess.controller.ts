/**
 * App page access controller — drives the server-rendered sidebar, the
 * per-page route guard, and the admin "Page Access" CRUD. Mirrors the shape
 * of `insights.controller.ts` so the frontend reuses one access pattern.
 */

import { Request, Response } from 'express'
import appPermissionService from '../services/AppPermissionService'
import { AppAccessLevel } from '../generated/prisma/client'
import { getInsightsRoleId } from '../utils/insightsRoleMap'
import logger from '../config/logger'

interface NavGroup {
  section: string
  pages: Array<{
    page_key:   string
    label:      string
    section:    string
    route_path: string
    icon:       string | null
    sort_order: number
    level:      AppAccessLevel
    canEdit:    boolean
  }>
}

/**
 * GET /api/app-access/navigation
 *
 * Every page the current role can reach, grouped by section, with the label
 * and route already resolved for the role's level (OWN → "My X" link;
 * ALL/EDIT → editor link). The sidebar renders this verbatim.
 */
export const getNavigation = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return }

    const roleId = getInsightsRoleId(req.user.role)
    if (roleId === null) { res.status(403).json({ error: 'Unknown role' }); return }

    const pages = await appPermissionService.resolveAccessForAllPages(roleId)

    const grouped: Record<string, NavGroup> = {}
    for (const p of pages) {
      if (!grouped[p.section]) grouped[p.section] = { section: p.section, pages: [] }
      grouped[p.section].pages.push({
        page_key:   p.page_key,
        label:      p.label,
        section:    p.section,
        route_path: p.route_path,
        icon:       p.icon,
        sort_order: p.sort_order,
        level:      p.level,
        canEdit:    p.canEdit,
      })
    }

    res.json(Object.values(grouped))
  } catch (error) {
    logger.error('getNavigation error:', error)
    res.status(500).json({ error: 'Failed to load app navigation' })
  }
}

/**
 * GET /api/app-access/:pageKey
 * Access check for the `RequirePageAccess` route guard. Returns the resolved
 * level + the convenience booleans the guard uses.
 */
export const getAccess = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return }

    const roleId = getInsightsRoleId(req.user.role)
    if (roleId === null) { res.status(403).json({ error: 'Unknown role' }); return }

    const access = await appPermissionService.resolveAccess(roleId, req.params.pageKey)
    res.json({
      level:      access.level,
      canView:    access.canView,
      canViewAll: access.canViewAll,
      canEdit:    access.canEdit,
    })
  } catch (error) {
    logger.error('getAccess error:', error)
    res.status(500).json({ error: 'Failed to check app access' })
  }
}

/**
 * GET /api/app-access/admin/pages  (Admin only)
 * Full page catalog + role grant matrix for the admin screen.
 */
export const listPages = async (_req: Request, res: Response): Promise<void> => {
  try {
    const pages = await appPermissionService.listPagesWithGrants()
    res.json(pages)
  } catch (error) {
    logger.error('listPages error:', error)
    res.status(500).json({ error: 'Failed to list app pages' })
  }
}

const VALID_LEVELS: AppAccessLevel[] = ['NONE', 'OWN', 'ALL', 'EDIT']

/**
 * PUT /api/app-access/admin/pages/:id/access  (Admin only)
 * Body: { grants: Array<{ role_id, access_level }> }
 *
 * Replaces the grant set for one page. Missing roles are removed. CSR is
 * clamped to OWN (or NONE on non-self pages) by the service.
 */
export const updatePageAccess = async (req: Request, res: Response): Promise<void> => {
  try {
    const pageId = Number.parseInt(req.params.id, 10)
    if (Number.isNaN(pageId)) {
      res.status(400).json({ error: 'Invalid page id' })
      return
    }

    const body = req.body as { grants?: unknown }
    if (!Array.isArray(body.grants)) {
      res.status(400).json({ error: 'grants array required' })
      return
    }

    const grants: Array<{ role_id: number; access_level: AppAccessLevel }> = []
    for (const raw of body.grants) {
      const g = raw as { role_id?: unknown; access_level?: unknown }
      const role_id = Number(g.role_id)
      if (!Number.isInteger(role_id) || role_id < 1) {
        res.status(400).json({ error: 'Invalid role_id in grants' })
        return
      }
      const level = g.access_level as AppAccessLevel
      if (!VALID_LEVELS.includes(level)) {
        res.status(400).json({ error: `Invalid access_level: ${String(g.access_level)}` })
        return
      }
      grants.push({ role_id, access_level: level })
    }

    await appPermissionService.updatePageAccess(pageId, grants)
    res.json({ ok: true })
  } catch (error) {
    logger.error('updatePageAccess error:', error)
    res.status(500).json({ error: 'Failed to update page access' })
  }
}
