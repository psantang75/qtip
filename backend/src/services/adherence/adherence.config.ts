/**
 * adherence.config — loads the effective-dated point bands and discipline ladder
 * out of the database into the plain shapes adherence.rules.ts works with. One
 * place knows how the config tables map onto the rule types; Decimal columns are
 * converted to numbers once, here. Mirrors attendance.config.ts.
 */
import prisma from '../../config/prisma';
import { dateStrFromDate } from '../scheduling/schedule.dates';
import type { PointRule, WarningThreshold, AdherenceKind } from './adherence.rules';

export async function loadPointRules(): Promise<PointRule[]> {
  const rows = await prisma.adherencePointRule.findMany({ orderBy: { sort_order: 'asc' } });
  return rows.map((r) => ({
    id: r.id,
    ruleKey: r.rule_key,
    label: r.label,
    kind: r.kind as AdherenceKind,
    minSeconds: r.min_seconds,
    maxSeconds: r.max_seconds,
    points: Number(r.points),
    effectiveFrom: dateStrFromDate(r.effective_from),
    effectiveTo: r.effective_to ? dateStrFromDate(r.effective_to) : null,
    isActive: r.is_active,
  }));
}

export async function loadWarningThresholds(): Promise<WarningThreshold[]> {
  const rows = await prisma.adherenceWarningThreshold.findMany({ orderBy: { sort_order: 'asc' } });
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
