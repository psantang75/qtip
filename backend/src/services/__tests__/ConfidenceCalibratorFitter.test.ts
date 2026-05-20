/**
 * Tier-1 Item 3 — per-question calibration fitter.
 *
 * `fitPerQuestionBins(formId)` joins ai_calibration_data ↔ submission
 * answers, buckets samples by question_id, and emits a
 * `Record<questionId, { bins, fallback }>` for any question with
 * `>= PER_QUESTION_MIN_SAMPLES` samples (20). Questions below the
 * threshold are silently skipped — they fall back to per-form bins
 * via `applyAnswerCalibration`.
 *
 * These tests pin the buckets-by-question + threshold behaviour
 * without exercising the actual prisma client (mocked).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { calibrationDataMock, submissionAnswerMock } = vi.hoisted(() => ({
  calibrationDataMock: vi.fn(),
  submissionAnswerMock: vi.fn(),
}));

vi.mock('../../config/prisma', () => ({
  default: {
    aiCalibrationData: { findMany: calibrationDataMock },
    submissionAnswer: { findMany: submissionAnswerMock },
  },
}));

import { fitPerQuestionBins } from '../ConfidenceCalibratorFitter';

/**
 * Build N synthetic submissions for the given form. Each submission
 * carries the same set of question answers, with the AI's confidence
 * for question `qid` deterministically driven by `confFn(submissionIdx)`
 * and the human/AI agreement driven by `agreedFn(submissionIdx)`.
 *
 * Returns the {calibrationData, submissionAnswers} pair the prisma
 * mocks should resolve.
 */
function makeSubmissions(opts: {
  formId: number;
  count: number;
  questions: Array<{
    qid: number;
    confFn: (i: number) => number;
    agreedFn: (i: number) => boolean;
  }>;
}) {
  const calibrationData: Array<{
    ai_answers: Record<string, string>;
    human_answers: Record<string, string>;
    ai_submission_id: number;
  }> = [];
  const submissionAnswers: Array<{
    submission_id: number;
    question_id: number;
    ai_confidence: number | null;
  }> = [];
  for (let i = 0; i < opts.count; i++) {
    const aiAnswers: Record<string, string> = {};
    const humanAnswers: Record<string, string> = {};
    for (const q of opts.questions) {
      const aiVal = 'yes';
      aiAnswers[String(q.qid)] = aiVal;
      humanAnswers[String(q.qid)] = q.agreedFn(i) ? aiVal : 'no';
      submissionAnswers.push({
        submission_id: 1000 + i,
        question_id: q.qid,
        ai_confidence: q.confFn(i),
      });
    }
    calibrationData.push({
      ai_answers: aiAnswers,
      human_answers: humanAnswers,
      ai_submission_id: 1000 + i,
    });
  }
  return { calibrationData, submissionAnswers };
}

describe('fitPerQuestionBins', () => {
  beforeEach(() => {
    calibrationDataMock.mockReset();
    submissionAnswerMock.mockReset();
  });

  it('returns empty object when no calibration data exists', async () => {
    calibrationDataMock.mockResolvedValue([]);
    const out = await fitPerQuestionBins(7);
    expect(out).toEqual({});
    expect(submissionAnswerMock).not.toHaveBeenCalled();
  });

  it('skips questions below PER_QUESTION_MIN_SAMPLES (20)', async () => {
    // 10 submissions for q42, only 1 question — well below the 20-sample threshold.
    const { calibrationData, submissionAnswers } = makeSubmissions({
      formId: 7,
      count: 10,
      questions: [{ qid: 42, confFn: () => 0.8, agreedFn: () => true }],
    });
    calibrationDataMock.mockResolvedValue(calibrationData);
    submissionAnswerMock.mockResolvedValue(submissionAnswers);
    const out = await fitPerQuestionBins(7);
    expect(out).toEqual({});
  });

  it('emits per-question bins for questions at or above the threshold', async () => {
    // 25 submissions, 2 questions: one (q42) consistently agreed at
    // confidence 0.9, the other (q43) consistently disagreed at the
    // same nominal confidence. The fitter should produce different
    // calibrated values for the two — that's the entire point of
    // per-question calibration.
    const { calibrationData, submissionAnswers } = makeSubmissions({
      formId: 7,
      count: 25,
      questions: [
        { qid: 42, confFn: () => 0.9, agreedFn: () => true },
        { qid: 43, confFn: () => 0.9, agreedFn: () => false },
      ],
    });
    calibrationDataMock.mockResolvedValue(calibrationData);
    submissionAnswerMock.mockResolvedValue(submissionAnswers);
    const out = await fitPerQuestionBins(7);
    expect(Object.keys(out).sort()).toEqual(['42', '43']);
    // q42: every sample agreed → calibrated near 1.0.
    const q42Bin = out['42'].bins.find((b) => 0.9 >= b.low && 0.9 <= b.high);
    expect(q42Bin).toBeDefined();
    expect(q42Bin!.calibrated).toBe(1);
    // q43: every sample disagreed → calibrated 0.0 for the same nominal.
    const q43Bin = out['43'].bins.find((b) => 0.9 >= b.low && 0.9 <= b.high);
    expect(q43Bin).toBeDefined();
    expect(q43Bin!.calibrated).toBe(0);
  });

  it('skips submissions with no recorded ai_confidence for a question', async () => {
    // 25 submissions for q42 — but submissionAnswer rows are missing
    // ai_confidence for q42 entirely, so the per-question fit drops
    // every sample.
    calibrationDataMock.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => ({
        ai_answers: { '42': 'yes' },
        human_answers: { '42': 'yes' },
        ai_submission_id: 1000 + i,
      }))
    );
    submissionAnswerMock.mockResolvedValue([]); // no per-answer confidence rows
    const out = await fitPerQuestionBins(7);
    expect(out).toEqual({});
  });
});
