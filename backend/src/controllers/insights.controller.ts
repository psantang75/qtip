import { Request, Response } from 'express';
import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import { InsightsPermissionService } from '../services/InsightsPermissionService';
import { getInsightsRoleId } from '../utils/insightsRoleMap';

const permissionService = new InsightsPermissionService();

/**
 * GET /api/insights/navigation
 * Returns all Insights pages the current user can access, grouped by category.
 */
export const getInsightsNavigation = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }

    const userId = req.user.user_id;
    const roleId = getInsightsRoleId(req.user.role);
    if (roleId === null) { res.status(403).json({ error: 'Unknown role' }); return; }

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
    const roleId = getInsightsRoleId(req.user.role);
    if (roleId === null) { res.status(403).json({ error: 'Unknown role' }); return; }
    const access = await permissionService.resolveAccess(req.user.user_id, roleId, pageKey);

    res.json({ canAccess: access.canAccess, dataScope: access.dataScope });
  } catch (error) {
    console.error('getInsightsAccess error:', error);
    res.status(500).json({ error: 'Failed to check insights access' });
  }
};

/**
 * GET /api/insights/kpi-config
 * Returns all active KPI definitions with their currently active global thresholds.
 * Used by the frontend to drive KPI tile colors and goal lines from the IE settings
 * rather than hardcoded values in kpiDefs.ts.
 * Accessible to any authenticated user (not admin-gated).
 */
export const getKpiConfig = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         k.kpi_code,
         k.kpi_name,
         k.format_type,
         k.direction,
         k.decimal_places,
         k.description,
         k.formula,
         k.source_table,
         t.goal_value,
         t.warning_value,
         t.critical_value
       FROM ie_kpi k
       LEFT JOIN ie_kpi_threshold t
         ON t.kpi_id = k.id
         AND t.department_key IS NULL
         AND DATE(t.effective_from) <= CURDATE()
         AND (t.effective_to IS NULL OR DATE(t.effective_to) >= CURDATE())
       WHERE k.is_active = 1
       ORDER BY k.category, k.sort_order`,
    )

    const config: Record<string, {
      name: string; format: string; direction: string; decimal_places: number
      goal: number | null; warn: number | null; crit: number | null
      description: string | null; formula: string | null; source: string | null
    }> = {}

    for (const row of rows) {
      config[row.kpi_code as string] = {
        name:           row.kpi_name as string,
        format:         row.format_type as string,
        direction:      row.direction as string,
        decimal_places: row.decimal_places as number,
        goal:  row.goal_value     != null ? parseFloat(row.goal_value)     : null,
        warn:  row.warning_value  != null ? parseFloat(row.warning_value)  : null,
        crit:  row.critical_value != null ? parseFloat(row.critical_value) : null,
        description: (row.description  as string | null) ?? null,
        formula:     (row.formula      as string | null) ?? null,
        source:      (row.source_table as string | null) ?? null,
      }
    }

    res.json(config)
  } catch (error) {
    console.error('getKpiConfig error:', error)
    res.status(500).json({ error: 'Failed to load KPI config' })
  }
}

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
