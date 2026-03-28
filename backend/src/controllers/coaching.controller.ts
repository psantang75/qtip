import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
const fs = require('fs').promises;
const path = require('path');
const { createReadStream } = require('fs');

interface AuthReq extends Request {
  user?: { user_id: number; role: string };
}

const escapeFilename = (filename: string | null | undefined): string => {
  if (!filename) return 'filename="attachment"';
  const clean = filename.replace(/[\x00-\x1F\x7F]/g, '').trim();
  return clean ? `filename="${clean}"` : 'filename="attachment"';
};

const roleCondition = (role: string, userId: number): Prisma.Sql => {
  if (role === 'Admin') return Prisma.sql`1=1`;
  if (role === 'Manager') return Prisma.sql`u.manager_id = ${userId}`;
  if (role === 'QA') return Prisma.sql`cs.created_by = ${userId}`;
  return Prisma.sql`cs.created_by = ${userId}`;
};

export const getCoachingSessions = async (req: AuthReq, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const role = req.user!.role;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    const offset = (page - 1) * limit;
    const { csr_id, status, coaching_purpose, coaching_format, topic_ids, date_from, date_to, overdue_only } = req.query;

    const conditions: Prisma.Sql[] = [Prisma.sql`u.is_active = 1`, roleCondition(role, userId)];

    if (csr_id)          conditions.push(Prisma.sql`cs.csr_id = ${parseInt(csr_id as string)}`);
    if (status)          conditions.push(Prisma.sql`cs.status = ${status}`);
    if (coaching_purpose) conditions.push(Prisma.sql`cs.coaching_purpose = ${coaching_purpose}`);
    if (coaching_format)  conditions.push(Prisma.sql`cs.coaching_format = ${coaching_format}`);
    if (date_from) conditions.push(Prisma.sql`DATE(cs.session_date) >= ${date_from}`);
    if (date_to) conditions.push(Prisma.sql`DATE(cs.session_date) <= ${date_to}`);
    if (overdue_only === 'true') {
      conditions.push(Prisma.sql`(cs.due_date IS NOT NULL AND cs.due_date < NOW() AND cs.status NOT IN ('COMPLETED','CLOSED'))`);
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
          SELECT cs.id, cs.csr_id, u.username as csr_name, cs.coaching_purpose, cs.coaching_format, cs.source_type,
            cs.status, cs.quiz_required, cs.quiz_id, cs.session_date, cs.due_date, cs.follow_up_date, cs.follow_up_required,
            cs.created_at, cb.username as created_by_name, cs.attachment_filename,
            GROUP_CONCAT(DISTINCT t.topic_name ORDER BY t.topic_name SEPARATOR ',') as topics,
            GROUP_CONCAT(DISTINCT t.id ORDER BY t.id SEPARATOR ',') as topic_ids,
            CASE WHEN cs.due_date IS NOT NULL AND cs.due_date < NOW() AND cs.status NOT IN ('COMPLETED','CLOSED') THEN 1 ELSE 0 END as is_overdue
          FROM coaching_sessions cs
          JOIN users u ON cs.csr_id = u.id
          LEFT JOIN users cb ON cs.created_by = cb.id
          LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
          LEFT JOIN topics t ON cst.topic_id = t.id
          ${whereClause}
          GROUP BY cs.id ORDER BY cs.session_date DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      ),
    ]);

    const data = sessions.map((s: any) => ({
      ...s,
      topics: s.topics ? s.topics.split(',') : [],
      topic_ids: s.topic_ids ? s.topic_ids.split(',').map(Number) : [],
      is_overdue: !!s.is_overdue,
    }));

    res.json({ success: true, data: { sessions: data, totalCount: Number(countRows[0]?.total ?? 0), page, limit } });
  } catch (error) {
    console.error('[COACHING] getCoachingSessions error:', error);
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
          GROUP_CONCAT(DISTINCT t.topic_name ORDER BY t.topic_name SEPARATOR ',') as topics,
          GROUP_CONCAT(DISTINCT t.id ORDER BY t.id SEPARATOR ',') as topic_ids
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        LEFT JOIN departments d ON u.department_id = d.id
        LEFT JOIN users cb ON cs.created_by = cb.id
        LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
        LEFT JOIN topics t ON cst.topic_id = t.id
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

    const [kbRows, quizRows, quizAttempts, recentRows] = await Promise.all([
      prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT r.id, r.title, r.url, r.description FROM coaching_session_resources csr2
          JOIN training_resources r ON csr2.resource_id = r.id WHERE csr2.coaching_session_id = ${sessionId}`
      ),
      prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT q.id, q.quiz_title, q.pass_score FROM coaching_session_quizzes csq
          JOIN quizzes q ON csq.quiz_id = q.id WHERE csq.coaching_session_id = ${sessionId}`
      ),
      prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT id, attempt_number, score, passed, submitted_at FROM quiz_attempts WHERE coaching_session_id = ${sessionId} ORDER BY attempt_number`
      ),
      prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT cs2.id, cs2.session_date, cs2.coaching_purpose, cs2.coaching_format, cs2.status,
            GROUP_CONCAT(DISTINCT t2.topic_name ORDER BY t2.topic_name SEPARATOR ',') as topics
          FROM coaching_sessions cs2
          LEFT JOIN coaching_session_topics cst2 ON cs2.id = cst2.coaching_session_id
          LEFT JOIN topics t2 ON cst2.topic_id = t2.id
          WHERE cs2.csr_id = ${session.csr_id} AND cs2.id != ${sessionId}
          GROUP BY cs2.id ORDER BY cs2.session_date DESC LIMIT 3
        `
      ),
    ]);

    const quizzesWithQuestions = await Promise.all(
      quizRows.map(async (qr: any) => {
        const questions = await prisma.$queryRaw<any[]>(
          Prisma.sql`SELECT id, question_text, options, correct_option FROM quiz_questions WHERE quiz_id = ${qr.id} ORDER BY id`
        );
        return { ...qr, questions: questions.map((q: any) => ({ ...q, options: JSON.parse(q.options || '[]') })) };
      })
    );

    const recentSessions = (recentRows || []).map((s: any) => ({ ...s, topics: s.topics ? s.topics.split(',') : [] }));
    const recentTopicsFlat = recentSessions.flatMap((s: any) => s.topics);
    const repeatTopics = session.topics.filter((t: string) => recentTopicsFlat.includes(t));

    res.json({
      success: true,
      data: {
        ...session,
        kb_resources: kbRows,
        quizzes: quizzesWithQuestions,
        quiz_attempts: quizAttempts,
        recent_sessions: recentSessions,
        repeat_topics: repeatTopics,
      },
    });
  } catch (error) {
    console.error('[COACHING] getCoachingSessionDetail error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const createCoachingSession = async (req: AuthReq, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const attachment = req.file;
    let { csr_id, session_date, coaching_purpose, coaching_format, source_type, notes, topic_ids,
          required_action, resource_ids, kb_url, quiz_ids,
          require_acknowledgment, require_action_plan, due_date,
          follow_up_required, follow_up_date, coach_id } = req.body;

    if (typeof topic_ids    === 'string') topic_ids    = topic_ids.split(',').map((x: string) => parseInt(x.trim())).filter(Boolean);
    if (!Array.isArray(topic_ids)) topic_ids = topic_ids ? [parseInt(topic_ids)] : [];

    const parsedResourceIds: number[] = typeof resource_ids === 'string'
      ? resource_ids.split(',').map((x: string) => parseInt(x.trim())).filter(Boolean)
      : [];
    const parsedQuizIds: number[] = typeof quiz_ids === 'string'
      ? quiz_ids.split(',').map((x: string) => parseInt(x.trim())).filter(Boolean)
      : [];

    if (!csr_id || !session_date || !coaching_purpose || !coaching_format || !source_type) {
      return res.status(400).json({ success: false, message: 'Required: csr_id, session_date, coaching_purpose, coaching_format, source_type' });
    }
    if (!topic_ids.length) return res.status(400).json({ success: false, message: 'At least one topic is required' });

    // Resolve the coach: use provided coach_id if valid, otherwise fall back to the authenticated user
    const resolvedCoachId = coach_id ? parseInt(coach_id) : userId;
    if (coach_id && parseInt(coach_id) !== userId) {
      const coachCheck = await prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT id FROM users WHERE id = ${resolvedCoachId} AND role_id IN (1, 4, 5) AND is_active = 1`
      );
      if (!coachCheck.length) return res.status(400).json({ success: false, message: 'Invalid or ineligible coach' });
    }

    const csrCheck = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT id FROM users WHERE id = ${parseInt(csr_id)} AND role_id = 3 AND is_active = 1`);
    if (!csrCheck.length) return res.status(403).json({ success: false, message: 'CSR not found or inactive' });

    const topicCheck = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT id FROM topics WHERE id IN (${Prisma.join(topic_ids)}) AND is_active = 1`);
    if (topicCheck.length !== topic_ids.length) return res.status(400).json({ success: false, message: 'One or more topics are invalid or inactive' });

    let attFilename = null, attPath = null, attSize = null, attMime = null;
    if (attachment) {
      const uploadsDir = path.join(process.cwd(), 'uploads', 'coaching');
      await fs.mkdir(uploadsDir, { recursive: true });
      const filename = `coaching_${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(attachment.originalname)}`;
      await fs.writeFile(path.join(uploadsDir, filename), attachment.buffer);
      attFilename = attachment.originalname; attPath = `uploads/coaching/${filename}`; attSize = attachment.size; attMime = attachment.mimetype;
    }

    const newId = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO coaching_sessions
          (csr_id, session_date, coaching_purpose, coaching_format, source_type, notes, status, required_action, kb_url,
           require_acknowledgment, require_action_plan, due_date, follow_up_required, follow_up_date,
           attachment_filename, attachment_path, attachment_size, attachment_mime_type, created_by)
          VALUES
          (${parseInt(csr_id)}, ${session_date}, ${coaching_purpose}, ${coaching_format}, ${source_type}, ${notes || null}, 'SCHEDULED',
           ${required_action || null}, ${kb_url || null},
           ${require_acknowledgment === 'false' || require_acknowledgment === false ? 0 : 1},
           ${require_action_plan === 'false' || require_action_plan === false ? 0 : 1},
           ${due_date || null},
           ${follow_up_required === 'true' || follow_up_required === true ? 1 : 0},
           ${follow_up_date || null}, ${attFilename}, ${attPath}, ${attSize}, ${attMime}, ${resolvedCoachId})`
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
      await tx.auditLog.create({ data: { user_id: userId, action: 'CREATE', target_id: sessionId, target_type: 'coaching_session', details: JSON.stringify({ csr_id, coaching_purpose, coaching_format, topic_ids }) } });
      return sessionId;
    });

    res.status(201).json({ success: true, data: { id: newId }, message: 'Coaching session created successfully' });
  } catch (error) {
    console.error('[COACHING] createCoachingSession error:', error);
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
          follow_up_required, follow_up_date, coach_id } = req.body;

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
    if (['COMPLETED', 'CLOSED'].includes(existing[0].status)) return res.status(400).json({ success: false, message: 'Cannot edit a completed or closed session' });

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

    if (attachment) {
      const uploadsDir = path.join(process.cwd(), 'uploads', 'coaching');
      await fs.mkdir(uploadsDir, { recursive: true });
      const filename = `coaching_${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(attachment.originalname)}`;
      await fs.writeFile(path.join(uploadsDir, filename), attachment.buffer);
      parts.push(Prisma.sql`attachment_filename = ${attachment.originalname}`);
      parts.push(Prisma.sql`attachment_path = ${'uploads/coaching/' + filename}`);
      parts.push(Prisma.sql`attachment_size = ${attachment.size}`);
      parts.push(Prisma.sql`attachment_mime_type = ${attachment.mimetype}`);
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

    await prisma.$transaction(async (tx) => {
      if (parts.length) await tx.$executeRaw(Prisma.sql`UPDATE coaching_sessions SET ${Prisma.join(parts, ', ')} WHERE id = ${sessionId}`);
      if (Array.isArray(topic_ids) && topic_ids.length) {
        await tx.coachingSessionTopic.deleteMany({ where: { coaching_session_id: sessionId } });
        for (const tid of topic_ids) await tx.$executeRaw(Prisma.sql`INSERT INTO coaching_session_topics (coaching_session_id, topic_id) VALUES (${sessionId}, ${tid})`);
      }
      if (updateResourceIds !== undefined) {
        await tx.$executeRaw(Prisma.sql`DELETE FROM coaching_session_resources WHERE coaching_session_id = ${sessionId}`);
        for (const rid of updateResourceIds) await tx.$executeRaw(Prisma.sql`INSERT IGNORE INTO coaching_session_resources (coaching_session_id, resource_id) VALUES (${sessionId}, ${rid})`);
      }
      if (updateQuizIds !== undefined) {
        await tx.$executeRaw(Prisma.sql`DELETE FROM coaching_session_quizzes WHERE coaching_session_id = ${sessionId}`);
        for (const qid of updateQuizIds) await tx.$executeRaw(Prisma.sql`INSERT IGNORE INTO coaching_session_quizzes (coaching_session_id, quiz_id) VALUES (${sessionId}, ${qid})`);
      }
      await tx.auditLog.create({ data: { user_id: userId, action: 'UPDATE', target_id: sessionId, target_type: 'coaching_session', details: JSON.stringify(req.body) } });
    });

    res.json({ success: true, message: 'Session updated successfully' });
  } catch (error) {
    console.error('[COACHING] updateCoachingSession error:', error);
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
    if (rows[0].status !== 'SCHEDULED') return res.status(400).json({ success: false, message: 'Can only mark in-process a SCHEDULED session' });

    await prisma.$executeRaw(Prisma.sql`UPDATE coaching_sessions SET status = 'IN_PROCESS', delivered_at = NOW() WHERE id = ${sessionId}`);
    await prisma.auditLog.create({ data: { user_id: userId, action: 'IN_PROCESS', target_id: sessionId, target_type: 'coaching_session', details: '{}' } });
    res.json({ success: true, message: 'Session marked as in-process' });
  } catch (error) {
    console.error('[COACHING] deliverCoachingSession error:', error);
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
    if (rows[0].status === 'COMPLETED' || rows[0].status === 'CLOSED') return res.status(400).json({ success: false, message: 'Session is already completed or closed' });

    await prisma.$executeRaw(Prisma.sql`UPDATE coaching_sessions SET status = 'COMPLETED', completed_at = NOW() WHERE id = ${sessionId}`);
    await prisma.auditLog.create({ data: { user_id: userId, action: 'COMPLETE', target_id: sessionId, target_type: 'coaching_session', details: '{}' } });
    res.json({ success: true, message: 'Session marked as completed' });
  } catch (error) {
    console.error('[COACHING] completeCoachingSession error:', error);
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
    console.error('[COACHING] flagFollowUp error:', error);
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
    if (rows[0].status === 'CLOSED') return res.status(400).json({ success: false, message: 'Session is already closed' });

    await prisma.$executeRaw(Prisma.sql`UPDATE coaching_sessions SET status = 'CLOSED' WHERE id = ${sessionId}`);
    await prisma.auditLog.create({ data: { user_id: userId, action: 'CLOSE', target_id: sessionId, target_type: 'coaching_session', details: '{}' } });
    res.json({ success: true, message: 'Session closed' });
  } catch (error) {
    console.error('[COACHING] closeCoachingSession error:', error);
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
    console.error('[COACHING] downloadAttachment error:', error);
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
    console.error('[COACHING] getEligibleCoaches error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getCSRCoachingHistory = async (req: AuthReq, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const role = req.user!.role;
    const csrId = parseInt(req.params.csrId);

    if (!csrId || isNaN(csrId)) return res.status(400).json({ success: false, message: 'Invalid CSR ID' });

    const accessConditions: Prisma.Sql[] = [Prisma.sql`cs.csr_id = ${csrId}`, Prisma.sql`u.is_active = 1`, roleCondition(role, userId)];
    const whereClause = Prisma.sql`WHERE ${Prisma.join(accessConditions, ' AND ')}`;

    const sessions = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT cs.id, cs.session_date, cs.coaching_purpose, cs.coaching_format, cs.status,
          GROUP_CONCAT(DISTINCT t.topic_name ORDER BY t.topic_name SEPARATOR ',') as topics
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
        LEFT JOIN topics t ON cst.topic_id = t.id
        ${whereClause}
        GROUP BY cs.id ORDER BY cs.session_date DESC LIMIT 5
      `
    );

    const sessionsWithTopics = sessions.map((s: any) => ({ ...s, topics: s.topics ? s.topics.split(',') : [] }));

    const ninetyDaysAgo = new Date(); ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const repeatConditions: Prisma.Sql[] = [
      Prisma.sql`cs.csr_id = ${csrId}`,
      Prisma.sql`u.is_active = 1`,
      Prisma.sql`cs.session_date >= ${ninetyDaysAgo.toISOString().slice(0, 10)}`,
      roleCondition(role, userId),
    ];
    const recentTopicRows = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT t.topic_name, COUNT(DISTINCT cs.id) as session_count
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
        JOIN topics t ON cst.topic_id = t.id
        WHERE ${Prisma.join(repeatConditions, ' AND ')}
        GROUP BY t.id HAVING session_count >= 2
      `
    );
    const repeatTopics = recentTopicRows.map((r: any) => r.topic_name);

    res.json({ success: true, data: { sessions: sessionsWithTopics, repeat_topics: repeatTopics } });
  } catch (error) {
    console.error('[COACHING] getCSRCoachingHistory error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
