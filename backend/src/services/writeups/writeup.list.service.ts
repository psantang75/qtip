/**
 * Writeup read paths: list, detail, prior-discipline lookup.
 *
 * Owns every `Prisma.sql` raw query the read endpoints need so the
 * controllers stay transport-only. Extracted from the old
 * `controllers/writeup.controller.ts` during the pre-production review
 * (item #29).
 *
 * Visibility rules:
 *   - Admin / QA / Manager: see everyone, can filter by `csr_id`.
 *   - Everyone else (CSR): scoped to their own non-DRAFT records.
 *     Detail returns 404 when the row exists but belongs to another CSR
 *     or is still in DRAFT — same envelope as a missing row, no info leak.
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { canSeeAll, isVisibleToCsr } from './writeup.permissions'
import { shapePriorDiscipline, splitSep } from './writeup.helpers'
import { WriteUpServiceError } from './writeup.types'

export interface ListWriteUpsParams {
  viewerId: number
  viewerRole: string
  page: number
  limit: number
  csrId?: number
  status?: string
  documentType?: string
  dateFrom?: string
  dateTo?: string
  search?: string
}

export interface ListWriteUpsResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items: any[]
  total: number
  page: number
  limit: number
  totalPages: number
}

/**
 * Paginated write-up list. Caller controls page / limit; the SQL applies
 * role-based visibility plus the optional filters surfaced by the UI.
 */
export async function listWriteUps(params: ListWriteUpsParams): Promise<ListWriteUpsResult> {
  const { viewerId, viewerRole, page, limit, csrId, status, documentType, dateFrom, dateTo, search } = params
  const offset = (page - 1) * limit

  const conditions: Prisma.Sql[] = []

  if (!canSeeAll(viewerRole)) {
    conditions.push(Prisma.sql`wu.csr_id = ${viewerId}`)
    conditions.push(Prisma.sql`wu.status != 'DRAFT'`)
  } else if (csrId) {
    conditions.push(Prisma.sql`wu.csr_id = ${csrId}`)
  }

  if (status)       conditions.push(Prisma.sql`wu.status = ${status}`)
  if (documentType) conditions.push(Prisma.sql`wu.document_type = ${documentType}`)
  if (dateFrom)     conditions.push(Prisma.sql`DATE(wu.meeting_date) >= ${dateFrom}`)
  if (dateTo)       conditions.push(Prisma.sql`DATE(wu.meeting_date) <= ${dateTo}`)
  if (search)       conditions.push(Prisma.sql`(csr.username LIKE ${'%' + search + '%'} OR creator.username LIKE ${'%' + search + '%'})`)

  const whereClause = conditions.length
    ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
    : Prisma.sql``

  const baseJoin = Prisma.sql`
    FROM write_ups wu
    JOIN users csr     ON wu.csr_id     = csr.id
    JOIN users creator ON wu.created_by = creator.id
  `

  const [countRows, rows] = await Promise.all([
    prisma.$queryRaw<{ total: bigint }[]>(
      Prisma.sql`SELECT COUNT(*) as total ${baseJoin} ${whereClause}`,
    ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT wu.id, wu.document_type, wu.status, wu.meeting_date, wu.created_at,
          wu.follow_up_required, wu.follow_up_date, wu.follow_up_completed_at,
          wu.csr_id, csr.username as csr_name,
          wu.created_by, creator.username as created_by_name,
          (SELECT COUNT(*) FROM write_up_incidents WHERE write_up_id = wu.id) as incident_count
        ${baseJoin}
        ${whereClause}
        ORDER BY wu.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
    ),
  ])

  const total = Number(countRows[0]?.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const items = rows.map(r => ({ ...r, incident_count: Number(r.incident_count) }))

  return { items, total, page, limit, totalPages }
}

/**
 * Detail view: write-up row + nested incidents/violations/examples + prior
 * discipline + linked coaching session + attachments + management-only
 * list-item categories. CSR viewers receive a 404 when the row is not
 * theirs or is still DRAFT.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getWriteUpDetail(writeUpId: number, viewerId: number, viewerRole: string): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT wu.*,
      csr.username       as csr_name,
      creator.username   as created_by_name,
      mgr.username       as manager_name,
      hrw.username       as hr_witness_name,
      assignee.username  as follow_up_assignee_name
    FROM write_ups wu
    JOIN  users csr      ON wu.csr_id               = csr.id
    JOIN  users creator  ON wu.created_by            = creator.id
    LEFT JOIN users mgr      ON wu.manager_id        = mgr.id
    LEFT JOIN users hrw      ON wu.hr_witness_id     = hrw.id
    LEFT JOIN users assignee ON wu.follow_up_assigned_to = assignee.id
    WHERE wu.id = ${writeUpId}
  `)

  if (!rows?.length) {
    throw new WriteUpServiceError('Write-up not found', 404, 'WRITEUP_NOT_FOUND')
  }

  const writeUp = rows[0]
  if (viewerRole === 'CSR' && !isVisibleToCsr(writeUp.csr_id, writeUp.status, viewerId)) {
    throw new WriteUpServiceError('Write-up not found', 404, 'WRITEUP_NOT_FOUND')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const incidents = await prisma.$queryRaw<any[]>(
    Prisma.sql`SELECT * FROM write_up_incidents WHERE write_up_id = ${writeUpId} ORDER BY sort_order ASC`,
  )
  for (const incident of incidents) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const violations = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT * FROM write_up_violations WHERE incident_id = ${incident.id} ORDER BY sort_order ASC`,
    )
    for (const violation of violations) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      violation.examples = await prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT * FROM write_up_examples WHERE violation_id = ${violation.id} ORDER BY sort_order ASC`,
      )
    }
    incident.violations = violations
  }

  const linkedCoachingRaw = writeUp.linked_coaching_id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT cs.id, cs.coaching_purpose, cs.status, cs.session_date,
          SUBSTRING(cs.notes, 1, 500) as notes,
          GROUP_CONCAT(DISTINCT li_t.label ORDER BY li_t.label SEPARATOR '~|~') as topic_names
        FROM coaching_sessions cs
        LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
        LEFT JOIN list_items li_t ON cst.topic_id = li_t.id
        WHERE cs.id = ${writeUp.linked_coaching_id}
        GROUP BY cs.id
      `)
    : []

  const linkedCoachingSession = linkedCoachingRaw.length ? {
    id:               Number(linkedCoachingRaw[0].id),
    coaching_purpose: linkedCoachingRaw[0].coaching_purpose,
    status:           linkedCoachingRaw[0].status,
    date:             linkedCoachingRaw[0].session_date,
    notes:            linkedCoachingRaw[0].notes,
    topic_names:      splitSep(linkedCoachingRaw[0].topic_names),
  } : null

  const [priorDisciplineRaw, attachments, behaviorFlagItems, rootCauseItems, supportNeededItems] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT pd.reference_type, pd.reference_id,
        wu.document_type, wu.status as wu_status, wu.meeting_date,
        cs.coaching_purpose, cs.status as cs_status, cs.session_date,
        SUBSTRING(cs.notes, 1, 500) as cs_notes,
        GROUP_CONCAT(DISTINCT wuv.policy_violated ORDER BY wuv.policy_violated SEPARATOR '~|~') as policies_violated,
        GROUP_CONCAT(DISTINCT SUBSTRING(wui.description, 1, 200) SEPARATOR '~|~') as incident_descriptions,
        GROUP_CONCAT(DISTINCT li_t.label ORDER BY li_t.label SEPARATOR '~|~') as topic_names
      FROM write_up_prior_discipline pd
      LEFT JOIN write_ups wu            ON pd.reference_type = 'write_up' AND pd.reference_id = wu.id
      LEFT JOIN write_up_incidents wui  ON wu.id = wui.write_up_id
      LEFT JOIN write_up_violations wuv ON wui.id = wuv.incident_id
      LEFT JOIN coaching_sessions cs    ON pd.reference_type = 'coaching_session' AND pd.reference_id = cs.id
      LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
      LEFT JOIN list_items li_t         ON cst.topic_id = li_t.id
      WHERE pd.write_up_id = ${writeUpId}
      GROUP BY pd.reference_type, pd.reference_id
      ORDER BY MIN(pd.id) ASC
    `),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM write_up_attachments WHERE write_up_id = ${writeUpId} ORDER BY created_at ASC`),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT li.id, li.category, li.label, li.sort_order
      FROM write_up_list_items wuli
      JOIN list_items li ON wuli.list_item_id = li.id
      WHERE wuli.write_up_id = ${writeUpId} AND li.list_type = 'behavior_flag'
      ORDER BY li.sort_order ASC
    `),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT li.id, li.category, li.label, li.sort_order
      FROM write_up_list_items wuli
      JOIN list_items li ON wuli.list_item_id = li.id
      WHERE wuli.write_up_id = ${writeUpId} AND li.list_type = 'root_cause'
      ORDER BY li.sort_order ASC
    `),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT li.id, li.category, li.label, li.sort_order
      FROM write_up_list_items wuli
      JOIN list_items li ON wuli.list_item_id = li.id
      WHERE wuli.write_up_id = ${writeUpId} AND li.list_type = 'support_needed'
      ORDER BY li.sort_order ASC
    `),
  ])

  const priorDiscipline = shapePriorDiscipline(priorDisciplineRaw)
  const isAgent = viewerRole === 'CSR'

  return {
    ...writeUp,
    internal_notes:       isAgent ? null : (writeUp.internal_notes ?? null),
    behavior_flag_items:  isAgent ? [] : behaviorFlagItems.map(r => ({ ...r, id: Number(r.id) })),
    root_cause_items:     isAgent ? [] : rootCauseItems.map(r => ({ ...r, id: Number(r.id) })),
    support_needed_items: isAgent ? [] : supportNeededItems.map(r => ({ ...r, id: Number(r.id) })),
    behavior_flag_ids:    isAgent ? [] : behaviorFlagItems.map(r => Number(r.id)),
    root_cause_ids:       isAgent ? [] : rootCauseItems.map(r => Number(r.id)),
    support_needed_ids:   isAgent ? [] : supportNeededItems.map(r => Number(r.id)),
    follow_up_required:   Boolean(Number(writeUp.follow_up_required)),
    incidents,
    prior_discipline:        priorDiscipline,
    linked_coaching_session: linkedCoachingSession,
    attachments,
  }
}

/**
 * Standalone prior-discipline lookup for a CSR — used when starting a new
 * write-up to populate the "prior discipline" picker. Returns both completed
 * write-ups (status != DRAFT) and every coaching session.
 */
export async function getPriorDiscipline(csrId: number): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  write_ups: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  coaching_sessions: any[]
}> {
  const [writeUpsRaw, coachingRaw] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT wu.id, wu.document_type, wu.status, wu.meeting_date, wu.created_at,
        GROUP_CONCAT(DISTINCT wuv.policy_violated ORDER BY wuv.policy_violated SEPARATOR '~|~') as policies_violated,
        GROUP_CONCAT(DISTINCT SUBSTRING(wui.description, 1, 200) SEPARATOR '~|~') as incident_descriptions
      FROM write_ups wu
      LEFT JOIN write_up_incidents wui ON wu.id = wui.write_up_id
      LEFT JOIN write_up_violations wuv ON wui.id = wuv.incident_id
      WHERE wu.csr_id = ${csrId} AND wu.status != 'DRAFT'
      GROUP BY wu.id
      ORDER BY wu.created_at DESC
    `),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT cs.id, cs.session_date, cs.coaching_purpose, cs.status,
        SUBSTRING(cs.notes, 1, 500) as notes,
        GROUP_CONCAT(DISTINCT li_t.label ORDER BY li_t.label SEPARATOR '~|~') as topic_names
      FROM coaching_sessions cs
      LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
      LEFT JOIN list_items li_t ON cst.topic_id = li_t.id
      WHERE cs.csr_id = ${csrId}
      GROUP BY cs.id
      ORDER BY cs.session_date DESC
    `),
  ])

  return {
    write_ups: writeUpsRaw.map(r => ({
      ...r,
      policies_violated:     splitSep(r.policies_violated),
      incident_descriptions: splitSep(r.incident_descriptions),
    })),
    coaching_sessions: coachingRaw.map(r => ({
      ...r,
      topic_names: splitSep(r.topic_names),
    })),
  }
}
