/**
 * Unit tests for the new calibration-loop primitives:
 *   - AICalibrationService.getRecentCorrections
 *   - AICalibrationService.getModeReadiness
 *
 * Both rely on prisma; we mock the underlying client so the suite runs
 * without a database. The math is deterministic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findManyMock, findUniqueMock, questionFindManyMock, countMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  findUniqueMock: vi.fn(),
  questionFindManyMock: vi.fn(),
  countMock: vi.fn(),
}));

vi.mock('../../config/prisma', () => ({
  default: {
    aiCalibrationData: {
      findMany: findManyMock,
      count: countMock,
    },
    formQuestion: {
      findMany: questionFindManyMock,
    },
    form: {
      findUnique: findUniqueMock,
    },
  },
}));

import aiCalibrationService from '../AICalibrationService';

beforeEach(() => {
  findManyMock.mockReset();
  findUniqueMock.mockReset();
  questionFindManyMock.mockReset();
  countMock.mockReset();
});

describe('AICalibrationService.getRecentCorrections', () => {
  it('returns [] when no rows exist', async () => {
    findManyMock.mockResolvedValue([]);
    const out = await aiCalibrationService.getRecentCorrections(99016);
    expect(out).toEqual([]);
    // Should NOT have hit the question-text lookup when there's nothing to learn from.
    expect(questionFindManyMock).not.toHaveBeenCalled();
  });

  it('skips rows where AI has no answers (no correction to learn from)', async () => {
    findManyMock.mockResolvedValue([
      {
        id: 1n,
        created_at: new Date('2026-04-29T00:00:00Z'),
        form_id: 99016,
        ticket_id: 11111,
        source: 'qa_promoted_draft',
        ai_answers: null,
        human_answers: { 99125: 'no' },
      },
    ]);
    const out = await aiCalibrationService.getRecentCorrections(99016);
    expect(out).toEqual([]);
  });

  it('skips agreements (AI === Human) and emits diffs only', async () => {
    findManyMock.mockResolvedValue([
      {
        id: 10n,
        created_at: new Date('2026-04-29T00:00:00Z'),
        form_id: 99016,
        ticket_id: 11111,
        source: 'qa_promoted_draft',
        ai_answers: { 99125: 'yes', 12345: 'great' },
        human_answers: { 99125: 'no', 12345: 'great' },
      },
    ]);
    questionFindManyMock.mockResolvedValue([
      { id: 99125, question_text: 'Did the subclass match?' },
    ]);
    const out = await aiCalibrationService.getRecentCorrections(99016);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      question_id: 99125,
      ai_value: 'yes',
      human_value: 'no',
    });
  });

  it('keeps only the most recent correction per question (dedup)', async () => {
    findManyMock.mockResolvedValue([
      // Newest — wins
      {
        id: 30n,
        created_at: new Date('2026-04-29T00:00:00Z'),
        form_id: 99016,
        ticket_id: 33333,
        source: 'qa_promoted_draft',
        ai_answers: { 99125: 'no' },
        human_answers: { 99125: 'yes' },
      },
      // Older — should be dropped because q 99125 already captured.
      {
        id: 20n,
        created_at: new Date('2026-04-15T00:00:00Z'),
        form_id: 99016,
        ticket_id: 22222,
        source: 'qa_promoted_draft',
        ai_answers: { 99125: 'yes' },
        human_answers: { 99125: 'no' },
      },
    ]);
    questionFindManyMock.mockResolvedValue([
      { id: 99125, question_text: 'Did the subclass match?' },
    ]);
    const out = await aiCalibrationService.getRecentCorrections(99016);
    expect(out).toHaveLength(1);
    expect(out[0].ticket_id).toBe(33333);
    expect(out[0].ai_value).toBe('no');
    expect(out[0].human_value).toBe('yes');
  });

  it('greedy-fills the char budget and stops when full', async () => {
    // Generate 50 corrections on different questions; each renders ~80
    // chars. Budget of 200 should fit ~2-3 corrections.
    const rows = Array.from({ length: 50 }, (_, i) => ({
      id: BigInt(i + 1),
      created_at: new Date(2026, 3, 29 - i),
      form_id: 99016,
      ticket_id: 1000 + i,
      source: 'qa_promoted_draft',
      ai_answers: { [100 + i]: 'yes' },
      human_answers: { [100 + i]: 'no' },
    }));
    findManyMock.mockResolvedValue(rows);
    questionFindManyMock.mockResolvedValue(
      rows.map((_, i) => ({ id: 100 + i, question_text: `Question ${i}` })),
    );
    const out = await aiCalibrationService.getRecentCorrections(99016, { tokenBudgetChars: 200 });
    // Always include at least 1 even if budget would be exceeded by it.
    expect(out.length).toBeGreaterThanOrEqual(1);
    // Should have stopped well before all 50.
    expect(out.length).toBeLessThan(10);
    // Must be in newest-first order. Row 0 in the mock is the newest
    // (created_at = 2026-04-29) and has ticket_id 1000.
    expect(out[0].ticket_id).toBe(1000);
  });

  it('rejects invalid form ids', async () => {
    await expect(aiCalibrationService.getRecentCorrections(0)).rejects.toThrow(/Invalid form id/);
    await expect(aiCalibrationService.getRecentCorrections(-1)).rejects.toThrow(/Invalid form id/);
  });
});

describe('AICalibrationService.getModeReadiness', () => {
  it('recommends INSUFFICIENT_DATA when sample count is below the floor', async () => {
    findUniqueMock.mockResolvedValue({ id: 99016, ai_submit_as_draft: true });
    findManyMock.mockResolvedValue([
      // 5 rows where AI matches human → 100% agreement but only 5 samples.
      ...Array.from({ length: 5 }, (_, i) => ({
        id: BigInt(i + 1),
        created_at: new Date(2026, 3, 29 - i),
        form_id: 99016,
        ticket_id: 1000 + i,
        source: 'qa_promoted_draft',
        ai_answers: { 99125: 'yes' },
        human_answers: { 99125: 'yes' },
        in_rolling_set: true,
      })),
    ]);
    countMock.mockResolvedValue(5);
    const r = await aiCalibrationService.getModeReadiness(99016);
    expect(r.recommendation).toBe('INSUFFICIENT_DATA');
    expect(r.sample_count).toBe(5);
    expect(r.current_mode).toBe('CALIBRATING');
  });

  it('recommends PROMOTE_TO_TRUSTED when calibrating + agreement >= 90% + samples >= 20', async () => {
    findUniqueMock.mockResolvedValue({ id: 99016, ai_submit_as_draft: true });
    findManyMock.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        id: BigInt(i + 1),
        created_at: new Date(2026, 3, 29 - i),
        form_id: 99016,
        ticket_id: 1000 + i,
        source: 'qa_promoted_draft',
        ai_answers: { 99125: 'yes' },
        human_answers: { 99125: 'yes' },
        in_rolling_set: true,
      })),
    );
    countMock.mockResolvedValue(20);
    const r = await aiCalibrationService.getModeReadiness(99016);
    expect(r.recommendation).toBe('PROMOTE_TO_TRUSTED');
    expect(r.rolling_agreement).toBe(1);
  });

  it('does not recommend promote when agreement is below 90%', async () => {
    findUniqueMock.mockResolvedValue({ id: 99016, ai_submit_as_draft: true });
    // 20 rows; 17 agree, 3 disagree → 85%
    findManyMock.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        id: BigInt(i + 1),
        created_at: new Date(2026, 3, 29 - i),
        form_id: 99016,
        ticket_id: 1000 + i,
        source: 'qa_promoted_draft',
        ai_answers: { 99125: i < 17 ? 'yes' : 'yes' },
        human_answers: { 99125: i < 17 ? 'yes' : 'no' },
        in_rolling_set: true,
      })),
    );
    countMock.mockResolvedValue(20);
    const r = await aiCalibrationService.getModeReadiness(99016);
    expect(r.recommendation).toBe('STAY_CALIBRATING');
    expect(r.rolling_agreement).toBeCloseTo(0.85, 2);
  });

  it('recommends CONSIDER_DEMOTE when trusted + agreement < 80% + last_30d >= 10', async () => {
    findUniqueMock.mockResolvedValue({ id: 99016, ai_submit_as_draft: false });
    // 20 rows; only 14 agree → 70%
    findManyMock.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        id: BigInt(i + 1),
        created_at: new Date(2026, 3, 29 - i),
        form_id: 99016,
        ticket_id: 1000 + i,
        source: 'qa_sample_review',
        ai_answers: { 99125: 'yes' },
        human_answers: { 99125: i < 14 ? 'yes' : 'no' },
        in_rolling_set: true,
      })),
    );
    countMock.mockResolvedValue(15);
    const r = await aiCalibrationService.getModeReadiness(99016);
    expect(r.recommendation).toBe('CONSIDER_DEMOTE');
    expect(r.current_mode).toBe('TRUSTED');
  });
});
