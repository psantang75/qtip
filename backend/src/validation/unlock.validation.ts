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

export const UNLOCK_REASON_CODES = [
  'SCORING_ERROR',
  'WRONG_INTERACTION',
  'CALIBRATION_CORRECTION',
  'POLICY_CHANGE',
  'TECHNICAL_ISSUE',
  'AGENT_APPEAL',
  'OTHER',
] as const;

export const UnlockRequestSchema = z.object({
  reason_code: z.enum(UNLOCK_REASON_CODES),
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
  entity_type: z.enum(['SUBMISSION', 'DISPUTE']).optional(),
  reason_code: z.enum(UNLOCK_REASON_CODES).optional(),
  state: z.enum(['OPEN', 'CLOSED', 'AUTO_RELOCKED']).optional(),
  unlocked_by: posInt.optional(),
  search: z.string().max(200).optional(),
});
