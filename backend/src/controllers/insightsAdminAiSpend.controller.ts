/**
 * Admin → Insights → AI Spend. One place to see what every LLM feature cost,
 * so a background worker can never quietly spend money again.
 *
 * Read-only. The rollup and the caveat about prompt-cache discounts live in
 * services/insights/aiSpend.service.ts.
 */
import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/errorHandler';
import { getAiSpend, SPEND_WINDOW_RANGE } from '../services/insights/aiSpend.service';

/**
 * GET /api/insights/admin/ai-spend?days=30
 * Query: days=1..90 (defaults to 30).
 */
export const getAiSpendRollup = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const raw = Number(req.query.days);
  const days = Number.isFinite(raw) ? raw : 30;
  res.json(await getAiSpend(Math.min(SPEND_WINDOW_RANGE.max, Math.max(SPEND_WINDOW_RANGE.min, days))));
});
