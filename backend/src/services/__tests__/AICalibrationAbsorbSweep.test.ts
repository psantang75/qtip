/**
 * AICalibrationAbsorbSweep — Phase 2a unit tests.
 *
 * Locks down the auto-absorb behavior so a refactor cannot accidentally
 *   - skip the absorbed_at filter (would absorb the same row repeatedly),
 *   - omit the per-form auto-absorb-days override (would use the wrong cutoff),
 *   - mass-update absorbed rows (would corrupt audit trail).
 *
 * The sweep itself just composes prisma.updateMany, so we mock the
 * client and assert the call shape rather than spinning a DB.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findManyMock, updateManyMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  updateManyMock: vi.fn(),
}));

vi.mock('../../config/prisma', () => ({
  default: {
    form: { findMany: findManyMock },
    aiCalibrationData: { updateMany: updateManyMock },
  },
}));

import { runCalibrationAbsorbSweep } from '../AICalibrationAbsorbSweep';

describe('runCalibrationAbsorbSweep', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    updateManyMock.mockReset();
  });

  it('returns zero when there are no AI-enabled forms', async () => {
    findManyMock.mockResolvedValue([]);
    const result = await runCalibrationAbsorbSweep();
    expect(result.rowsAbsorbed).toBe(0);
    expect(result.perForm).toEqual([]);
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it('uses the per-form auto-absorb-days override when set', async () => {
    findManyMock.mockResolvedValue([
      { id: 1, ai_calibration_auto_absorb_days: 30 },
    ]);
    updateManyMock.mockResolvedValue({ count: 4 });
    await runCalibrationAbsorbSweep();
    const args = updateManyMock.mock.calls[0][0];
    expect(args.where.form_id).toBe(1);
    expect(args.where.absorbed_at).toBeNull();
    expect(args.data.absorbed_reason).toContain('auto-absorbed (>30 days)');
  });

  it('falls back to 180 days when override is null/zero/negative', async () => {
    findManyMock.mockResolvedValue([
      { id: 2, ai_calibration_auto_absorb_days: null },
      { id: 3, ai_calibration_auto_absorb_days: 0 },
      { id: 4, ai_calibration_auto_absorb_days: -7 },
    ]);
    updateManyMock.mockResolvedValue({ count: 1 });
    await runCalibrationAbsorbSweep();
    for (const call of updateManyMock.mock.calls) {
      expect(call[0].data.absorbed_reason).toContain('auto-absorbed (>180 days)');
    }
  });

  it('only counts forms that actually had rows updated', async () => {
    findManyMock.mockResolvedValue([
      { id: 10, ai_calibration_auto_absorb_days: 180 },
      { id: 11, ai_calibration_auto_absorb_days: 180 },
    ]);
    updateManyMock
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 5 });
    const result = await runCalibrationAbsorbSweep();
    expect(result.rowsAbsorbed).toBe(5);
    expect(result.perForm).toEqual([{ form_id: 11, absorbed: 5, cutoff_days: 180 }]);
  });

  it('passes a created_at cutoff that is roughly N days in the past', async () => {
    findManyMock.mockResolvedValue([{ id: 7, ai_calibration_auto_absorb_days: 180 }]);
    updateManyMock.mockResolvedValue({ count: 0 });
    const before = Date.now();
    await runCalibrationAbsorbSweep();
    const cutoff: Date = updateManyMock.mock.calls[0][0].where.created_at.lt;
    const expected = before - 180 * 24 * 60 * 60 * 1000;
    // Within 5 minutes of the expected cutoff (test runtime fuzz tolerance).
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(5 * 60 * 1000);
  });
});
