/**
 * insightsSalesPlays.controller — Insights → Sales Agent Activity → Missed
 * Opportunities → Sales Plays (Phase 2 learning loop). Thin: authenticate →
 * DB-driven page gate → service.
 *
 * Shares the Missed Opportunities page grant and Admin-only write guard: plays
 * shape the same report's recommendations and mining spends money, so a Manager
 * who can read the page still cannot approve a play or trigger a mine.
 */
import { Request, Response } from 'express';
import { z } from 'zod';
import logger from '../config/logger';
import { resolveAaScope } from './insightsAgentActivity.controller';
import { requireAdminOnPage } from './insightsMissedOpportunities.controller';
import {
  getSalesPlaysSettings,
  saveSalesPlaysSettings,
} from '../services/insights/missedOpportunities/salesPlays/settings';
import {
  listPlays,
  updatePlay,
  PLAY_CATEGORIES,
  PLAY_STATUSES,
} from '../services/insights/missedOpportunities/salesPlays/plays.service';
import { SalesPlaysMinerWorker } from '../workers/SalesPlaysMinerWorker';

const PAGE_KEY = 'aa_sales_missed_opportunities';

/**
 * GET /api/insights/agent-activity/missed-opportunities/plays
 * Every play (proposed/active/archived) plus the plays settings. Readable by
 * anyone with the page grant so a Manager can see what grounds the review.
 */
export const getPlays = async (req: Request, res: Response): Promise<void> => {
  try {
    const scope = await resolveAaScope(req, res, PAGE_KEY);
    if (!scope) return;
    const [plays, settings] = await Promise.all([listPlays(), getSalesPlaysSettings()]);
    res.json({ plays, settings, canEdit: req.user?.role === 'Admin' });
  } catch (error) {
    logger.error('salesPlays getPlays error:', error);
    res.status(500).json({ error: 'Failed to load sales plays' });
  }
};

const playsSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  roster: z.array(z.string().trim().max(160)).max(25).optional(),
  seedDays: z.number().int().optional(),
  monthlyUsdCap: z.number().optional(),
  scheduleDay: z.number().int().min(1).max(28).optional(),
  scheduleHour: z.number().int().min(0).max(23).optional(),
});

/** PATCH /api/insights/agent-activity/missed-opportunities/plays/settings */
export const patchPlaysSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!(await requireAdminOnPage(req, res))) return;
    const parsed = playsSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings' });
      return;
    }
    res.json(await saveSalesPlaysSettings(parsed.data));
  } catch (error) {
    const message = (error as Error).message;
    logger.error('salesPlays patchPlaysSettings error:', error);
    res.status(400).json({ error: message || 'Failed to save settings' });
  }
};

const updatePlaySchema = z.object({
  status: z.enum(PLAY_STATUSES).optional(),
  category: z.enum(PLAY_CATEGORIES).optional(),
  title: z.string().trim().min(1).max(240).optional(),
  bodyMd: z.string().trim().min(1).max(2000).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

/** PATCH /api/insights/agent-activity/missed-opportunities/plays/:playId */
export const patchPlay = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!(await requireAdminOnPage(req, res))) return;
    const playId = Number(req.params.playId);
    if (!Number.isInteger(playId) || playId <= 0) {
      res.status(400).json({ error: 'Invalid play id' });
      return;
    }
    const parsed = updatePlaySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid play' });
      return;
    }
    res.json(await updatePlay(playId, parsed.data, req.user?.user_id ?? undefined));
  } catch (error) {
    const message = (error as Error).message;
    logger.error('salesPlays patchPlay error:', error);
    res.status(400).json({ error: message || 'Failed to update play' });
  }
};

/**
 * POST /api/insights/agent-activity/missed-opportunities/plays/mine
 * Run the monthly miner on demand (fire-and-forget, like the report re-grade).
 * The worker respects the enabled toggle, the roster, the incremental window and
 * the budget cap, so a manual mine can't overspend or run when disabled.
 */
export const postMineNow = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!(await requireAdminOnPage(req, res))) return;
    const worker = new SalesPlaysMinerWorker();
    void worker.run().catch((err) => {
      logger.error('salesPlays background mine failed:', err);
    });
    res.status(202).json({ started: true });
  } catch (error) {
    logger.error('salesPlays postMineNow error:', error);
    res.status(500).json({ error: (error as Error).message || 'Mine failed' });
  }
};
