/**
 * Contract tests for the pure campaign anchor resolver and override application.
 * No DB — everything here is deterministic. Covers the three anchor types, the
 * not-on-Friday shift, the relative-cycle guard, and ADD/REMOVE overrides.
 *
 * The business-day spine used below is August 2026 workdays (Mon–Fri), where
 * Aug 1 is a Saturday, so the first workday is Mon Aug 3 and Fridays fall on
 * the 7th, 14th, 21st, 28th.
 */
import { describe, it, expect } from 'vitest';
import { resolveOccurrences, applyOverrides, toDs } from '../campaign.projection.service';

// August 2026 Mon–Fri workdays.
const AUG_BD = [
  '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07',
  '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14',
  '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21',
  '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28',
  '2026-08-31',
];

// Minimal LibItem factory (the resolver only reads anchor fields + id).
const item = (over: Partial<Parameters<typeof resolveOccurrences>[0][number]> & { id: number }) => ({
  id: over.id,
  label: `c${over.id}`,
  anchor_type: over.anchor_type ?? 'BD_FROM_START',
  anchor_offset: over.anchor_offset ?? 1,
  anchor_ref_item_id: over.anchor_ref_item_id ?? null,
  not_on_friday: over.not_on_friday ?? false,
  sort_order: 0, category_id: 1, category_name: 'x', color: '#000', category_sort: 0,
} as Parameters<typeof resolveOccurrences>[0][number]);

describe('resolveOccurrences', () => {
  it('BD_FROM_START counts the Nth workday from the 1st (1-based)', () => {
    const m = resolveOccurrences([item({ id: 1, anchor_type: 'BD_FROM_START', anchor_offset: 1 })], AUG_BD);
    expect(m.get(1)).toBe('2026-08-03');
    const m3 = resolveOccurrences([item({ id: 2, anchor_type: 'BD_FROM_START', anchor_offset: 3 })], AUG_BD);
    expect(m3.get(2)).toBe('2026-08-05');
  });

  it('BD_FROM_END counts back from the last workday (1 = last)', () => {
    const m = resolveOccurrences([item({ id: 1, anchor_type: 'BD_FROM_END', anchor_offset: 1 })], AUG_BD);
    expect(m.get(1)).toBe('2026-08-31');
    const m2 = resolveOccurrences([item({ id: 2, anchor_type: 'BD_FROM_END', anchor_offset: 2 })], AUG_BD);
    expect(m2.get(2)).toBe('2026-08-28');
  });

  it('out-of-range offsets resolve to null', () => {
    const m = resolveOccurrences([item({ id: 1, anchor_offset: 99 })], AUG_BD);
    expect(m.get(1)).toBeNull();
  });

  it('not_on_friday shifts a Friday hit to the next workday (Monday)', () => {
    // 5th workday = Fri Aug 7 → shifts to Mon Aug 10.
    const m = resolveOccurrences([item({ id: 1, anchor_type: 'BD_FROM_START', anchor_offset: 5, not_on_friday: true })], AUG_BD);
    expect(m.get(1)).toBe('2026-08-10');
    // Without the flag it stays on Friday.
    const m2 = resolveOccurrences([item({ id: 2, anchor_type: 'BD_FROM_START', anchor_offset: 5 })], AUG_BD);
    expect(m2.get(2)).toBe('2026-08-07');
  });

  it('RELATIVE_TO_CAMPAIGN resolves the ref then adds N workdays', () => {
    const ref = item({ id: 1, anchor_type: 'BD_FROM_START', anchor_offset: 1 }); // Aug 3
    const rel = item({ id: 2, anchor_type: 'RELATIVE_TO_CAMPAIGN', anchor_offset: 2, anchor_ref_item_id: 1 }); // +2 bd → Aug 5
    const m = resolveOccurrences([ref, rel], AUG_BD);
    expect(m.get(2)).toBe('2026-08-05');
  });

  it('RELATIVE with offset 0 lands on the same day as its reference', () => {
    const ref = item({ id: 1, anchor_type: 'BD_FROM_END', anchor_offset: 1 }); // Aug 31
    const rel = item({ id: 2, anchor_type: 'RELATIVE_TO_CAMPAIGN', anchor_offset: 0, anchor_ref_item_id: 1 });
    const m = resolveOccurrences([ref, rel], AUG_BD);
    expect(m.get(2)).toBe('2026-08-31');
  });

  it('guards against relative cycles (both resolve to null, no infinite loop)', () => {
    const a = item({ id: 1, anchor_type: 'RELATIVE_TO_CAMPAIGN', anchor_offset: 1, anchor_ref_item_id: 2 });
    const b = item({ id: 2, anchor_type: 'RELATIVE_TO_CAMPAIGN', anchor_offset: 1, anchor_ref_item_id: 1 });
    const m = resolveOccurrences([a, b], AUG_BD);
    expect(m.get(1)).toBeNull();
    expect(m.get(2)).toBeNull();
  });
});

describe('applyOverrides', () => {
  const gen = () => new Map<string, Set<number>>([['2026-08-03', new Set([10, 20])]]);

  it('REMOVE hides a generated occurrence', () => {
    const out = applyOverrides(gen(), [{ occurrence_date: '2026-08-03', campaign_item_id: 10, action: 'REMOVE' }]);
    expect([...out.get('2026-08-03')!]).toEqual([20]);
  });

  it('ADD inserts a manual occurrence on a date', () => {
    const out = applyOverrides(gen(), [{ occurrence_date: '2026-08-04', campaign_item_id: 30, action: 'ADD' }]);
    expect([...out.get('2026-08-04')!]).toEqual([30]);
  });

  it('does not mutate the input map', () => {
    const g = gen();
    applyOverrides(g, [{ occurrence_date: '2026-08-03', campaign_item_id: 10, action: 'REMOVE' }]);
    expect([...g.get('2026-08-03')!]).toEqual([10, 20]);
  });
});

describe('toDs (override date normalization)', () => {
  // Overrides are stored at UTC midnight; reading them back must return the SAME
  // calendar day regardless of the server timezone. Local getters would return
  // the previous day in negative-offset (US) zones, landing a toggle on the
  // wrong date — the day popover then appears to do nothing.
  it('recovers the stored day from a UTC-midnight Date', () => {
    expect(toDs(new Date('2026-09-15T00:00:00Z'))).toBe('2026-09-15');
  });

  it('round-trips the exact date the write persisted', () => {
    const date = '2026-09-15';
    expect(toDs(new Date(`${date}T00:00:00Z`))).toBe(date);
  });
});
