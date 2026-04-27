import { Request, Response } from 'express';
import prisma from '../../config/prisma';
import { Prisma } from '../../generated/prisma/client';
import { applyAutoAdvance } from '../../utils/coachingAutoAdvance';
import { formatFilename as escapeFilename } from '../../utils/contentDisposition';
import logger from '../../config/logger';

/**
 * CSR coaching handlers — quiz submission, coaching-session list/details/
 * attachment, the resource-file pass-through, and CSR response submission.
 *
 * One of three transport modules under `controllers/csr/` (consolidated
 * during pre-production review item #69). The dashboard, audit list/detail,
 * and finalize handlers that used to be duplicated here were removed during
 * pre-production review item #12 so bug fixes only have to land in one
 * place. Re-exported via `./index`.
 */

/**
 * Submit quiz answers for CSR
 */
export const submitQuizAnswers = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const quizId = parseInt(req.params.quizId);
    const { answers } = req.body;

    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({ message: 'Invalid answers format' });
    }

    const quizCheck = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT q.*, c.id as course_id, ce.id as enrollment_id
        FROM quizzes q
        JOIN courses c ON q.course_id = c.id
        JOIN enrollments ce ON ce.course_id = c.id
        WHERE q.id = ${quizId} AND ce.user_id = ${userId}
      `
    );

    if (quizCheck.length === 0) {
      return res.status(404).json({ message: 'Quiz not found or access denied' });
    }

    const quiz = quizCheck[0];

    const questions = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT id, correct_option FROM quiz_questions WHERE quiz_id = ${quizId} ORDER BY id`
    );

    if (questions.length !== answers.length) {
      return res.status(400).json({ message: 'Number of answers does not match number of questions' });
    }

    let correctAnswers = 0;
    const correctAnswerArray: number[] = [];

    questions.forEach((question, index) => {
      correctAnswerArray.push(question.correct_option);
      if (answers[index] === question.correct_option) {
        correctAnswers++;
      }
    });

    const score = Math.round((correctAnswers / questions.length) * 100);
    const passed = score >= quiz.pass_score;

    res.json({
      score,
      passed,
      correctAnswers: correctAnswerArray
    });
  } catch (error) {
    logger.error('Error submitting quiz:', error);
    res.status(500).json({ message: 'Failed to submit quiz' });
  }
};

/**
 * Get coaching sessions for CSR
 */
export const getCSRCoachingSessions = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const { page = 1, pageSize, limit: limitParam, status, coaching_purpose, coaching_format, startDate, endDate, search } = req.query;

    const pageNum = Number(page);
    const pageSizeNum = Number(pageSize || limitParam || 10);

    if (isNaN(pageNum) || pageNum < 1 || pageNum > 10000) {
      return res.status(400).json({
        error: 'INVALID_PAGE',
        message: 'Page must be a number between 1 and 10000'
      });
    }

    if (isNaN(pageSizeNum) || pageSizeNum < 1 || pageSizeNum > 5000) {
      return res.status(400).json({
        error: 'INVALID_PAGE_SIZE',
        message: 'Page size must be a number between 1 and 5000'
      });
    }

    if (search && typeof search === 'string' && search.length > 100) {
      return res.status(400).json({
        error: 'SEARCH_TOO_LONG',
        message: 'Search term cannot exceed 100 characters'
      });
    }

    if (startDate && typeof startDate === 'string') {
      const startDateObj = new Date(startDate);
      if (isNaN(startDateObj.getTime())) {
        return res.status(400).json({
          error: 'INVALID_START_DATE',
          message: 'Start date must be in valid format (YYYY-MM-DD)'
        });
      }
    }

    if (endDate && typeof endDate === 'string') {
      const endDateObj = new Date(endDate);
      if (isNaN(endDateObj.getTime())) {
        return res.status(400).json({
          error: 'INVALID_END_DATE',
          message: 'End date must be in valid format (YYYY-MM-DD)'
        });
      }
    }

    if (status && typeof status === 'string' && !['SCHEDULED', 'COMPLETED'].includes(status)) {
      return res.status(400).json({
        error: 'INVALID_STATUS',
        message: 'Status must be either SCHEDULED or COMPLETED'
      });
    }

    const validPurposes = ['WEEKLY', 'PERFORMANCE', 'ONBOARDING'];
    if (coaching_purpose && typeof coaching_purpose === 'string' && !validPurposes.includes(coaching_purpose)) {
      return res.status(400).json({ error: 'INVALID_COACHING_PURPOSE', message: 'Invalid coaching purpose provided' });
    }
    const validFormats = ['ONE_ON_ONE', 'SIDE_BY_SIDE', 'TEAM_SESSION'];
    if (coaching_format && typeof coaching_format === 'string' && !validFormats.includes(coaching_format)) {
      return res.status(400).json({ error: 'INVALID_COACHING_FORMAT', message: 'Invalid coaching format provided' });
    }

    const offset = (pageNum - 1) * pageSizeNum;
    const limit = pageSizeNum;

    // CSR sees SCHEDULED sessions as "Upcoming" — coach delivers after the meeting
    const conditions: Prisma.Sql[] = [
      Prisma.sql`cs.csr_id = ${userId}`,
      Prisma.sql`cs.status != 'DRAFT'`,
    ];

    if (status && status !== 'all') {
      conditions.push(Prisma.sql`cs.status = ${status}`);
    }

    if (coaching_purpose && coaching_purpose !== 'all') {
      conditions.push(Prisma.sql`cs.coaching_purpose = ${coaching_purpose}`);
    }
    if (coaching_format && coaching_format !== 'all') {
      conditions.push(Prisma.sql`cs.coaching_format = ${coaching_format}`);
    }

    if (startDate) {
      conditions.push(Prisma.sql`DATE(cs.session_date) >= ${startDate}`);
    }

    if (endDate) {
      conditions.push(Prisma.sql`DATE(cs.session_date) <= ${endDate}`);
    }

    if (search && typeof search === 'string' && search.trim() !== '') {
      const sanitizedSearch = search.trim().replace(/[%_]/g, '\\$&');
      const searchTerm = `%${sanitizedSearch}%`;
      conditions.push(
        Prisma.sql`(
          cs.notes LIKE ${searchTerm}
          OR creator.username LIKE ${searchTerm}
          OR EXISTS (
            SELECT 1 FROM coaching_session_topics cst
            JOIN list_items li_t ON cst.topic_id = li_t.id
            WHERE cst.coaching_session_id = cs.id
            AND li_t.label LIKE ${searchTerm}
          )
        )`
      );
    }

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const countResult = await prisma.$queryRaw<{total: bigint}[]>(
      Prisma.sql`
        SELECT COUNT(DISTINCT cs.id) as total
        FROM coaching_sessions cs
        LEFT JOIN users creator ON cs.created_by = creator.id
        LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
        LEFT JOIN list_items li_t ON cst.topic_id = li_t.id
        ${whereClause}
      `
    );
    const totalCount = Number(countResult[0]?.total ?? 0);
    const totalPages = Math.ceil(totalCount / limit);

    const sessions = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT
          cs.id,
          cs.session_date,
          cs.coaching_purpose,
          cs.coaching_format,
          cs.notes,
          cs.status,
          cs.attachment_filename,
          cs.attachment_path,
          cs.due_date,
          cs.follow_up_date,
          creator.username as manager_name,
          cs.created_at,
          GROUP_CONCAT(DISTINCT li_t.label ORDER BY li_t.label SEPARATOR ', ') as topics,
          GROUP_CONCAT(DISTINCT li_t.id ORDER BY li_t.id SEPARATOR ',') as topic_ids,
          (SELECT COUNT(*) FROM coaching_session_quizzes WHERE coaching_session_id = cs.id) as quiz_count,
          (SELECT COUNT(DISTINCT csq2.quiz_id) FROM coaching_session_quizzes csq2
           WHERE csq2.coaching_session_id = cs.id
           AND EXISTS (
             SELECT 1 FROM quiz_attempts qa
             WHERE qa.coaching_session_id = cs.id AND qa.quiz_id = csq2.quiz_id
               AND qa.user_id = ${userId} AND qa.passed = 1
           )) as quiz_passed_count
        FROM coaching_sessions cs
        LEFT JOIN users creator ON cs.created_by = creator.id
        LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
        LEFT JOIN list_items li_t ON cst.topic_id = li_t.id
        ${whereClause}
        GROUP BY
          cs.id, cs.session_date, cs.coaching_purpose, cs.coaching_format,
          cs.notes, cs.status, cs.attachment_filename, cs.attachment_path,
          cs.due_date, cs.follow_up_date, creator.username, cs.created_at
        ORDER BY cs.session_date DESC
        LIMIT ${limit} OFFSET ${offset}
      `
    );

    const transformedSessions = (sessions || []).map((session: any) => ({
      ...session,
      topics: session.topics ? session.topics.split(', ') : [],
      topic_ids: session.topic_ids ? session.topic_ids.split(',').map((id: string) => parseInt(id)) : [],
      quiz_count: Number(session.quiz_count ?? 0),
      quiz_passed_count: Number(session.quiz_passed_count ?? 0),
    }));

    res.json({
      success: true,
      data: {
        sessions: transformedSessions,
        totalCount,
        totalPages,
        currentPage: pageNum,
        pageSize: limit
      }
    });
  } catch (error) {
    logger.error('Error fetching CSR coaching sessions:', error);

    const errorResponse = {
      success: false,
      error: 'FETCH_SESSIONS_ERROR',
      message: 'Failed to fetch coaching sessions',
      timestamp: new Date().toISOString()
    };

    if (process.env.NODE_ENV === 'development') {
      Object.assign(errorResponse, { details: error instanceof Error ? error.message : 'Unknown error' });
    }

    res.status(500).json(errorResponse);
  }
};

/**
 * Get coaching session details for CSR
 */
export const getCSRCoachingSessionDetails = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const sessionId = parseInt(req.params.sessionId);

    if (!sessionId || isNaN(sessionId) || sessionId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_SESSION_ID',
        message: 'Session ID must be a positive number'
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'User not authenticated'
      });
    }

    const sessionRows = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT cs.id, cs.session_date, cs.coaching_purpose, cs.coaching_format, cs.source_type, cs.status,
          cs.notes, cs.required_action,
          cs.require_action_plan, cs.require_acknowledgment,
          cs.quiz_required, cs.quiz_id,
          cs.kb_resource_id, cs.kb_url,
          cs.csr_action_plan, cs.csr_root_cause, cs.csr_support_needed, cs.csr_acknowledged_at,
          cs.delivered_at, cs.completed_at,
          cs.attachment_filename, cs.attachment_path, cs.attachment_size, cs.attachment_mime_type,
          cs.due_date, cs.follow_up_required, cs.follow_up_date, cs.created_at,
          creator.username as created_by_name,
          GROUP_CONCAT(DISTINCT li_t.label ORDER BY li_t.label SEPARATOR ',') as topics,
          GROUP_CONCAT(DISTINCT li_t.id ORDER BY li_t.id SEPARATOR ',') as topic_ids
        FROM coaching_sessions cs
        LEFT JOIN users creator ON cs.created_by = creator.id
        LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
        LEFT JOIN list_items li_t ON cst.topic_id = li_t.id
        WHERE cs.id = ${sessionId} AND cs.csr_id = ${userId}
        GROUP BY cs.id
      `
    );

    if (!sessionRows || sessionRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'SESSION_NOT_FOUND',
        message: 'Coaching session not found or you do not have permission to view it'
      });
    }

    const sessionData = sessionRows[0];

    // Load quizzes from junction table (multi-quiz support)
    const quizJunctionRows = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT q.id, q.quiz_title, q.pass_score FROM coaching_session_quizzes csq
                 JOIN quizzes q ON csq.quiz_id = q.id
                 WHERE csq.coaching_session_id = ${sessionId}`
    );

    const quizzesWithQuestions = await Promise.all(
      quizJunctionRows.map(async (qr: any) => {
        const questionRows = await prisma.$queryRaw<any[]>(
          Prisma.sql`SELECT id, question_text, options, correct_option FROM quiz_questions WHERE quiz_id = ${qr.id} ORDER BY id`
        );
        return { ...qr, questions: questionRows.map((q: any) => ({ ...q, options: JSON.parse(q.options || '[]') })) };
      })
    );

    const allAttempts = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT id, quiz_id, attempt_number, score, passed, submitted_at, answers_json
                 FROM quiz_attempts
                 WHERE coaching_session_id = ${sessionId} AND user_id = ${userId}
                 ORDER BY quiz_id, attempt_number`
    );

    const kbResources = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT r.id, r.title, r.resource_type, r.url, r.file_name, r.description FROM coaching_session_resources csr2
                 JOIN training_resources r ON csr2.resource_id = r.id
                 WHERE csr2.coaching_session_id = ${sessionId}`
    );

    const responseData = {
      ...sessionData,
      topics: sessionData.topics ? sessionData.topics.split(',') : [],
      topic_ids: sessionData.topic_ids ? sessionData.topic_ids.split(',').map((id: string) => parseInt(id)) : [],
      quizzes: quizzesWithQuestions,
      quiz_attempts: allAttempts,
      kb_resources: kbResources,
    };

    res.json({ success: true, data: responseData });
  } catch (error) {
    logger.error('Error fetching CSR coaching session details:', error);

    const errorResponse = {
      success: false,
      error: 'FETCH_SESSION_DETAILS_ERROR',
      message: 'Failed to fetch coaching session details',
      timestamp: new Date().toISOString()
    };

    if (process.env.NODE_ENV === 'development') {
      Object.assign(errorResponse, { details: error instanceof Error ? error.message : 'Unknown error' });
    }

    res.status(500).json(errorResponse);
  }
};

/**
 * Serve a resource file for a CSR — validates the resource is assigned to one of their sessions
 */
export const getCSRResourceFile = async (req: Request, res: Response) => {
  try {
    const userId     = req.user?.user_id;
    const resourceId = parseInt(req.params.resourceId);
    const fs         = require('fs').promises;
    const path       = require('path');

    const rows = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT r.file_path, r.file_mime_type, r.file_name
                 FROM training_resources r
                 WHERE r.id = ${resourceId}
                   AND r.file_path IS NOT NULL
                   AND EXISTS (
                     SELECT 1 FROM coaching_session_resources csr2
                     JOIN coaching_sessions cs ON csr2.coaching_session_id = cs.id
                     WHERE csr2.resource_id = ${resourceId} AND cs.csr_id = ${userId}
                   )`
    );

    if (!rows.length) return res.status(404).json({ success: false, message: 'Resource not found or access denied' });

    const { file_path, file_mime_type, file_name } = rows[0];
    const filePath = path.join(process.cwd(), file_path);

    try { await fs.access(filePath); } catch { return res.status(404).json({ success: false, message: 'File not found on server' }); }

    const stats = await fs.stat(filePath);
    res.setHeader('Content-Type', file_mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `inline; filename="${(file_name || 'file').replace(/"/g, '\\"')}"`);

    const { createReadStream } = require('fs');
    const stream = createReadStream(filePath);
    stream.on('error', () => { if (!res.headersSent) res.status(500).json({ success: false, message: 'Error reading file' }); });
    stream.pipe(res);
  } catch (error) {
    logger.error('[CSR] getCSRResourceFile error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Download coaching session attachment for CSR
 */
export const downloadCSRCoachingAttachment = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const sessionId = parseInt(req.params.sessionId);

    if (!sessionId || isNaN(sessionId) || sessionId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_SESSION_ID',
        message: 'Session ID must be a positive number'
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'User not authenticated'
      });
    }

    const sessionRows = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT
          cs.attachment_filename,
          cs.attachment_path,
          cs.attachment_mime_type
        FROM coaching_sessions cs
        WHERE cs.id = ${sessionId} AND cs.csr_id = ${userId} AND cs.attachment_path IS NOT NULL
      `
    );

    if (!sessionRows || sessionRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'ATTACHMENT_NOT_FOUND',
        message: 'Attachment not found or you do not have permission to access it'
      });
    }

    const session = sessionRows[0];
    const fs = require('fs').promises;
    const path = require('path');

    const sanitizedPath = path.normalize(session.attachment_path).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(process.cwd(), sanitizedPath);

    const allowedDir = path.join(process.cwd(), 'uploads');
    if (!filePath.startsWith(allowedDir)) {
      return res.status(403).json({
        success: false,
        error: 'ACCESS_DENIED',
        message: 'Access to file denied'
      });
    }

    try {
      const stats = await fs.stat(filePath);

      const maxSize = 50 * 1024 * 1024;
      if (stats.size > maxSize) {
        return res.status(413).json({
          success: false,
          error: 'FILE_TOO_LARGE',
          message: 'File too large to download'
        });
      }

      const allowedTypes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
        'image/jpeg',
        'image/png',
        'image/gif'
      ];

      const mimeType = session.attachment_mime_type || 'application/octet-stream';
      if (!allowedTypes.includes(mimeType)) {
        return res.status(415).json({
          success: false,
          error: 'UNSUPPORTED_FILE_TYPE',
          message: 'File type not supported for download'
        });
      }

      res.setHeader('Content-Disposition', `attachment; ${escapeFilename(session.attachment_filename)}`);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', stats.size.toString());

      const fileBuffer = await fs.readFile(filePath);
      res.send(fileBuffer);
    } catch (fileError) {
      logger.error('File access error:', fileError);
      res.status(404).json({
        success: false,
        error: 'FILE_NOT_FOUND',
        message: 'File not found on server'
      });
    }
  } catch (error) {
    logger.error('Error downloading coaching attachment:', error);

    const errorResponse = {
      success: false,
      error: 'DOWNLOAD_ATTACHMENT_ERROR',
      message: 'Failed to download attachment',
      timestamp: new Date().toISOString()
    };

    if (process.env.NODE_ENV === 'development') {
      Object.assign(errorResponse, { details: error instanceof Error ? error.message : 'Unknown error' });
    }

    res.status(500).json(errorResponse);
  }
};

/**
 * CSR submits their response to a delivered coaching session
 */
export const submitCSRResponse = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const sessionId = parseInt(req.params.id);
    const { action_plan, root_cause, support_needed, acknowledged } = req.body;

    if (!sessionId || isNaN(sessionId)) {
      return res.status(400).json({ success: false, message: 'Invalid session ID' });
    }

    const rows = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT id, status, require_action_plan, require_acknowledgment, quiz_required FROM coaching_sessions WHERE id = ${sessionId} AND csr_id = ${userId}`
    );

    if (!rows.length) return res.status(404).json({ success: false, message: 'Session not found or access denied' });

    const session = rows[0];
    if (!['SCHEDULED', 'AWAITING_CSR_ACTION'].includes(session.status)) {
      return res.status(400).json({ success: false, message: 'Session is not awaiting a CSR response' });
    }

    if (session.require_action_plan && (!action_plan || action_plan.length < 50)) {
      return res.status(400).json({ success: false, message: 'Action plan must be at least 50 characters' });
    }

    if (session.require_acknowledgment && acknowledged !== true) {
      return res.status(400).json({ success: false, message: 'Acknowledgment is required' });
    }

    // Save the CSR response (do not touch status yet)
    await prisma.$executeRaw(
      Prisma.sql`UPDATE coaching_sessions SET
        csr_action_plan     = ${action_plan    || null},
        csr_root_cause      = ${root_cause     || null},
        csr_support_needed  = ${support_needed || null},
        csr_acknowledged_at = ${acknowledged === true ? new Date() : null}
        WHERE id = ${sessionId}`
    );

    // Auto-advance: check if ALL CSR requirements are now satisfied
    const advancedTo = await applyAutoAdvance(sessionId, userId);

    res.json({ success: true, message: 'Response submitted', data: { new_status: advancedTo ?? session.status } });
  } catch (error) {
    logger.error('[CSR] submitCSRResponse error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
