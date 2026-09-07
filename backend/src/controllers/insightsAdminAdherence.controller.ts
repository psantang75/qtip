/**
 * insightsAdminAdherence.controller — the write surface for adherence config,
 * alongside the attendance one on insightsAdmin.routes.ts. Same effective-dated
 * discipline: saving retires the current version and inserts a new one from the
 * effective date, so a delivered warning re-scores under the bands in force on the
 * day it happened. Every save writes an audit_logs row.
 *
 * Uses asyncHandler + AppError (the backend contract), so shape errors (ZodError)
 * and domain errors (AppError) both land on the global envelope — no per-handler
 * try/catch or bespoke 500 JSON.
 */
import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { asyncHandler, createValidationError } from '../utils/errorHandler';
import { dateStrFromDate, dateOnlyValue, addDays } from '../services/scheduling/schedule.dates';
import { loadPointRules, loadWarningThresholds } from '../services/adherence/adherence.config';
import {
  getAdherenceStartDate, setAdherenceStartDate,
  getPointsActiveFrom, setPointsActiveFrom,
  getPhoneGrace, setPhoneGrace,
  getComplianceThresholds, setComplianceThresholds,
} from '../services/adherence/adherence.settings';
import { validateBands, BANDED_KINDS } from '../services/adherence/adherence.rules';
import { recomputeRange } from '../services/adherence/adherence.engine';
import {
  pointRulesSaveSchema, thresholdsSaveSchema, settingsSaveSchema, recalculateSchema,
} from '../validation/adherence.validation';

/** Current bands, ladder, and the tunable settings. */
export const getAdherenceConfig = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  const [rules, thresholds, startDate, pointsActiveFrom, phoneGrace, compliance] = await Promise.all([
    loadPointRules(),
    loadWarningThresholds(),
    getAdherenceStartDate(),
    getPointsActiveFrom(),
    getPhoneGrace(),
    getComplianceThresholds(),
  ]);
  const today = dateStrFromDate(new Date());
  res.json({
    rules,
    thresholds,
    settings: {
      startDate,
      pointsActiveFrom,
      phoneGraceBeforeSec: phoneGrace.beforeSec,
      phoneGraceAfterSec: phoneGrace.afterSec,
      complianceGreenMin: compliance.greenMin,
      complianceYellowMin: compliance.yellowMin,
    },
    pointsActive: pointsActiveFrom <= today,
  });
});

export const saveAdherenceSettings = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const {
    startDate, pointsActiveFrom, phoneGraceBeforeSec, phoneGraceAfterSec,
    complianceGreenMin, complianceYellowMin,
  } = settingsSaveSchema.parse(req.body);

  await setAdherenceStartDate(startDate);
  await setPointsActiveFrom(pointsActiveFrom);
  const grace = await setPhoneGrace(phoneGraceBeforeSec, phoneGraceAfterSec);
  const compliance = await setComplianceThresholds(complianceGreenMin, complianceYellowMin);

  await prisma.auditLog.create({
    data: {
      user_id: req.user!.user_id,
      action: 'UPDATE',
      target_type: 'adherence_settings',
      details: JSON.stringify({ startDate, pointsActiveFrom, ...grace, ...compliance }),
    },
  });
  res.json({ success: true, startDate, pointsActiveFrom, phoneGrace: grace, compliance });
});

export const saveAdherenceRules = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { effectiveFrom, rules } = pointRulesSaveSchema.parse(req.body);

  const problems: string[] = [];
  for (const kind of BANDED_KINDS) {
    problems.push(
      ...validateBands(
        rules
          .filter((r) => r.kind === kind && r.isActive)
          .map((r) => ({ label: r.label, minSeconds: r.minSeconds, maxSeconds: r.maxSeconds })),
      ),
    );
  }
  if (problems.length > 0) throw createValidationError(problems.join('; '), { problems });

  const existing = await prisma.adherencePointRule.findMany({ where: { effective_to: null } });
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
        sort_order: r.sortOrder,
        is_active: r.isActive,
      };
      // At or before the current version's start this is a correction in place,
      // not a new version (see attendance controller for the reasoning).
      if (current && dateStrFromDate(current.effective_from) >= effectiveFrom) {
        await tx.adherencePointRule.update({
          where: { id: current.id },
          data: { ...data, effective_from: dateOnlyValue(effectiveFrom) },
        });
        continue;
      }
      if (current) {
        await tx.adherencePointRule.update({
          where: { id: current.id },
          data: { effective_to: dateOnlyValue(addDays(effectiveFrom, -1)) },
        });
      }
      await tx.adherencePointRule.create({
        data: { ...data, rule_key: r.ruleKey, effective_from: dateOnlyValue(effectiveFrom) },
      });
    }

    await tx.auditLog.create({
      data: {
        user_id: req.user!.user_id,
        action: 'UPDATE',
        target_type: 'adherence_point_rule',
        details: JSON.stringify({ effectiveFrom, rules }),
      },
    });
  });

  res.json({ success: true, effectiveFrom, count: rules.length });
});

export const saveAdherenceThresholds = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { effectiveFrom, thresholds } = thresholdsSaveSchema.parse(req.body);

  const active = thresholds.filter((t) => t.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  for (let i = 0; i < active.length - 1; i++) {
    if (active[i + 1].pointsThreshold <= active[i].pointsThreshold) {
      throw createValidationError(`${active[i + 1].label} must require more points than ${active[i].label}`);
    }
  }

  const existing = await prisma.adherenceWarningThreshold.findMany({ where: { effective_to: null } });
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
      if (current && dateStrFromDate(current.effective_from) >= effectiveFrom) {
        await tx.adherenceWarningThreshold.update({
          where: { id: current.id },
          data: { ...data, effective_from: dateOnlyValue(effectiveFrom) },
        });
        continue;
      }
      if (current) {
        await tx.adherenceWarningThreshold.update({
          where: { id: current.id },
          data: { effective_to: dateOnlyValue(addDays(effectiveFrom, -1)) },
        });
      }
      await tx.adherenceWarningThreshold.create({
        data: { ...data, level_key: t.levelKey, effective_from: dateOnlyValue(effectiveFrom) },
      });
    }

    await tx.auditLog.create({
      data: {
        user_id: req.user!.user_id,
        action: 'UPDATE',
        target_type: 'adherence_warning_threshold',
        details: JSON.stringify({ effectiveFrom, thresholds }),
      },
    });
  });

  res.json({ success: true, effectiveFrom, count: thresholds.length });
});

/**
 * On-demand rebuild for a date range — the initial backfill and after a schedule
 * correction. Idempotent and serialised, so it is safe to run repeatedly.
 */
export const recalculateAdherence = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { from, to, userIds } = recalculateSchema.parse(req.body);
  const result = await recomputeRange(from, to, userIds);
  await prisma.auditLog.create({
    data: {
      user_id: req.user!.user_id,
      action: 'RECALCULATE',
      target_type: 'adherence_daily',
      details: JSON.stringify(result),
    },
  });
  res.json(result);
});
