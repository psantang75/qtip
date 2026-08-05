/**
 * The re-submit half of the unlock round trip.
 *
 * `promoteDraftToSubmitted` is shared with the AI Reviewer's promote flow, so
 * the one thing that must differ for a correction is pinned here: a reopened
 * review keeps its original `submitted_at`. Without that, fixing a July audit
 * in August silently moves it into August's numbers and every trend that
 * buckets on review date shifts underneath the report.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/prisma', () => {
  const db = {
    submission: { findUnique: vi.fn(), update: vi.fn() },
    submissionAnswer: { deleteMany: vi.fn(), createMany: vi.fn() },
    submissionMetadata: { deleteMany: vi.fn(), createMany: vi.fn() },
    formCategory: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(db)),
  };
  return { default: db };
});
vi.mock('../../../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../utils/scoringUtil', () => ({
  calculateFormScoreBySubmissionId: vi.fn(async () => ({ total_score: 94.5 })),
  recalculateScores: vi.fn(),
  getScoreBreakdown: vi.fn(),
}));
vi.mock('../../qa/qa.submissions.notify', () => ({ notifySubmissionGraded: vi.fn(async () => undefined) }));

import prisma from '../../../config/prisma';
import { SubmissionService } from '../../SubmissionService';
import type { MySQLSubmissionRepository } from '../../../repositories/MySQLSubmissionRepository';

type Mock = ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  submission: { findUnique: Mock; update: Mock }
  submissionAnswer: { deleteMany: Mock; createMany: Mock }
  submissionMetadata: { deleteMany: Mock; createMany: Mock }
};

const QA = 4;
const ORIGINAL_SUBMITTED_AT = new Date('2026-07-02T13:00:00.000Z');

const updateSubmissionScore = vi.fn(async () => undefined);
const repo = {
  getConnection: () => ({}),
  updateSubmissionScore,
} as unknown as MySQLSubmissionRepository;

const service = new SubmissionService(repo);

const edits = { answers: [{ question_id: 1, answer: 'YES', notes: '' }] };

/** The `data` payload of the submission status flip. */
const flip = () => db.submission.update.mock.calls[0][0].data;

beforeEach(() => {
  db.submission.findUnique.mockReset().mockResolvedValue({
    id: 100,
    form_id: 12,
    status: 'DRAFT',
    submitted_at: ORIGINAL_SUBMITTED_AT,
    submission_answers: [{ question_id: 1, answer: 'NO' }],
    submission_ticket_tasks: [],
    submission_calls: [],
  });
  db.submission.update.mockReset().mockResolvedValue({});
  db.submissionAnswer.deleteMany.mockReset().mockResolvedValue({});
  db.submissionAnswer.createMany.mockReset().mockResolvedValue({});
  db.submissionMetadata.deleteMany.mockReset().mockResolvedValue({});
  db.submissionMetadata.createMany.mockReset().mockResolvedValue({});
  updateSubmissionScore.mockClear();
});

describe('promoteDraftToSubmitted — metadata replacement', () => {
  it('replaces the metadata the caller sent', async () => {
    await service.promoteDraftToSubmitted(
      100,
      { ...edits, metadata: [{ field_id: 7, value: 'Cheryl Campbell' }] },
      QA,
      { preserveSubmittedAt: true, preserveSubmittedBy: true },
    );

    expect(db.submissionMetadata.deleteMany).toHaveBeenCalled();
    expect(db.submissionMetadata.createMany).toHaveBeenCalled();
  });

  it('treats an empty array as "nothing sent" so a bad request cannot wipe the reviewer and agent', async () => {
    await service.promoteDraftToSubmitted(100, { ...edits, metadata: [] }, QA, {
      preserveSubmittedAt: true,
      preserveSubmittedBy: true,
    });

    expect(db.submissionMetadata.deleteMany).not.toHaveBeenCalled();
    expect(db.submissionMetadata.createMany).not.toHaveBeenCalled();
  });
});

describe('promoteDraftToSubmitted — preserveSubmittedAt / preserveSubmittedBy', () => {
  it('leaves the original review date alone on a correction', async () => {
    await service.promoteDraftToSubmitted(100, edits, QA, { preserveSubmittedAt: true });

    expect(flip()).toMatchObject({ status: 'SUBMITTED' });
    expect(flip()).not.toHaveProperty('submitted_at');
  });

  it('still stamps a fresh date for the AI promote path, which never submitted before', async () => {
    await service.promoteDraftToSubmitted(100, edits, QA);
    expect(flip().submitted_at).toBeInstanceOf(Date);
  });

  it('leaves authorship with the original reviewer when someone else corrects it', async () => {
    await service.promoteDraftToSubmitted(100, edits, QA, {
      preserveSubmittedAt: true,
      preserveSubmittedBy: true,
    });

    expect(flip()).not.toHaveProperty('submitted_by');
  });

  it('hands authorship to the human on the AI promote path, where they own the draft', async () => {
    await service.promoteDraftToSubmitted(100, edits, QA);
    expect(flip().submitted_by).toBe(QA);
  });

  it('re-scores the corrected answers and returns the new score for the unlock event', async () => {
    const result = await service.promoteDraftToSubmitted(100, edits, QA, { preserveSubmittedAt: true });

    expect(result.total_score).toBe(94.5);
    expect(updateSubmissionScore).toHaveBeenCalledWith(100, 94.5);
    expect(db.submissionAnswer.createMany).toHaveBeenCalled();
  });

  it('refuses anything that is not sitting in DRAFT, so a re-submit cannot run twice', async () => {
    db.submission.findUnique.mockResolvedValue({
      id: 100, form_id: 12, status: 'SUBMITTED', submitted_at: ORIGINAL_SUBMITTED_AT,
      submission_answers: [], submission_ticket_tasks: [], submission_calls: [],
    });

    await expect(
      service.promoteDraftToSubmitted(100, edits, QA, { preserveSubmittedAt: true }),
    ).rejects.toMatchObject({ code: 'NOT_A_DRAFT', statusCode: 409 });
  });
});
