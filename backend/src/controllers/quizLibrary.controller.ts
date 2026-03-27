import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';

interface AuthReq extends Request {
  user?: { user_id: number; role: string };
}

function parseTopicIds(raw: any): number[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(Number).filter(Boolean);
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p.map(Number).filter(Boolean) : []; }
    catch { return raw.split(',').map(s => parseInt(s.trim())).filter(Boolean); }
  }
  return [];
}

function mapQuiz(q: any) {
  return {
    ...q,
    is_active:      Boolean(Number(q.is_active)),
    pass_score:     Number(q.pass_score),
    question_count: Number(q.question_count),
    times_used:     Number(q.times_used),
    topic_ids:      q.topic_ids   ? q.topic_ids.split(',').map(Number)  : [],
    topic_names:    q.topic_names ? q.topic_names.split(', ')            : [],
  };
}

export const getQuizLibrary = async (req: AuthReq, res: Response) => {
  try {
    const { topic_id, search, is_active } = req.query;

    const conditions: Prisma.Sql[] = [];
    if (search) conditions.push(Prisma.sql`q.quiz_title LIKE ${'%' + search + '%'}`);
    if (topic_id) conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM quiz_topics qt2 WHERE qt2.quiz_id = q.id AND qt2.topic_id = ${parseInt(topic_id as string)})`);
    if (is_active === 'true')  conditions.push(Prisma.sql`q.is_active = 1`);
    if (is_active === 'false') conditions.push(Prisma.sql`q.is_active = 0`);

    const whereClause = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.sql``;

    const quizzes = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT q.id, q.quiz_title, q.pass_score, q.topic_id, q.course_id, q.is_active,
          (SELECT COUNT(*) FROM quiz_questions qq WHERE qq.quiz_id = q.id) as question_count,
          (SELECT COUNT(*) FROM coaching_sessions cs WHERE cs.quiz_id = q.id) as times_used,
          GROUP_CONCAT(DISTINCT ta.id ORDER BY ta.id SEPARATOR ',') as topic_ids,
          GROUP_CONCAT(DISTINCT ta.topic_name ORDER BY ta.topic_name SEPARATOR '|||') as topic_names
        FROM quizzes q
        LEFT JOIN quiz_topics qt ON q.id = qt.quiz_id
        LEFT JOIN topics ta ON qt.topic_id = ta.id AND ta.is_active = 1
        ${whereClause}
        GROUP BY q.id
        ORDER BY q.quiz_title ASC
      `
    );

    res.json({ success: true, data: quizzes.map(mapQuiz) });
  } catch (error) {
    console.error('[QUIZ_LIB] getQuizLibrary error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getLibraryQuizDetail = async (req: AuthReq, res: Response) => {
  try {
    const quizId = parseInt(req.params.id);
    const rows = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT q.id, q.quiz_title, q.pass_score, q.topic_id, q.course_id, q.is_active,
          GROUP_CONCAT(DISTINCT ta.id ORDER BY ta.id SEPARATOR ',') as topic_ids,
          GROUP_CONCAT(DISTINCT ta.topic_name ORDER BY ta.topic_name SEPARATOR '|||') as topic_names
        FROM quizzes q
        LEFT JOIN quiz_topics qt ON q.id = qt.quiz_id
        LEFT JOIN topics ta ON qt.topic_id = ta.id AND ta.is_active = 1
        WHERE q.id = ${quizId}
        GROUP BY q.id
      `
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Quiz not found' });

    const questions = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT id, question_text, options, correct_option FROM quiz_questions WHERE quiz_id = ${quizId} ORDER BY id`
    );

    const quiz = {
      ...mapQuiz(rows[0]),
      questions: questions.map((q: any) => ({
        ...q,
        id:             Number(q.id),
        correct_option: Number(q.correct_option),
        options:        JSON.parse(q.options || '[]'),
      })),
    };

    res.json({ success: true, data: quiz });
  } catch (error) {
    console.error('[QUIZ_LIB] getLibraryQuizDetail error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const createLibraryQuiz = async (req: AuthReq, res: Response) => {
  try {
    const { quiz_title, pass_score, topic_id, topic_ids: rawTopicIds, course_id, is_active, questions } = req.body;
    const topicIds = parseTopicIds(rawTopicIds);
    const active   = is_active === false || is_active === 'false' ? 0 : 1;

    if (!quiz_title) return res.status(400).json({ success: false, message: 'quiz_title is required' });
    if (pass_score === undefined || pass_score < 1 || pass_score > 100) return res.status(400).json({ success: false, message: 'pass_score must be between 1 and 100' });
    if (!Array.isArray(questions) || !questions.length) return res.status(400).json({ success: false, message: 'At least one question is required' });

    for (const q of questions) {
      if (!q.question_text) return res.status(400).json({ success: false, message: 'Each question must have question_text' });
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) return res.status(400).json({ success: false, message: 'Each question must have 2-4 options' });
      if (q.correct_option === undefined || q.correct_option < 0 || q.correct_option >= q.options.length) return res.status(400).json({ success: false, message: 'correct_option must be a valid 0-based index' });
    }

    const resolvedCourseId = course_id ? parseInt(course_id) : await getDefaultCourseId();
    if (!resolvedCourseId) return res.status(400).json({ success: false, message: 'No published course found for quiz assignment' });

    const primaryTopicId = topicIds[0] ?? (topic_id ? parseInt(topic_id) : null);

    const newId = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO quizzes (course_id, quiz_title, pass_score, topic_id, is_active) VALUES (${resolvedCourseId}, ${quiz_title}, ${parseFloat(pass_score)}, ${primaryTopicId}, ${active})`
      );
      const [{ id }] = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT LAST_INSERT_ID() as id`);
      const quizId = Number(id);
      for (const q of questions) {
        await tx.$executeRaw(Prisma.sql`INSERT INTO quiz_questions (quiz_id, question_text, options, correct_option) VALUES (${quizId}, ${q.question_text}, ${JSON.stringify(q.options)}, ${q.correct_option})`);
      }
      for (const tid of topicIds) {
        await tx.$executeRaw(Prisma.sql`INSERT IGNORE INTO quiz_topics (quiz_id, topic_id) VALUES (${quizId}, ${tid})`);
      }
      return quizId;
    });

    res.status(201).json({ success: true, data: { id: newId }, message: 'Quiz created' });
  } catch (error) {
    console.error('[QUIZ_LIB] createLibraryQuiz error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const updateLibraryQuiz = async (req: AuthReq, res: Response) => {
  try {
    const quizId = parseInt(req.params.id);
    const { quiz_title, pass_score, topic_id, topic_ids: rawTopicIds, is_active, questions } = req.body;
    const topicIds = rawTopicIds !== undefined ? parseTopicIds(rawTopicIds) : null;

    const existing = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT id FROM quizzes WHERE id = ${quizId}`);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Quiz not found' });

    if (questions !== undefined) {
      if (!Array.isArray(questions) || !questions.length) return res.status(400).json({ success: false, message: 'At least one question is required' });
      for (const q of questions) {
        if (!q.question_text) return res.status(400).json({ success: false, message: 'Each question must have question_text' });
        if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) return res.status(400).json({ success: false, message: 'Each question must have 2-4 options' });
        if (q.correct_option === undefined || q.correct_option < 0 || q.correct_option >= q.options.length) return res.status(400).json({ success: false, message: 'correct_option must be a valid 0-based index' });
      }
    }

    await prisma.$transaction(async (tx) => {
      const parts: Prisma.Sql[] = [];
      if (quiz_title  !== undefined) parts.push(Prisma.sql`quiz_title = ${quiz_title}`);
      if (pass_score  !== undefined) parts.push(Prisma.sql`pass_score = ${parseFloat(pass_score)}`);
      if (is_active   !== undefined) parts.push(Prisma.sql`is_active = ${is_active === true || is_active === 'true' ? 1 : 0}`);

      if (topicIds !== null && topicIds.length > 0) {
        parts.push(Prisma.sql`topic_id = ${topicIds[0]}`);
      } else if (topic_id !== undefined) {
        parts.push(Prisma.sql`topic_id = ${topic_id ? parseInt(topic_id) : null}`);
      }

      if (parts.length) await tx.$executeRaw(Prisma.sql`UPDATE quizzes SET ${Prisma.join(parts, ', ')} WHERE id = ${quizId}`);

      if (Array.isArray(questions)) {
        await tx.quizQuestion.deleteMany({ where: { quiz_id: quizId } });
        for (const q of questions) {
          await tx.$executeRaw(Prisma.sql`INSERT INTO quiz_questions (quiz_id, question_text, options, correct_option) VALUES (${quizId}, ${q.question_text}, ${JSON.stringify(q.options)}, ${q.correct_option})`);
        }
      }

      if (topicIds !== null) {
        await tx.$executeRaw(Prisma.sql`DELETE FROM quiz_topics WHERE quiz_id = ${quizId}`);
        for (const tid of topicIds) {
          await tx.$executeRaw(Prisma.sql`INSERT IGNORE INTO quiz_topics (quiz_id, topic_id) VALUES (${quizId}, ${tid})`);
        }
      }
    });

    res.json({ success: true, message: 'Quiz updated' });
  } catch (error) {
    console.error('[QUIZ_LIB] updateLibraryQuiz error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const toggleQuizStatus = async (req: AuthReq, res: Response) => {
  try {
    const quizId = parseInt(req.params.id);
    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT id, is_active FROM quizzes WHERE id = ${quizId}`);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Quiz not found' });
    const newStatus = rows[0].is_active ? 0 : 1;
    await prisma.$executeRaw(Prisma.sql`UPDATE quizzes SET is_active = ${newStatus} WHERE id = ${quizId}`);
    res.json({ success: true, is_active: Boolean(newStatus) });
  } catch (error) {
    console.error('[QUIZ_LIB] toggleQuizStatus error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const deleteLibraryQuiz = async (req: AuthReq, res: Response) => {
  try {
    const quizId = parseInt(req.params.id);
    const existing = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT id FROM quizzes WHERE id = ${quizId}`);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Quiz not found' });
    const attemptCount = await prisma.$queryRaw<{ cnt: bigint }[]>(Prisma.sql`SELECT COUNT(*) as cnt FROM quiz_attempts WHERE quiz_id = ${quizId}`);
    if (Number(attemptCount[0]?.cnt ?? 0) > 0) {
      return res.status(409).json({ success: false, message: 'This quiz has recorded attempts and cannot be deleted' });
    }
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`DELETE FROM quiz_topics WHERE quiz_id = ${quizId}`);
      await tx.quizQuestion.deleteMany({ where: { quiz_id: quizId } });
      await tx.$executeRaw(Prisma.sql`DELETE FROM quizzes WHERE id = ${quizId}`);
    });
    res.json({ success: true, message: 'Quiz deleted' });
  } catch (error) {
    console.error('[QUIZ_LIB] deleteLibraryQuiz error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const getDefaultCourseId = async (): Promise<number | null> => {
  const rows = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT id FROM courses WHERE is_draft = 0 ORDER BY id ASC LIMIT 1`);
  return rows[0]?.id ?? null;
};
