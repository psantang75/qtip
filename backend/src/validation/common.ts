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

/**
 * Hard server-side cap for any list endpoint that accepts `limit` /
 * `pageSize` / `perPage`. Lowered from 5,000 during the pre-production
 * review (item #40) — the old cap let any authenticated client request
 * effectively unbounded result sets, which combined with our N×JOIN
 * dispute / audit queries was a foot-gun. 1,000 still covers the
 * frontend's "fetch all" pattern (CLIENT_FETCH_LIMIT) for every
 * realistic deployment of this product while bounding the worst case.
 *
 * Endpoints that need a different cap should declare their own schema
 * rather than raising this number — see `quizLibrary.controller.ts` for
 * an in-controller cap example.
 */
export const MAX_PAGE_SIZE  = 1_000
export const PageSchema     = z.coerce.number().int().min(1).max(10_000).optional()
export const PageSizeSchema = z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional()

// ── ISO date strings ─────────────────────────────────────────────────────────

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
export const IsoDateStringSchema = z.string().regex(ISO_DATE_REGEX, 'Invalid date format. Expected YYYY-MM-DD')

// Empty-string / null coercer — most controllers receive `?status=` from
// the UI when the dropdown is cleared (empty string), and JSON-body callers
// send `null` for cleared optional fields (which matches the DB's NULL
// semantics). Both mean "no value", so we normalise them to `undefined`
// before running the inner schema's `.optional()` so neither rejects.
const isAbsent = (v: unknown) => v === '' || v === null
export const optionalString = () => z.preprocess(v => (isAbsent(v) ? undefined : v), z.string().optional())
export const optionalDate   = () => z.preprocess(v => (isAbsent(v) ? undefined : v), IsoDateStringSchema.optional())

/**
 * Optional positive integer — accepts a number, a numeric string, `null`,
 * `0`, or `''` (the last three all mean "not set" in form payloads). Used
 * for foreign-key id fields that the UI clears by setting to 0 or null.
 */
export const optionalPositiveInt = () =>
  z.preprocess(
    v => (isAbsent(v) || v === 0 || v === '0' ? undefined : v),
    z.coerce.number().int().positive().optional(),
  )

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

// Coaching purpose / format / source are now list_items.id references managed
// via List Management (migration 20260629150000). Filters accept a numeric id.
export const CoachingPurposeSchema = z.coerce.number().int().positive()
export const CoachingFormatSchema = z.coerce.number().int().positive()
