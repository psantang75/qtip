import { Request, Response } from 'express'
import prisma from '../config/prisma'
import { Prisma } from '../generated/prisma/client'

interface AuthReq extends Request {
  user?: { user_id: number; role: string }
}

interface IncidentInput {
  incident_date: string
  description: string
  sort_order?: number
  violations?: ViolationInput[]
}

interface ViolationInput {
  policy_violated: string
  reference_material?: string
  sort_order?: number
  examples?: ExampleInput[]
}

interface ExampleInput {
  example_date?: string
  description: string
  source?: string
  qa_submission_id?: number
  qa_question_id?: number
  sort_order?: number
}

const canSeeAll = (role: string) => ['Admin', 'QA', 'Manager'].includes(role)

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT:               ['SCHEDULED'],
  SCHEDULED:           ['DELIVERED'],
  DELIVERED:           ['AWAITING_SIGNATURE'],
  AWAITING_SIGNATURE:  ['DELIVERED', 'SIGNED'],
  SIGNED:              ['CLOSED', 'FOLLOW_UP_PENDING'],
  FOLLOW_UP_PENDING:   ['CLOSED'],
}

// ── Shared helper: insert nested incidents → violations → examples ────────────

async function insertIncidents(
  tx: Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
  writeUpId: number,
  incidents: IncidentInput[]
) {
  for (const inc of incidents) {
    const incident = await tx.writeUpIncident.create({
      data: {
        write_up_id: writeUpId,
        incident_date: new Date(inc.incident_date),
        description: inc.description,
        sort_order: inc.sort_order ?? 0,
      },
    })
    for (const viol of (inc.violations ?? [])) {
      const violation = await tx.writeUpViolation.create({
        data: {
          incident_id: incident.id,
          policy_violated: viol.policy_violated,
          reference_material: viol.reference_material ?? null,
          sort_order: viol.sort_order ?? 0,
        },
      })
      for (const ex of (viol.examples ?? [])) {
        await tx.writeUpExample.create({
          data: {
            violation_id: violation.id,
            example_date: ex.example_date ? new Date(ex.example_date) : null,
            description: ex.description,
            source: (ex.source as any) ?? 'MANUAL',
            qa_submission_id: ex.qa_submission_id ?? null,
            qa_question_id: ex.qa_question_id ?? null,
            sort_order: ex.sort_order ?? 0,
          },
        })
      }
    }
  }
}

// ── 1. getWriteUps ────────────────────────────────────────────────────────────

export const getWriteUps = async (req: AuthReq, res: Response) => {
  try {
    const userId = req.user!.user_id
    const role   = req.user!.role
    const page   = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit  = Math.min(100, parseInt(req.query.limit as string) || 20)
    const offset = (page - 1) * limit
    const { csr_id, status, document_type, date_from, date_to, search } = req.query

    const conditions: Prisma.Sql[] = []

    if (!canSeeAll(role)) {
      conditions.push(Prisma.sql`wu.csr_id = ${userId}`)
    } else if (csr_id) {
      conditions.push(Prisma.sql`wu.csr_id = ${parseInt(csr_id as string)}`)
    }

    if (status)        conditions.push(Prisma.sql`wu.status = ${status}`)
    if (document_type) conditions.push(Prisma.sql`wu.document_type = ${document_type}`)
    if (date_from)     conditions.push(Prisma.sql`DATE(wu.created_at) >= ${date_from}`)
    if (date_to)       conditions.push(Prisma.sql`DATE(wu.created_at) <= ${date_to}`)
    if (search)        conditions.push(Prisma.sql`(csr.username LIKE ${'%' + search + '%'} OR creator.username LIKE ${'%' + search + '%'})`)

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
        Prisma.sql`SELECT COUNT(*) as total ${baseJoin} ${whereClause}`
      ),
      prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT wu.id, wu.document_type, wu.status, wu.meeting_date, wu.created_at,
            wu.csr_id, csr.username as csr_name,
            wu.created_by, creator.username as created_by_name,
            (SELECT COUNT(*) FROM write_up_incidents WHERE write_up_id = wu.id) as incident_count
          ${baseJoin}
          ${whereClause}
          ORDER BY wu.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      ),
    ])

    const items = rows.map(r => ({ ...r, incident_count: Number(r.incident_count) }))
    res.json({ success: true, data: { items, total: Number(countRows[0]?.total ?? 0), page, limit } })
  } catch (error) {
    console.error('[WRITEUP] getWriteUps error:', error)
    res.status(500).json({ success: false, message: 'Internal server error' })
  }
}

// ── 2. getWriteUpById ─────────────────────────────────────────────────────────

export const getWriteUpById = async (req: AuthReq, res: Response) => {
  try {
    const userId    = req.user!.user_id
    const role      = req.user!.role
    const writeUpId = parseInt(req.params.id)
    if (isNaN(writeUpId)) return res.status(400).json({ success: false, message: 'Invalid write-up ID' })

    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT wu.*,
        csr.username      as csr_name,
        creator.username  as created_by_name,
        assignee.username as follow_up_assignee_name
      FROM write_ups wu
      JOIN  users csr     ON wu.csr_id             = csr.id
      JOIN  users creator ON wu.created_by          = creator.id
      LEFT JOIN users assignee ON wu.follow_up_assigned_to = assignee.id
      WHERE wu.id = ${writeUpId}
    `)

    if (!rows?.length) return res.status(404).json({ success: false, message: 'Write-up not found' })

    const writeUp = rows[0]
    if (role === 'CSR' && writeUp.csr_id !== userId) {
      return res.status(404).json({ success: false, message: 'Write-up not found' })
    }

    const incidents = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT * FROM write_up_incidents WHERE write_up_id = ${writeUpId} ORDER BY sort_order ASC`
    )
    for (const incident of incidents) {
      const violations = await prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT * FROM write_up_violations WHERE incident_id = ${incident.id} ORDER BY sort_order ASC`
      )
      for (const violation of violations) {
        violation.examples = await prisma.$queryRaw<any[]>(
          Prisma.sql`SELECT * FROM write_up_examples WHERE violation_id = ${violation.id} ORDER BY sort_order ASC`
        )
      }
      incident.violations = violations
    }

    const [priorDiscipline, attachments] = await Promise.all([
      prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM write_up_prior_discipline WHERE write_up_id = ${writeUpId}`),
      prisma.$queryRaw<any[]>(Prisma.sql`SELECT * FROM write_up_attachments WHERE write_up_id = ${writeUpId} ORDER BY created_at ASC`),
    ])

    res.json({
      success: true,
      data: {
        ...writeUp,
        follow_up_required: Boolean(Number(writeUp.follow_up_required)),
        incidents,
        prior_discipline: priorDiscipline,
        attachments,
      },
    })
  } catch (error) {
    console.error('[WRITEUP] getWriteUpById error:', error)
    res.status(500).json({ success: false, message: 'Internal server error' })
  }
}

// ── 3. createWriteUp ──────────────────────────────────────────────────────────

export const createWriteUp = async (req: AuthReq, res: Response) => {
  try {
    const userId = req.user!.user_id
    const { csr_id, document_type, meeting_date, corrective_action, correction_timeline,
            checkin_date, consequence, linked_coaching_id, incidents = [] } = req.body

    if (!csr_id || !document_type) {
      return res.status(400).json({ success: false, message: 'csr_id and document_type are required' })
    }

    const result = await prisma.$transaction(async (tx) => {
      const writeUp = await tx.writeUp.create({
        data: {
          csr_id:             parseInt(csr_id),
          document_type:      document_type as any,
          status:             'DRAFT',
          meeting_date:       meeting_date       ? new Date(meeting_date)       : null,
          corrective_action:  corrective_action  ?? null,
          correction_timeline: correction_timeline ?? null,
          checkin_date:       checkin_date       ? new Date(checkin_date)       : null,
          consequence:        consequence        ?? null,
          linked_coaching_id: linked_coaching_id ? parseInt(linked_coaching_id) : null,
          created_by:         userId,
        },
      })
      await insertIncidents(tx, writeUp.id, incidents as IncidentInput[])
      return writeUp
    })

    res.status(201).json({ success: true, data: { id: result.id } })
  } catch (error) {
    console.error('[WRITEUP] createWriteUp error:', error)
    res.status(500).json({ success: false, message: 'Internal server error' })
  }
}

// ── 4. updateWriteUp ──────────────────────────────────────────────────────────

export const updateWriteUp = async (req: AuthReq, res: Response) => {
  try {
    const userId    = req.user!.user_id
    const role      = req.user!.role
    const writeUpId = parseInt(req.params.id)
    if (isNaN(writeUpId)) return res.status(400).json({ success: false, message: 'Invalid write-up ID' })

    const existing = await prisma.writeUp.findUnique({ where: { id: writeUpId } })
    if (!existing) return res.status(404).json({ success: false, message: 'Write-up not found' })

    if (!['DRAFT', 'SCHEDULED'].includes(existing.status)) {
      return res.status(403).json({ success: false, message: 'Write-up cannot be edited in its current status' })
    }
    if (role !== 'Admin' && existing.created_by !== userId) {
      return res.status(403).json({ success: false, message: 'Not authorized to update this write-up' })
    }

    const { meeting_date, corrective_action, correction_timeline, checkin_date,
            consequence, linked_coaching_id, incidents = [], prior_discipline = [] } = req.body

    await prisma.$transaction(async (tx) => {
      await tx.writeUp.update({
        where: { id: writeUpId },
        data: {
          meeting_date:        meeting_date       ? new Date(meeting_date)       : null,
          corrective_action:   corrective_action  ?? null,
          correction_timeline: correction_timeline ?? null,
          checkin_date:        checkin_date       ? new Date(checkin_date)       : null,
          consequence:         consequence        ?? null,
          linked_coaching_id:  linked_coaching_id ? parseInt(linked_coaching_id) : null,
        },
      })

      await tx.writeUpIncident.deleteMany({ where: { write_up_id: writeUpId } })
      await insertIncidents(tx, writeUpId, incidents as IncidentInput[])

      await tx.writeUpPriorDiscipline.deleteMany({ where: { write_up_id: writeUpId } })
      for (const pd of prior_discipline) {
        await tx.writeUpPriorDiscipline.create({
          data: { write_up_id: writeUpId, reference_type: pd.reference_type, reference_id: parseInt(pd.reference_id) },
        })
      }
    })

    res.json({ success: true })
  } catch (error) {
    console.error('[WRITEUP] updateWriteUp error:', error)
    res.status(500).json({ success: false, message: 'Internal server error' })
  }
}

// ── 5. transitionStatus ───────────────────────────────────────────────────────

export const transitionStatus = async (req: AuthReq, res: Response) => {
  try {
    const userId    = req.user!.user_id
    const role      = req.user!.role
    const writeUpId = parseInt(req.params.id)
    if (isNaN(writeUpId)) return res.status(400).json({ success: false, message: 'Invalid write-up ID' })

    const { status: newStatus, meeting_notes, meeting_date, follow_up_notes } = req.body
    if (!newStatus) return res.status(400).json({ success: false, message: 'status is required' })

    const existing = await prisma.writeUp.findUnique({ where: { id: writeUpId } })
    if (!existing) return res.status(404).json({ success: false, message: 'Write-up not found' })

    const allowed = ALLOWED_TRANSITIONS[existing.status] ?? []
    if (!allowed.includes(newStatus)) {
      return res.status(422).json({ success: false, message: `Cannot transition from ${existing.status} to ${newStatus}` })
    }

    if (existing.status === 'AWAITING_SIGNATURE' && newStatus === 'DELIVERED') {
      if (role !== 'Manager' && role !== 'Admin') {
        return res.status(403).json({ success: false, message: 'Only managers can recall a document' })
      }
    }
    if (existing.status === 'DRAFT' && newStatus === 'SCHEDULED' && !meeting_date && !existing.meeting_date) {
      return res.status(400).json({ success: false, message: 'meeting_date is required to schedule a write-up' })
    }
    if (existing.status === 'SCHEDULED' && newStatus === 'DELIVERED' && !meeting_notes) {
      return res.status(400).json({ success: false, message: 'meeting_notes are required when delivering a write-up' })
    }
    if (existing.status === 'FOLLOW_UP_PENDING' && newStatus === 'CLOSED' && !follow_up_notes && !existing.follow_up_notes) {
      return res.status(400).json({ success: false, message: 'follow_up_notes are required to close a follow-up' })
    }

    const updateData: Record<string, unknown> = { status: newStatus }
    if (meeting_notes)                                          updateData.meeting_notes = meeting_notes
    if (meeting_date)                                           updateData.meeting_date  = new Date(meeting_date)
    if (follow_up_notes)                                        updateData.follow_up_notes = follow_up_notes
    if (newStatus === 'AWAITING_SIGNATURE')                     updateData.delivered_at  = new Date()
    if (newStatus === 'CLOSED')                                 updateData.closed_at     = new Date()

    await prisma.writeUp.update({ where: { id: writeUpId }, data: updateData as any })
    res.json({ success: true, data: { status: newStatus } })
  } catch (error) {
    console.error('[WRITEUP] transitionStatus error:', error)
    res.status(500).json({ success: false, message: 'Internal server error' })
  }
}

// ── 6. signWriteUp ────────────────────────────────────────────────────────────

export const signWriteUp = async (req: AuthReq, res: Response) => {
  try {
    const userId    = req.user!.user_id
    const role      = req.user!.role
    const writeUpId = parseInt(req.params.id)
    if (isNaN(writeUpId)) return res.status(400).json({ success: false, message: 'Invalid write-up ID' })

    if (role !== 'CSR') return res.status(403).json({ success: false, message: 'Only CSRs can sign write-ups' })

    const existing = await prisma.writeUp.findUnique({ where: { id: writeUpId } })
    if (!existing) return res.status(404).json({ success: false, message: 'Write-up not found' })
    if (existing.csr_id !== userId) return res.status(403).json({ success: false, message: 'You can only sign your own write-ups' })
    if (existing.status !== 'AWAITING_SIGNATURE') return res.status(422).json({ success: false, message: 'Write-up is not awaiting signature' })

    const { signature_data } = req.body
    if (!signature_data) return res.status(400).json({ success: false, message: 'signature_data is required' })

    const now = new Date()
    await prisma.writeUp.update({
      where: { id: writeUpId },
      data: { status: 'SIGNED', signature_data, signed_at: now, acknowledged_at: now },
    })

    res.json({ success: true })
  } catch (error) {
    console.error('[WRITEUP] signWriteUp error:', error)
    res.status(500).json({ success: false, message: 'Internal server error' })
  }
}

// ── 7. setFollowUp ────────────────────────────────────────────────────────────

export const setFollowUp = async (req: AuthReq, res: Response) => {
  try {
    const writeUpId = parseInt(req.params.id)
    if (isNaN(writeUpId)) return res.status(400).json({ success: false, message: 'Invalid write-up ID' })

    const existing = await prisma.writeUp.findUnique({ where: { id: writeUpId } })
    if (!existing) return res.status(404).json({ success: false, message: 'Write-up not found' })
    if (existing.status !== 'SIGNED') return res.status(422).json({ success: false, message: 'Follow-up can only be set on a signed write-up' })

    const { follow_up_date, follow_up_assigned_to, follow_up_checklist } = req.body
    await prisma.writeUp.update({
      where: { id: writeUpId },
      data: {
        follow_up_required:   true,
        status:               'FOLLOW_UP_PENDING',
        follow_up_date:       follow_up_date       ? new Date(follow_up_date)               : null,
        follow_up_assigned_to: follow_up_assigned_to ? parseInt(follow_up_assigned_to)      : null,
        follow_up_checklist:  follow_up_checklist  ?? null,
      },
    })

    res.json({ success: true })
  } catch (error) {
    console.error('[WRITEUP] setFollowUp error:', error)
    res.status(500).json({ success: false, message: 'Internal server error' })
  }
}

// ── 8. searchQaRecords ────────────────────────────────────────────────────────

export const searchQaRecords = async (req: AuthReq, res: Response) => {
  try {
    const { csr_id, form_id, date_from, date_to, question_text, failed_only = 'true' } = req.query
    if (!csr_id) return res.status(400).json({ success: false, message: 'csr_id is required' })

    const csrIdInt = parseInt(csr_id as string)

    // Support arrays for OR-based multi-question search
    const rawQuestionIds  = ([] as string[]).concat((req.query.question_id ?? []) as string[]).filter(Boolean)
    const rawAnswerValues = ([] as string[]).concat((req.query.answer_value ?? []) as string[]).filter(Boolean)

    const conditions: Prisma.Sql[] = [
      Prisma.sql`(CAST(csr_meta.value AS UNSIGNED) = ${csrIdInt} OR c.csr_id = ${csrIdInt})`,
    ]

    if (form_id)       conditions.push(Prisma.sql`s.form_id = ${parseInt(form_id as string)}`)
    if (date_from)     conditions.push(Prisma.sql`COALESCE(idate_meta.date_value, DATE(s.submitted_at)) >= ${date_from}`)
    if (date_to)       conditions.push(Prisma.sql`COALESCE(idate_meta.date_value, DATE(s.submitted_at)) <= ${date_to}`)
    if (question_text) conditions.push(Prisma.sql`fq.question_text LIKE ${'%' + question_text + '%'}`)

    if (rawQuestionIds.length > 0) {
      // Build OR conditions — each (question_id, answer_value) pair is one OR branch
      const orConds = rawQuestionIds.map((qid, i) => {
        const ans = rawAnswerValues[i]
        if (ans) return Prisma.sql`(sa.question_id = ${parseInt(qid)} AND LOWER(sa.answer) = LOWER(${ans}))`
        return Prisma.sql`sa.question_id = ${parseInt(qid)}`
      })
      conditions.push(
        orConds.length === 1
          ? orConds[0]
          : Prisma.sql`(${Prisma.join(orConds, ' OR ')})`
      )
    } else if (failed_only === 'true') {
      conditions.push(Prisma.sql`sa.answer IN ('No', 'FAIL', 'no', 'fail', '0', 'false')`)
    }

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`

    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT DISTINCT
        s.id as submission_id,
        s.submitted_at as submission_date,
        COALESCE(idate_meta.date_value, DATE(s.submitted_at)) as interaction_date,
        f.form_name, sa.question_id as matched_question_id, fc.category_name, fq.question_text, sa.answer, sa.notes
      FROM submissions s
      JOIN forms f ON s.form_id = f.id
      JOIN submission_answers sa ON sa.submission_id = s.id
      JOIN form_questions fq ON fq.id = sa.question_id
      LEFT JOIN form_categories fc ON fq.category_id = fc.id
      LEFT JOIN (
        SELECT DISTINCT sm.submission_id, sm.value
        FROM submission_metadata sm
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        WHERE fmf.field_name = 'CSR'
      ) csr_meta ON s.id = csr_meta.submission_id
      LEFT JOIN (
        SELECT sm.submission_id, MIN(sm.date_value) as date_value
        FROM submission_metadata sm
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        WHERE fmf.field_name IN ('Interaction Date', 'Call Date')
        GROUP BY sm.submission_id
      ) idate_meta ON s.id = idate_meta.submission_id
      LEFT JOIN calls c ON s.call_id = c.id
      ${whereClause}
      ORDER BY COALESCE(idate_meta.date_value, DATE(s.submitted_at)) DESC
      LIMIT 100
    `)

    res.json({ success: true, data: rows })
  } catch (error) {
    console.error('[WRITEUP] searchQaRecords error:', error)
    res.status(500).json({ success: false, message: 'Internal server error' })
  }
}

// ── 9. searchCoachingSessions ─────────────────────────────────────────────────

export const searchCoachingSessions = async (req: AuthReq, res: Response) => {
  try {
    const { csr_id, date_from, date_to } = req.query
    if (!csr_id) return res.status(400).json({ success: false, message: 'csr_id is required' })

    const topicNames = ([] as string[]).concat((req.query.topic_name ?? []) as string[]).filter(Boolean)

    const conditions: Prisma.Sql[] = [Prisma.sql`cs.csr_id = ${parseInt(csr_id as string)}`]

    if (date_from) conditions.push(Prisma.sql`DATE(cs.session_date) >= ${date_from}`)
    if (date_to)   conditions.push(Prisma.sql`DATE(cs.session_date) <= ${date_to}`)
    if (topicNames.length > 0) {
      const orConds = topicNames.map(n => Prisma.sql`t.topic_name LIKE ${'%' + n + '%'}`)
      conditions.push(
        orConds.length === 1
          ? orConds[0]
          : Prisma.sql`(${Prisma.join(orConds, ' OR ')})`
      )
    }

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`

    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT cs.id as session_id, cs.session_date, cs.coaching_purpose, cs.status, cs.notes,
        GROUP_CONCAT(DISTINCT t.topic_name ORDER BY t.topic_name SEPARATOR ', ') as topic_names
      FROM coaching_sessions cs
      LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
      LEFT JOIN topics t ON cst.topic_id = t.id
      ${whereClause}
      GROUP BY cs.id
      ORDER BY cs.session_date DESC
      LIMIT 50
    `)

    const data = rows.map(r => ({ ...r, topic_names: r.topic_names ? r.topic_names.split(', ') : [] }))
    res.json({ success: true, data })
  } catch (error) {
    console.error('[WRITEUP] searchCoachingSessions error:', error)
    res.status(500).json({ success: false, message: 'Internal server error' })
  }
}

// ── 10. getPriorDiscipline ────────────────────────────────────────────────────

export const getPriorDiscipline = async (req: AuthReq, res: Response) => {
  try {
    const csrId = parseInt(req.params.csrId)
    if (isNaN(csrId)) return res.status(400).json({ success: false, message: 'Invalid CSR ID' })

    const [writeUpsRaw, coachingRaw] = await Promise.all([
      prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT wu.id, wu.document_type, wu.status, wu.meeting_date, wu.created_at,
          GROUP_CONCAT(DISTINCT wuv.policy_violated ORDER BY wuv.policy_violated SEPARATOR ', ') as policies_violated
        FROM write_ups wu
        LEFT JOIN write_up_incidents wui ON wu.id = wui.write_up_id
        LEFT JOIN write_up_violations wuv ON wui.id = wuv.incident_id
        WHERE wu.csr_id = ${csrId} AND wu.status != 'DRAFT'
        GROUP BY wu.id
        ORDER BY wu.created_at DESC
      `),
      prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT cs.id, cs.session_date, cs.coaching_purpose, cs.status,
          SUBSTRING(cs.notes, 1, 100) as notes,
          GROUP_CONCAT(DISTINCT t.topic_name ORDER BY t.topic_name SEPARATOR ', ') as topic_names
        FROM coaching_sessions cs
        LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
        LEFT JOIN topics t ON cst.topic_id = t.id
        WHERE cs.csr_id = ${csrId}
        GROUP BY cs.id
        ORDER BY cs.session_date DESC
      `),
    ])

    const writeUps = writeUpsRaw.map(r => ({
      ...r,
      policies_violated: r.policies_violated ? r.policies_violated.split(', ') : [],
    }))
    const coachingSessions = coachingRaw.map(r => ({
      ...r,
      topic_names: r.topic_names ? r.topic_names.split(', ') : [],
    }))

    res.json({ success: true, data: { write_ups: writeUps, coaching_sessions: coachingSessions } })
  } catch (error) {
    console.error('[WRITEUP] getPriorDiscipline error:', error)
    res.status(500).json({ success: false, message: 'Internal server error' })
  }
}

// ── 11. createLinkedCoachingSession ───────────────────────────────────────────

export const createLinkedCoachingSession = async (req: AuthReq, res: Response) => {
  try {
    const { csr_id, session_date, coaching_purpose, coaching_format, notes } = req.body
    if (!csr_id || !session_date) {
      return res.status(400).json({ success: false, message: 'csr_id and session_date are required' })
    }

    const purpose   = (['WEEKLY', 'PERFORMANCE', 'ONBOARDING'].includes(coaching_purpose) ? coaching_purpose : 'PERFORMANCE') as string
    const format    = (['ONE_ON_ONE', 'SIDE_BY_SIDE', 'TEAM_SESSION'].includes(coaching_format) ? coaching_format : 'ONE_ON_ONE') as string
    const createdBy = req.user?.user_id ?? null

    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO coaching_sessions
        (csr_id, session_date, coaching_purpose, coaching_format, notes, status, source_type, created_by)
      VALUES
        (${parseInt(csr_id)}, ${session_date}, ${purpose}, ${format}, ${notes || null}, 'SCHEDULED', 'OTHER', ${createdBy})
    `)

    const [row] = await prisma.$queryRaw<[{ id: bigint }]>(Prisma.sql`SELECT LAST_INSERT_ID() as id`)
    const sessionId = Number(row.id)

    const purposeLabels: Record<string, string> = {
      WEEKLY: 'Weekly Coaching',
      PERFORMANCE: 'Performance Coaching',
      ONBOARDING: 'Onboarding Coaching',
    }
    const label = `${purposeLabels[purpose] ?? 'Coaching'} — ${String(session_date).slice(0, 10)}`

    res.json({ success: true, data: { id: sessionId, label } })
  } catch (error) {
    console.error('[WRITEUP] createLinkedCoachingSession error:', error)
    res.status(500).json({ success: false, message: 'Internal server error' })
  }
}
