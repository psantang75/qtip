import { Request, Response } from 'express';
import logger from '../config/logger';
import { InsightsPermissionService } from '../services/InsightsPermissionService';
import { getInsightsRoleId } from '../utils/insightsRoleMap';
import {
  listSourceReports,
  getEmailActivity as svcGetEmailActivity,
  getCallActivity as svcGetCallActivity,
  getTicketsTasks as svcGetTicketsTasks,
  getTicketsPastDue as svcGetTicketsPastDue,
  getLeads as svcGetLeads,
  getMargin as svcGetMargin,
} from '../services/insightsAgentActivity.service';

const permissionService = new InsightsPermissionService();

/**
 * Resolve Insights page access for an Agent Activity endpoint, mirroring the
 * QC controller. Writes the 401/403 response and returns null when the caller
 * has no grant. On success returns the SELF-scope employee key (or null for
 * ALL scope). A SELF grant with no conformed employee row resolves to -1 (an
 * impossible key) so the viewer sees nothing rather than everything.
 */
async function resolveAaScope(
  req: Request,
  res: Response,
  pageKey: string,
): Promise<{ selfEmployeeKey: number | null } | null> {
  if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return null; }
  const roleId = getInsightsRoleId(req.user.role);
  if (roleId === null) { res.status(403).json({ error: 'Unknown role' }); return null; }
  const access = await permissionService.resolveAccess(req.user.user_id, roleId, pageKey);
  if (!access.canAccess) { res.status(403).json({ error: 'Access denied' }); return null; }
  const selfEmployeeKey = access.dataScope === 'SELF' ? (access.employeeKey ?? -1) : null;
  return { selfEmployeeKey };
}

/**
 * GET /api/insights/agent-activity/status
 * Returns the source-report ingestion registry + last/next run status.
 * Returns [] until reports are seeded (Phase 1+). Any authenticated user may
 * read it; it exposes no row-level data, only ingestion metadata.
 */
export const getAgentActivityStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
    const reports = await listSourceReports();
    res.json(reports);
  } catch (error) {
    logger.error('getAgentActivityStatus error:', error);
    res.status(500).json({ error: 'Failed to load agent activity status' });
  }
};

/**
 * GET /api/insights/agent-activity/email
 * Email Activity report (Outbound = "sent") scoped by period/agent/department.
 */
export const getEmailActivity = async (req: Request, res: Response): Promise<void> => {
  try {
    const scope = await resolveAaScope(req, res, 'aa_sales_email');
    if (!scope) return;
    const { period, start, end, users, departments } = req.query as Record<string, string | undefined>;
    const result = await svcGetEmailActivity({
      period: period || 'current_month',
      customStart: start,
      customEnd: end,
      users: users ? users.split(',').filter(Boolean) : undefined,
      departments: departments ? departments.split(',').filter(Boolean) : undefined,
      selfEmployeeKey: scope.selfEmployeeKey,
    });
    res.json(result);
  } catch (error) {
    logger.error('getEmailActivity error:', error);
    res.status(500).json({ error: 'Failed to load email activity' });
  }
};

/**
 * GET /api/insights/agent-activity/call
 * Call Activity report (Inbound/Outbound) scoped by period/agent/department.
 */
export const getCallActivity = async (req: Request, res: Response): Promise<void> => {
  try {
    const scope = await resolveAaScope(req, res, 'aa_sales_call');
    if (!scope) return;
    const { period, start, end, users, departments } = req.query as Record<string, string | undefined>;
    const result = await svcGetCallActivity({
      period: period || 'current_month',
      customStart: start,
      customEnd: end,
      users: users ? users.split(',').filter(Boolean) : undefined,
      departments: departments ? departments.split(',').filter(Boolean) : undefined,
      selfEmployeeKey: scope.selfEmployeeKey,
    });
    res.json(result);
  } catch (error) {
    logger.error('getCallActivity error:', error);
    res.status(500).json({ error: 'Failed to load call activity' });
  }
};

/**
 * GET /api/insights/agent-activity/tickets
 * Tickets & Tasks snapshot (open work items by agent/classification, bucketed
 * Current/Due Today/Past Due). SNAPSHOT report — no period; only agent/department.
 */
export const getTicketsTasks = async (req: Request, res: Response): Promise<void> => {
  try {
    const scope = await resolveAaScope(req, res, 'aa_sales_tickets');
    if (!scope) return;
    const { users, departments } = req.query as Record<string, string | undefined>;
    const result = await svcGetTicketsTasks({
      users: users ? users.split(',').filter(Boolean) : undefined,
      departments: departments ? departments.split(',').filter(Boolean) : undefined,
      selfEmployeeKey: scope.selfEmployeeKey,
    });
    res.json(result);
  } catch (error) {
    logger.error('getTicketsTasks error:', error);
    res.status(500).json({ error: 'Failed to load tickets & tasks' });
  }
};

/**
 * GET /api/insights/csr/tickets
 * The same Tickets & Tasks snapshot for the Agent Activity - CSR section: same
 * buckets and grouping, scoped to the CSR-area agents (everyone outside the
 * Sales Department - All subtree) and its own page grant.
 */
export const getCsrTicketsTasks = async (req: Request, res: Response): Promise<void> => {
  try {
    const scope = await resolveAaScope(req, res, 'csr_tickets');
    if (!scope) return;
    const { users, departments } = req.query as Record<string, string | undefined>;
    const result = await svcGetTicketsTasks({
      users: users ? users.split(',').filter(Boolean) : undefined,
      departments: departments ? departments.split(',').filter(Boolean) : undefined,
      selfEmployeeKey: scope.selfEmployeeKey,
      area: 'csr',
    });
    res.json(result);
  } catch (error) {
    logger.error('getCsrTicketsTasks error:', error);
    res.status(500).json({ error: 'Failed to load tickets & tasks' });
  }
};

/**
 * Shared handler for the Past Due drill-in behind a Tickets & Tasks cell. Both
 * sections read the same fact through the same guards; only the page grant and
 * the department subtree differ.
 */
function pastDueHandler(pageKey: string, area: 'sales' | 'csr') {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const scope = await resolveAaScope(req, res, pageKey);
      if (!scope) return;
      const { agent, classification } = req.query as Record<string, string | undefined>;
      if (!agent || !classification) {
        res.status(400).json({ error: 'agent and classification are required' });
        return;
      }
      const items = await svcGetTicketsPastDue({
        agent,
        classification,
        selfEmployeeKey: scope.selfEmployeeKey,
        area,
      });
      res.json(items);
    } catch (error) {
      logger.error('getTicketsPastDue error:', error);
      res.status(500).json({ error: 'Failed to load past due tickets & tasks' });
    }
  };
}

/**
 * GET /api/insights/agent-activity/tickets/past-due?agent=&classification=
 * GET /api/insights/csr/tickets/past-due?agent=&classification=
 * The individual overdue work items behind one Past Due count, each with its CRM
 * deep link so the viewer can act on it.
 */
export const getTicketsPastDue = pastDueHandler('aa_sales_tickets', 'sales');
export const getCsrTicketsPastDue = pastDueHandler('csr_tickets', 'csr');

/**
 * GET /api/insights/agent-activity/leads
 * Leads report (leads/conversions by category + source, with month-end pace)
 * scoped by period/agent/department.
 */
export const getLeads = async (req: Request, res: Response): Promise<void> => {
  try {
    const scope = await resolveAaScope(req, res, 'aa_sales_leads');
    if (!scope) return;
    const { period, start, end, users, departments } = req.query as Record<string, string | undefined>;
    const result = await svcGetLeads({
      period: period || 'current_month',
      customStart: start,
      customEnd: end,
      users: users ? users.split(',').filter(Boolean) : undefined,
      departments: departments ? departments.split(',').filter(Boolean) : undefined,
      selfEmployeeKey: scope.selfEmployeeKey,
    });
    res.json(result);
  } catch (error) {
    logger.error('getLeads error:', error);
    res.status(500).json({ error: 'Failed to load leads' });
  }
};

/**
 * GET /api/insights/agent-activity/margin
 * Sales Margin report (four tables: leads, deals & subs, margin by salesperson,
 * margin by customer) scoped by period/agent/department.
 */
export const getMargin = async (req: Request, res: Response): Promise<void> => {
  try {
    const scope = await resolveAaScope(req, res, 'aa_sales_margin');
    if (!scope) return;
    const { period, start, end, users, departments } = req.query as Record<string, string | undefined>;
    const result = await svcGetMargin({
      period: period || 'current_month',
      customStart: start,
      customEnd: end,
      users: users ? users.split(',').filter(Boolean) : undefined,
      departments: departments ? departments.split(',').filter(Boolean) : undefined,
      selfEmployeeKey: scope.selfEmployeeKey,
    });
    res.json(result);
  } catch (error) {
    logger.error('getMargin error:', error);
    res.status(500).json({ error: 'Failed to load margin' });
  }
};
