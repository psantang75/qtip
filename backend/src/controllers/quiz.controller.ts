import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import { applyAutoAdvance } from '../utils/coachingAutoAdvance';
import logger from '../config/logger';

interface AuthReq extends Request {
  user?: { user_id: number; role: string };
}

export const submitQuizAttempt = async (req: AuthReq, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const quizId = parseInt(req.params.quizId);
    const { coaching_session_id, answers } = req.body;

    if (!quizId || isNaN(quizId)) return res.status(400).json({ success: false, message: 'Invalid quiz ID' });
    if (!Array.isArray(answers) || !answers.length) return res.status(400).json({ success: false, message: 'answers array is required' });

    const quizRows = await prisma.$queryRaw<any[]>(Prisma.sql`SELECT id, pass_score FROM quizzes WHERE id = ${quizId}`);
    if (!quizRows.length) return res.status(404).json({ success: false, message: 'Quiz not found' });
    const quiz = quizRows[0];

    const questions = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT id, correct_option FROM quiz_questions WHERE quiz_id = ${quizId}`
    );
    if (!questions.length) return res.status(400).json({ success: false, message: 'Quiz has no questions' });

    const correctMap = new Map(questions.map((q: any) => [q.id, q.correct_option]));
    const correctAnswers: number[] = [];
    let correctCount = 0;

    for (const answer of answers) {
      const { question_id, selected_option } = answer;
      if (correctMap.get(question_id) === selected_option) {
        correctCount++;
        correctAnswers.push(question_id);
      }
    }

    const score = parseFloat(((correctCount / questions.length) * 100).toFixed(2));
    const passed = score >= parseFloat(quiz.pass_score);

    const sessionId = coaching_session_id ? parseInt(coaching_session_id) : null;
    if (coaching_session_id !== undefined && coaching_session_id !== null && (sessionId === null || isNaN(sessionId))) {
      return res.status(400).json({ success: false, message: 'Invalid coaching_session_id' });
    }

    // Verify the caller actually owns the coaching session before we mutate
    // session state or write quiz_attempts/audit rows for it. Without this
    // check, a leaked session id would let any authenticated user submit
    // attempts (and trigger auto-advance) on someone else's session.
    if (sessionId !== null) {
      const sessionRows = await prisma.$queryRaw<{ csr_id: number }[]>(
        Prisma.sql`SELECT csr_id FROM coaching_sessions WHERE id = ${sessionId}`
      );
      if (!sessionRows.length) {
        return res.status(404).json({ success: false, message: 'Coaching session not found' });
      }
      if (Number(sessionRows[0].csr_id) !== Number(userId)) {
        return res.status(403).json({ success: false, message: 'You are not authorized to submit a quiz attempt for this coaching session' });
      }
    }

    const attemptCountRows = await prisma.$queryRaw<{ cnt: bigint }[]>(
      Prisma.sql`SELECT COUNT(*) as cnt FROM quiz_attempts WHERE quiz_id = ${quizId} AND user_id = ${userId} ${sessionId ? Prisma.sql`AND coaching_session_id = ${sessionId}` : Prisma.sql``}`
    );
    const attemptNumber = Number(attemptCountRows[0]?.cnt ?? 0) + 1;

    // Insert the attempt
    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO quiz_attempts (quiz_id, user_id, coaching_session_id, answers_json, score, passed, attempt_number)
        VALUES (${quizId}, ${userId}, ${sessionId}, ${JSON.stringify(answers)}, ${score}, ${passed ? 1 : 0}, ${attemptNumber})`
    );

    // Auto-advance if this was a pass and the session is awaiting CSR action
    if (passed && sessionId) {
      await applyAutoAdvance(sessionId, userId);
    }

    res.json({
      success: true,
      data: { score, passed, pass_score: parseFloat(quiz.pass_score), attempt_number: attemptNumber, correct_answers: correctAnswers },
    });
  } catch (error) {
    logger.error('[QUIZ] submitQuizAttempt error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getMyAttempts = async (req: AuthReq, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const quizId = parseInt(req.params.quizId);

    if (!quizId || isNaN(quizId)) return res.status(400).json({ success: false, message: 'Invalid quiz ID' });

    const attempts = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT id, attempt_number, score, passed, submitted_at, coaching_session_id
        FROM quiz_attempts
        WHERE quiz_id = ${quizId} AND user_id = ${userId}
        ORDER BY attempt_number ASC
      `
    );

    res.json({ success: true, data: attempts });
  } catch (error) {
    logger.error('[QUIZ] getMyAttempts error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
