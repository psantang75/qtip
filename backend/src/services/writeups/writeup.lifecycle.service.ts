/**
 * Writeup data-mutation paths: create / update / internal-notes / follow-up notes.
 *
 * Owns the four endpoints that change the body of a write-up. Lifecycle
 * status moves (transitionStatus / signWriteUp / setFollowUp) live in
 * `writeup.transition.service.ts` so each file stays focused and under the
 * 300-line cap. Both files were extracted from the old
 * `controllers/writeup.controller.ts` during the pre-production review
 * (item #29).
 *
 * ── Role policy (pre-production review item #90) ─────────────────────────
 *
 * The route layer mounts create / update / status / attachment handlers
 * behind `authorizeManager`, which resolves to **Manager, Admin, QA**.
 * Trainers are intentionally excluded even though they can author coaching
 * sessions: write-ups are HR disciplinary records (Verbal → Written → Final
 * Warning) and the system-of-record for the corrective-action process.
 * Trainer scope is onboarding / performance coaching, not formal discipline.
 * If this policy changes, update `routes/writeup.routes.ts`, the
 * `authorizeManager` allow-list, and this comment together.
 *
 * ── Audit trail (pre-production review item #86) ─────────────────────────
 *
 * Write-ups do **not** emit separate `audit_log` rows. The state-machine
 * columns on the record itself capture actorship and timing:
 *   `created_by`, `meeting_date`, `delivered_at`, `refused_at`,
 *   `refusal_reason`, `signed_at`, `signed_ip`, `acknowledged_at`,
 *   `follow_up_completed_at`, `closed_at`.
 * That is the audit trail for the discipline process; new state transitions
 * should add columns here rather than branching into a parallel log.
 *
 * ── Naming convention (pre-production review item #101) ──────────────────
 *
 * The canonical compound is **`WriteUp`** (two capitals) — matches the
 * Prisma models (`WriteUp`, `WriteUpIncident`, `WriteUpAttachment`, …) and
 * the enums (`WriteUpType`, `WriteUpStatus`, `WriteUpExampleSource`). Apply
 * that everywhere a type, class, or React component name is needed:
 *
 *   • Backend types / interfaces:    `WriteUpServiceError`, `CreateWriteUpInput`
 *   • Frontend React components:     `WriteUpFormPage`, `WriteUpPdf`
 *
 * File naming is intentionally layer-specific:
 *
 *   • Backend — `lowercase.dotted.ts` (`writeup.lifecycle.service.ts`,
 *     `writeup.routes.ts`, `writeup.validation.ts`). Keeps the folder
 *     alphabetized by feature and mirrors every other backend module.
 *   • Frontend — `PascalCase.tsx` for React components
 *     (`WriteUpFormPage.tsx`), `camelCase.ts` for hooks / helpers
 *     (`warningListHelpers.tsx`, `openPdf.ts`). That's the React
 *     ecosystem norm and aligns with the rest of `frontend/src/pages/`.
 *
 * The case-variant `Writeup` (one capital) shows up in a handful of
 * historical spots but should not spread — prefer `WriteUp` for all new
 * symbols so the codebase matches the Prisma source of truth.
 */

import prisma from '../../config/prisma'
import { insertIncidents, replaceWriteUpListItems, toIntArray } from './writeup.helpers'
import { WriteUpServiceError } from './writeup.types'
import type { IncidentInput, PriorDisciplineRef } from './writeup.types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const orNull = <T>(v: T | undefined): T | null => (v as any) ?? null

// Body shapes accepted by the lifecycle endpoints. Kept loose because they
// land straight from JSON; coercions happen in the methods below.
export interface CreateWriteUpInput {
  csr_id: number | string
  document_type: string
  meeting_date?: string
  corrective_action?: string
  correction_timeline?: string
  checkin_date?: string
  consequence?: string
  internal_notes?: string
  linked_coaching_id?: number | string
  manager_id?: number | string
  hr_witness_id?: number | string
  incidents?: IncidentInput[]
  prior_discipline?: PriorDisciplineRef[]
  behavior_flag_ids?: unknown
  root_cause_ids?: unknown
  support_needed_ids?: unknown
}

export interface UpdateWriteUpInput {
  meeting_date?: string
  corrective_action?: string
  correction_timeline?: string
  checkin_date?: string
  consequence?: string
  internal_notes?: string
  linked_coaching_id?: number | string
  manager_id?: number | string
  hr_witness_id?: number | string
  incidents?: IncidentInput[]
  prior_discipline?: PriorDisciplineRef[]
  behavior_flag_ids?: unknown
  root_cause_ids?: unknown
  support_needed_ids?: unknown
}

export interface UpdateInternalNotesInput {
  internal_notes?: string | null
  behavior_flag_ids?: unknown
  root_cause_ids?: unknown
  support_needed_ids?: unknown
}

/** Create a new write-up (always lands in DRAFT). */
export async function createWriteUp(input: CreateWriteUpInput, createdBy: number): Promise<{ id: number }> {
  if (!input.csr_id || !input.document_type) {
    throw new WriteUpServiceError('csr_id and document_type are required', 400, 'WRITEUP_VALIDATION')
  }

  const listItemIds = [
    ...toIntArray(input.behavior_flag_ids),
    ...toIntArray(input.root_cause_ids),
    ...toIntArray(input.support_needed_ids),
  ]

  const result = await prisma.$transaction(async (tx) => {
    const writeUp = await tx.writeUp.create({
      data: {
        csr_id:              parseInt(String(input.csr_id)),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        document_type:       input.document_type as any,
        status:              'DRAFT',
        meeting_date:        input.meeting_date  ? new Date(input.meeting_date)  : null,
        corrective_action:   orNull(input.corrective_action),
        correction_timeline: orNull(input.correction_timeline),
        checkin_date:        input.checkin_date  ? new Date(input.checkin_date)  : null,
        consequence:         orNull(input.consequence),
        internal_notes:      orNull(input.internal_notes),
        linked_coaching_id:  input.linked_coaching_id ? parseInt(String(input.linked_coaching_id)) : null,
        manager_id:          input.manager_id         ? parseInt(String(input.manager_id))         : null,
        hr_witness_id:       input.hr_witness_id      ? parseInt(String(input.hr_witness_id))      : null,
        created_by:          createdBy,
      },
    })
    await insertIncidents(tx, writeUp.id, input.incidents ?? [])
    for (const pd of (input.prior_discipline ?? [])) {
      await tx.writeUpPriorDiscipline.create({
        data: {
          write_up_id:    writeUp.id,
          reference_type: pd.reference_type,
          reference_id:   parseInt(String(pd.reference_id)),
        },
      })
    }
    await replaceWriteUpListItems(tx, writeUp.id, listItemIds)
    return writeUp
  })

  return { id: result.id }
}

/**
 * Update incidents / metadata. Locked to DRAFT and SCHEDULED — anything past
 * SCHEDULED uses the more targeted `updateInternalNotes` /
 * `updateFollowUpNotes` / `transitionStatus` paths. Non-admins can only
 * update records they created.
 */
export async function updateWriteUp(
  writeUpId: number,
  input: UpdateWriteUpInput,
  viewerId: number,
  viewerRole: string,
): Promise<void> {
  const existing = await prisma.writeUp.findUnique({ where: { id: writeUpId } })
  if (!existing) throw new WriteUpServiceError('Write-up not found', 404, 'WRITEUP_NOT_FOUND')

  if (!['DRAFT', 'SCHEDULED'].includes(existing.status)) {
    throw new WriteUpServiceError('Write-up cannot be edited in its current status', 403, 'WRITEUP_NOT_EDITABLE')
  }
  if (viewerRole !== 'Admin' && existing.created_by !== viewerId) {
    throw new WriteUpServiceError('Not authorized to update this write-up', 403, 'WRITEUP_FORBIDDEN')
  }

  const hasInternalListItems =
    input.behavior_flag_ids   !== undefined ||
    input.root_cause_ids      !== undefined ||
    input.support_needed_ids  !== undefined

  const listItemIds = hasInternalListItems
    ? [
        ...toIntArray(input.behavior_flag_ids),
        ...toIntArray(input.root_cause_ids),
        ...toIntArray(input.support_needed_ids),
      ]
    : []

  await prisma.$transaction(async (tx) => {
    await tx.writeUp.update({
      where: { id: writeUpId },
      data: {
        meeting_date:        input.meeting_date  ? new Date(input.meeting_date)  : null,
        corrective_action:   orNull(input.corrective_action),
        correction_timeline: orNull(input.correction_timeline),
        checkin_date:        input.checkin_date  ? new Date(input.checkin_date)  : null,
        consequence:         orNull(input.consequence),
        internal_notes:      input.internal_notes !== undefined ? (input.internal_notes ?? null) : undefined,
        linked_coaching_id:  input.linked_coaching_id ? parseInt(String(input.linked_coaching_id)) : null,
        manager_id:          input.manager_id         ? parseInt(String(input.manager_id))         : null,
        hr_witness_id:       input.hr_witness_id      ? parseInt(String(input.hr_witness_id))      : null,
      },
    })

    await tx.writeUpIncident.deleteMany({ where: { write_up_id: writeUpId } })
    await insertIncidents(tx, writeUpId, input.incidents ?? [])

    await tx.writeUpPriorDiscipline.deleteMany({ where: { write_up_id: writeUpId } })
    for (const pd of (input.prior_discipline ?? [])) {
      await tx.writeUpPriorDiscipline.create({
        data: {
          write_up_id:    writeUpId,
          reference_type: pd.reference_type,
          reference_id:   parseInt(String(pd.reference_id)),
        },
      })
    }

    if (hasInternalListItems) {
      await replaceWriteUpListItems(tx, writeUpId, listItemIds)
    }
  })
}

/**
 * Management-only edit for internal notes + list-item categories. Allowed
 * at any status except CLOSED.
 */
export async function updateInternalNotes(
  writeUpId: number,
  input: UpdateInternalNotesInput,
): Promise<void> {
  const existing = await prisma.writeUp.findUnique({ where: { id: writeUpId } })
  if (!existing) throw new WriteUpServiceError('Write-up not found', 404, 'WRITEUP_NOT_FOUND')
  if (existing.status === 'CLOSED') {
    throw new WriteUpServiceError(
      'Internal notes cannot be edited after the warning is closed',
      403,
      'WRITEUP_CLOSED',
    )
  }

  const listItemIds = [
    ...toIntArray(input.behavior_flag_ids),
    ...toIntArray(input.root_cause_ids),
    ...toIntArray(input.support_needed_ids),
  ]

  await prisma.$transaction(async (tx) => {
    await tx.writeUp.update({
      where: { id: writeUpId },
      data: { internal_notes: input.internal_notes !== undefined ? (input.internal_notes ?? null) : undefined },
    })
    await replaceWriteUpListItems(tx, writeUpId, listItemIds)
  })
}

/** Save follow-up notes while the record is in FOLLOW_UP_PENDING. */
export async function updateFollowUpNotes(writeUpId: number, follow_up_notes?: string | null): Promise<void> {
  const existing = await prisma.writeUp.findUnique({ where: { id: writeUpId } })
  if (!existing) throw new WriteUpServiceError('Write-up not found', 404, 'WRITEUP_NOT_FOUND')
  if (existing.status !== 'FOLLOW_UP_PENDING') {
    throw new WriteUpServiceError(
      'Follow-up notes can only be saved while a write-up is in follow-up',
      422,
      'WRITEUP_INVALID_STATE',
    )
  }

  await prisma.writeUp.update({
    where: { id: writeUpId },
    data: { follow_up_notes: follow_up_notes ?? null },
  })
}
