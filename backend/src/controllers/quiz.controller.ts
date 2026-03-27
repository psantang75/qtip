import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';

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

    const attemptCountRows = await prisma.$queryRaw<{ cnt: bigint }[]>(
      Prisma.sql`SELECT COUNT(*) as cnt FROM quiz_attempts WHERE quiz_id = ${quizId} AND user_id = ${userId} ${sessionId ? Prisma.sql`AND coaching_session_id = ${sessionId}` : Prisma.sql``}`
    );
    const attemptNumber = Number(attemptCountRows[0]?.cnt ?? 0) + 1;

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO quiz_attempts (quiz_id, user_id, coaching_session_id, answers_json, score, passed, attempt_number)
          VALUES (${quizId}, ${userId}, ${sessionId}, ${JSON.stringify(answers)}, ${score}, ${passed ? 1 : 0}, ${attemptNumber})`
      );

      if (passed && sessionId) {
        const csRows = await tx.$queryRaw<any[]>(Prisma.sql`SELECT status FROM coaching_sessions WHERE id = ${sessionId}`);
        if (csRows.length && csRows[0].status === 'QUIZ_PENDING') {
          await tx.$executeRaw(Prisma.sql`UPDATE coaching_sessions SET status = 'COMPLETED', completed_at = NOW() WHERE id = ${sessionId}`);
        }
      }
    });

    res.json({
      success: true,
      data: { score, passed, pass_score: parseFloat(quiz.pass_score), attempt_number: attemptNumber, correct_answers: correctAnswers },
    });
  } catch (error) {
    console.error('[QUIZ] submitQuizAttempt error:', error);
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
    console.error('[QUIZ] getMyAttempts error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
