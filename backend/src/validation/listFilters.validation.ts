import { z } from 'zod'
import { optionalPositiveInt } from './common'

/**
 * Query-param validation schemas for list endpoints that have no domain
 * validation file of their own.
 *
 * **NARROW BY DESIGN.** We validate only the two classes of input that are both
 * (a) genuinely bounded and (b) safe to reject early:
 *   1. Numeric IDs — the UI always sends an integer or omits the key, so a
 *      non-numeric id is a real client bug worth a clean 400 (vs. a `NaN`
 *      reaching the query).
 *   2. Hard-bounded enums the UI sends from a fixed typed select.
 *
 * Pagination (`page`/`limit`/`pageSize`/`perPage`), dates, booleans, and
 * free-text `search` are intentionally **omitted** so they keep flowing to the
 * handler's existing lenient parsing — `parsePagination` already defaults/caps
 * pagination, and validating dates/search/booleans stricter here would 400
 * inputs the handlers currently accept. `z.object` strips unlisted keys, so
 * these schemas validate the listed fields and ignore everything else.
 *
 * Frontend list services build query params with an "omit when empty" guard
 * (e.g. `auditAssignmentService`), so bounded enums are only ever sent with a
 * valid value — never `''` — but we still normalise `''`/null → undefined for
 * defense in depth.
 */

const emptyToUndef = (v: unknown) => (v === '' || v == null ? undefined : v)

/** GET /api/departments — `department.controller.getDepartments` */
export const DepartmentListQuerySchema = z.object({
  manager_id: optionalPositiveInt(),
})

/** GET /api/director-departments — `directorDepartment.controller.getDirectorDepartments` */
export const DirectorDepartmentListQuerySchema = z.object({
  director_id: optionalPositiveInt(),
  department_id: optionalPositiveInt(),
})

/** GET /api/audit-assignments — `auditAssignment.controller.getAuditAssignments` */
export const AuditAssignmentListQuerySchema = z.object({
  form_id: optionalPositiveInt(),
  target_id: optionalPositiveInt(),
  target_type: z.preprocess(emptyToUndef, z.enum(['USER', 'DEPARTMENT']).optional()),
})

/** GET /api/manager/team-audits — `manager/audits.controller.teamAuditsListHandler` */
export const TeamAuditsListQuerySchema = z.object({
  csr_id: optionalPositiveInt(),
  form_id: optionalPositiveInt(),
})

/** GET /api/manager/disputes — `manager/disputes.controller.listDisputesHandler` */
export const ManagerDisputesListQuerySchema = z.object({
  csr_id: optionalPositiveInt(),
  form_id: optionalPositiveInt(),
})

/**
 * GET /api/disputes/history and GET /api/csr/disputes/history —
 * `dispute.controller.getDisputeHistory` (same handler mounted twice).
 */
export const DisputeHistoryQuerySchema = z.object({
  form_id: optionalPositiveInt(),
})

/**
 * GET /api/writeups — `writeups/list.controller.getWriteUps`. `document_type`
 * is a fixed typed select in `writeupService` (`WriteUpType | ''`, only sent
 * when truthy), so enforcing the enum is safe. `status`/dates/`search` stay
 * lenient.
 */
export const WriteUpListQuerySchema = z.object({
  csr_id: optionalPositiveInt(),
  document_type: z.preprocess(
    emptyToUndef,
    z.enum(['VERBAL_WARNING', 'WRITTEN_WARNING', 'FINAL_WARNING']).optional(),
  ),
})

/** GET /api/qa/completed — `qa/submissions.controller.getCompletedSubmissions` */
export const QaCompletedListQuerySchema = z.object({
  form_id: optionalPositiveInt(),
})

/** GET /api/trainer/completed — `trainer/submissions.controller.getTrainerCompletedSubmissions` */
export const TrainerCompletedListQuerySchema = z.object({
  form_id: optionalPositiveInt(),
})

/**
 * GET /api/trainer/coaching-sessions — `coaching.controller.getCoachingSessions`.
 * `coaching_purpose` / `coaching_format` are `list_items.id` references (numeric).
 * `status` (a coaching-status enum) is left lenient — its "no filter" sentinel
 * wasn't verified, so we don't risk 400-ing it.
 */
export const TrainerCoachingSessionsListQuerySchema = z.object({
  csr_id: optionalPositiveInt(),
  coaching_purpose: optionalPositiveInt(),
  coaching_format: optionalPositiveInt(),
})

/** GET /api/audit-logs — inline handler in `auditLog.routes.ts` */
export const AuditLogListQuerySchema = z.object({
  user_id: optionalPositiveInt(),
})

/**
 * GET /api/enhanced-performance-goals — inline handler.
 * IDs only; the `goal_type`/`scope`/`target_scope` enums are left lenient
 * (their senders / "no filter" values weren't verified).
 */
export const EnhancedPerfGoalListQuerySchema = z.object({
  user_id: optionalPositiveInt(),
  department_id: optionalPositiveInt(),
  form_id: optionalPositiveInt(),
})
