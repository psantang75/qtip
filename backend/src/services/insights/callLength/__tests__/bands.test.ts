/**
 * Bucket-boundary tests. The buckets are half-open [min, max), so every
 * boundary second is asserted on both sides — an off-by-one here silently
 * misreports the whole distribution, and the "under 1 min" and "20 min+"
 * buckets are the ones a reader will challenge first.
 */
import { describe, it, expect } from 'vitest';
import { CALL_LENGTH_BANDS, bandCaseSql, bandForSecs, zeroBands } from '../bands';

describe('CALL_LENGTH_BANDS', () => {
  it('is contiguous and open-ended at the top', () => {
    expect(CALL_LENGTH_BANDS[0].minSecs).toBe(0);
    for (let i = 1; i < CALL_LENGTH_BANDS.length; i++) {
      expect(CALL_LENGTH_BANDS[i].minSecs).toBe(CALL_LENGTH_BANDS[i - 1].maxSecs);
    }
    expect(CALL_LENGTH_BANDS[CALL_LENGTH_BANDS.length - 1].maxSecs).toBeNull();
  });

  it('has unique keys', () => {
    const keys = CALL_LENGTH_BANDS.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('bandForSecs', () => {
  it('places each boundary second in the upper bucket', () => {
    // [0,60) [60,120) [120,300) [300,600) [600,1200) [1200,inf)
    expect(bandForSecs(59)).toBe('u1');
    expect(bandForSecs(60)).toBe('m1_2');
    expect(bandForSecs(119)).toBe('m1_2');
    expect(bandForSecs(120)).toBe('m2_5');
    expect(bandForSecs(299)).toBe('m2_5');
    expect(bandForSecs(300)).toBe('m5_10');
    expect(bandForSecs(599)).toBe('m5_10');
    expect(bandForSecs(600)).toBe('m10_20');
    expect(bandForSecs(1199)).toBe('m10_20');
    expect(bandForSecs(1200)).toBe('o20');
  });

  it('puts a one-second call in the shortest bucket and a marathon in the longest', () => {
    expect(bandForSecs(1)).toBe('u1');
    expect(bandForSecs(36_000)).toBe('o20');
  });
});

describe('bandCaseSql', () => {
  it('emits an arm per bounded bucket plus an ELSE for the open-ended one', () => {
    const sql = bandCaseSql();
    expect(sql).toBe(
      "CASE WHEN f.handle_secs < 60 THEN 'u1' WHEN f.handle_secs < 120 THEN 'm1_2' " +
      "WHEN f.handle_secs < 300 THEN 'm2_5' WHEN f.handle_secs < 600 THEN 'm5_10' " +
      "WHEN f.handle_secs < 1200 THEN 'm10_20' ELSE 'o20' END",
    );
  });

  it('honours a caller-supplied column', () => {
    expect(bandCaseSql('x.secs')).toContain('x.secs < 60');
  });

  it('agrees with bandForSecs on every boundary', () => {
    // The SQL CASE is authoritative in queries and bandForSecs is the TS twin;
    // if they diverge, report numbers stop matching any local calculation.
    const arms = [...bandCaseSql().matchAll(/< (\d+) THEN '([a-z0-9_]+)'/g)]
      .map((m) => ({ max: Number(m[1]), key: m[2] }));
    for (const arm of arms) {
      expect(bandForSecs(arm.max - 1)).toBe(arm.key);
    }
  });
});

describe('zeroBands', () => {
  it('returns a zero for every bucket so a sparse rep still renders a full row', () => {
    const z = zeroBands();
    expect(Object.keys(z)).toHaveLength(CALL_LENGTH_BANDS.length);
    expect(Object.values(z).every((v) => v === 0)).toBe(true);
  });
});
