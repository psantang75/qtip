/**
 * ConfidenceCalibrator — Phase 4 unit tests.
 *
 * Behaviors pinned:
 *   - Identity mapping when no active calibration map exists for the
 *     form (Day-1 behavior).
 *   - Bin lookup picks the matching bin and clamps to [0, 1].
 *   - Cache invalidation forces a fresh DB read.
 *   - Null / non-finite inputs return null without hitting the DB.
 *
 * The fitter (ConfidenceCalibratorFitter) is not exercised here — its
 * isotonic-regression pass is exercised via integration runs against
 * the calibration tab.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock so we can swap return values per test without re-importing.
const { findFirstMock } = vi.hoisted(() => ({ findFirstMock: vi.fn() }));

vi.mock('../../config/prisma', () => ({
  default: { aiCalibrationMap: { findFirst: findFirstMock } },
}));

import { applyCalibration, applyAnswerCalibration, invalidateActiveMapCache } from '../ConfidenceCalibrator';

describe('ConfidenceCalibrator', () => {
  beforeEach(() => {
    findFirstMock.mockReset();
    invalidateActiveMapCache(); // wipe in-memory cache between tests
  });

  it('returns null for null / non-finite inputs without touching the DB', async () => {
    const out1 = await applyCalibration(99016, null);
    const out2 = await applyCalibration(99016, Number.NaN);
    const out3 = await applyCalibration(99016, Number.POSITIVE_INFINITY);
    expect(out1).toBeNull();
    expect(out2).toBeNull();
    expect(out3).toBeNull();
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it('falls back to identity (clamped) when no active map exists', async () => {
    findFirstMock.mockResolvedValue(null);
    const out = await applyCalibration(99016, 0.83);
    expect(out).toBe(0.83);
  });

  it('maps nominal confidence into the matching bin', async () => {
    findFirstMock.mockResolvedValue({
      version: 1,
      bins_json: {
        bins: [
          { low: 0.0, high: 0.5, calibrated: 0.3 },
          { low: 0.5, high: 0.8, calibrated: 0.6 },
          { low: 0.8, high: 1.0, calibrated: 0.9 },
        ],
      },
    });

    const lo = await applyCalibration(99016, 0.2);
    const mid = await applyCalibration(99016, 0.65);
    const hi = await applyCalibration(99016, 0.95);

    expect(lo).toBe(0.3);
    expect(mid).toBe(0.6);
    expect(hi).toBe(0.9);
  });

  it('clamps calibrated values outside [0, 1]', async () => {
    findFirstMock.mockResolvedValue({
      version: 1,
      bins_json: {
        bins: [{ low: 0, high: 1, calibrated: 1.5 }],
      },
    });
    const out = await applyCalibration(99016, 0.5);
    expect(out).toBe(1);
  });

  it('caches the active map (single DB hit across multiple calls)', async () => {
    findFirstMock.mockResolvedValue({
      version: 1,
      bins_json: { bins: [{ low: 0, high: 1, calibrated: 0.7 }] },
    });
    await applyCalibration(99016, 0.5);
    await applyCalibration(99016, 0.6);
    await applyCalibration(99016, 0.7);
    expect(findFirstMock).toHaveBeenCalledTimes(1);
  });

  it('invalidateActiveMapCache forces a re-fetch on next call', async () => {
    findFirstMock.mockResolvedValue({
      version: 1,
      bins_json: { bins: [{ low: 0, high: 1, calibrated: 0.5 }] },
    });
    await applyCalibration(99016, 0.5);
    expect(findFirstMock).toHaveBeenCalledTimes(1);

    invalidateActiveMapCache(99016);
    await applyCalibration(99016, 0.5);
    expect(findFirstMock).toHaveBeenCalledTimes(2);
  });

  it('drops cache entry when the active map disappears (e.g. archived)', async () => {
    findFirstMock.mockResolvedValueOnce({
      version: 1,
      bins_json: { bins: [{ low: 0, high: 1, calibrated: 0.5 }] },
    });
    await applyCalibration(99016, 0.5);
    expect(findFirstMock).toHaveBeenCalledTimes(1);

    invalidateActiveMapCache(99016);
    findFirstMock.mockResolvedValueOnce(null);
    const out = await applyCalibration(99016, 0.5);
    expect(out).toBe(0.5); // identity passthrough after map archive
  });

  it('treats invalid bins JSON as no map (identity passthrough)', async () => {
    findFirstMock.mockResolvedValue({
      version: 1,
      bins_json: { bins: [{ low: 'oops', high: 'nope' }] },
    });
    const out = await applyCalibration(99016, 0.42);
    expect(out).toBe(0.42);
  });
});

// ── Tier-1 Item 3: per-question calibration ──────────────────────────────
//
// `applyAnswerCalibration(formId, questionId, nominal)` looks at the
// active map's optional `by_question[<qid>]` bin set first, then falls
// back to the per-form bins, then to identity. Gated by env flag
// `AI_REVIEWER_PER_QUESTION_CALIBRATION` so the rollout can be staged.
describe('applyAnswerCalibration', () => {
  beforeEach(() => {
    findFirstMock.mockReset();
    invalidateActiveMapCache();
  });

  it('is identity (clamped) when the per-question feature flag is off', async () => {
    delete process.env.AI_REVIEWER_PER_QUESTION_CALIBRATION;
    findFirstMock.mockResolvedValue({
      version: 1,
      bins_json: {
        bins: [{ low: 0, high: 1, calibrated: 0.5 }],
        by_question: { 42: { bins: [{ low: 0, high: 1, calibrated: 0.99 }] } },
      },
    });
    const out = await applyAnswerCalibration(99016, 42, 0.7);
    expect(out).toBe(0.7);
  });

  it('uses the per-question bins when the flag is on AND the map has a by_question entry', async () => {
    process.env.AI_REVIEWER_PER_QUESTION_CALIBRATION = '1';
    try {
      findFirstMock.mockResolvedValue({
        version: 1,
        bins_json: {
          bins: [{ low: 0, high: 1, calibrated: 0.5 }],
          by_question: { 42: { bins: [{ low: 0, high: 1, calibrated: 0.3 }] } },
        },
      });
      const out = await applyAnswerCalibration(99016, 42, 0.95);
      expect(out).toBe(0.3);
    } finally {
      delete process.env.AI_REVIEWER_PER_QUESTION_CALIBRATION;
    }
  });

  it('falls through to per-form bins for questions without a by_question entry', async () => {
    process.env.AI_REVIEWER_PER_QUESTION_CALIBRATION = '1';
    try {
      findFirstMock.mockResolvedValue({
        version: 1,
        bins_json: {
          bins: [{ low: 0.5, high: 1, calibrated: 0.6 }],
          by_question: { 42: { bins: [{ low: 0, high: 1, calibrated: 0.99 }] } },
        },
      });
      const out = await applyAnswerCalibration(99016, 99, 0.7); // q99 has no entry
      expect(out).toBe(0.6);
    } finally {
      delete process.env.AI_REVIEWER_PER_QUESTION_CALIBRATION;
    }
  });

  it('is identity passthrough when there is no active map at all', async () => {
    process.env.AI_REVIEWER_PER_QUESTION_CALIBRATION = '1';
    try {
      findFirstMock.mockResolvedValue(null);
      const out = await applyAnswerCalibration(99016, 42, 0.42);
      expect(out).toBe(0.42);
    } finally {
      delete process.env.AI_REVIEWER_PER_QUESTION_CALIBRATION;
    }
  });

  it('returns null for null / non-finite inputs without touching the DB', async () => {
    process.env.AI_REVIEWER_PER_QUESTION_CALIBRATION = '1';
    try {
      const out1 = await applyAnswerCalibration(99016, 42, null);
      const out2 = await applyAnswerCalibration(99016, 42, Number.NaN);
      expect(out1).toBeNull();
      expect(out2).toBeNull();
      expect(findFirstMock).not.toHaveBeenCalled();
    } finally {
      delete process.env.AI_REVIEWER_PER_QUESTION_CALIBRATION;
    }
  });

  it('skips by_question entries with malformed bins (per-form fallback wins)', async () => {
    process.env.AI_REVIEWER_PER_QUESTION_CALIBRATION = '1';
    try {
      findFirstMock.mockResolvedValue({
        version: 1,
        bins_json: {
          bins: [{ low: 0, high: 1, calibrated: 0.5 }],
          by_question: { 42: { bins: [{ low: 'oops', high: 'nope' }] } },
        },
      });
      const out = await applyAnswerCalibration(99016, 42, 0.8);
      expect(out).toBe(0.5);
    } finally {
      delete process.env.AI_REVIEWER_PER_QUESTION_CALIBRATION;
    }
  });
});
