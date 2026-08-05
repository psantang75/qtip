/**
 * insightsAdminAttendance.controller — the write surface for attendance config.
 * It lives on insightsAdmin.routes.ts with the rest of the Insights write
 * endpoints, because Insights REPORT routers are read-only.
 *
 * Saving does not mutate rows in place: it retires the current effective-dated
 * version and inserts a new one starting on the effective date. That is what
 * keeps a delivered warning reproducible — recompute re-scores each day under the
 * bands in force on THAT day, so changing a band tomorrow cannot retroactively
 * push somebody over Written.
 *
 * Every save writes an audit_logs row. Changing a discipline threshold moves
 * where every employee stands, so it has to be attributable to a person and time.
 */
import { Request, Response } from 'express';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { dateStrFromDate, dateOnlyValue, addDays } from '../services/scheduling/schedule.dates';
import { loadPointRules, loadWarningThresholds } from '../services/attendance/attendance.config';
import { getPointsStartDate, setPointsStartDate } from '../services/attendance/attendance.settings';
import { validateBands } from '../services/attendance/attendance.rules';
import type { AttendanceKind } from '../services/attendance/attendance.rules';
import { recomputeRange } from '../services/attendance/attendance.engine';
import {
  pointRulesSaveSchema, thresholdsSaveSchema, recalculateSchema, pointsStartSaveSchema,
} from '../validation/attendance.validation';

/** Current bands and ladder, plus the exception types an EXCEPTION band can bind to. */
export async function getAttendanceConfig(_req: Request, res: Response): Promise<void> {
  try {
    const [rules, thresholds, exceptionTypes, pointsStartDate] = await Promise.all([
      loadPointRules(),
      loadWarningThresholds(),
      prisma.scheduleExceptionType.findMany({
        where: { is_active: true, is_excused: false },
        select: { id: true, type_key: true, label: true },
        orderBy: { sort_order: 'asc' },
      }),
      getPointsStartDate(),
    ]);
    res.json({ rules, thresholds, exceptionTypes, pointsStartDate });
  } catch (err) {
    logger.error('insightsAdminAttendance [config] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * The date the point policy took effect. Days before it are never scored or
 * counted, so this is not effective-dated like the bands — it is a single floor.
 * Changing it does NOT rescore on its own; the admin rescans the last 90 days to
 * drop occurrences that now fall before the new start.
 */
export async function savePointsStartDate(req: Request, res: Response): Promise<void> {
  const parsed = pointsStartSaveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' });
    return;
  }
  try {
    const pointsStartDate = await setPointsStartDate(parsed.data.pointsStartDate);
    await prisma.auditLog.create({
      data: {
        user_id: req.user!.user_id,
        action: 'UPDATE',
        target_type: 'attendance_points_start_date',
        details: JSON.stringify({ pointsStartDate }),
      },
    });
    res.json({ success: true, pointsStartDate });
  } catch (err) {
    logger.error('insightsAdminAttendance [savePointsStartDate] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function savePointRules(req: Request, res: Response): Promise<void> {
  const parsed = pointRulesSaveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' });
    return;
  }
  const { effectiveFrom, rules } = parsed.data;

  // Bands of one kind may not overlap, or the same deviation matches two rows and
  // the points awarded would depend on sort order.
  const kinds: AttendanceKind[] = ['LATE', 'EARLY_LEAVE'];
  const problems: string[] = [];
  for (const kind of kinds) {
    problems.push(
      ...validateBands(
        rules
          .filter((r) => r.kind === kind && r.isActive)
          .map((r) => ({ label: r.label, minSeconds: r.minSeconds, maxSeconds: r.maxSeconds })),
      ),
    );
  }
  if (problems.length > 0) {
    res.status(400).json({ error: problems.join('; '), problems });
    return;
  }

  try {
    const existing = await prisma.attendancePointRule.findMany({ where: { effective_to: null } });
    const byKey = new Map(existing.map((r) => [r.rule_key, r]));

    await prisma.$transaction(async (tx) => {
      for (const r of rules) {
        const current = byKey.get(r.ruleKey);
        const data = {
          label: r.label,
          kind: r.kind,
          min_seconds: r.minSeconds,
          max_seconds: r.maxSeconds,
          points: r.points,
          exception_type_id: r.exceptionTypeId ?? null,
          sort_order: r.sortOrder,
          is_active: r.isActive,
        };

        // Correcting the current version rather than superseding it. This covers
        // the same-day edit and the back-dated one: if the new date is at or before
        // the day this version began, the version never governed a day the new one
        // will not, so it is replaced in place. Retiring it instead would set
        // effective_to earlier than its own effective_from — a window that matches
        // no date at all, which would silently delete the band.
        if (current && dateStrFromDate(current.effective_from) >= effectiveFrom) {
          await tx.attendancePointRule.update({
            where: { id: current.id },
            data: { ...data, effective_from: dateOnlyValue(effectiveFrom) },
          });
          continue;
        }
        if (current) {
          await tx.attendancePointRule.update({
            where: { id: current.id },
            data: { effective_to: dateOnlyValue(addDays(effectiveFrom, -1)) },
          });
        }
        await tx.attendancePointRule.create({
          data: { ...data, rule_key: r.ruleKey, effective_from: dateOnlyValue(effectiveFrom) },
        });
      }

      await tx.auditLog.create({
        data: {
          user_id: req.user!.user_id,
          action: 'UPDATE',
          target_type: 'attendance_point_rule',
          details: JSON.stringify({ effectiveFrom, rules }),
        },
      });
    });

    res.json({ success: true, effectiveFrom, count: rules.length });
  } catch (err) {
    logger.error('insightsAdminAttendance [savePointRules] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function saveWarningThresholds(req: Request, res: Response): Promise<void> {
  const parsed = thresholdsSaveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' });
    return;
  }
  const { effectiveFrom, thresholds } = parsed.data;

  // The ladder must ascend, or a lower rung would mask a higher one and the
  // resolved level would silently be the wrong one.
  const active = thresholds.filter((t) => t.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  for (let i = 0; i < active.length - 1; i++) {
    if (active[i + 1].pointsThreshold <= active[i].pointsThreshold) {
      res.status(400).json({
        error: `${active[i + 1].label} must require more points than ${active[i].label}`,
      });
      return;
    }
  }

  try {
    const existing = await prisma.attendanceWarningThreshold.findMany({ where: { effective_to: null } });
    const byKey = new Map(existing.map((r) => [r.level_key, r]));

    await prisma.$transaction(async (tx) => {
      for (const t of thresholds) {
        const current = byKey.get(t.levelKey);
        const data = {
          label: t.label,
          points_threshold: t.pointsThreshold,
          sort_order: t.sortOrder,
          is_active: t.isActive,
        };
        // See savePointRules: at or before the current version's start date this is
        // a correction, not a new version.
        if (current && dateStrFromDate(current.effective_from) >= effectiveFrom) {
          await tx.attendanceWarningThreshold.update({
            where: { id: current.id },
            data: { ...data, effective_from: dateOnlyValue(effectiveFrom) },
          });
          continue;
        }
        if (current) {
          await tx.attendanceWarningThreshold.update({
            where: { id: current.id },
            data: { effective_to: dateOnlyValue(addDays(effectiveFrom, -1)) },
          });
        }
        await tx.attendanceWarningThreshold.create({
          data: { ...data, level_key: t.levelKey, effective_from: dateOnlyValue(effectiveFrom) },
        });
      }

      await tx.auditLog.create({
        data: {
          user_id: req.user!.user_id,
          action: 'UPDATE',
          target_type: 'attendance_warning_threshold',
          details: JSON.stringify({ effectiveFrom, thresholds }),
        },
      });
    });

    res.json({ success: true, effectiveFrom, count: thresholds.length });
  } catch (err) {
    logger.error('insightsAdminAttendance [saveThresholds] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * On-demand rebuild for a date range. Needed for the initial backfill and after a
 * schedule correction; the import trigger covers the routine case. Safe to run
 * repeatedly — the engine is idempotent and serialises overlapping runs.
 */
export async function recalculateAttendance(req: Request, res: Response): Promise<void> {
  const parsed = recalculateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' });
    return;
  }
  const { from, to, userIds } = parsed.data;
  try {
    const result = await recomputeRange(from, to, userIds);
    await prisma.auditLog.create({
      data: {
        user_id: req.user!.user_id,
        action: 'RECALCULATE',
        target_type: 'attendance_daily',
        details: JSON.stringify(result),
      },
    });
    res.json(result);
  } catch (err) {
    logger.error('insightsAdminAttendance [recalculate] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
