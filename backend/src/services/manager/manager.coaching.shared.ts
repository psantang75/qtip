/**
 * Validation + lookup helpers shared by the coaching create / update flows.
 *
 * Centralised here because the legacy controller had three near-identical
 * copies of every check, all subtly different in their error envelopes.
 */
import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { getCsrRoleId } from './manager.access'
import {
  ManagerServiceError,
  VALID_COACHING_TYPES,
  type CoachingType,
} from './manager.types'

/**
 * Coerces multipart-friendly `topic_ids` payloads into a clean array of
 * positive integers. Accepts an already-array body, a comma-separated string
 * (multipart/form-data), or a single value.
 */
export function normalizeTopicIds(input: unknown): number[] {
  if (input === undefined || input === null) return []

  let values: unknown[]
  if (typeof input === 'string') {
    values = input.split(',').map((id) => id.trim()).filter((id) => id !== '')
  } else if (Array.isArray(input)) {
    values = input
  } else {
    values = [input]
  }

  return values
    .map((id) => parseInt(String(id), 10))
    .filter((id): id is number => !Number.isNaN(id) && id > 0)
}

/**
 * Verifies that every supplied topic id maps to an active
 * `list_items.list_type = 'training_topic'` row.
 *
 * @returns Filtered list of topic ids that are still active. Throws if the
 *          input would result in an empty selection.
 */
export async function validateTopicIds(
  topicIds: number[],
  { atLeastOne }: { atLeastOne: boolean },
): Promise<number[]> {
  if (atLeastOne && topicIds.length === 0) {
    throw new ManagerServiceError(
      'At least one topic is required',
      400,
      'TOPICS_REQUIRED',
    )
  }
  if (topicIds.length === 0) return []

  const validInputs = topicIds.filter((id) => Number.isInteger(id) && id > 0)
  if (validInputs.length !== topicIds.length) {
    throw new ManagerServiceError(
      'All topic IDs must be valid positive integers',
      400,
      'INVALID_TOPICS',
    )
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
    `SELECT id FROM list_items
     WHERE id IN (${validInputs.map(() => '?').join(',')})
       AND is_active = 1
       AND list_type = 'training_topic'`,
    ...validInputs,
  )

  if (rows.length === 0 || rows.length !== validInputs.length) {
    throw new ManagerServiceError(
      'One or more topic IDs are invalid or inactive',
      400,
      'TOPICS_INACTIVE',
    )
  }

  return rows.map((r) => r.id)
}

export function assertValidCoachingType(value: string | undefined): asserts value is CoachingType {
  if (!value || !(VALID_COACHING_TYPES as readonly string[]).includes(value)) {
    throw new ManagerServiceError('Invalid coaching type', 400, 'INVALID_COACHING_TYPE')
  }
}

export function assertValidStatus(value: string | undefined): void {
  if (value && !['SCHEDULED', 'COMPLETED'].includes(value)) {
    throw new ManagerServiceError(
      'Invalid status. Must be SCHEDULED or COMPLETED',
      400,
      'INVALID_STATUS',
    )
  }
}

export function assertNotesLength(value: string | undefined): void {
  if (value && value.length > 2000) {
    throw new ManagerServiceError(
      'Notes cannot exceed 2000 characters',
      400,
      'NOTES_TOO_LONG',
    )
  }
}

/**
 * Verifies that the manager (when role === 'Manager') has authority to coach
 * the supplied CSR. Non-Manager roles bypass the department check but still
 * require the CSR to be active.
 */
export async function assertCanCoachCsr(
  managerId: number,
  userRole: string | undefined,
  csrId: number,
): Promise<void> {
  const csrRoleId = await getCsrRoleId()

  let rows: Array<{ id: number }>
  if (userRole === 'Manager') {
    rows = await prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT u.id
      FROM users u
      JOIN departments d ON u.department_id = d.id
      JOIN department_managers dm ON d.id = dm.department_id
      WHERE u.id = ${csrId}
        AND u.role_id = ${csrRoleId}
        AND u.is_active = 1
        AND d.is_active = 1
        AND dm.manager_id = ${managerId}
        AND dm.is_active = 1
    `)
  } else {
    rows = await prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT u.id
      FROM users u
      JOIN departments d ON u.department_id = d.id
      WHERE u.id = ${csrId}
        AND u.role_id = ${csrRoleId}
        AND u.is_active = 1
        AND d.is_active = 1
    `)
  }

  if (rows.length === 0) {
    throw new ManagerServiceError(
      'CSR not found, inactive, or you do not have permission to coach this CSR',
      403,
      'NO_CSR_ACCESS',
    )
  }
}

/** Re-fetches a coaching session in the canonical "list row" shape used by responses. */
export async function fetchSessionRow(sessionId: number): Promise<Record<string, unknown>> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT
      cs.id, cs.csr_id, u.username as csr_name,
      cs.session_date, cs.coaching_type, cs.notes, cs.status,
      cs.attachment_filename, cs.attachment_path, cs.attachment_size,
      cs.attachment_mime_type, cs.created_at,
      creator.username as created_by_name,
      GROUP_CONCAT(li_t.label ORDER BY li_t.label SEPARATOR ', ') as topics,
      GROUP_CONCAT(li_t.id ORDER BY li_t.id SEPARATOR ',') as topic_ids
    FROM coaching_sessions cs
    JOIN users u ON cs.csr_id = u.id
    LEFT JOIN users creator ON cs.created_by = creator.id
    LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
    LEFT JOIN list_items li_t ON cst.topic_id = li_t.id
    WHERE cs.id = ${sessionId}
    GROUP BY cs.id
  `)
  return rows[0] ?? {}
}
