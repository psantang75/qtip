/**
 * Tier-2 Item 4 — KB Coverage aggregator.
 *
 * `aggregateKbCoverage(formId, windowDays, submissions)` rolls
 * `ai_extras.pivots` arrays into a per-pivot summary used by the
 * dashboard. A pivot is flagged `gap: true` when it appeared in
 * `>= 3` cases AND its average `kb_hit_count` is `< 1`.
 *
 * The aggregator is pure — these tests feed in synthetic prisma rows
 * directly without touching the DB.
 */

import { describe, it, expect } from 'vitest';
import { aggregateKbCoverage } from '../KbCoverageAggregator';

function sub(pivots: Array<{ label: string; kb_hit_count: number }>): { ai_extras: unknown } {
  return { ai_extras: { pivots } };
}

describe('aggregateKbCoverage', () => {
  it('returns empty pivots when no submissions are provided', () => {
    const out = aggregateKbCoverage(7, 30, []);
    expect(out).toEqual({ form_id: 7, window_days: 30, total_cases: 0, pivots: [] });
  });

  it('handles submissions with missing or empty pivots arrays', () => {
    const out = aggregateKbCoverage(7, 30, [
      {} as { ai_extras: unknown }, // no ai_extras
      { ai_extras: null }, // null ai_extras
      { ai_extras: { pivots: [] } }, // empty pivots
      { ai_extras: { pivots: 'nope' as unknown } }, // malformed
    ]);
    expect(out.total_cases).toBe(4);
    expect(out.pivots).toEqual([]);
  });

  it('rolls a single pivot across multiple submissions', () => {
    const out = aggregateKbCoverage(7, 30, [
      sub([{ label: 'Refund', kb_hit_count: 3 }]),
      sub([{ label: 'Refund', kb_hit_count: 5 }]),
      sub([{ label: 'Refund', kb_hit_count: 4 }]),
    ]);
    expect(out.pivots).toHaveLength(1);
    expect(out.pivots[0].label).toBe('Refund');
    expect(out.pivots[0].cases).toBe(3);
    expect(out.pivots[0].avg_kb_hits).toBe(4);
    expect(out.pivots[0].gap).toBe(false);
  });

  it('flags content gaps when avg_kb_hits<1 AND cases>=3', () => {
    const out = aggregateKbCoverage(7, 30, [
      sub([{ label: 'Install Refund', kb_hit_count: 0 }]),
      sub([{ label: 'Install Refund', kb_hit_count: 0 }]),
      sub([{ label: 'Install Refund', kb_hit_count: 1 }]),
      // Adds another high-volume pivot to confirm both can co-exist.
      sub([{ label: 'Refund', kb_hit_count: 5 }]),
    ]);
    const installRefund = out.pivots.find((p) => p.label === 'Install Refund');
    expect(installRefund?.gap).toBe(true);
    expect(installRefund?.avg_kb_hits).toBeCloseTo(0.33, 1);
    const refund = out.pivots.find((p) => p.label === 'Refund');
    expect(refund?.gap).toBe(false);
    // Stable ordering: gaps first.
    expect(out.pivots[0].label).toBe('Install Refund');
  });

  it('does NOT flag a single zero-hit case (cases<3 threshold)', () => {
    const out = aggregateKbCoverage(7, 30, [
      sub([{ label: 'One-off', kb_hit_count: 0 }]),
      sub([{ label: 'One-off', kb_hit_count: 0 }]),
    ]);
    expect(out.pivots[0].gap).toBe(false);
  });

  it('normalises labels case-insensitively when bucketing', () => {
    const out = aggregateKbCoverage(7, 30, [
      sub([{ label: 'Refund', kb_hit_count: 4 }]),
      sub([{ label: 'refund', kb_hit_count: 6 }]),
    ]);
    expect(out.pivots).toHaveLength(1);
    expect(out.pivots[0].cases).toBe(2);
    expect(out.pivots[0].avg_kb_hits).toBe(5);
  });

  it('skips malformed pivot entries (missing label, NaN hits)', () => {
    const out = aggregateKbCoverage(7, 30, [
      {
        ai_extras: {
          pivots: [
            { label: '', kb_hit_count: 5 }, // empty label
            { label: 'Refund', kb_hit_count: 'oops' }, // NaN hits
            { label: 'Refund', kb_hit_count: 3 }, // valid
          ],
        },
      },
    ]);
    expect(out.pivots).toHaveLength(1);
    expect(out.pivots[0].label).toBe('Refund');
    expect(out.pivots[0].cases).toBe(1);
  });

  it('orders results gaps-first, then by case volume desc, then by label asc', () => {
    const out = aggregateKbCoverage(7, 30, [
      sub([{ label: 'A-Refund', kb_hit_count: 5 }]),
      sub([{ label: 'A-Refund', kb_hit_count: 5 }]),
      sub([{ label: 'B-Empathy', kb_hit_count: 5 }]),
      sub([{ label: 'B-Empathy', kb_hit_count: 5 }]),
      sub([{ label: 'B-Empathy', kb_hit_count: 5 }]),
      sub([{ label: 'Z-Gap', kb_hit_count: 0 }]),
      sub([{ label: 'Z-Gap', kb_hit_count: 0 }]),
      sub([{ label: 'Z-Gap', kb_hit_count: 0 }]),
    ]);
    expect(out.pivots[0].label).toBe('Z-Gap'); // gap wins despite lower cases
    expect(out.pivots[1].label).toBe('B-Empathy'); // higher cases than A-Refund
    expect(out.pivots[2].label).toBe('A-Refund');
  });
});
