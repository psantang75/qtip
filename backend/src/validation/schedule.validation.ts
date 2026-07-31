/**
 * Zod schemas for the scheduling routes, applied via the shared validateSchema
 * middleware (validation only — controllers read from req.query/params/body).
 */
import { z } from 'zod';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const timeStr = z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:MM');
const posInt = z.coerce.number().int().positive();

const SegmentSchema = z.object({
  activity_type_id: posInt,
  start: timeStr,
  end: timeStr,
});

export const GridQuerySchema = z.object({
  from: dateStr,
  to: dateStr,
});

export const ShiftUpsertSchema = z.object({
  user_id: posInt,
  shift_date: dateStr,
  is_day_off: z.boolean(),
  start: timeStr.nullish(),
  end: timeStr.nullish(),
  notes: z.string().max(500).nullish(),
  segments: z.array(SegmentSchema).max(6).optional(),
});

export const ApplyScheduleSchema = z.object({
  mode: z.enum(['template', 'copy']),
  user_ids: z.array(posInt).min(1),
  dates: z.array(dateStr).min(1).max(14),
  template_id: posInt.optional(),
  source_week_start: dateStr.optional(),
  dry_run: z.boolean().optional(),
});

export const PublishSchema = z.object({
  user_ids: z.array(posInt).min(1),
  dates: z.array(dateStr).min(1).max(14),
  confirm_elapsed: z.boolean().optional(),
});

export const UnpublishSchema = z.object({
  user_ids: z.array(posInt).min(1),
  dates: z.array(dateStr).min(1).max(14),
});

const TemplateDaySchema = z.object({
  day_of_week: z.coerce.number().int().min(0).max(6),
  is_day_off: z.boolean(),
  start: timeStr.nullish(),
  end: timeStr.nullish(),
  segments: z.array(SegmentSchema).max(6).optional(),
});

export const TemplateSchema = z.object({
  template_name: z.string().min(1).max(100),
  description: z.string().max(255).nullish(),
  days: z.array(TemplateDaySchema).min(1).max(7),
});

export const ExceptionCreateSchema = z.object({
  user_id: posInt,
  exception_date: dateStr,
  exception_type_id: posInt,
  is_full_day: z.boolean(),
  start: timeStr.nullish(),
  end: timeStr.nullish(),
  notes: z.string().max(500).nullish(),
  paychex_reference: z.string().max(100).nullish(),
});

export const BulkExceptionSchema = z.object({
  user_ids: z.array(posInt).min(1),
  from: dateStr,
  to: dateStr,
  exception_type_id: posInt,
  is_full_day: z.boolean(),
  start: timeStr.nullish(),
  end: timeStr.nullish(),
  dry_run: z.boolean().optional(),
});

export const ExceptionTypeSchema = z.object({
  type_key: z.string().min(1).max(50),
  label: z.string().min(1).max(100),
  description: z.string().max(255).nullish(),
  is_excused: z.boolean(),
  duration_mode: z.enum(['FULL_DAY', 'WINDOW', 'EITHER']),
  affects_arrival: z.boolean().optional(),
  affects_departure: z.boolean().optional(),
});

export const ActivityTypeSchema = z.object({
  label: z.string().min(1).max(50),
  is_paid: z.boolean(),
  counts_as_coverage: z.boolean().optional(),
  color: z.string().max(20).nullish(),
});

export const CoverageThresholdSchema = z.object({
  department_id: posInt,
  green_min: z.coerce.number().int().min(0),
  yellow_min: z.coerce.number().int().min(0),
});
