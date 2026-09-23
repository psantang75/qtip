/**
 * insightsMissedOpportunities.controller — Insights → Sales Agent Activity →
 * Missed Opportunities. Thin: authenticate → DB-driven page gate → service.
 *
 * Reads gate on the shared `resolveAaScope` so a SELF or DEPARTMENT grant on
 * `aa_sales_missed_opportunities` narrows this report exactly as it narrows the
 * sibling Call Activity report.
 *
 * Writes (rule sets, thresholds, manual re-run) are Admin-only on top of the
 * page grant. The rules ARE the report's methodology and a re-run spends money,
 * so a Manager who can read the page still cannot change how it grades or
 * trigger another run.
 */
import { Request, Response } from 'express';
import { z } from 'zod';
import logger from '../config/logger';
import { resolveAaScope } from './insightsAgentActivity.controller';
import { getMissedOpportunities, getRunStatus } from '../services/insightsMissedOpportunities.service';
import { renderMissedOpportunitiesDoc } from '../services/insightsMissedOpportunities.export';
import { listSalesAgentNames } from '../services/insights/missedOpportunities/candidates';
import {
  createRule,
  listRules,
  updateRule,
} from '../services/insights/missedOpportunities/rules.service';
import {
  getMissedOpportunitySettings,
  saveMissedOpportunitySettings,
} from '../services/insights/missedOpportunities/settings';
import { MissedOpportunitiesWorker } from '../workers/MissedOpportunitiesWorker';

const PAGE_KEY = 'aa_sales_missed_opportunities';

/** Page grant plus Admin role. Writes the response and returns false on deny. */
export async function requireAdminOnPage(req: Request, res: Response): Promise<boolean> {
  const scope = await resolveAaScope(req, res, PAGE_KEY);
  if (!scope) return false;
  if (req.user?.role !== 'Admin') {
    res.status(403).json({ error: 'Administrator access required' });
    return false;
  }
  return true;
}

const csv = (v: string | undefined): string[] | undefined =>
  v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

/**
 * GET /api/insights/agent-activity/missed-opportunities
 * The report: per-agent rollup, per-rule totals, and every finding with its
 * recommended approach.
 */
export const getReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const scope = await resolveAaScope(req, res, PAGE_KEY);
    if (!scope) return;
    const { period, start, end, users, departments, rules, severities } =
      req.query as Record<string, string | undefined>;
    const result = await getMissedOpportunities({
      // Defaults to yesterday, not current_month: this is a daily review and
      // the prior business day is the run the worker just produced.
      period: period || 'yesterday',
      customStart: start,
      customEnd: end,
      users: csv(users),
      departments: csv(departments),
      ruleKeys: csv(rules),
      severities: csv(severities),
      selfEmployeeKey: scope.selfEmployeeKey,
      departmentKeys: scope.departmentKeys,
    });
    res.json(result);
  } catch (error) {
    logger.error('missedOpportunities getReport error:', error);
    res.status(500).json({ error: 'Failed to load missed opportunities' });
  }
};

/**
 * GET /api/insights/agent-activity/missed-opportunities/export
 * The same report as `getReport`, rendered as a Word-openable document. Shares
 * the exact viewer scope and filters so the download can never reveal a row the
 * page would hide.
 */
export const exportReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const scope = await resolveAaScope(req, res, PAGE_KEY);
    if (!scope) return;
    const { period, start, end, users, departments, rules, severities } =
      req.query as Record<string, string | undefined>;
    const result = await getMissedOpportunities({
      period: period || 'yesterday',
      customStart: start,
      customEnd: end,
      users: csv(users),
      departments: csv(departments),
      ruleKeys: csv(rules),
      severities: csv(severities),
      selfEmployeeKey: scope.selfEmployeeKey,
      departmentKeys: scope.departmentKeys,
    });
    // The page always scopes to a single day (start === end); fall back to the
    // graded run's date, then today, so the title and filename name the day.
    const day = start || end || result.run?.runDate ||
      new Date().toISOString().slice(0, 10);
    const html = renderMissedOpportunitiesDoc(result, day);
    const filename = `Missed_Opportunities_${day}.doc`;
    res.setHeader('Content-Type', 'application/msword; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(html);
  } catch (error) {
    logger.error('missedOpportunities exportReport error:', error);
    res.status(500).json({ error: 'Failed to export missed opportunities' });
  }
};

/**
 * GET /api/insights/agent-activity/missed-opportunities/rules
 * The rule set, thresholds, and the Sales roster behind the Settings tab.
 * Readable by anyone with the page grant so a Manager can see the methodology
 * the report used. `salesAgents` populates the exclusion picker with the exact
 * names the worker matches against, so an exclusion can't be mistyped.
 */
export const getRules = async (req: Request, res: Response): Promise<void> => {
  try {
    const scope = await resolveAaScope(req, res, PAGE_KEY);
    if (!scope) return;
    const [rules, settings, salesAgents] = await Promise.all([
      listRules(),
      getMissedOpportunitySettings(),
      listSalesAgentNames(),
    ]);
    res.json({ rules, settings, salesAgents, canEdit: req.user?.role === 'Admin' });
  } catch (error) {
    logger.error('missedOpportunities getRules error:', error);
    res.status(500).json({ error: 'Failed to load rule sets' });
  }
};

const severitySchema = z.enum(['low', 'medium', 'high']);

const createRuleSchema = z.object({
  rule_key: z.string().trim().min(3).max(64),
  rule_name: z.string().trim().min(1).max(160),
  category: z.string().trim().max(64).optional(),
  severity: severitySchema.optional(),
  body_md: z.string().trim().min(1),
  guidance_md: z.string().trim().max(20000).nullish(),
  is_active: z.boolean().optional(),
  is_omission: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
});

// rule_key is intentionally absent: stored findings reference it, so renaming
// a key would orphan history.
const updateRuleSchema = z.object({
  rule_name: z.string().trim().min(1).max(160).optional(),
  category: z.string().trim().max(64).optional(),
  severity: severitySchema.optional(),
  body_md: z.string().trim().min(1).optional(),
  guidance_md: z.string().trim().max(20000).nullish(),
  is_active: z.boolean().optional(),
  is_omission: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
});

/** POST /api/insights/agent-activity/missed-opportunities/rules */
export const postRule = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!(await requireAdminOnPage(req, res))) return;
    const parsed = createRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid rule' });
      return;
    }
    const rule = await createRule(parsed.data, req.user?.user_id ?? null);
    res.status(201).json(rule);
  } catch (error) {
    const message = (error as Error).message;
    logger.error('missedOpportunities postRule error:', error);
    res.status(400).json({ error: message || 'Failed to create rule' });
  }
};

/** PATCH /api/insights/agent-activity/missed-opportunities/rules/:ruleId */
export const patchRule = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!(await requireAdminOnPage(req, res))) return;
    const ruleId = Number(req.params.ruleId);
    if (!Number.isInteger(ruleId) || ruleId <= 0) {
      res.status(400).json({ error: 'Invalid rule id' });
      return;
    }
    const parsed = updateRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid rule' });
      return;
    }
    const rule = await updateRule(ruleId, parsed.data, req.user?.user_id ?? null);
    res.json(rule);
  } catch (error) {
    const message = (error as Error).message;
    logger.error('missedOpportunities patchRule error:', error);
    res.status(400).json({ error: message || 'Failed to update rule' });
  }
};

const settingsSchema = z.object({
  minTalkSecs: z.number().int().optional(),
  excludedAgents: z.array(z.string().trim().max(160)).max(100).optional(),
  dailyUsdCap: z.number().optional(),
  modelTier: z.enum(['cheap', 'reasoning']).optional(),
  maxCallsPerRun: z.number().int().optional(),
  systemPersona: z.string().trim().min(1).max(8000).optional(),
  kbAnchorUrls: z.array(z.string().trim().max(300)).max(20).optional(),
  scheduleEnabled: z.boolean().optional(),
  scheduleHour: z.number().int().min(0).max(23).optional(),
});

/** PATCH /api/insights/agent-activity/missed-opportunities/settings */
export const patchSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!(await requireAdminOnPage(req, res))) return;
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings' });
      return;
    }
    res.json(await saveMissedOpportunitySettings(parsed.data));
  } catch (error) {
    const message = (error as Error).message;
    logger.error('missedOpportunities patchSettings error:', error);
    res.status(400).json({ error: message || 'Failed to save settings' });
  }
};

const runSchema = z.object({
  runDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'runDate must be YYYY-MM-DD').optional(),
});

/**
 * POST /api/insights/agent-activity/missed-opportunities/run
 * Re-grade a business day — how a day is refreshed after a rule-set change.
 *
 * Fire-and-forget: grading a day is minutes of LLM calls, far longer than an
 * HTTP request should block (the old synchronous version timed out the client).
 * The worker writes a RUNNING run row immediately and a terminal row when done;
 * the client polls GET /run-status to follow it to completion. The worker's own
 * lock still prevents it from colliding with the daily scheduled run.
 */
export const postRun = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!(await requireAdminOnPage(req, res))) return;
    const parsed = runSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid run request' });
      return;
    }
    const runDate = parsed.data.runDate ?? null;

    // Refuse to stack a second run on a day already in progress (UX guard; the
    // worker lock is the real backstop).
    if (runDate) {
      const existing = await getRunStatus(runDate);
      if (existing?.status === 'RUNNING') {
        res.status(409).json({ error: 'A run for this day is already in progress' });
        return;
      }
    }

    const worker = new MissedOpportunitiesWorker(parsed.data.runDate);
    void worker.run().catch((err) => {
      logger.error('missedOpportunities background run failed:', err);
    });

    res.status(202).json({ started: true, runDate });
  } catch (error) {
    logger.error('missedOpportunities postRun error:', error);
    res.status(500).json({ error: (error as Error).message || 'Run failed' });
  }
};

/**
 * GET /api/insights/agent-activity/missed-opportunities/run-status?runDate=YYYY-MM-DD
 * The run row for a day, so the admin re-grade can poll a background run to
 * completion. Read-only, so the page grant (not Admin) is enough to view it.
 */
export const getRunStatusController = async (req: Request, res: Response): Promise<void> => {
  try {
    const scope = await resolveAaScope(req, res, PAGE_KEY);
    if (!scope) return;
    const runDate = String(req.query.runDate ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) {
      res.status(400).json({ error: 'runDate must be YYYY-MM-DD' });
      return;
    }
    res.json(await getRunStatus(runDate));
  } catch (error) {
    logger.error('missedOpportunities getRunStatus error:', error);
    res.status(500).json({ error: 'Failed to load run status' });
  }
};
