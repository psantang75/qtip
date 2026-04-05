import { Request, Response } from 'express';
import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import { InsightsPermissionService } from '../services/InsightsPermissionService';

const permissionService = new InsightsPermissionService();

const roleNameToId: Record<string, number> = {
  Admin: 1, QA: 2, CSR: 3, Trainer: 4, Manager: 5, Director: 6,
};

/**
 * GET /api/insights/navigation
 * Returns all Insights pages the current user can access, grouped by category.
 */
export const getInsightsNavigation = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

    const userId = req.user.user_id;
    const roleId = roleNameToId[req.user.role] ?? 0;

    const [pages] = await pool.execute<RowDataPacket[]>(
      'SELECT id, page_key, page_name, category, route_path, icon, sort_order FROM ie_page WHERE is_active = 1 ORDER BY category, sort_order'
    );

    const accessible: Array<{
      page_key: string; page_name: string; category: string;
      route_path: string; icon: string | null; sort_order: number;
    }> = [];

    for (const page of pages) {
      const access = await permissionService.resolveAccess(userId, roleId, page.page_key);
      if (access.canAccess) {
        accessible.push({
          page_key: page.page_key,
          page_name: page.page_name,
          category: page.category,
          route_path: page.route_path,
          icon: page.icon,
          sort_order: page.sort_order,
        });
      }
    }

    const grouped: Record<string, typeof accessible> = {};
    for (const item of accessible) {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(item);
    }

    const categories = Object.entries(grouped).map(([category, pages]) => ({ category, pages }));

    res.json(categories);
  } catch (error) {
    console.error('getInsightsNavigation error:', error);
    res.status(500).json({ error: 'Failed to load insights navigation' });
  }
};

/**
 * GET /api/insights/access/:pageKey
 * Returns the user's access and data scope for a specific Insights page.
 */
export const getInsightsAccess = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

    const pageKey = req.params.pageKey;
    const roleId = roleNameToId[req.user.role] ?? 0;
    const access = await permissionService.resolveAccess(req.user.user_id, roleId, pageKey);

    res.json({ canAccess: access.canAccess, dataScope: access.dataScope });
  } catch (error) {
    console.error('getInsightsAccess error:', error);
    res.status(500).json({ error: 'Failed to check insights access' });
  }
};

/**
 * GET /api/insights/data-freshness
 * Returns last successful ingestion time per source system.
 */
export const getDataFreshness = async (req: Request, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT source_system, MAX(run_finished_at) as last_success_at
       FROM ie_ingestion_log
       WHERE status = 'SUCCESS'
       GROUP BY source_system
       ORDER BY source_system`
    );

    const result = rows.map((r) => {
      const lastSuccess = r.last_success_at ? new Date(r.last_success_at) : null;
      const hoursSince = lastSuccess
        ? Math.round((Date.now() - lastSuccess.getTime()) / 3600000 * 10) / 10
        : null;
      return {
        source_system: r.source_system,
        last_success_at: lastSuccess?.toISOString() ?? null,
        hours_since: hoursSince,
      };
    });

    res.json(result);
  } catch (error) {
    console.error('getDataFreshness error:', error);
    res.status(500).json({ error: 'Failed to load data freshness' });
  }
};
