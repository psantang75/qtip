import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import { hasCsrRequirements, applyAutoAdvance } from '../utils/coachingAutoAdvance';
import { buildCoachingSessionScope } from '../services/coachingSessionsReport';
import { formatFilename as escapeFilename } from '../utils/contentDisposition';
import logger from '../config/logger';
const fs = require('fs').promises;
const path = require('path');
const { createReadStream } = require('fs');

/**
 * Live coaching session controller — list, detail, lifecycle (create / deliver
 * / complete / close / follow-up / status), and attachment download.
 *
 * Visibility rules: every query goes through {@link buildCoachingSessionScope}
 * (re-exported here as `roleCondition`) which is shared with
 * `controllers/coachingReport.controller.ts` and
 * `services/coachingSessionsReport.ts`. The shared filter+scope+xlsx layout
 * lives in `services/coachingSessionsReport.ts`; bug-fixes / new filter knobs
 * land there so the live UI, the aggregates report, and the on-demand exports
 * stay aligned (see pre-production review item #21).
 */

interface AuthReq extends Request {
  user?: { user_id: number; role: string };
}

interface SessionRow {
  [key: string]: unknown;
  topics?: string | null;
  topic_ids?: string | null;
  is_overdue?: unknown;
  quiz_count?: unknown;
  quiz_passed_count?: unknown;
}

interface QuizRow {
  id: number;
  [key: string]: unknown;
}

interface QuestionRow {
  id: number;
  question_text: string;
  options: string;
  correct_option: number;
}

interface BehaviorFlagRow {
  id: number;
  [key: string]: unknown;
}

interface RecentSessionRow {
  [key: string]: unknown;
  topics?: string | null;
}

// Local `escapeFilename` removed during pre-production review (item #26).
// The previous copy here was actually the *unsafe* variant — it skipped the
// RFC 5987 fallback so any filename containing a space or non-ASCII character
// produced an invalid Content-Disposition header. The canonical implementation
// in `utils/contentDisposition.formatFilename` handles RFC 5987 correctly.

/**
 * @deprecated Local alias kept only so the dozens of call sites below don't
 * have to change. The implementation now lives in
 * `services/coachingSessionsReport.ts` as `buildCoachingSessionScope`.
 */
const roleCondition = buildCoachingSessionScope;

export const getCoachingSessions = async (req: AuthReq, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const role = req.user!.role;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(5000, parseInt(req.query.limit as string) || 20);
    const offset = (page - 1) * limit;
    const { csr_id, status, coaching_purpose, coaching_format, topic_ids, date_from, date_to, overdue_only, due_today } = req.query;

    const conditions: Prisma.Sql[] = [Prisma.sql`u.is_active = 1`, roleCondition(role, userId)];

    if (csr_id)          conditions.push(Prisma.sql`cs.csr_id = ${parseInt(csr_id as string)}`);
    if (status)          conditions.push(Prisma.sql`cs.status = ${status}`);
    if (coaching_purpose) conditions.push(Prisma.sql`cs.coaching_purpose = ${coaching_purpose}`);
    if (coaching_format)  conditions.push(Prisma.sql`cs.coaching_format = ${coaching_format}`);
    if (date_from) conditions.push(Prisma.sql`DATE(cs.session_date) >= ${date_from}`);
    if (date_to) conditions.push(Prisma.sql`DATE(cs.session_date) <= ${date_to}`);
    if (overdue_only === 'true') {
      conditions.push(Prisma.sql`(
        (cs.due_date IS NOT NULL AND DATE(cs.due_date) < CURDATE() AND cs.status NOT IN ('COMPLETED','CLOSED','CANCELED'))
        OR (cs.follow_up_date IS NOT NULL AND DATE(cs.follow_up_date) < CURDATE() AND cs.status = 'FOLLOW_UP_REQUIRED')
      )`);
    }
    if (due_today === 'true') {
      conditions.push(Prisma.sql`(
        DATE(cs.session_date) = CURDATE()
        OR (cs.due_date IS NOT NULL AND DATE(cs.due_date) = CURDATE())
        OR (cs.follow_up_date IS NOT NULL AND DATE(cs.follow_up_date) = CURDATE())
      )`);
    }
    if (topic_ids) {
      const ids = (topic_ids as string).split(',').map(Number).filter(Boolean);
      if (ids.length) conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM coaching_session_topics x WHERE x.coaching_session_id = cs.id AND x.topic_id IN (${Prisma.join(ids)}))`);
    }

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const [countRows, sessions] = await Promise.all([
      prisma.$queryRaw<{ total: bigint }[]>(
        Prisma.sql`SELECT COUNT(DISTINCT cs.id) as total FROM coaching_sessions cs JOIN users u ON cs.csr_id = u.id ${whereClause}`
      ),
      prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT cs.id, cs.batch_id, cs.csr_id, u.username as csr_name, cs.coaching_purpose, cs.coaching_format, cs.source_type,
            cs.status, cs.session_date, cs.due_date, cs.follow_up_date, cs.follow_up_required,
            cs.notes, cs.created_at, cb.username as created_by_name, cs.attachment_filename,
            GROUP_CONCAT(DISTINCT li_t.label ORDER BY li_t.label SEPARATOR ',') as topics,
            GROUP_CONCAT(DISTINCT li_t.id ORDER BY li_t.id SEPARATOR ',') as topic_ids,
            CASE WHEN cs.due_date IS NOT NULL AND cs.due_date < NOW() AND cs.status NOT IN ('COMPLETED','CLOSED') THEN 1 ELSE 0 END as is_overdue,
            (SELECT COUNT(*) FROM coaching_session_quizzes WHERE coaching_session_id = cs.id) as quiz_count,
            (SELECT COUNT(DISTINCT csq2.quiz_id) FROM coaching_session_quizzes csq2
             WHERE csq2.coaching_session_id = cs.id
             AND EXISTS (
               SELECT 1 FROM quiz_attempts qa
               WHERE qa.coaching_session_id = cs.id AND qa.quiz_id = csq2.quiz_id
                 AND qa.user_id = cs.csr_id AND qa.passed = 1
             )) as quiz_passed_count
          FROM coaching_sessions cs
          JOIN users u ON cs.csr_id = u.id
          LEFT JOIN users cb ON cs.created_by = cb.id
          LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
          LEFT JOIN list_items li_t ON cst.topic_id = li_t.id
          ${whereClause}
          GROUP BY cs.id ORDER BY cs.session_date DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      ),
    ]);

    const data = sessions.map((s: SessionRow) => ({
      ...s,
      topics: s.topics ? s.topics.split(',') : [],
      topic_ids: s.topic_ids ? s.topic_ids.split(',').map(Number) : [],
      is_overdue: !!s.is_overdue,
      quiz_count: Number(s.quiz_count ?? 0),
      quiz_passed_count: Number(s.quiz_passed_count ?? 0),
    }));

    res.json({ success: true, data: { sessions: data, totalCount: Number(countRows[0]?.total ?? 0), page, limit } });
  } catch (error) {
    logger.error('[COACHING] getCoachingSessions error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getCoachingSessionDetail = async (req: AuthReq, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const role = req.user!.role;
    const sessionId = parseInt(req.params.id);
    if (!sessionId || isNaN(sessionId)) return res.status(400).json({ success: false, message: 'Invalid session ID' });

    const conditions: Prisma.Sql[] = [Prisma.sql`cs.id = ${sessionId}`, Prisma.sql`u.is_active = 1`, roleCondition(role, userId)];
    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const rows = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT cs.*, u.username as csr_name, u.email as csr_email,
          d.department_name as csr_department, cb.username as created_by_name,
          GROUP_CONCAT(DISTINCT li_t.label ORDER BY li_t.label SEPARATOR ',') as topics,
          GROUP_CONCAT(DISTINCT li_t.id ORDER BY li_t.id SEPARATOR ',') as topic_ids
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        LEFT JOIN departments d ON u.department_id = d.id
        LEFT JOIN users cb ON cs.created_by = cb.id
        LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
        LEFT JOIN list_items li_t ON cst.topic_id = li_t.id
        ${whereClause}
        GROUP BY cs.id
      `
    );

    if (!rows?.length) return res.status(404).json({ success: false, message: 'Session not found or access denied' });

    const session = {
      ...rows[0],
      require_acknowledgment: Boolean(Number(rows[0].require_acknowledgment)),
      require_action_plan:    Boolean(Number(rows[0].require_action_plan)),
      follow_up_required:     Boolean(Number(rows[0].follow_up_required)),
      topics:    rows[0].topics    ? rows[0].topics.split(',')            : [],
      topic_ids: rows[0].topic_ids ? rows[0].topic_ids.split(',').map(Number) : [],
    };

    const [behaviorFlagRows, rootCauseRows, supportNeededRows] = await Promise.all([
      prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT li.id, li.category, li.label, li.sort_order
                   FROM coaching_session_behavior_flags cbf
                   JOIN list_items li ON cbf.list_item_id = li.id
                   WHERE cbf.coaching_session_id = ${sessionId} AND li.list_type = 'behavior_flag'
                   ORDER BY li.sort_order ASC`
      ),
      prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT li.id, li.category, li.label, li.sort_order
                   FROM coaching_session_behavior_flags cbf
                   JOIN list_items li ON cbf.list_item_id = li.id
                   WHERE cbf.coaching_session_id = ${sessionId} AND li.list_type = 'root_cause'
                   ORDER BY li.sort_order ASC`
      ),
      prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT li.id, li.category, li.label, li.sort_order
                   FROM coaching_session_behavior_flags cbf
                   JOIN list_items li ON cbf.list_item_id = li.id
                   WHERE cbf.coaching_session_id = ${sessionId} AND li.list_type = 'support_needed'
                   ORDER BY li.sort_order ASC`
      ),
    ]);

    const [kbRows, quizRows, quizAttempts, recentRows] = await Promise.all([
      prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT r.id, r.title, r.resource_type, r.url, r.file_name, r.description FROM coaching_session_resources csr2
          JOIN training_resources r ON csr2.resource_id = r.id WHERE csr2.coaching_session_id = ${sessionId}`
      ),
      prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT q.id, q.quiz_title, q.pass_score FROM coaching_session_quizzes csq
          JOIN quizzes q ON csq.quiz_id = q.id WHERE csq.coaching_session_id = ${sessionId}`
      ),
      prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT id, quiz_id, attempt_number, score, passed, submitted_at FROM quiz_attempts WHERE coaching_session_id = ${sessionId} ORDER BY quiz_id, attempt_number`
      ),
      prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT cs2.id, cs2.session_date, cs2.coaching_purpose, cs2.coaching_format, cs2.status,
            GROUP_CONCAT(DISTINCT li_t2.label ORDER BY li_t2.label SEPARATOR ',') as topics
          FROM coaching_sessions cs2
          LEFT JOIN coaching_session_topics cst2 ON cs2.id = cst2.coaching_session_id
          LEFT JOIN list_items li_t2 ON cst2.topic_id = li_t2.id
          WHERE cs2.csr_id = ${session.csr_id} AND cs2.id != ${sessionId}
            AND cs2.session_date >= DATE_SUB(CURDATE(), INTERVAL 1 YEAR)
          GROUP BY cs2.id ORDER BY cs2.session_date DESC
        `
      ),
    ]);

    const quizzesWithQuestions = await Promise.all(
      quizRows.map(async (qr: QuizRow) => {
        const questions = await prisma.$queryRaw<any[]>(
          Prisma.sql`SELECT id, question_text, options, correct_option FROM quiz_questions WHERE quiz_id = ${qr.id} ORDER BY id`
        );
        return { ...qr, questions: questions.map((q: QuestionRow) => ({ ...q, options: JSON.parse(q.options || '[]') })) };
      })
    );

    const allPriorSessions = (recentRows || []).map((s: SessionRow) => ({ ...s, topics: s.topics ? s.topics.split(',') : [] }));
    const ninetyDaysAgo = new Date(); ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const ninetyStr = `${ninetyDaysAgo.getFullYear()}-${String(ninetyDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(ninetyDaysAgo.getDate()).padStart(2, '0')}`;
    const recentSessions = allPriorSessions.filter((s: any) => {
      const d = s.session_date instanceof Date ? s.session_date.toISOString().slice(0, 10) : String(s.session_date ?? '').slice(0, 10);
      return d >= ninetyStr;
    });
    const recentTopicsFlat = recentSessions.flatMap((s: any) => s.topics as string[]);
    const repeatTopics = session.topics.filter((t: string) => recentTopicsFlat.includes(t));

    res.json({
      success: true,
      data: {
        ...session,
        kb_resources: kbRows,
        quizzes: quizzesWithQuestions,
        quiz_attempts: quizAttempts,
        recent_sessions: recentSessions,
        prior_year_sessions: allPriorSessions,
        repeat_topics: repeatTopics,
        behavior_flag_items: behaviorFlagRows,
        behavior_flag_ids: behaviorFlagRows.map((r: BehaviorFlagRow) => r.id),
        root_cause_items: rootCauseRows,
        root_cause_ids: rootCauseRows.map((r: BehaviorFlagRow) => r.id),
        support_needed_items: supportNeededRows,
        support_needed_ids: supportNeededRows.map((r: BehaviorFlagRow) => r.id),
      },
    });
  } catch (error) {
    logger.error('[COACHING] getCoachingSessionDetail error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const createCoachingSession = async (req: AuthReq, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const attachment = req.file;
    let { csr_id, csr_ids, session_date, coaching_purpose, coaching_format, source_type, notes, topic_ids,
          required_action, resource_ids, kb_url, quiz_ids,
          require_acknowledgment, require_action_plan, due_date,
          follow_up_required, follow_up_date, coach_id } = req.body;

    if (typeof topic_ids === 'string') topic_ids = topic_ids.split(',').map((x: string) => parseInt(x.trim())).filter(Boolean);
    if (!Array.isArray(topic_ids)) topic_ids = topic_ids ? [parseInt(topic_ids)] : [];

    const { follow_up_notes: follow_up_notes_create, internal_notes: internal_notes_create } = req.body;
    const behavior_flag_ids_create: number[] = req.body.behavior_flag_ids
      ? String(req.body.behavior_flag_ids).split(',').map(Number).filter(Boolean)
      : [];
    const root_cause_ids_create: number[] = req.body.root_cause_ids
      ? String(req.body.root_cause_ids).split(',').map(Number).filter(Boolean)
      : [];
    const support_needed_ids_create: number[] = req.body.support_needed_ids
      ? String(req.body.support_needed_ids).split(',').map(Number).filter(Boolean)
      : [];

    // Support both csr_ids (multi-select) and csr_id (legacy single)
    let csrIdList: number[] = [];
    if (csr_ids) {
      csrIdList = (typeof csr_ids === 'string' ? csr_ids.split(',') : [String(csr_ids)])
        .map(Number).filter(Boolean);
    } else if (csr_id) {
      csrIdList = [parseInt(csr_id)];
    }

    const parsedResourceIds: number[] = typeof resource_ids === 'string'
      ? resource_ids.split(',').map((x: string) => parseInt(x.trim())).filter(Boolean) : [];
    const parsedQuizIds: number[] = typeof quiz_ids === 'string'
      ? quiz_ids.split(',').map((x: string) => parseInt(x.trim())).filter(Boolean) : [];

    if (!csrIdList.length || !session_date || !coaching_purpose || !coaching_format || !source_type) {
      return res.status(400).json({ success: false, message: 'Required: csr_ids, session_date, coaching_purpose, coaching_format, source_type' });
    }
    if (!topic_ids.length) return res.status(400).json({ success: false, message: 'At least one topic is required' });

    const resolvedCoachId = coach_id ? parseInt(coach_id) : userId;
    if (coach_id && parseInt(coach_id) !== userId) {
      const coachCheck = await prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT id FROM users WHERE id = ${resolvedCoachId} AND role_id IN (1, 4, 5) AND is_active = 1`
      );
      if (!coachCheck.length) return res.status(400).json({ success: false, message: 'Invalid or ineligible coach' });
    }

    // Validate all CSRs
    for (const csrId of csrIdList) {
      const csrCheck = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT id FROM users WHERE id = ${csrId} AND role_id = 3 AND is_active = 1`);
      if (!csrCheck.length) return res.status(403).json({ success: false, message: `CSR ${csrId} not found or inactive` });
    }

    const topicCheck = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT id FROM list_items WHERE id IN (${Prisma.join(topic_ids)}) AND is_active = 1 AND list_type = 'training_topic'`);
    if (topicCheck.length !== topic_ids.length) return res.status(400).json({ success: false, message: 'One or more topics are invalid or inactive' });

    let attFilename = null, attPath = null, attSize = null, attMime = null;
    if (attachment) {
      const uploadsDir = path.join(process.cwd(), 'uploads', 'coaching');
      await fs.mkdir(uploadsDir, { recursive: true });
      const filename = `coaching_${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(attachment.originalname)}`;
      await fs.writeFile(path.join(uploadsDir, filename), attachment.buffer);
      attFilename = attachment.originalname; attPath = `uploads/coaching/${filename}`; attSize = attachment.size; attMime = attachment.mimetype;
    }

    // Generate batch_id when creating for multiple CSRs
    const batchId = csrIdList.length > 1 ? randomUUID() : null;

    const createdIds: number[] = [];
    for (const csrId of csrIdList) {
      const newId = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO coaching_sessions
            (batch_id, csr_id, session_date, coaching_purpose, coaching_format, source_type, notes, status, required_action, kb_url,
             require_acknowledgment, require_action_plan, due_date, follow_up_required, follow_up_date, follow_up_notes,
             internal_notes, behavior_flags,
             attachment_filename, attachment_path, attachment_size, attachment_mime_type, created_by)
            VALUES
            (${batchId}, ${csrId}, ${session_date}, ${coaching_purpose}, ${coaching_format}, ${source_type}, ${notes || null}, 'DRAFT',
             ${required_action || null}, ${kb_url || null},
             ${require_acknowledgment === 'false' || require_acknowledgment === false ? 0 : 1},
             ${require_action_plan === 'false' || require_action_plan === false ? 0 : 1},
             ${due_date || null},
             ${follow_up_required === 'true' || follow_up_required === true ? 1 : 0},
             ${follow_up_date || null}, ${follow_up_notes_create || null},
             ${internal_notes_create || null}, NULL,
             ${attFilename}, ${attPath}, ${attSize}, ${attMime}, ${resolvedCoachId})`
        );
        const [{ id }] = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT LAST_INSERT_ID() as id`);
        const sessionId = Number(id);
        for (const topicId of topic_ids) {
          await tx.$executeRaw(Prisma.sql`INSERT INTO coaching_session_topics (coaching_session_id, topic_id) VALUES (${sessionId}, ${topicId})`);
        }
        for (const resourceId of parsedResourceIds) {
          await tx.$executeRaw(Prisma.sql`INSERT IGNORE INTO coaching_session_resources (coaching_session_id, resource_id) VALUES (${sessionId}, ${resourceId})`);
        }
        for (const quizId of parsedQuizIds) {
          await tx.$executeRaw(Prisma.sql`INSERT IGNORE INTO coaching_session_quizzes (coaching_session_id, quiz_id) VALUES (${sessionId}, ${quizId})`);
        }
        for (const flagId of behavior_flag_ids_create) {
          await tx.$executeRaw(Prisma.sql`INSERT IGNORE INTO coaching_session_behavior_flags (coaching_session_id, list_item_id) VALUES (${sessionId}, ${flagId})`);
        }
        for (const rcId of root_cause_ids_create) {
          await tx.$executeRaw(Prisma.sql`INSERT IGNORE INTO coaching_session_behavior_flags (coaching_session_id, list_item_id) VALUES (${sessionId}, ${rcId})`);
        }
        for (const snId of support_needed_ids_create) {
          await tx.$executeRaw(Prisma.sql`INSERT IGNORE INTO coaching_session_behavior_flags (coaching_session_id, list_item_id) VALUES (${sessionId}, ${snId})`);
        }
        await tx.auditLog.create({ data: { user_id: userId, action: 'CREATE', target_id: sessionId, target_type: 'coaching_session', details: JSON.stringify({ csr_id: csrId, coaching_purpose, coaching_format, topic_ids, batch_id: batchId }) } });
        return sessionId;
      });
      createdIds.push(newId);
    }

    if (createdIds.length === 1) {
      res.status(201).json({ success: true, data: { id: createdIds[0] }, message: 'Coaching session created successfully' });
    } else {
      res.status(201).json({ success: true, data: { ids: createdIds, batch_id: batchId, count: createdIds.length }, message: `${createdIds.length} coaching sessions created` });
    }
  } catch (error) {
    logger.error('[COACHING] createCoachingSession error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const updateCoachingSession = async (req: AuthReq, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const role = req.user!.role;
    const sessionId = parseInt(req.params.id);
    const attachment = req.file;

    let { session_date, coaching_purpose, coaching_format, source_type, notes, topic_ids,
          required_action, resource_ids, kb_url, quiz_ids,
          require_acknowledgment, require_action_plan, due_date,
          follow_up_required, follow_up_date, follow_up_notes,
          internal_notes, behavior_flag_ids, root_cause_ids, support_needed_ids,
          coach_id, remove_attachment } = req.body;

    const updateBehaviorFlagIds: number[] | undefined = behavior_flag_ids !== undefined
      ? String(behavior_flag_ids).split(',').map(Number).filter(Boolean)
      : undefined;
    const updateRootCauseIds: number[] | undefined = root_cause_ids !== undefined
      ? String(root_cause_ids).split(',').map(Number).filter(Boolean)
      : undefined;
    const updateSupportNeededIds: number[] | undefined = support_needed_ids !== undefined
      ? String(support_needed_ids).split(',').map(Number).filter(Boolean)
      : undefined;

    if (typeof topic_ids === 'string') topic_ids = topic_ids.split(',').map((x: string) => parseInt(x.trim())).filter(Boolean);

    const updateResourceIds: number[] | undefined = resource_ids !== undefined
      ? (typeof resource_ids === 'string' ? resource_ids.split(',').map((x: string) => parseInt(x.trim())).filter(Boolean) : [])
      : undefined;
    const updateQuizIds: number[] | undefined = quiz_ids !== undefined
      ? (typeof quiz_ids === 'string' ? quiz_ids.split(',').map((x: string) => parseInt(x.trim())).filter(Boolean) : [])
      : undefined;

    const conditions: Prisma.Sql[] = [Prisma.sql`cs.id = ${sessionId}`, Prisma.sql`u.is_active = 1`, roleCondition(role, userId)];
    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const existing = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT cs.id, cs.status FROM coaching_sessions cs JOIN users u ON cs.csr_id = u.id ${whereClause}`);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Session not found or access denied' });
    if (['CLOSED', 'CANCELED'].includes(existing[0].status)) return res.status(400).json({ success: false, message: 'Cannot edit a closed or canceled session' });

    const parts: Prisma.Sql[] = [];
    if (session_date     !== undefined) parts.push(Prisma.sql`session_date = ${session_date}`);
    if (coaching_purpose !== undefined) parts.push(Prisma.sql`coaching_purpose = ${coaching_purpose}`);
    if (coaching_format  !== undefined) parts.push(Prisma.sql`coaching_format = ${coaching_format}`);
    if (source_type      !== undefined) parts.push(Prisma.sql`source_type = ${source_type}`);
    if (notes !== undefined) parts.push(Prisma.sql`notes = ${notes || null}`);
    if (required_action !== undefined) parts.push(Prisma.sql`required_action = ${required_action || null}`);
    if (kb_url !== undefined) parts.push(Prisma.sql`kb_url = ${kb_url || null}`);
    if (require_acknowledgment !== undefined) parts.push(Prisma.sql`require_acknowledgment = ${require_acknowledgment === 'false' || require_acknowledgment === false ? 0 : 1}`);
    if (require_action_plan !== undefined) parts.push(Prisma.sql`require_action_plan = ${require_action_plan === 'false' || require_action_plan === false ? 0 : 1}`);
    if (due_date           !== undefined) parts.push(Prisma.sql`due_date = ${due_date || null}`);
    if (follow_up_required !== undefined) parts.push(Prisma.sql`follow_up_required = ${follow_up_required === 'true' || follow_up_required === true ? 1 : 0}`);
    if (follow_up_date     !== undefined) parts.push(Prisma.sql`follow_up_date = ${follow_up_date || null}`);
    if (follow_up_notes    !== undefined) parts.push(Prisma.sql`follow_up_notes = ${follow_up_notes || null}`);
    if (internal_notes     !== undefined) parts.push(Prisma.sql`internal_notes = ${internal_notes || null}`);
    // behavior_flags legacy column — no longer written; use junction table below

    if (attachment) {
      const uploadsDir = path.join(process.cwd(), 'uploads', 'coaching');
      await fs.mkdir(uploadsDir, { recursive: true });
      const filename = `coaching_${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(attachment.originalname)}`;
      await fs.writeFile(path.join(uploadsDir, filename), attachment.buffer);
      parts.push(Prisma.sql`attachment_filename = ${attachment.originalname}`);
      parts.push(Prisma.sql`attachment_path = ${'uploads/coaching/' + filename}`);
      parts.push(Prisma.sql`attachment_size = ${attachment.size}`);
      parts.push(Prisma.sql`attachment_mime_type = ${attachment.mimetype}`);
    } else if (remove_attachment === 'true') {
      const oldRows = await prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT attachment_path FROM coaching_sessions WHERE id = ${sessionId}`
      );
      if (oldRows[0]?.attachment_path) {
        const oldPath = path.join(process.cwd(), oldRows[0].attachment_path);
        try { await fs.unlink(oldPath); } catch { /* file may already be gone */ }
      }
      parts.push(Prisma.sql`attachment_filename = NULL`);
      parts.push(Prisma.sql`attachment_path = NULL`);
      parts.push(Prisma.sql`attachment_size = NULL`);
      parts.push(Prisma.sql`attachment_mime_type = NULL`);
    }

    if (coach_id !== undefined) {
      const newCoachId = parseInt(coach_id);
      const coachCheck = await prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT id FROM users WHERE id = ${newCoachId} AND role_id IN (1, 4, 5) AND is_active = 1`
      );
      if (!coachCheck.length) return res.status(400).json({ success: false, message: 'Invalid or ineligible coach' });
      parts.push(Prisma.sql`created_by = ${newCoachId}`);
    }

    if (!parts.length && !topic_ids && updateResourceIds === undefined && updateQuizIds === undefined && !coach_id) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    // Optional: apply same content changes to all sessions in the same batch
    const { apply_to_batch } = req.body;
    let batchSessionIds: number[] = [sessionId];
    if (apply_to_batch === 'true' || apply_to_batch === true) {
      const batchRows = await prisma.$queryRaw<{ id: number; batch_id: string }[]>(
        Prisma.sql`SELECT id, batch_id FROM coaching_sessions WHERE id = ${sessionId}`
      );
      if (batchRows[0]?.batch_id) {
        const siblingRows = await prisma.$queryRaw<{ id: number }[]>(
          Prisma.sql`SELECT id FROM coaching_sessions WHERE batch_id = ${batchRows[0].batch_id} AND id != ${sessionId} AND status != 'CLOSED'`
        );
        batchSessionIds = [sessionId, ...siblingRows.map(r => r.id)];
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const sid of batchSessionIds) {
      if (parts.length) await tx.$executeRaw(Prisma.sql`UPDATE coaching_sessions SET ${Prisma.join(parts, ', ')} WHERE id = ${sid}`);
      if (Array.isArray(topic_ids) && topic_ids.length) {
        await tx.$executeRaw(Prisma.sql`DELETE FROM coaching_session_topics WHERE coaching_session_id = ${sid}`);
        for (const tid of topic_ids) await tx.$executeRaw(Prisma.sql`INSERT INTO coaching_session_topics (coaching_session_id, topic_id) VALUES (${sid}, ${tid})`);
      }
      if (updateResourceIds !== undefined) {
        await tx.$executeRaw(Prisma.sql`DELETE FROM coaching_session_resources WHERE coaching_session_id = ${sid}`);
        for (const rid of updateResourceIds) await tx.$executeRaw(Prisma.sql`INSERT IGNORE INTO coaching_session_resources (coaching_session_id, resource_id) VALUES (${sid}, ${rid})`);
      }
      if (updateQuizIds !== undefined) {
        await tx.$executeRaw(Prisma.sql`DELETE FROM coaching_session_quizzes WHERE coaching_session_id = ${sid}`);
        for (const qid of updateQuizIds) await tx.$executeRaw(Prisma.sql`INSERT IGNORE INTO coaching_session_quizzes (coaching_session_id, quiz_id) VALUES (${sid}, ${qid})`);
      }
      if (updateBehaviorFlagIds !== undefined) {
        await tx.$executeRaw(Prisma.sql`DELETE cbf FROM coaching_session_behavior_flags cbf JOIN list_items li ON cbf.list_item_id = li.id WHERE cbf.coaching_session_id = ${sid} AND li.list_type = 'behavior_flag'`);
        for (const fid of updateBehaviorFlagIds) await tx.$executeRaw(Prisma.sql`INSERT IGNORE INTO coaching_session_behavior_flags (coaching_session_id, list_item_id) VALUES (${sid}, ${fid})`);
      }
      if (updateRootCauseIds !== undefined) {
        await tx.$executeRaw(Prisma.sql`DELETE cbf FROM coaching_session_behavior_flags cbf JOIN list_items li ON cbf.list_item_id = li.id WHERE cbf.coaching_session_id = ${sid} AND li.list_type = 'root_cause'`);
        for (const rcId of updateRootCauseIds) await tx.$executeRaw(Prisma.sql`INSERT IGNORE INTO coaching_session_behavior_flags (coaching_session_id, list_item_id) VALUES (${sid}, ${rcId})`);
      }
      if (updateSupportNeededIds !== undefined) {
        await tx.$executeRaw(Prisma.sql`DELETE cbf FROM coaching_session_behavior_flags cbf JOIN list_items li ON cbf.list_item_id = li.id WHERE cbf.coaching_session_id = ${sid} AND li.list_type = 'support_needed'`);
        for (const snId of updateSupportNeededIds) await tx.$executeRaw(Prisma.sql`INSERT IGNORE INTO coaching_session_behavior_flags (coaching_session_id, list_item_id) VALUES (${sid}, ${snId})`);
      }
      await tx.auditLog.create({ data: { user_id: userId, action: sid === sessionId ? 'UPDATE' : 'BATCH_UPDATE', target_id: sid, target_type: 'coaching_session', details: JSON.stringify({ batch_applied: sid !== sessionId }) } });
      } // end batchSessionIds loop
    });

    // ── Re-evaluate status after edit ─────────────────────────────────────────
    // If the session is in an active delivery state, check whether requirements
    // have changed and auto-adjust to the correct status.
    const [statusRow] = await prisma.$queryRaw<{ status: string }[]>(
      Prisma.sql`SELECT status FROM coaching_sessions WHERE id = ${sessionId}`
    );
    const currentStatus = statusRow?.status;
    if (['SCHEDULED', 'AWAITING_CSR_ACTION'].includes(currentStatus)) {
      const needsCSR = await hasCsrRequirements(sessionId);

      if (needsCSR && currentStatus === 'SCHEDULED') {
        await prisma.$executeRaw(Prisma.sql`UPDATE coaching_sessions SET status = 'AWAITING_CSR_ACTION' WHERE id = ${sessionId}`);
        await prisma.auditLog.create({ data: { user_id: userId, action: 'AUTO_STATUS_ADVANCE', target_id: sessionId, target_type: 'coaching_session', details: JSON.stringify({ from: 'SCHEDULED', to: 'AWAITING_CSR_ACTION', reason: 'requirements_added_on_edit' }) } });
      } else if (!needsCSR && currentStatus === 'AWAITING_CSR_ACTION') {
        await prisma.$executeRaw(Prisma.sql`UPDATE coaching_sessions SET status = 'SCHEDULED' WHERE id = ${sessionId}`);
        await prisma.auditLog.create({ data: { user_id: userId, action: 'AUTO_STATUS_REVERT', target_id: sessionId, target_type: 'coaching_session', details: JSON.stringify({ from: 'AWAITING_CSR_ACTION', to: 'SCHEDULED', reason: 'requirements_removed_on_edit' }) } });
      } else if (needsCSR) {
        await applyAutoAdvance(sessionId, userId);
      }
    }

    res.json({ success: true, message: 'Session updated successfully' });
  } catch (error) {
    logger.error('[COACHING] updateCoachingSession error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const deliverCoachingSession = async (req: AuthReq, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const role = req.user!.role;
    const sessionId = parseInt(req.params.id);

    const conditions: Prisma.Sql[] = [Prisma.sql`cs.id = ${sessionId}`, Prisma.sql`u.is_active = 1`, roleCondition(role, userId)];
    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT cs.id, cs.status FROM coaching_sessions cs JOIN users u ON cs.csr_id = u.id ${whereClause}`);

    if (!rows.length) return res.status(404).json({ success: false, message: 'Session not found or access denied' });
    if (rows[0].status !== 'DRAFT') return res.status(400).json({ success: false, message: 'Can only schedule a DRAFT session' });

    const needsCSR = await hasCsrRequirements(sessionId);
    const deliveredStatus = needsCSR ? 'AWAITING_CSR_ACTION' : 'SCHEDULED';

    await prisma.$executeRaw(Prisma.sql`UPDATE coaching_sessions SET status = ${deliveredStatus}, delivered_at = NOW() WHERE id = ${sessionId}`);
    await prisma.auditLog.create({ data: { user_id: userId, action: 'DELIVERED', target_id: sessionId, target_type: 'coaching_session', details: JSON.stringify({ status: deliveredStatus }) } });
    res.json({ success: true, message: `Session scheduled — status: ${deliveredStatus}` });
  } catch (error) {
    logger.error('[COACHING] deliverCoachingSession error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const completeCoachingSession = async (req: AuthReq, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const role = req.user!.role;
    const sessionId = parseInt(req.params.id);

    const conditions: Prisma.Sql[] = [Prisma.sql`cs.id = ${sessionId}`, Prisma.sql`u.is_active = 1`, roleCondition(role, userId)];
    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT cs.id, cs.status FROM coaching_sessions cs JOIN users u ON cs.csr_id = u.id ${whereClause}`);

    if (!rows.length) return res.status(404).json({ success: false, message: 'Session not found or access denied' });
    if (['COMPLETED', 'CLOSED', 'CANCELED'].includes(rows[0].status)) return res.status(400).json({ success: false, message: 'Session is already completed or closed' });

    await prisma.$executeRaw(Prisma.sql`UPDATE coaching_sessions SET status = 'COMPLETED', completed_at = NOW() WHERE id = ${sessionId}`);
    await prisma.auditLog.create({ data: { user_id: userId, action: 'COMPLETE', target_id: sessionId, target_type: 'coaching_session', details: '{}' } });
    res.json({ success: true, message: 'Session marked as completed' });
  } catch (error) {
    logger.error('[COACHING] completeCoachingSession error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const flagFollowUp = async (req: AuthReq, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const role = req.user!.role;
    const sessionId = parseInt(req.params.id);
    const { follow_up_date } = req.body;

    const conditions: Prisma.Sql[] = [Prisma.sql`cs.id = ${sessionId}`, Prisma.sql`u.is_active = 1`, roleCondition(role, userId)];
    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT cs.id FROM coaching_sessions cs JOIN users u ON cs.csr_id = u.id ${whereClause}`);

    if (!rows.length) return res.status(404).json({ success: false, message: 'Session not found or access denied' });

    await prisma.$executeRaw(
      Prisma.sql`UPDATE coaching_sessions SET follow_up_required = 1, status = 'FOLLOW_UP_REQUIRED', follow_up_date = ${follow_up_date || null} WHERE id = ${sessionId}`
    );
    await prisma.auditLog.create({ data: { user_id: userId, action: 'FLAG_FOLLOWUP', target_id: sessionId, target_type: 'coaching_session', details: JSON.stringify({ follow_up_date }) } });
    res.json({ success: true, message: 'Follow-up flagged' });
  } catch (error) {
    logger.error('[COACHING] flagFollowUp error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const closeCoachingSession = async (req: AuthReq, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const role = req.user!.role;
    const sessionId = parseInt(req.params.id);

    const conditions: Prisma.Sql[] = [Prisma.sql`cs.id = ${sessionId}`, Prisma.sql`u.is_active = 1`, roleCondition(role, userId)];
    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT cs.id, cs.status FROM coaching_sessions cs JOIN users u ON cs.csr_id = u.id ${whereClause}`);

    if (!rows.length) return res.status(404).json({ success: false, message: 'Session not found or access denied' });
    if (['CLOSED', 'CANCELED'].includes(rows[0].status)) return res.status(400).json({ success: false, message: 'Session is already closed' });

    await prisma.$executeRaw(Prisma.sql`UPDATE coaching_sessions SET status = 'CLOSED', closed_at = NOW() WHERE id = ${sessionId}`);
    await prisma.auditLog.create({ data: { user_id: userId, action: 'CLOSE', target_id: sessionId, target_type: 'coaching_session', details: '{}' } });
    res.json({ success: true, message: 'Session closed' });
  } catch (error) {
    logger.error('[COACHING] closeCoachingSession error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const downloadAttachment = async (req: AuthReq, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const role = req.user!.role;
    const sessionId = parseInt(req.params.id);

    const conditions: Prisma.Sql[] = [Prisma.sql`cs.id = ${sessionId}`, Prisma.sql`cs.attachment_path IS NOT NULL`, Prisma.sql`u.is_active = 1`, roleCondition(role, userId)];
    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT cs.attachment_filename, cs.attachment_path, cs.attachment_mime_type FROM coaching_sessions cs JOIN users u ON cs.csr_id = u.id ${whereClause}`);

    if (!rows.length) return res.status(404).json({ success: false, message: 'Session not found, no attachment, or access denied' });

    const { attachment_filename, attachment_path, attachment_mime_type } = rows[0];
    const filePath = path.join(process.cwd(), attachment_path);

    try { await fs.access(filePath); } catch { return res.status(404).json({ success: false, message: 'Attachment file not found on server' }); }

    const stats = await fs.stat(filePath);
    res.setHeader('Content-Type', attachment_mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; ${escapeFilename(attachment_filename)}`);

    const stream = createReadStream(filePath);
    stream.on('error', (err: Error) => { if (!res.headersSent) res.status(500).json({ success: false, message: 'Error reading file' }); else res.destroy(); });
    stream.pipe(res);
  } catch (error) {
    logger.error('[COACHING] downloadAttachment error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const setSessionStatus = async (req: AuthReq, res: Response) => {
  try {
    const userId    = req.user!.user_id;
    const role      = req.user!.role;
    const sessionId = parseInt(req.params.id);
    const { status } = req.body as { status: string };

    // Mirrors Prisma enum CoachingSessionStatus (backend/prisma/schema.prisma).
    // CLOSED + CANCELED are still rejected below as terminal states (cannot be reopened).
    const validStatuses = [
      'DRAFT', 'SCHEDULED', 'IN_PROCESS', 'AWAITING_CSR_ACTION',
      'QUIZ_PENDING', 'COMPLETED', 'FOLLOW_UP_REQUIRED', 'CLOSED', 'CANCELED',
    ];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const conditions: Prisma.Sql[] = [Prisma.sql`cs.id = ${sessionId}`, Prisma.sql`u.is_active = 1`, roleCondition(role, userId)];
    const rows = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT cs.id, cs.status FROM coaching_sessions cs JOIN users u ON cs.csr_id = u.id WHERE ${Prisma.join(conditions, ' AND ')}`
    );

    if (!rows.length) return res.status(404).json({ success: false, message: 'Session not found or access denied' });

    const current = rows[0].status;
    if (['CLOSED', 'CANCELED'].includes(current)) {
      return res.status(400).json({ success: false, message: 'Closed or canceled sessions cannot be reopened' });
    }
    if (status === current) {
      return res.json({ success: true, message: 'Status unchanged' });
    }

    const parts: Prisma.Sql[] = [Prisma.sql`status = ${status}`];
    if (status === 'SCHEDULED') parts.push(Prisma.sql`delivered_at = COALESCE(delivered_at, NOW())`);
    if (status === 'COMPLETED')  parts.push(Prisma.sql`completed_at = COALESCE(completed_at, NOW())`);
    if (status === 'CLOSED')     parts.push(Prisma.sql`closed_at = COALESCE(closed_at, NOW())`);
    if (status === 'CANCELED')   parts.push(Prisma.sql`closed_at = COALESCE(closed_at, NOW())`);

    await prisma.$executeRaw(Prisma.sql`UPDATE coaching_sessions SET ${Prisma.join(parts, ', ')} WHERE id = ${sessionId}`);
    await prisma.auditLog.create({
      data: { user_id: userId, action: 'STATUS_CHANGE', target_id: sessionId, target_type: 'coaching_session',
              details: JSON.stringify({ from: current, to: status }) },
    });

    res.json({ success: true, message: `Status changed to ${status}` });
  } catch (error) {
    logger.error('[COACHING] setSessionStatus error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getEligibleCoaches = async (_req: AuthReq, res: Response) => {
  try {
    // role_id 1=Admin, 4=Trainer, 5=Manager are eligible to conduct coaching sessions
    const coaches = await prisma.$queryRaw<{ id: number; name: string }[]>(
      Prisma.sql`SELECT id, username as name FROM users WHERE role_id IN (1, 4, 5) AND is_active = 1 ORDER BY username ASC`
    );
    res.json({ success: true, data: coaches });
  } catch (error) {
    logger.error('[COACHING] getEligibleCoaches error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getCSRCoachingHistory = async (req: AuthReq, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const role = req.user!.role;
    const csrId = parseInt(req.params.csrId);

    if (!csrId || isNaN(csrId)) return res.status(400).json({ success: false, message: 'Invalid CSR ID' });

    const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const oneYearStr = `${oneYearAgo.getFullYear()}-${String(oneYearAgo.getMonth() + 1).padStart(2, '0')}-${String(oneYearAgo.getDate()).padStart(2, '0')}`;
    const accessConditions: Prisma.Sql[] = [Prisma.sql`cs.csr_id = ${csrId}`, Prisma.sql`u.is_active = 1`, Prisma.sql`cs.session_date >= ${oneYearStr}`, roleCondition(role, userId)];
    const whereClause = Prisma.sql`WHERE ${Prisma.join(accessConditions, ' AND ')}`;

    const sessions = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT cs.id, cs.session_date, cs.coaching_purpose, cs.coaching_format, cs.status,
          GROUP_CONCAT(DISTINCT li_t.label ORDER BY li_t.label SEPARATOR ',') as topics
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
        LEFT JOIN list_items li_t ON cst.topic_id = li_t.id
        ${whereClause}
        GROUP BY cs.id ORDER BY cs.session_date DESC
      `
    );

    const allWithTopics = sessions.map((s: SessionRow) => ({ ...s, topics: s.topics ? s.topics.split(',') : [] }));

    const ninetyDaysAgo = new Date(); ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const ninetyDaysStr = `${ninetyDaysAgo.getFullYear()}-${String(ninetyDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(ninetyDaysAgo.getDate()).padStart(2, '0')}`;
    const recentSessions = allWithTopics.filter((s: any) => {
      const d = s.session_date instanceof Date ? s.session_date.toISOString().slice(0, 10) : String(s.session_date ?? '').slice(0, 10);
      return d >= ninetyDaysStr;
    });

    const repeatConditions: Prisma.Sql[] = [
      Prisma.sql`cs.csr_id = ${csrId}`,
      Prisma.sql`u.is_active = 1`,
      Prisma.sql`cs.session_date >= ${ninetyDaysStr}`,
      roleCondition(role, userId),
    ];
    const recentTopicRows = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT li_t.label, COUNT(DISTINCT cs.id) as session_count
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
        JOIN list_items li_t ON cst.topic_id = li_t.id
        WHERE ${Prisma.join(repeatConditions, ' AND ')}
        GROUP BY li_t.id HAVING session_count >= 2
      `
    );
    const repeatTopics = recentTopicRows.map((r: { label: string }) => r.label);

    res.json({ success: true, data: { sessions: recentSessions, prior_year_sessions: allWithTopics, repeat_topics: repeatTopics } });
  } catch (error) {
    logger.error('[COACHING] getCSRCoachingHistory error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
