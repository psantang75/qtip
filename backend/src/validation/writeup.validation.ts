import { z } from 'zod'
import { optionalDate, optionalString, optionalPositiveInt } from './common'

/**
 * Write-up request validation (pre-production review item #86).
 *
 * The old create handler only checked `csr_id` and `document_type`; everything
 * below (nested incidents → violations → examples, prior-discipline refs, the
 * list-item id arrays) was accepted blind and then coerced inside the
 * transaction. That meant a malformed request — wrong enum, missing
 * description on a nested example, a non-array prior_discipline payload —
 * landed as a mid-transaction Prisma exception, returning a 500 with no
 * indication of which field was bad. These schemas fail fast at the edge with
 * a normal 400 and a path-qualified error message, matching the discipline
 * applied by `csr.validation.ts` and `user.validation.ts`.
 *
 * Audit-log boundary: write-up mutations do **not** write separate
 * `audit_log` rows — the lifecycle already records actorship on the record
 * itself (`created_by`, `delivered_at`, `refused_at`, `refusal_reason`,
 * `signed_at`, `signed_ip`, `closed_at`, `follow_up_completed_at`). That
 * captures the same "who did what, when, from where" signal that a separate
 * audit table would. New state-machine columns should stay on the record
 * rather than branching into a second write path.
 */

// DocumentType mirrors Prisma enum `WriteUpType`. Kept in lock-step with
// `backend/prisma/schema.prisma` — update both at the same time.
export const WRITEUP_DOCUMENT_TYPES = [
  'VERBAL_WARNING',
  'WRITTEN_WARNING',
  'FINAL_WARNING',
] as const
export const WriteUpDocumentTypeSchema = z.enum(WRITEUP_DOCUMENT_TYPES)

// `z.coerce.number()` lets the schema accept either a JSON number or a
// stringified id — the UI sends numbers, but legacy callers send strings.
const positiveInt = z.coerce.number().int().positive()

const ExampleInputSchema = z.object({
  example_date:     optionalDate(),
  description:      z.string().trim().min(1, 'Example description is required'),
  source:           optionalString(),
  qa_submission_id: optionalPositiveInt(),
  qa_question_id:   optionalPositiveInt(),
  sort_order:       z.coerce.number().int().min(0).optional(),
})

const ViolationInputSchema = z.object({
  policy_violated:    z.string().trim().min(1, 'policy_violated is required'),
  reference_material: optionalString(),
  sort_order:         z.coerce.number().int().min(0).optional(),
  examples:           z.array(ExampleInputSchema).optional(),
})

const IncidentInputSchema = z.object({
  description: z.string().trim().min(1, 'Incident description is required'),
  sort_order:  z.coerce.number().int().min(0).optional(),
  violations:  z.array(ViolationInputSchema).optional(),
})

const PriorDisciplineRefSchema = z.object({
  reference_type: z.enum(['write_up', 'coaching_session']),
  reference_id:   positiveInt,
})

// `behavior_flag_ids` / `root_cause_ids` / `support_needed_ids` are either a
// number[] or a comma-joined string in the wild — the service normalises via
// `toIntArray`. We accept both here so we don't reject legacy payloads.
const listItemIdsSchema = z
  .union([z.array(z.union([z.string(), z.number()])), z.string()])
  .optional()

/**
 * Write-up create payload.
 *
 * **Draft semantics:** only `csr_id` and `document_type` are required at the
 * schema level. Everything else is optional so the "Save as Draft" flow can
 * persist a half-finished record. Stricter validations (e.g. "meeting_date
 * required to schedule") live in the lifecycle transition layer, not here.
 *
 * Optional string / id / date fields are written through the shared
 * `optionalString` / `optionalPositiveInt` / `optionalDate` helpers, which
 * accept `null`, `0`, and `''` as "not set" — matching what the UI sends
 * for cleared inputs and what the DB stores for `NULL` columns.
 */
export const CreateWriteUpSchema = z.object({
  csr_id:                positiveInt,
  document_type:         WriteUpDocumentTypeSchema,
  meeting_date:          optionalDate(),
  corrective_action:     optionalString(),
  correction_timeline:   optionalString(),
  checkin_date:          optionalDate(),
  consequence:           optionalString(),
  internal_notes:        optionalString(),
  linked_coaching_id:    optionalPositiveInt(),
  manager_id:            optionalPositiveInt(),
  hr_witness_id:         optionalPositiveInt(),
  incidents:             z.array(IncidentInputSchema).optional(),
  prior_discipline:      z.array(PriorDisciplineRefSchema).optional(),
  behavior_flag_ids:     listItemIdsSchema,
  root_cause_ids:        listItemIdsSchema,
  support_needed_ids:    listItemIdsSchema,
})
export type CreateWriteUpBody = z.infer<typeof CreateWriteUpSchema>

export const UpdateWriteUpSchema = CreateWriteUpSchema.partial({
  csr_id:        true,
  document_type: true,
})
