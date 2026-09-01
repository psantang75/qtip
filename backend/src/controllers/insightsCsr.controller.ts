/**
 * insightsCsr.controller — read endpoints for the "Agent Activity - CSR" section.
 * Named for the section rather than the page so later CSR pages share the wrapper.
 *
 * ALL GET, no writes: Insights report routers are read-only. Recompute and config
 * edits live on insightsAdmin.routes.ts with the rest of the Insights write
 * surface, and forgiveness is an excused schedule_exception in Scheduling, not a
 * button here.
 *
 * Every endpoint is anchored to an as-of date so a disputed warning can be
 * reconstructed exactly as it stood on a past date.
 */
import { Request, Response } from 'express';
import logger from '../config/logger';
import { InsightsPermissionService } from '../services/InsightsPermissionService';
import type { InsightsAccessResult } from '../services/InsightsPermissionService';
import { resolveDeptFilter } from '../services/insightsScope';
import { resolvePeriod } from '../utils/periodUtils';
import { getInsightsRoleId } from '../utils/insightsRoleMap';
import { fmtLocal } from '../services/scheduling/schedule.dates';
import { getPunchWatermark } from '../services/attendance/punchProvider';
import prisma from '../config/prisma';
import {
  getAgentRows, getFilterOptions, getOccurrences, windowForFloored,
} from '../services/attendance/attendance.rollup.service';
import { getComplianceMatrix, getDayOfWeek } from '../services/attendance/attendance.analytics.service';
import { loadPointRules, loadWarningThresholds } from '../services/attendance/attendance.config';

const permissionService = new InsightsPermissionService();
const PAGE_KEY = 'csr_attendance';

interface CsrContext {
  deptFilter: number[];
  /** Usernames from the filter bar's Agent dropdown. Empty means no restriction. */
  userNames: string[];
  /** Set only for SELF-scoped viewers; every query narrows to this user. */
  selfUserId?: number;
  asOf: string;
  /** True when asOf was pulled back from what the filter asked for. */
  asOfClamped: boolean;
}

/**
 * Resolve the effective as-of date: the earliest of what the period filter asked
 * for, today, and where the punch feed reaches.
 *
 * All three clamps matter. "Current Year" ends on Dec 31, so without the today
 * clamp the 90-day window would be mostly unworked future days; and reading past
 * the punch watermark would show a run of days with no actuals, which the engine
 * correctly refused to score.
 */
async function resolveAsOf(req: Request): Promise<{ asOf: string; clamped: boolean }> {
  const ranges = resolvePeriod(
    (req.query.period as string) || 'current_month',
    req.query.start as string | undefined,
    req.query.end as string | undefined,
  );
  const requested = req.query.asOf ? String(req.query.asOf) : fmtLocal(ranges.current.end);
  const today = fmtLocal(new Date());
  const watermark = await getPunchWatermark();

  let asOf = requested;
  if (asOf > today) asOf = today;
  if (watermark && asOf > watermark) asOf = watermark;
  return { asOf, clamped: asOf !== requested };
}

/**
 * Is this user inside the viewer's department scope? An EMPTY deptFilter means no
 * department restriction, matching deptClause, so it passes.
 */
async function isUserInScope(userId: number, deptFilter: number[]): Promise<boolean> {
  if (deptFilter.length === 0) return true;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { department_id: true } });
  return user?.department_id != null && deptFilter.includes(user.department_id);
}

function csrHandler(fn: (ctx: CsrContext, req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response): Promise<void> => {
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
      const access: InsightsAccessResult = await permissionService.resolveAccess(
        req.user.user_id, roleId, PAGE_KEY,
      );
      if (!access.canAccess) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const deptFilter = await resolveDeptFilter(
        access, req.query.departments as string | undefined,
      );
      const { asOf, clamped } = await resolveAsOf(req);
      const data = await fn(
        {
          deptFilter,
          userNames: (req.query.users as string | undefined)
            ?.split(',').map((s) => s.trim()).filter(Boolean) ?? [],
          selfUserId: access.dataScope === 'SELF' ? req.user.user_id : undefined,
          asOf,
          asOfClamped: clamped,
        },
        req,
      );
      res.json(data);
    } catch (err) {
      logger.error('insightsCsr [attendance] error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

/**
 * The roster plus everything derived from it. Department Comparison, Discipline
 * Pipeline and Perfect Attendance are all computed client-side from these rows,
 * so those sections can never disagree with the table above them.
 */
export const getAttendanceSummary = csrHandler(async (ctx) => {
  const [rows, options] = await Promise.all([
    getAgentRows(ctx.deptFilter, ctx.asOf, ctx.selfUserId, ctx.userNames),
    getFilterOptions(ctx.deptFilter, ctx.asOf, ctx.selfUserId),
  ]);
  const [rules, thresholds] = await Promise.all([loadPointRules(), loadWarningThresholds()]);
  const { from } = await windowForFloored(ctx.asOf);
  return {
    asOf: ctx.asOf,
    asOfClamped: ctx.asOfClamped,
    windowFrom: from,
    isSelfView: ctx.selfUserId !== undefined,
    rows,
    ...options,
    // Shipped with the roster so the point-band and discipline-ladder tooltips
    // never need a second request, and always describe the rules the numbers used.
    pointBands: rules
      .filter((r) => r.isActive && r.effectiveFrom <= ctx.asOf && (r.effectiveTo === null || ctx.asOf <= r.effectiveTo))
      .map((r) => ({
        ruleKey: r.ruleKey, label: r.label, kind: r.kind,
        minSeconds: r.minSeconds, maxSeconds: r.maxSeconds, points: r.points,
      })),
    warningLevels: thresholds
      .filter((t) => t.isActive && t.effectiveFrom <= ctx.asOf && (t.effectiveTo === null || ctx.asOf <= t.effectiveTo))
      .map((t) => ({ levelKey: t.levelKey, label: t.label, pointsThreshold: t.pointsThreshold })),
  };
});

/**
 * Per-day detail behind one person's point total. `userId` arrives from the query
 * string, so it is authorised independently of the roster: a viewer who can read
 * the roster must not be able to read detail for somebody the roster excluded.
 */
export const getAttendanceOccurrences = csrHandler(async (ctx, req) => {
  const requested = parseInt(String(req.query.userId ?? ''), 10);
  const userId = ctx.selfUserId ?? requested;
  if (!Number.isFinite(userId)) return { occurrences: [] };
  // A SELF viewer can only ever read their own detail, whatever they ask for.
  if (ctx.selfUserId !== undefined && requested && requested !== ctx.selfUserId) {
    return { occurrences: [] };
  }
  if (ctx.selfUserId === undefined && !(await isUserInScope(userId, ctx.deptFilter))) {
    return { occurrences: [] };
  }
  return { userId, asOf: ctx.asOf, occurrences: await getOccurrences(userId, ctx.asOf) };
});

export const getAttendanceCompliance = csrHandler(async (ctx, req) => {
  const monthsBack = Math.min(12, Math.max(1, parseInt(String(req.query.months ?? '6'), 10) || 6));
  return getComplianceMatrix(ctx.deptFilter, ctx.asOf, ctx.selfUserId, monthsBack, ctx.userNames);
});

export const getAttendanceDayOfWeek = csrHandler(async (ctx) => {
  const { from } = await windowForFloored(ctx.asOf);
  return {
    asOf: ctx.asOf,
    windowFrom: from,
    days: await getDayOfWeek(ctx.deptFilter, from, ctx.asOf, ctx.selfUserId, ctx.userNames),
  };
});
