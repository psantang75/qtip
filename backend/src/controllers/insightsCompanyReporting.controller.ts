/**
 * insightsCompanyReporting.controller — read endpoints for the Company Reporting
 * section (admin-only). Thin: authenticate → DB-driven page gate → service.
 *
 * Access is the same ie_page_role_access model as the rest of Insights; the
 * 'company_service_counts' page is granted to Admin only, so a non-admin (or a
 * direct-URL hit) is denied here just as the sidebar hides it.
 */
import { Request, Response } from 'express';
import logger from '../config/logger';
import { InsightsPermissionService } from '../services/InsightsPermissionService';
import { getInsightsRoleId } from '../utils/insightsRoleMap';
import { getServiceCounts } from '../services/insightsCompanyReporting.service';

const permissionService = new InsightsPermissionService();
const PAGE_KEY = 'company_service_counts';

export const getServiceCountsReport = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const roleId = getInsightsRoleId(req.user.role);
    if (roleId === null) {
      res.status(403).json({ error: 'Unknown role' });
      return;
    }
    const access = await permissionService.resolveAccess(req.user.user_id, roleId, PAGE_KEY);
    if (!access.canAccess) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    res.json(await getServiceCounts());
  } catch (err) {
    logger.error('insightsCompanyReporting [service-counts] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
