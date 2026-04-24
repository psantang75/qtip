/**
 * Writeup state-machine endpoints: transitionStatus, signWriteUp, setFollowUp.
 *
 * These were originally three separate handlers in `controllers/writeup.controller.ts`
 * that each duplicated the "load existing, validate role + state, decide
 * resolved status, write the update" pattern. Pulled out together during
 * the pre-production review (item #29) so the lifecycle service stays under
 * the 300-line cap and every state-machine guard lives next to the other
 * guards instead of being scattered across files.
 *
 * Transition matrix lives in `writeup.permissions.ts`; this file enforces
 * the per-edge field requirements and side-effect column writes.
 */

import prisma from '../../config/prisma'
import { assertTransition } from './writeup.permissions'
import { WriteUpServiceError } from './writeup.types'

export interface TransitionStatusInput {
  status: string
  meeting_notes?: string
  meeting_date?: string
  follow_up_notes?: string
  follow_up_required?: boolean
  follow_up_date?: string
  follow_up_assigned_to?: number | string
  follow_up_checklist?: string
  refusal_reason?: string
}

export interface SignWriteUpInput {
  signature_data: string
  clientIp: string
}

export interface SetFollowUpInput {
  follow_up_date?: string
  follow_up_assigned_to?: number | string
  follow_up_checklist?: string
}

/**
 * Move a write-up through the lifecycle. Validates transitions against
 * `ALLOWED_TRANSITIONS`, enforces the role and required-field rules each
 * edge needs, and applies the side-effect columns (delivered_at,
 * refused_at, closed_at, follow_up_completed_at, etc).
 */
export async function transitionStatus(
  writeUpId: number,
  input: TransitionStatusInput,
  viewerRole: string,
): Promise<{ status: string }> {
  if (!input.status) {
    throw new WriteUpServiceError('status is required', 400, 'WRITEUP_VALIDATION')
  }

  const existing = await prisma.writeUp.findUnique({ where: { id: writeUpId } })
  if (!existing) throw new WriteUpServiceError('Write-up not found', 404, 'WRITEUP_NOT_FOUND')

  const newStatus = input.status
  assertTransition(existing.status, newStatus)
  assertTransitionGuards(existing, input, viewerRole, newStatus)

  // Mirror signWriteUp's auto-route: a manager-recorded refusal at
  // AWAITING_SIGNATURE jumps straight to FOLLOW_UP_PENDING when a follow-up
  // is already on the record.
  let resolvedStatus = newStatus
  if (existing.status === 'AWAITING_SIGNATURE' && newStatus === 'SIGNATURE_REFUSED' && existing.follow_up_required) {
    resolvedStatus = 'FOLLOW_UP_PENDING'
  }

  const updateData = buildTransitionUpdate(existing, input, newStatus, resolvedStatus)

  await prisma.writeUp.update({
    where: { id: writeUpId },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data:  updateData as any,
  })

  return { status: resolvedStatus }
}

/** CSR signs their own AWAITING_SIGNATURE write-up. */
export async function signWriteUp(
  writeUpId: number,
  input: SignWriteUpInput,
  viewerId: number,
  viewerRole: string,
): Promise<{ status: string }> {
  if (viewerRole !== 'CSR') {
    throw new WriteUpServiceError('Only CSRs can sign write-ups', 403, 'WRITEUP_FORBIDDEN')
  }

  const existing = await prisma.writeUp.findUnique({ where: { id: writeUpId } })
  if (!existing) throw new WriteUpServiceError('Write-up not found', 404, 'WRITEUP_NOT_FOUND')
  if (existing.csr_id !== viewerId) {
    throw new WriteUpServiceError('You can only sign your own write-ups', 403, 'WRITEUP_FORBIDDEN')
  }
  if (existing.status !== 'AWAITING_SIGNATURE') {
    throw new WriteUpServiceError('Write-up is not awaiting signature', 422, 'WRITEUP_INVALID_STATE')
  }
  if (!input.signature_data) {
    throw new WriteUpServiceError('signature_data is required', 400, 'WRITEUP_VALIDATION')
  }

  const now = new Date()
  // If follow-up was already captured at finalize-meeting time the manager
  // does not need a second decision after the agent signs.
  const nextStatus = existing.follow_up_required ? 'FOLLOW_UP_PENDING' : 'SIGNED'
  await prisma.writeUp.update({
    where: { id: writeUpId },
    data:  {
      status:          nextStatus,
      signature_data:  input.signature_data,
      signed_at:       now,
      acknowledged_at: now,
      signed_ip:       input.clientIp,
    },
  })

  return { status: nextStatus }
}

/** Schedule a follow-up after a SIGNED write-up. Moves to FOLLOW_UP_PENDING. */
export async function setFollowUp(writeUpId: number, input: SetFollowUpInput): Promise<void> {
  const existing = await prisma.writeUp.findUnique({ where: { id: writeUpId } })
  if (!existing) throw new WriteUpServiceError('Write-up not found', 404, 'WRITEUP_NOT_FOUND')
  if (existing.status !== 'SIGNED') {
    throw new WriteUpServiceError('Follow-up can only be set on a signed write-up', 422, 'WRITEUP_INVALID_STATE')
  }

  await prisma.writeUp.update({
    where: { id: writeUpId },
    data:  {
      follow_up_required:    true,
      status:                'FOLLOW_UP_PENDING',
      follow_up_date:        input.follow_up_date        ? new Date(input.follow_up_date)        : null,
      follow_up_assigned_to: input.follow_up_assigned_to ? parseInt(String(input.follow_up_assigned_to)) : null,
      follow_up_checklist:   input.follow_up_checklist ?? null,
    },
  })
}

// ── internal helpers ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function assertTransitionGuards(existing: any, input: TransitionStatusInput, viewerRole: string, newStatus: string): void {
  const isManagerLike = viewerRole === 'Manager' || viewerRole === 'Admin'

  if (existing.status === 'AWAITING_SIGNATURE' && newStatus === 'SCHEDULED' && !isManagerLike) {
    throw new WriteUpServiceError('Only managers can recall a document', 403, 'WRITEUP_FORBIDDEN')
  }
  if (existing.status === 'AWAITING_SIGNATURE' && newStatus === 'SIGNATURE_REFUSED') {
    if (!isManagerLike) {
      throw new WriteUpServiceError('Only managers can record a signature refusal', 403, 'WRITEUP_FORBIDDEN')
    }
    if (!input.refusal_reason || !String(input.refusal_reason).trim()) {
      throw new WriteUpServiceError('refusal_reason is required when recording a signature refusal', 400, 'WRITEUP_VALIDATION')
    }
  }
  if (existing.status === 'DRAFT' && newStatus === 'SCHEDULED' && !input.meeting_date && !existing.meeting_date) {
    throw new WriteUpServiceError('meeting_date is required to schedule a write-up', 400, 'WRITEUP_VALIDATION')
  }
  if (existing.status === 'SCHEDULED' && newStatus === 'AWAITING_SIGNATURE') {
    if (!input.meeting_notes) {
      throw new WriteUpServiceError('meeting_notes are required when finalizing a write-up', 400, 'WRITEUP_VALIDATION')
    }
    if (input.follow_up_required === true) {
      if (!input.follow_up_date) {
        throw new WriteUpServiceError('follow_up_date is required when follow-up is required', 400, 'WRITEUP_VALIDATION')
      }
      if (!input.follow_up_assigned_to) {
        throw new WriteUpServiceError('follow_up_assigned_to is required when follow-up is required', 400, 'WRITEUP_VALIDATION')
      }
    }
  }
  if (existing.status === 'FOLLOW_UP_PENDING' && newStatus === 'FOLLOW_UP_COMPLETED' &&
      !input.follow_up_notes && !existing.follow_up_notes) {
    throw new WriteUpServiceError('follow_up_notes are required to complete a follow-up', 400, 'WRITEUP_VALIDATION')
  }
}

function buildTransitionUpdate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  existing: any,
  input: TransitionStatusInput,
  newStatus: string,
  resolvedStatus: string,
): Record<string, unknown> {
  const updateData: Record<string, unknown> = { status: resolvedStatus }
  if (input.meeting_notes)                          updateData.meeting_notes = input.meeting_notes
  if (input.meeting_date)                           updateData.meeting_date  = new Date(input.meeting_date)
  if (input.follow_up_notes)                        updateData.follow_up_notes = input.follow_up_notes
  if (newStatus === 'AWAITING_SIGNATURE')           updateData.delivered_at  = new Date()
  if (newStatus === 'SIGNATURE_REFUSED') {
    updateData.refused_at     = new Date()
    updateData.refusal_reason = String(input.refusal_reason).trim()
  }
  if (resolvedStatus === 'FOLLOW_UP_COMPLETED')     updateData.follow_up_completed_at = new Date()
  if (resolvedStatus === 'CLOSED')                  updateData.closed_at = new Date()

  // Capture the follow-up decision when finalising the meeting so the agent
  // signing flow can route directly into FOLLOW_UP_PENDING without a second
  // manager step.
  if (existing.status === 'SCHEDULED' && newStatus === 'AWAITING_SIGNATURE' && input.follow_up_required !== undefined) {
    if (input.follow_up_required === true) {
      updateData.follow_up_required    = true
      updateData.follow_up_date        = input.follow_up_date ? new Date(input.follow_up_date) : null
      updateData.follow_up_assigned_to = input.follow_up_assigned_to ? parseInt(String(input.follow_up_assigned_to)) : null
      updateData.follow_up_checklist   = input.follow_up_checklist ?? null
    } else {
      updateData.follow_up_required    = false
      updateData.follow_up_date        = null
      updateData.follow_up_assigned_to = null
      updateData.follow_up_checklist   = null
    }
  }

  return updateData
}
