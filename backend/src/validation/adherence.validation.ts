/**
 * Zod schemas for the adherence admin write surface. Structural validation only;
 * set-wide policy (bands of a kind must not overlap, the ladder must ascend) lives
 * in adherence.rules.ts and the controller, because it is domain logic.
 */
import { z } from 'zod';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must be YYYY-MM-DD');

const kind = z.enum([
  'BREAK_DURATION', 'LUNCH_DURATION', 'BREAK_START', 'LUNCH_START',
  'BREAK_PHONE_START', 'BREAK_PHONE_STOP', 'LUNCH_PHONE_START', 'LUNCH_PHONE_STOP',
  'BREAK_MISSED', 'LUNCH_MISSED',
]);

const pointRule = z.object({
  ruleKey: z.string().min(1).max(50),
  label: z.string().min(1).max(100),
  kind,
  minSeconds: z.number().int().min(0).max(86_400),
  maxSeconds: z.number().int().min(0).max(86_400).nullable(),
  points: z.number().min(0).max(99.99),
  sortOrder: z.number().int().min(0),
  isActive: z.boolean(),
});

export const pointRulesSaveSchema = z.object({
  effectiveFrom: dateStr,
  rules: z.array(pointRule).min(1),
});

export const thresholdsSaveSchema = z.object({
  effectiveFrom: dateStr,
  thresholds: z
    .array(
      z.object({
        levelKey: z.string().min(1).max(50),
        label: z.string().min(1).max(100),
        pointsThreshold: z.number().min(0).max(99.99),
        sortOrder: z.number().int().min(0),
        isActive: z.boolean(),
      }),
    )
    .min(1),
});

/** Phone tolerance is capped at an hour: anything larger is a data problem, not a
 * grace period. */
export const settingsSaveSchema = z
  .object({
    startDate: dateStr,
    pointsActiveFrom: dateStr,
    phoneGraceBeforeSec: z.number().int().min(0).max(3600),
    phoneGraceAfterSec: z.number().int().min(0).max(3600),
    complianceGreenMin: z.number().min(0).max(100),
    complianceYellowMin: z.number().min(0).max(100),
  })
  .refine((s) => s.complianceGreenMin >= s.complianceYellowMin, {
    message: 'Green threshold must be at or above the yellow threshold',
    path: ['complianceGreenMin'],
  });

/**
 * Adherence exception logged against one break/lunch instance. References a type
 * (excused/unexcused decides scoring), mirroring attendance's ScheduleException.
 */
export const adherenceExceptionSaveSchema = z.object({
  user_id: z.number().int().positive(),
  work_date: dateStr,
  segment_kind: z.enum(['BREAK', 'LUNCH']),
  seq: z.number().int().min(1).max(127),
  exception_type_id: z.number().int().positive(),
  reason: z.string().max(255).nullable().optional(),
});

/** Adherence exception TYPE create (List Management). type_key auto-slugs from
 *  label when omitted; PUT updates are field-picked in the service. */
export const adherenceExceptionTypeSaveSchema = z.object({
  type_key: z.string().min(1).max(50).optional(),
  label: z.string().min(1).max(100),
  category: z.string().max(100).nullish(),
  description: z.string().max(255).nullish(),
  is_excused: z.boolean().optional(),
});

const MAX_RECALC_DAYS = 730;

export const recalculateSchema = z
  .object({
    from: dateStr,
    to: dateStr,
    userIds: z.array(z.number().int().positive()).optional(),
  })
  .refine((v) => v.from <= v.to, { message: 'Start date must be on or before end date' })
  .refine(
    (v) => (Date.parse(`${v.to}T00:00:00Z`) - Date.parse(`${v.from}T00:00:00Z`)) / 86_400_000 <= MAX_RECALC_DAYS,
    { message: `Recalculate covers at most ${MAX_RECALC_DAYS} days at a time` },
  );
