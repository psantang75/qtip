import { describe, it, expect } from 'vitest';
import {
  matchBand, missedRule, resolveWarningLevel, validateBands, formatDeviation,
} from '../adherence.rules';
import type { PointRule, WarningThreshold } from '../adherence.rules';

const D = '2026-08-01';

const RULES: PointRule[] = [
  { id: 1, ruleKey: 'break_dur_minor', label: 'Break long — minor', kind: 'BREAK_DURATION', minSeconds: 180, maxSeconds: 359, points: 0.25, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
  { id: 2, ruleKey: 'break_dur_moderate', label: 'Break long — moderate', kind: 'BREAK_DURATION', minSeconds: 360, maxSeconds: 659, points: 0.5, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
  { id: 3, ruleKey: 'break_dur_severe', label: 'Break long — severe', kind: 'BREAK_DURATION', minSeconds: 660, maxSeconds: null, points: 1, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
  { id: 7, ruleKey: 'break_missed', label: 'Break missed', kind: 'BREAK_MISSED', minSeconds: 0, maxSeconds: null, points: 1, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
];

describe('matchBand — grace and boundaries', () => {
  it('returns null inside grace (below the lowest band)', () => {
    expect(matchBand(RULES, 'BREAK_DURATION', 0, D)).toBeNull();
    expect(matchBand(RULES, 'BREAK_DURATION', 179, D)).toBeNull();
  });

  it('is inclusive on the lower edge', () => {
    expect(matchBand(RULES, 'BREAK_DURATION', 180, D)?.ruleKey).toBe('break_dur_minor');
  });

  it('is inclusive on the upper edge and steps to the next band above it', () => {
    expect(matchBand(RULES, 'BREAK_DURATION', 359, D)?.ruleKey).toBe('break_dur_minor');
    expect(matchBand(RULES, 'BREAK_DURATION', 360, D)?.ruleKey).toBe('break_dur_moderate');
  });

  it('an unbounded top band catches everything above its minimum', () => {
    expect(matchBand(RULES, 'BREAK_DURATION', 99999, D)?.ruleKey).toBe('break_dur_severe');
  });

  it('does not cross kinds', () => {
    expect(matchBand(RULES, 'LUNCH_DURATION', 500, D)).toBeNull();
  });
});

describe('effective dating', () => {
  const dated: PointRule[] = [
    { ...RULES[0], id: 10, points: 0.25, effectiveFrom: '2000-01-01', effectiveTo: '2026-06-30' },
    { ...RULES[0], id: 11, points: 0.5, effectiveFrom: '2026-07-01', effectiveTo: null },
  ];
  it('scores the day under the band in force that day', () => {
    expect(matchBand(dated, 'BREAK_DURATION', 200, '2026-06-30')?.points).toBe(0.25);
    expect(matchBand(dated, 'BREAK_DURATION', 200, '2026-07-01')?.points).toBe(0.5);
  });
});

describe('missedRule', () => {
  it('finds the flat missed rule', () => {
    expect(missedRule(RULES, 'BREAK_MISSED', D)?.points).toBe(1);
  });
});

describe('resolveWarningLevel', () => {
  const ladder: WarningThreshold[] = [
    { levelKey: 'coaching', label: 'Coaching', pointsThreshold: 5, sortOrder: 10, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
    { levelKey: 'verbal', label: 'Verbal', pointsThreshold: 10, sortOrder: 20, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
  ];
  it('reaches nothing below the first rung', () => {
    expect(resolveWarningLevel(ladder, 4.99, D)).toBeNull();
  });
  it('triggers exactly on a threshold', () => {
    expect(resolveWarningLevel(ladder, 5, D)?.levelKey).toBe('coaching');
  });
  it('returns the highest rung reached', () => {
    expect(resolveWarningLevel(ladder, 12, D)?.levelKey).toBe('verbal');
  });
});

describe('validateBands', () => {
  it('accepts a clean, gapped ladder (gap below lowest = grace)', () => {
    expect(validateBands([
      { label: 'minor', minSeconds: 180, maxSeconds: 359 },
      { label: 'moderate', minSeconds: 360, maxSeconds: 659 },
      { label: 'severe', minSeconds: 660, maxSeconds: null },
    ])).toEqual([]);
  });
  it('flags overlap', () => {
    expect(validateBands([
      { label: 'a', minSeconds: 180, maxSeconds: 400 },
      { label: 'b', minSeconds: 360, maxSeconds: 659 },
    ])).toContain('a overlaps b');
  });
  it('flags an unbounded band below another', () => {
    expect(validateBands([
      { label: 'a', minSeconds: 180, maxSeconds: null },
      { label: 'b', minSeconds: 660, maxSeconds: null },
    ])).toContain('a is unbounded, so b can never match');
  });
});

describe('formatDeviation', () => {
  it('formats H:MM:SS and clamps negatives', () => {
    expect(formatDeviation(0)).toBe('0:00:00');
    expect(formatDeviation(659)).toBe('0:10:59');
    expect(formatDeviation(-5)).toBe('0:00:00');
  });
});
