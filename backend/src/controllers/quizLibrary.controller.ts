import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';

interface AuthReq extends Request {
  user?: { user_id: number; role: string };
}

export const getQuizLibrary = async (req: AuthReq, res: Response) => {
  try {
    const { topic_id, search } = req.query;

    const conditions: Prisma.Sql[] = [];
    if (topic_id) conditions.push(Prisma.sql`q.topic_id = ${parseInt(topic_id as string)}`);
    if (search) conditions.push(Prisma.sql`q.quiz_title LIKE ${'%' + search + '%'}`);

    const whereClause = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.sql``;

    const quizzes = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT q.id, q.quiz_title, q.pass_score, q.topic_id, q.course_id,
          t.topic_name,
          (SELECT COUNT(*) FROM quiz_questions qq WHERE qq.quiz_id = q.id) as question_count,
          (SELECT COUNT(*) FROM coaching_sessions cs WHERE cs.quiz_id = q.id) as times_used
        FROM quizzes q
        LEFT JOIN topics t ON q.topic_id = t.id
        ${whereClause}
        ORDER BY q.quiz_title ASC
      `
    );

    res.json({ success: true, data: quizzes.map((q: any) => ({ ...q, question_count: Number(q.question_count), times_used: Number(q.times_used) })) });
  } catch (error) {
    console.error('[QUIZ_LIB] getQuizLibrary error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const createLibraryQuiz = async (req: AuthReq, res: Response) => {
  try {
    const { quiz_title, pass_score, topic_id, course_id, questions } = req.body;

    if (!quiz_title) return res.status(400).json({ success: false, message: 'quiz_title is required' });
    if (pass_score === undefined || pass_score < 1 || pass_score > 100) return res.status(400).json({ success: false, message: 'pass_score must be between 1 and 100' });
    if (!Array.isArray(questions) || !questions.length) return res.status(400).json({ success: false, message: 'At least one question is required' });

    for (const q of questions) {
      if (!q.question_text) return res.status(400).json({ success: false, message: 'Each question must have question_text' });
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) return res.status(400).json({ success: false, message: 'Each question must have 2-4 options' });
      if (q.correct_option === undefined || q.correct_option < 0 || q.correct_option >= q.options.length) return res.status(400).json({ success: false, message: 'correct_option must be a valid 0-based index' });
    }

    const resolvedCourseId = course_id ? parseInt(course_id) : await getDefaultCourseId();
    if (!resolvedCourseId) return res.status(400).json({ success: false, message: 'course_id is required or no default course exists' });

    const newId = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO quizzes (course_id, quiz_title, pass_score, topic_id) VALUES (${resolvedCourseId}, ${quiz_title}, ${parseFloat(pass_score)}, ${topic_id ? parseInt(topic_id) : null})`
      );
      const [{ id }] = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT LAST_INSERT_ID() as id`);
      const quizId = Number(id);
      for (const q of questions) {
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO quiz_questions (quiz_id, question_text, options, correct_option) VALUES (${quizId}, ${q.question_text}, ${JSON.stringify(q.options)}, ${q.correct_option})`
        );
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
    const { quiz_title, pass_score, topic_id, questions } = req.body;

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
      if (quiz_title !== undefined) parts.push(Prisma.sql`quiz_title = ${quiz_title}`);
      if (pass_score !== undefined) parts.push(Prisma.sql`pass_score = ${parseFloat(pass_score)}`);
      if (topic_id !== undefined) parts.push(Prisma.sql`topic_id = ${topic_id ? parseInt(topic_id) : null}`);
      if (parts.length) await tx.$executeRaw(Prisma.sql`UPDATE quizzes SET ${Prisma.join(parts, ', ')} WHERE id = ${quizId}`);

      if (Array.isArray(questions)) {
        await tx.quizQuestion.deleteMany({ where: { quiz_id: quizId } });
        for (const q of questions) {
          await tx.$executeRaw(
            Prisma.sql`INSERT INTO quiz_questions (quiz_id, question_text, options, correct_option) VALUES (${quizId}, ${q.question_text}, ${JSON.stringify(q.options)}, ${q.correct_option})`
          );
        }
      }
    });

    res.json({ success: true, message: 'Quiz updated' });
  } catch (error) {
    console.error('[QUIZ_LIB] updateLibraryQuiz error:', error);
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
