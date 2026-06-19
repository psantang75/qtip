import { Request, Response } from 'express';
import logger from '../config/logger';
import {
  listSourceReports,
  getEmailActivity as svcGetEmailActivity,
  getCallActivity as svcGetCallActivity,
  getTicketsTasks as svcGetTicketsTasks,
  getLeads as svcGetLeads,
  getMargin as svcGetMargin,
} from '../services/insightsAgentActivity.service';

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
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
    const { period, start, end, users, departments } = req.query as Record<string, string | undefined>;
    const result = await svcGetEmailActivity({
      period: period || 'current_month',
      customStart: start,
      customEnd: end,
      users: users ? users.split(',').filter(Boolean) : undefined,
      departments: departments ? departments.split(',').filter(Boolean) : undefined,
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
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
    const { period, start, end, users, departments } = req.query as Record<string, string | undefined>;
    const result = await svcGetCallActivity({
      period: period || 'current_month',
      customStart: start,
      customEnd: end,
      users: users ? users.split(',').filter(Boolean) : undefined,
      departments: departments ? departments.split(',').filter(Boolean) : undefined,
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
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
    const { users, departments } = req.query as Record<string, string | undefined>;
    const result = await svcGetTicketsTasks({
      users: users ? users.split(',').filter(Boolean) : undefined,
      departments: departments ? departments.split(',').filter(Boolean) : undefined,
    });
    res.json(result);
  } catch (error) {
    logger.error('getTicketsTasks error:', error);
    res.status(500).json({ error: 'Failed to load tickets & tasks' });
  }
};

/**
 * GET /api/insights/agent-activity/leads
 * Leads report (leads/conversions by category + source, with month-end pace)
 * scoped by period/agent/department.
 */
export const getLeads = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
    const { period, start, end, users, departments } = req.query as Record<string, string | undefined>;
    const result = await svcGetLeads({
      period: period || 'current_month',
      customStart: start,
      customEnd: end,
      users: users ? users.split(',').filter(Boolean) : undefined,
      departments: departments ? departments.split(',').filter(Boolean) : undefined,
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
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
    const { period, start, end, users, departments } = req.query as Record<string, string | undefined>;
    const result = await svcGetMargin({
      period: period || 'current_month',
      customStart: start,
      customEnd: end,
      users: users ? users.split(',').filter(Boolean) : undefined,
      departments: departments ? departments.split(',').filter(Boolean) : undefined,
    });
    res.json(result);
  } catch (error) {
    logger.error('getMargin error:', error);
    res.status(500).json({ error: 'Failed to load margin' });
  }
};
