/**
 * Rollup tests. The report's credibility rests on the roll-ups agreeing with
 * each other: the per-department matrix and the bucket totals are folded from
 * ONE query, so if they disagree the page contradicts itself on screen. Each
 * test below pins one of those identities.
 */
import { describe, it, expect } from 'vitest';
import { rollupDepts, rollupReps, buildKpis, type DeptAggRow, type RepAggRow } from '../rollup';
import { CALL_LENGTH_BANDS } from '../bands';

const dept = (
  department: string, band: string, calls: number,
  handleSecs: number, wrapSecs = 0, talkSecs = handleSecs - wrapSecs,
): DeptAggRow => ({ department, band, calls, talkSecs, wrapSecs, handleSecs });

const rep = (
  agent: string, department: string, band: string, calls: number,
  handleSecs: number, wrapSecs = 0, talkSecs = handleSecs - wrapSecs,
): RepAggRow => ({ agent, department, band, calls, talkSecs, wrapSecs, handleSecs });

describe('rollupDepts', () => {
  const rows: DeptAggRow[] = [
    dept('Customer Service', 'm2_5',  16, 3200, 800),
    dept('Customer Service', 'o20',    1, 1500, 100),
    dept('Tech Support',     'm5_10',  4, 1600, 200),
    dept('Tech Support',     'm2_5',   2,  400, 100),
  ];

  it('totals calls and seconds across every grouping', () => {
    const r = rollupDepts(rows);
    expect(r.totalCalls).toBe(23);
    expect(r.totalHandleSecs).toBe(6700);
    expect(r.totalWrapSecs).toBe(1200);
  });

  it('keeps department and bucket roll-ups mutually consistent', () => {
    const r = rollupDepts(rows);
    const sumDepts = r.byDept.reduce((s, d) => s + d.calls, 0);
    const sumBands = r.bandTotals.reduce((s, b) => s + b.calls, 0);
    expect(sumDepts).toBe(r.totalCalls);
    expect(sumBands).toBe(r.totalCalls);
  });

  it('averages handle time per call, not per bucket', () => {
    const r = rollupDepts(rows);
    // Customer Service: (3200 + 1500) / 17 = 276.5s = 4.6 min
    expect(r.byDept[0]).toMatchObject({ department: 'Customer Service', calls: 17, avgHandleMin: 4.6 });
    // Tech Support: (1600 + 400) / 6 = 333.3s = 5.6 min
    expect(r.byDept[1]).toMatchObject({ department: 'Tech Support', calls: 6, avgHandleMin: 5.6 });
  });

  it('orders departments by descending volume for the chart series', () => {
    expect(rollupDepts(rows).byDept.map((d) => d.department))
      .toEqual(['Customer Service', 'Tech Support']);
  });

  it('emits every bucket in order, including ones with no calls', () => {
    const r = rollupDepts(rows);
    expect(r.bandTotals.map((b) => b.key)).toEqual(CALL_LENGTH_BANDS.map((b) => b.key));
    const u1 = r.bandTotals.find((b) => b.key === 'u1')!;
    expect(u1).toMatchObject({ calls: 0, pctCalls: 0, pctTime: 0, avgMin: 0, handleHours: 0, wrapHours: 0 });
  });

  it('breaks wrap out per bucket so it can be charted against the total', () => {
    const r = rollupDepts(rows);
    // 2-5 min bucket: 3600s handle of which 900s is wrap.
    expect(r.bandTotals.find((b) => b.key === 'm2_5')).toMatchObject({ handleHours: 1, wrapHours: 0.3 });
    // 5-10 min bucket: 1600s handle, 200s wrap.
    expect(r.bandTotals.find((b) => b.key === 'm5_10')).toMatchObject({ handleHours: 0.4, wrapHours: 0.1 });
    // Wrap is a component of handle, so it can never exceed it in any bucket.
    expect(r.bandTotals.every((b) => b.wrapHours <= b.handleHours)).toBe(true);
  });

  it('separates share-of-calls from share-of-time — the report\'s core finding', () => {
    const r = rollupDepts(rows);
    const o20 = r.bandTotals.find((b) => b.key === 'o20')!;
    // 1 of 23 calls (4.3%) but 1500 of 6700 seconds (22.4%).
    expect(o20.calls).toBe(1);
    expect(o20.pctCalls).toBe(4.3);
    expect(o20.pctTime).toBe(22.4);
    expect(o20.pctTime).toBeGreaterThan(o20.pctCalls);
  });

  it('returns zeroed totals for an empty range instead of dividing by zero', () => {
    const r = rollupDepts([]);
    expect(r.totalCalls).toBe(0);
    expect(r.byDept).toEqual([]);
    expect(r.bandTotals.every((b) => b.calls === 0 && b.pctCalls === 0 && b.pctTime === 0)).toBe(true);
  });

  it('treats a missing department name as one group, not as undefined keys', () => {
    const r = rollupDepts([dept('', 'm2_5', 3, 600)]);
    expect(r.byDept).toHaveLength(1);
    expect(r.byDept[0].department).toBe('');
  });
});

describe('rollupReps', () => {
  const rows: RepAggRow[] = [
    rep('Ann',  'Customer Service', 'm2_5',  30, 6000, 1800),
    rep('Ann',  'Customer Service', 'm5_10',  5, 2000,  400),
    rep('Bob',  'Customer Service', 'm2_5',  50, 9000, 3000),
    rep('Cara', 'Tech Support',     'o20',    4, 6000,  600),
  ];

  it('collapses each agent to one row carrying every bucket', () => {
    const out = rollupReps(rows);
    expect(out).toHaveLength(3);
    const ann = out.find((r) => r.agent === 'Ann')!;
    expect(ann.calls).toBe(35);
    expect(ann.bands.m2_5).toBe(30);
    expect(ann.bands.m5_10).toBe(5);
    expect(ann.bands.u1).toBe(0);
  });

  it('splits the average into talk and wrap so a long average can be diagnosed', () => {
    const ann = rollupReps(rows).find((r) => r.agent === 'Ann')!;
    // handle 8000s / 35 = 228.6s = 3.8 min; wrap 2200s / 35 = 62.9s = 1.0 min
    expect(ann.avgHandleMin).toBe(3.8);
    expect(ann.avgWrapMin).toBe(1);
    expect(ann.avgTalkMin).toBe(2.8);
  });

  it('groups by department then descending volume so the table reads team by team', () => {
    const out = rollupReps(rows);
    expect(out.map((r) => `${r.department}/${r.agent}`)).toEqual([
      'Customer Service/Bob',
      'Customer Service/Ann',
      'Tech Support/Cara',
    ]);
  });
});

describe('buildKpis', () => {
  it('reports % of TIME on long calls, which diverges from % of calls', () => {
    const roll = rollupDepts([
      dept('Customer Service', 'm1_2',  90,  9000, 1000),
      dept('Customer Service', 'm10_20', 8,  8000,  500),
      dept('Customer Service', 'o20',    2,  3000,  200),
    ]);
    const k = buildKpis(roll);
    expect(k.csr_cl_total_calls).toBe(100);
    expect(k.csr_cl_calls_over_10).toBe(10);
    // 10 of 100 calls are long, but 11000 of 20000 seconds — 55% of the time.
    expect(k.csr_cl_pct_time_long).toBe(55);
    expect(k.csr_cl_handle_hours).toBe(5.6);
    expect(k.csr_cl_avg_handle).toBe(3.3);
    expect(k.csr_cl_wrap_share).toBe(8.5);
  });

  it('yields zeros rather than NaN when nothing is in range', () => {
    const k = buildKpis(rollupDepts([]));
    expect(Object.values(k).every((v) => Number.isFinite(v))).toBe(true);
    expect(k.csr_cl_avg_handle).toBe(0);
    expect(k.csr_cl_pct_time_long).toBe(0);
    expect(k.csr_cl_wrap_share).toBe(0);
  });
});
