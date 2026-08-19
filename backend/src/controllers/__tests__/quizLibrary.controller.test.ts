/**
 * Controller/HTTP-layer tests for the quiz-library controller (Phase 2.2
 * error-envelope migration). Every handler moved off the legacy
 * `res.status(n).json({ success:false, message })` shape onto `asyncHandler` +
 * thrown `AppError`. These drive the validation / not-found / conflict branches
 * and assert the handler forwards an `AppError` with the SAME status code and
 * message to `next`. Prisma is mocked, so they run without a database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/prisma', () => {
  const db = {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
    quizQuestion: { deleteMany: vi.fn() },
  };
  return { default: db };
});

import prisma from '../../config/prisma';
import { AppError, ErrorType } from '../../utils/errorHandler';
import {
  getLibraryQuizDetail,
  createLibraryQuiz,
  updateLibraryQuiz,
  toggleQuizStatus,
  deleteLibraryQuiz,
} from '../quizLibrary.controller';

const db = prisma as unknown as { $queryRaw: ReturnType<typeof vi.fn> };

function mockRes() {
  const res: {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  } = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res;
}

async function runExpectError(
  handler: (req: never, res: never, next: never) => unknown,
  req: Record<string, unknown>,
): Promise<AppError> {
  const res = mockRes();
  const next = vi.fn();
  await handler(req as never, res as never, next as never);
  expect(next).toHaveBeenCalledTimes(1);
  expect(res.json).not.toHaveBeenCalled();
  const err = next.mock.calls[0][0];
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getLibraryQuizDetail', () => {
  it('404 when the quiz is not found', async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    const err = await runExpectError(getLibraryQuizDetail, { params: { id: '5' } });
    expect(err.statusCode).toBe(404);
    expect(err.type).toBe(ErrorType.NOT_FOUND_ERROR);
    expect(err.message).toBe('Quiz not found');
  });
});

describe('createLibraryQuiz — validation', () => {
  it('400 when quiz_title is missing', async () => {
    const err = await runExpectError(createLibraryQuiz, { body: {} });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('quiz_title is required');
  });

  it('400 when pass_score is out of range', async () => {
    const err = await runExpectError(createLibraryQuiz, { body: { quiz_title: 'Q', pass_score: 0 } });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('pass_score must be between 1 and 100');
  });

  it('400 when there are no questions', async () => {
    const err = await runExpectError(createLibraryQuiz, { body: { quiz_title: 'Q', pass_score: 80, questions: [] } });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('At least one question is required');
  });

  it('400 when a question has too few options', async () => {
    const err = await runExpectError(createLibraryQuiz, {
      body: { quiz_title: 'Q', pass_score: 80, questions: [{ question_text: 'x', options: ['a'], correct_option: 0 }] },
    });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Each question must have 2-4 options');
  });
});

describe('updateLibraryQuiz', () => {
  it('404 when the quiz does not exist', async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    const err = await runExpectError(updateLibraryQuiz, { params: { id: '5' }, body: {} });
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Quiz not found');
  });

  it('400 when questions are supplied but empty', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ id: 5 }]);
    const err = await runExpectError(updateLibraryQuiz, { params: { id: '5' }, body: { questions: [] } });
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('At least one question is required');
  });
});

describe('toggleQuizStatus', () => {
  it('404 when the quiz is not found', async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    const err = await runExpectError(toggleQuizStatus, { params: { id: '5' } });
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Quiz not found');
  });
});

describe('deleteLibraryQuiz', () => {
  it('404 when the quiz is not found', async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    const err = await runExpectError(deleteLibraryQuiz, { params: { id: '5' } });
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Quiz not found');
  });

  it('409 when the quiz has recorded attempts', async () => {
    db.$queryRaw
      .mockResolvedValueOnce([{ id: 5 }]) // existing quiz
      .mockResolvedValueOnce([{ cnt: 3n }]); // attempt count > 0
    const err = await runExpectError(deleteLibraryQuiz, { params: { id: '5' } });
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe('This quiz has recorded attempts and cannot be deleted');
  });
});
