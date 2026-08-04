/**
 * Zod schemas for the campaign routes, applied via the shared validateSchema
 * middleware. Dates are 'YYYY-MM-DD'; colors are 3/6-digit hex.
 */
import { z } from 'zod';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const hexColor = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Expected a hex color like #00aeef');
const posInt = z.coerce.number().int().positive();
const anchorType = z.enum(['BD_FROM_START', 'BD_FROM_END', 'RELATIVE_TO_CAMPAIGN']);

// ── Library: categories ──────────────────────────────────────────────────────
export const CategoryCreateSchema = z.object({
  name: z.string().min(1).max(100),
  color: hexColor.optional(),
});
export const CategoryUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: hexColor.optional(),
});

// ── Library: items ───────────────────────────────────────────────────────────
export const ItemCreateSchema = z.object({
  category_id: posInt,
  label: z.string().min(1).max(150),
  anchor_type: anchorType.optional(),
  anchor_offset: z.coerce.number().int().optional(),
  anchor_ref_item_id: posInt.nullish(),
  not_on_friday: z.boolean().optional(),
});
export const ItemUpdateSchema = z.object({
  category_id: posInt.optional(),
  label: z.string().min(1).max(150).optional(),
  anchor_type: anchorType.optional(),
  anchor_offset: z.coerce.number().int().optional(),
  anchor_ref_item_id: posInt.nullish(),
  not_on_friday: z.boolean().optional(),
});

export const ReorderSchema = z.object({
  order: z.array(z.object({ id: posInt, sort_order: z.coerce.number().int() })).min(1),
});

// ── Schedules + membership ───────────────────────────────────────────────────
/** The departments a calendar is shown to — at least one, the first owns it. */
const departmentIds = z.array(posInt).min(1, 'Pick at least one department');

export const ScheduleCreateSchema = z.object({
  name: z.string().min(1).max(120),
  department_ids: departmentIds,
});
export const ScheduleUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  is_active: z.boolean().optional(),
  department_ids: departmentIds.optional(),
});
export const MembershipSchema = z.object({
  campaign_item_id: posInt,
  is_enabled: z.boolean(),
});

// ── Publishing ───────────────────────────────────────────────────────────────
export const MonthPublishSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  is_published: z.boolean(),
});

// ── Month projection + overrides ─────────────────────────────────────────────
export const MonthQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});
export const DayCampaignSchema = z.object({
  occurrence_date: dateStr,
  campaign_item_id: posInt,
  is_on: z.boolean(),
});
