/**
 * attendance.config — loads the effective-dated point bands and discipline
 * ladder out of the database and into the plain shapes attendance.rules.ts
 * works with.
 *
 * Both the engine (which scores days) and the rollup (which picks a warning
 * level) read through here, so there is exactly one place that knows how the
 * config tables map onto the rule types. Decimal columns are converted to
 * numbers once, here, rather than at every call site.
 */
import prisma from '../../config/prisma';
import { dateStrFromDate } from '../scheduling/schedule.dates';
import type { PointRule, WarningThreshold, AttendanceKind } from './attendance.rules';

export async function loadPointRules(): Promise<PointRule[]> {
  const rows = await prisma.attendancePointRule.findMany({ orderBy: { sort_order: 'asc' } });
  return rows.map((r) => ({
    id: r.id,
    ruleKey: r.rule_key,
    label: r.label,
    kind: r.kind as AttendanceKind,
    minSeconds: r.min_seconds,
    maxSeconds: r.max_seconds,
    points: Number(r.points),
    exceptionTypeId: r.exception_type_id,
    effectiveFrom: dateStrFromDate(r.effective_from),
    effectiveTo: r.effective_to ? dateStrFromDate(r.effective_to) : null,
    isActive: r.is_active,
  }));
}

export async function loadWarningThresholds(): Promise<WarningThreshold[]> {
  const rows = await prisma.attendanceWarningThreshold.findMany({ orderBy: { sort_order: 'asc' } });
  return rows.map((r) => ({
    levelKey: r.level_key,
    label: r.label,
    pointsThreshold: Number(r.points_threshold),
    sortOrder: r.sort_order,
    effectiveFrom: dateStrFromDate(r.effective_from),
    effectiveTo: r.effective_to ? dateStrFromDate(r.effective_to) : null,
    isActive: r.is_active,
  }));
}
