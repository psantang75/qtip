/**
 * Zod schemas for the attendance admin write surface. Structural validation only;
 * the policy rules that need to see the whole set at once (bands must not overlap,
 * the discipline ladder must ascend) live in attendance.rules.ts and the
 * controller, because they are domain logic rather than shape checks.
 */
import { z } from 'zod';

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must be YYYY-MM-DD');

const kind = z.enum(['LATE', 'EARLY_LEAVE', 'ABSENT', 'EXCEPTION']);

const pointRule = z
  .object({
    ruleKey: z.string().min(1).max(50),
    label: z.string().min(1).max(100),
    kind,
    // Deviations are stored in whole seconds. 8 hours of lateness is already an
    // absence, so the cap is generous rather than tight.
    minSeconds: z.number().int().min(0).max(86_400),
    maxSeconds: z.number().int().min(0).max(86_400).nullable(),
    points: z.number().min(0).max(99.99),
    exceptionTypeId: z.number().int().positive().nullable().optional(),
    sortOrder: z.number().int().min(0),
    isActive: z.boolean(),
  })
  .refine((r) => r.kind !== 'EXCEPTION' || r.exceptionTypeId != null, {
    message: 'An exception band must be bound to an exception type',
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

/**
 * Two years is well past any range the rolling 90-day window needs, and it stops a
 * hand-written request from asking the engine to walk a century of dates and hold
 * the recompute lock while it does — recomputes are serialised, so one absurd range
 * blocks every import behind it.
 */
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
