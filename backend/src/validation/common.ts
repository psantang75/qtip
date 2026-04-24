import { z } from 'zod'

/**
 * Shared Zod primitives for request validation.
 *
 * **Use this file as the canonical home for cross-controller validation
 * pieces** — pagination, date ranges, and any enum that mirrors a Prisma
 * enum. Keeping these in one place stops the kind of drift the
 * pre-production review (item #31, #32, #34, #35, #36) flagged where the
 * same enum lived in 4+ places and silently went out of sync.
 *
 * ## Conventions
 *
 * 1. Field names mirror what the controller reads from `req.query` /
 *    `req.body` exactly (camelCase or snake_case — copy the controller).
 *    Schemas that strip unknown fields look like they are validating but
 *    aren't, so name mismatches become silent no-ops.
 * 2. Enum values are kept in lock-step with `backend/prisma/schema.prisma`.
 *    Update both at the same time.
 * 3. Use `validateSchema` from `csr.validation.ts` (or write a tiny shim)
 *    so every endpoint produces the same `{ message, errors[] }` envelope.
 */

// ── Pagination ───────────────────────────────────────────────────────────────

export const PageSchema     = z.coerce.number().int().min(1).max(10_000).optional()
export const PageSizeSchema = z.coerce.number().int().min(1).max(5_000).optional()

// ── ISO date strings ─────────────────────────────────────────────────────────

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
export const IsoDateStringSchema = z.string().regex(ISO_DATE_REGEX, 'Invalid date format. Expected YYYY-MM-DD')

// Empty-string coercer — most controllers receive `?status=` from the UI
// when the dropdown is cleared. Treat that as "filter not set".
export const optionalString = () => z.preprocess(v => (v === '' ? undefined : v), z.string().optional())
export const optionalDate   = () => z.preprocess(v => (v === '' ? undefined : v), IsoDateStringSchema.optional())

// ── Prisma-mirrored enums (single source of truth) ───────────────────────────

/** Mirrors Prisma enum `SubmissionStatus`. */
export const SUBMISSION_STATUSES = ['DRAFT', 'SUBMITTED', 'DISPUTED', 'FINALIZED'] as const
export type SubmissionStatus = typeof SUBMISSION_STATUSES[number]
export const SubmissionStatusSchema = z.enum(SUBMISSION_STATUSES)

/** Mirrors Prisma enum `DisputeStatus`. */
export const DISPUTE_STATUSES = ['OPEN', 'UPHELD', 'REJECTED', 'ADJUSTED'] as const
export type DisputeStatus = typeof DISPUTE_STATUSES[number]
export const DisputeStatusSchema = z.enum(DISPUTE_STATUSES)

/** Mirrors Prisma enum `CoachingSessionStatus`. */
export const COACHING_SESSION_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'IN_PROCESS',
  'AWAITING_CSR_ACTION',
  'QUIZ_PENDING',
  'COMPLETED',
  'FOLLOW_UP_REQUIRED',
  'CLOSED',
  'CANCELED',
] as const
export type CoachingSessionStatus = typeof COACHING_SESSION_STATUSES[number]
export const CoachingSessionStatusSchema = z.enum(COACHING_SESSION_STATUSES)

/** Mirrors Prisma enum `CoachingPurpose`. */
export const COACHING_PURPOSES = ['WEEKLY', 'PERFORMANCE', 'ONBOARDING'] as const
export type CoachingPurpose = typeof COACHING_PURPOSES[number]
export const CoachingPurposeSchema = z.enum(COACHING_PURPOSES)

/** Mirrors Prisma enum `CoachingFormat`. */
export const COACHING_FORMATS = ['ONE_ON_ONE', 'SIDE_BY_SIDE', 'TEAM_SESSION'] as const
export type CoachingFormat = typeof COACHING_FORMATS[number]
export const CoachingFormatSchema = z.enum(COACHING_FORMATS)
