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
  getTicketsDailyHistory as svcGetTicketsDailyHistory,
  getTicketProductivity as svcGetTicketProductivity,
  getLeads as svcGetLeads,
  getMargin as svcGetMargin,
} from '../services/insightsAgentActivity.service';
import { getTicketTouchDetail as svcGetTicketTouchDetail } from '../services/insightsTouchDetail.service';

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
 * Shared handler for the Tickets & Tasks daily trend. Same page grants and
 * SELF-scope folding as the snapshot table on the same page, and the same
 * users/departments filter params — so the trend always shows exactly the
 * population the table above it shows, summed per day server-side.
 */
function dailyHistoryHandler(pageKey: string, area: 'sales' | 'csr') {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const scope = await resolveAaScope(req, res, pageKey);
      if (!scope) return;
      const { users, departments } = req.query as Record<string, string | undefined>;
      const points = await svcGetTicketsDailyHistory({
        area,
        selfEmployeeKey: scope.selfEmployeeKey,
        users: users ? users.split(',').filter(Boolean) : undefined,
        departments: departments ? departments.split(',').filter(Boolean) : undefined,
      });
      res.json(points);
    } catch (error) {
      logger.error('getTicketsDailyHistory error:', error);
      res.status(500).json({ error: 'Failed to load tickets & tasks history' });
    }
  };
}

/**
 * GET /api/insights/agent-activity/tickets/daily-history?users=&departments=
 * GET /api/insights/csr/tickets/daily-history?users=&departments=
 * Daily 8am Current/Due Today/Past Due totals over time for the trend chart.
 */
export const getTicketsDailyHistory = dailyHistoryHandler('aa_sales_tickets', 'sales');
export const getCsrTicketsDailyHistory = dailyHistoryHandler('csr_tickets', 'csr');

/**
 * Shared handler for the Tickets & Tasks productivity roll-up. Unlike the
 * snapshot table on the Tickets & Tasks page, this report IS period-based
 * (beginning/new/touched/closed by day), so it accepts the standard
 * period/date-range params on top of the usual users/departments/SELF scope.
 */
function productivityHandler(pageKey: string, area: 'sales' | 'csr') {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const scope = await resolveAaScope(req, res, pageKey);
      if (!scope) return;
      const { period, start, end, users, departments } = req.query as Record<string, string | undefined>;
      const rows = await svcGetTicketProductivity({
        area,
        period: period || 'current_month',
        customStart: start,
        customEnd: end,
        selfEmployeeKey: scope.selfEmployeeKey,
        users: users ? users.split(',').filter(Boolean) : undefined,
        departments: departments ? departments.split(',').filter(Boolean) : undefined,
      });
      res.json(rows);
    } catch (error) {
      logger.error('getTicketProductivity error:', error);
      res.status(500).json({ error: 'Failed to load tickets & tasks productivity' });
    }
  };
}

/**
 * GET /api/insights/agent-activity/tickets/productivity
 * GET /api/insights/csr/tickets/productivity
 * Per-agent-per-day Beginning / New Assigned / Touched / Closed over the range.
 */
export const getTicketsProductivity = productivityHandler('aa_sales_workload', 'sales');
export const getCsrTicketsProductivity = productivityHandler('csr_workload', 'csr');

/**
 * GET /api/insights/agent-activity/tickets/touch-detail?area=&employeeKey=&date=
 * On-demand drill-down behind the Workload `touched` count: the individual CRM
 * task actions / ticket notes for one agent on one day. Guarded by the Workload
 * page grant for the requested area; a SELF-scoped viewer is pinned to their own
 * employee key so they can never inspect another agent. Read live from the CRM,
 * so it only runs when the report is explicitly requested.
 */
export const getTicketTouchDetail = async (req: Request, res: Response): Promise<void> => {
  try {
    const { area: areaRaw, employeeKey: empRaw, date, segment: segRaw } = req.query as Record<string, string | undefined>;
    const area = areaRaw === 'csr' ? 'csr' : 'sales';
    // Sales-only section scope; ignored for CSR (which has no CM split).
    const segment = area === 'sales' && (segRaw === 'contact_manager' || segRaw === 'other') ? segRaw : undefined;
    const pageKey = area === 'csr' ? 'csr_workload' : 'aa_sales_workload';
    const scope = await resolveAaScope(req, res, pageKey);
    if (!scope) return;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'date (YYYY-MM-DD) is required' });
      return;
    }
    // SELF scope pins to the viewer's own employee; ALL scope must name an agent.
    const requested = empRaw ? Number(empRaw) : NaN;
    const employeeKey = scope.selfEmployeeKey ?? requested;
    if (!Number.isFinite(employeeKey) || employeeKey <= 0) {
      res.status(400).json({ error: 'employeeKey is required' });
      return;
    }
    const result = await svcGetTicketTouchDetail({ area, employeeKey, date, segment });
    res.json(result);
  } catch (error) {
    logger.error('getTicketTouchDetail error:', error);
    res.status(500).json({ error: 'Failed to load touch detail' });
  }
};

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
