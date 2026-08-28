/**
 * Zod schemas for the phone queue routes, applied via the shared validateSchema
 * middleware. Dates are 'YYYY-MM-DD' and times 'HH:MM', matching the scheduling
 * schemas — the queue services hand both straight to schedule.dates helpers.
 *
 * Cross-field rules that need a queue's name for a readable message (target
 * below minimum, overlapping frames) are enforced in the service, not here.
 */
import { z } from 'zod';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');
const hexColor = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Expected a hex color like #00aeef');
const posInt = z.coerce.number().int().positive();
const count = z.coerce.number().int().min(0).max(999);

// ── Library (admin) ──────────────────────────────────────────────────────────
export const QueueCreateSchema = z.object({
  queue_name: z.string().min(1).max(120),
  queue_code: z.string().max(120).nullish(),
  description: z.string().max(500).nullish(),
  color: hexColor.optional(),
});
export const QueueUpdateSchema = z.object({
  queue_name: z.string().min(1).max(120).optional(),
  queue_code: z.string().max(120).nullish(),
  description: z.string().max(500).nullish(),
  color: hexColor.optional(),
});
export const QueueActiveSchema = z.object({ is_active: z.boolean() });
export const QueueReorderSchema = z.object({
  order: z.array(z.object({ id: posInt, sort_order: z.coerce.number().int() })).min(1),
});

// ── Department assignment ────────────────────────────────────────────────────
const QueueWindowSchema = z.object({
  start: timeStr,
  end: timeStr,
  min_agents: count,
  target_agents: count,
  max_agents: count.nullish(),
});

export const DepartmentQueuesSchema = z.object({
  queues: z.array(z.object({
    queue_id: posInt,
    is_active: z.boolean(),
    fill_priority: z.coerce.number().int().min(1).max(999),
    min_agents: count,
    target_agents: count,
    max_agents: count.nullish(),
    windows: z.array(QueueWindowSchema).optional(),
  })),
});

// ── Policy ───────────────────────────────────────────────────────────────────
export const QueuePolicySchema = z.object({
  is_enabled: z.boolean().optional(),
  max_queues_per_person: z.coerce.number().int().min(1).max(10).optional(),
  require_min_one_per_queue: z.boolean().optional(),
  respect_pins: z.boolean().optional(),
  fill_strategy: z.enum(['PRIORITY', 'ROUND_ROBIN']).optional(),
});

// ── Membership ───────────────────────────────────────────────────────────────
export const QueueMembersSchema = z.object({
  members: z.array(z.object({
    user_id: posInt,
    is_home: z.boolean(),
    person_priority: z.coerce.number().int().min(1).max(999),
    is_pinned: z.boolean(),
    is_active: z.boolean().optional(),
  })),
});

// ── Coverage + overrides ─────────────────────────────────────────────────────
export const CoverageQuerySchema = z.object({
  department_id: posInt,
  date: dateStr,
  include_draft: z.enum(['0', '1', 'true', 'false']).optional(),
});

/** The week view anchors on a start date and always covers seven days. */
export const CoverageWeekQuerySchema = z.object({
  department_id: posInt,
  start: dateStr,
  include_draft: z.enum(['0', '1', 'true', 'false']).optional(),
});

/**
 * Omitting start and end means the whole day. Requiring both or neither is
 * enforced in the service, where the message can say so in words; the schema
 * only polices the format.
 */
export const OverrideSchema = z.object({
  department_id: posInt,
  assignment_date: dateStr,
  user_id: posInt,
  queue_id: posInt,
  action: z.enum(['ASSIGN', 'EXCLUDE']),
  start: timeStr.nullish(),
  end: timeStr.nullish(),
});

/** Hand a window back to the solver. No queue_id means every queue. */
export const OverrideClearSchema = z.object({
  department_id: posInt,
  assignment_date: dateStr,
  user_id: posInt,
  queue_id: posInt.nullish(),
  start: timeStr.nullish(),
  end: timeStr.nullish(),
});
