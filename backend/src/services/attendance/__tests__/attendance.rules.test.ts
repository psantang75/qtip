/**
 * Contract tests for the pure attendance band matcher. No DB — this is where the
 * boundary mistakes (3:00 vs 3:01, 15:59 vs 16:00) get caught, because in
 * production they surface as a wrong number in somebody's discipline record.
 *
 * Bounds are inclusive on both ends. The seeded policy in seconds:
 *   Late 3+     181 -   959  -> 0.25      (3:01 - 15:59)
 *   Late 16+    960 -  3659  -> 0.50      (16:00 - 1:00:59)
 *   Late 61+   3660 -  7259  -> 0.75      (1:01:00 - 2:00:59)
 *   Late 121+  7260 - 28740  -> 1.00      (2:01:00 - 7:59:00)
 *   Leave Early 181 - null   -> 0.50
 *   Absent      full day     -> 1.00
 */
import { describe, it, expect } from 'vitest';
import {
  matchBand,
  exceedsLateBands,
  absenceRule,
  exceptionRule,
  resolveWarningLevel,
  validateBands,
  formatDeviation,
} from '../attendance.rules';
import type { PointRule, WarningThreshold } from '../attendance.rules';

const rule = (o: Partial<PointRule> & { ruleKey: string; kind: PointRule['kind'] }): PointRule => ({
  id: o.id ?? 1,
  ruleKey: o.ruleKey,
  label: o.label ?? o.ruleKey,
  kind: o.kind,
  minSeconds: o.minSeconds ?? 0,
  maxSeconds: o.maxSeconds ?? null,
  points: o.points ?? 1,
  exceptionTypeId: o.exceptionTypeId ?? null,
  effectiveFrom: o.effectiveFrom ?? '2000-01-01',
  effectiveTo: o.effectiveTo ?? null,
  isActive: o.isActive ?? true,
});

const SEEDED: PointRule[] = [
  rule({ id: 1, ruleKey: 'late_3', label: 'Late 3+', kind: 'LATE', minSeconds: 181, maxSeconds: 959, points: 0.25 }),
  rule({ id: 2, ruleKey: 'late_16', label: 'Late 16+', kind: 'LATE', minSeconds: 960, maxSeconds: 3659, points: 0.5 }),
  rule({ id: 3, ruleKey: 'late_61', label: 'Late 61+', kind: 'LATE', minSeconds: 3660, maxSeconds: 7259, points: 0.75 }),
  rule({ id: 4, ruleKey: 'late_121', label: 'Late 121+', kind: 'LATE', minSeconds: 7260, maxSeconds: 28740, points: 1 }),
  rule({ id: 5, ruleKey: 'leave_early', label: 'Leave Early', kind: 'EARLY_LEAVE', minSeconds: 181, points: 0.5 }),
  rule({ id: 6, ruleKey: 'absent', label: 'Absent', kind: 'ABSENT', points: 1 }),
  rule({ id: 7, ruleKey: 'ncns', label: 'No Call / No Show', kind: 'EXCEPTION', points: 2, exceptionTypeId: 3 }),
];

const D = '2026-07-15';

describe('matchBand - LATE boundaries', () => {
  it('earns nothing inside grace, including the last grace second', () => {
    expect(matchBand(SEEDED, 'LATE', 0, D)).toBeNull();
    expect(matchBand(SEEDED, 'LATE', 1, D)).toBeNull();
    expect(matchBand(SEEDED, 'LATE', 180, D)).toBeNull(); // exactly 3:00
  });

  it('starts charging at 3:01 and holds through 15:59', () => {
    expect(matchBand(SEEDED, 'LATE', 181, D)?.points).toBe(0.25);
    expect(matchBand(SEEDED, 'LATE', 959, D)?.points).toBe(0.25);
  });

  it('steps to 0.50 at exactly 16:00 and holds through 1:00:59', () => {
    expect(matchBand(SEEDED, 'LATE', 960, D)?.points).toBe(0.5);
    expect(matchBand(SEEDED, 'LATE', 3659, D)?.points).toBe(0.5);
  });

  it('steps to 0.75 at exactly 1:01:00 and holds through 2:00:59', () => {
    expect(matchBand(SEEDED, 'LATE', 3660, D)?.points).toBe(0.75);
    expect(matchBand(SEEDED, 'LATE', 7259, D)?.points).toBe(0.75);
  });

  it('steps to 1.00 at exactly 2:01:00 and holds through 7:59:00', () => {
    expect(matchBand(SEEDED, 'LATE', 7260, D)?.points).toBe(1);
    expect(matchBand(SEEDED, 'LATE', 28740, D)?.points).toBe(1);
  });

  it('has no band past the top of the ladder', () => {
    expect(matchBand(SEEDED, 'LATE', 28741, D)).toBeNull();
  });
});

describe('exceedsLateBands', () => {
  it('is false up to and including the top bound', () => {
    expect(exceedsLateBands(SEEDED, 28740, D)).toBe(false);
  });

  it('is true one second past it, so the engine converts it to an absence', () => {
    expect(exceedsLateBands(SEEDED, 28741, D)).toBe(true);
  });

  it('never overflows when the top band is unbounded', () => {
    const open = [rule({ ruleKey: 'late', kind: 'LATE', minSeconds: 181, maxSeconds: null })];
    expect(exceedsLateBands(open, 999_999, D)).toBe(false);
  });
});

describe('matchBand - EARLY_LEAVE', () => {
  it('mirrors the late grace boundary', () => {
    expect(matchBand(SEEDED, 'EARLY_LEAVE', 180, D)).toBeNull();
    expect(matchBand(SEEDED, 'EARLY_LEAVE', 181, D)?.points).toBe(0.5);
  });

  it('is unbounded above, so a whole afternoon still charges 0.50', () => {
    expect(matchBand(SEEDED, 'EARLY_LEAVE', 20_000, D)?.points).toBe(0.5);
  });
});

describe('effective dating', () => {
  const OLD = rule({ id: 10, ruleKey: 'late_3', kind: 'LATE', minSeconds: 181, maxSeconds: 959, points: 0.25, effectiveFrom: '2000-01-01', effectiveTo: '2026-06-30' });
  const NEW = rule({ id: 11, ruleKey: 'late_3', kind: 'LATE', minSeconds: 181, maxSeconds: 959, points: 0.5, effectiveFrom: '2026-07-01' });
  const both = [OLD, NEW];

  it('scores a day before the change under the OLD points', () => {
    expect(matchBand(both, 'LATE', 300, '2026-06-30')?.points).toBe(0.25);
  });

  it('scores a day after the change under the NEW points', () => {
    expect(matchBand(both, 'LATE', 300, '2026-07-01')?.points).toBe(0.5);
  });

  it('treats effective_to as inclusive, so a retired band still scores its last day', () => {
    const retired = [rule({ ruleKey: 'x', kind: 'LATE', minSeconds: 181, effectiveFrom: '2026-01-01', effectiveTo: '2026-07-15' })];
    expect(matchBand(retired, 'LATE', 300, '2026-07-15')).not.toBeNull();
    expect(matchBand(retired, 'LATE', 300, '2026-07-16')).toBeNull();
  });

  it('ignores inactive bands', () => {
    const off = [rule({ ruleKey: 'x', kind: 'LATE', minSeconds: 181, isActive: false })];
    expect(matchBand(off, 'LATE', 300, D)).toBeNull();
  });
});

describe('absence and exception rules', () => {
  it('finds the absence rule', () => {
    expect(absenceRule(SEEDED, D)?.points).toBe(1);
  });

  it('binds a point-bearing exception to its exception type', () => {
    expect(exceptionRule(SEEDED, 3, D)?.points).toBe(2);
  });

  it('returns null for an exception type that carries no weight', () => {
    expect(exceptionRule(SEEDED, 999, D)).toBeNull();
  });
});

describe('resolveWarningLevel', () => {
  const LADDER: WarningThreshold[] = [
    { levelKey: 'coaching', label: 'Coaching', pointsThreshold: 3, sortOrder: 10, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
    { levelKey: 'verbal', label: 'Verbal', pointsThreshold: 5, sortOrder: 20, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
    { levelKey: 'written', label: 'Written', pointsThreshold: 7, sortOrder: 30, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
    { levelKey: 'final', label: 'Final', pointsThreshold: 9, sortOrder: 40, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
    { levelKey: 'separation', label: 'Separation', pointsThreshold: 10, sortOrder: 50, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
  ];

  it('reaches no rung below the first threshold', () => {
    expect(resolveWarningLevel(LADDER, 2.75, D)).toBeNull();
  });

  it('triggers exactly ON a threshold, matching how the policy table reads', () => {
    expect(resolveWarningLevel(LADDER, 3, D)?.levelKey).toBe('coaching');
    expect(resolveWarningLevel(LADDER, 7, D)?.levelKey).toBe('written');
  });

  it('returns the HIGHEST rung reached, not the first', () => {
    expect(resolveWarningLevel(LADDER, 9.5, D)?.levelKey).toBe('final');
    expect(resolveWarningLevel(LADDER, 25, D)?.levelKey).toBe('separation');
  });

  it('stays below a rung just short of it', () => {
    expect(resolveWarningLevel(LADDER, 6.75, D)?.levelKey).toBe('verbal');
  });
});

describe('validateBands', () => {
  const band = (label: string, minSeconds: number, maxSeconds: number | null) => ({ label, minSeconds, maxSeconds });

  it('accepts the seeded ladder', () => {
    expect(validateBands([band('a', 181, 959), band('b', 960, 3659), band('c', 3660, null)])).toEqual([]);
  });

  it('accepts a gap, because the space below the lowest band is grace by design', () => {
    expect(validateBands([band('a', 181, 959), band('b', 2000, null)])).toEqual([]);
  });

  it('rejects overlapping bands, which would make points depend on sort order', () => {
    expect(validateBands([band('a', 181, 1000), band('b', 960, 3659)])).toHaveLength(1);
  });

  it('rejects a band that ends before it starts', () => {
    expect(validateBands([band('a', 900, 181)])).toHaveLength(1);
  });

  it('rejects an unbounded band that shadows a later one', () => {
    expect(validateBands([band('a', 181, null), band('b', 960, 3659)])).toHaveLength(1);
  });
});

describe('formatDeviation', () => {
  it('renders H:MM:SS', () => {
    expect(formatDeviation(181)).toBe('0:03:01');
    expect(formatDeviation(3659)).toBe('1:00:59');
    expect(formatDeviation(28740)).toBe('7:59:00');
  });

  it('clamps negatives to zero rather than printing a minus sign in a tooltip', () => {
    expect(formatDeviation(-5)).toBe('0:00:00');
  });
});
