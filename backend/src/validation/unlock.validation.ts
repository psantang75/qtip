/**
 * Zod schemas for the admin unlock / reopen routes, applied via the shared
 * validateSchema middleware.
 *
 * The reason note minimum is deliberately enforced here as well as in
 * unlock.service.ts — the service is the source of truth (it is also called
 * from tests and could gain other callers), the schema is what produces a
 * useful 400 for the UI.
 */
import { z } from 'zod';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const posInt = z.coerce.number().int().positive();

export const UnlockRequestSchema = z.object({
  // Reasons are admin-managed (Admin -> List Management -> Quality), so the
  // schema only enforces shape here; unlock.service.ts checks the code against
  // the active list, which is the source of truth.
  reason_code: z.string().trim().min(1, 'A reason is required').max(100),
  reason_note: z
    .string()
    .trim()
    .min(20, 'Explain the correction in at least 20 characters')
    .max(2000),
  confirm_beyond_window: z.boolean().optional(),
});

export const UnlockListQuerySchema = z.object({
  page: posInt.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  date_start: dateStr.optional(),
  date_end: dateStr.optional(),
  // The register's multi-select filters send comma-separated lists; the query
  // service splits and sanitises each against its allow-list (entity_type /
  // state) or treats them as opaque codes (admin-managed reason_code).
  entity_type: z.string().max(100).optional(),
  reason_code: z.string().max(500).optional(),
  state: z.string().max(100).optional(),
  unlocked_by: posInt.optional(),
  search: z.string().max(200).optional(),
});
