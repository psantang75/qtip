/**
 * insightsCallLength.controller — Insights → Agent Activity - CSR → Call Length.
 * Thin: DB-driven page gate → service → JSON.
 *
 * Lives in its own file rather than joining insightsAgentActivity.controller,
 * which is already far past the 300-line refactor threshold.
 *
 * Gates on the shared `resolveAaScope`, so a SELF grant on `csr_call_length`
 * narrows this report exactly as it narrows the Call Activity report directly
 * above it in the sidebar. Read-only — the bucket boundaries are code, not
 * user-editable settings, so there is nothing here to write.
 */
import { Request, Response } from 'express';
import { asyncHandler } from '../utils/errorHandler';
import { resolveAaScope } from './insightsAgentActivity.controller';
import { getCallLength } from '../services/insightsCallLength.service';

const PAGE_KEY = 'csr_call_length';

const csv = (v: string | undefined): string[] | undefined =>
  v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

/**
 * GET /api/insights/csr/call-length
 * Handle-time distribution: bucket totals, per-day and per-department series,
 * and the per-agent bucket table.
 */
export const getCsrCallLength = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const scope = await resolveAaScope(req, res, PAGE_KEY);
  if (!scope) return;
  const { period, start, end, users, departments } = req.query as Record<string, string | undefined>;
  const result = await getCallLength({
    period: period || 'current_month',
    customStart: start,
    customEnd: end,
    users: csv(users),
    departments: csv(departments),
    selfEmployeeKey: scope.selfEmployeeKey,
  });
  res.json(result);
});
