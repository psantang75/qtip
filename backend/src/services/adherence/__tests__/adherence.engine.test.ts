/**
 * Contract tests for scoreDay — one scheduled day of break/lunch plan plus that
 * day's actuals and phone presence, in, occurrences out. Pure, so no DB.
 *
 * These pin the decisions that only surface when someone disputes a point:
 * duration grace, the missed-segment path, start-time offset, and the phone
 * before/after tolerance the whole feature exists for.
 */
import { describe, it, expect } from 'vitest';
import { scoreDay } from '../adherence.engine';
import type { ScheduledSeg, ActualSeg, DayExcusals } from '../adherence.engine';
import type { PointRule } from '../adherence.rules';
import type { PhonePresence } from '../phonePresenceProvider';

const D = '2026-08-01';
const USER = 42;
const GRACE = { beforeSec: 120, afterSec: 60 };

const RULES: PointRule[] = [
  { id: 1, ruleKey: 'break_dur_minor', label: 'Break long — minor', kind: 'BREAK_DURATION', minSeconds: 180, maxSeconds: 359, points: 0.25, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
  { id: 2, ruleKey: 'break_dur_moderate', label: 'Break long — moderate', kind: 'BREAK_DURATION', minSeconds: 360, maxSeconds: 659, points: 0.5, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
  { id: 3, ruleKey: 'break_dur_severe', label: 'Break long — severe', kind: 'BREAK_DURATION', minSeconds: 660, maxSeconds: null, points: 1, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
  { id: 7, ruleKey: 'break_missed', label: 'Break missed', kind: 'BREAK_MISSED', minSeconds: 0, maxSeconds: null, points: 1, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
  { id: 9, ruleKey: 'break_start', label: 'Break wrong start', kind: 'BREAK_START', minSeconds: 300, maxSeconds: null, points: 0, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
  { id: 11, ruleKey: 'break_phone_start_minor', label: 'Break phone early on — minor', kind: 'BREAK_PHONE_START', minSeconds: 1, maxSeconds: 299, points: 0.25, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
  { id: 12, ruleKey: 'break_phone_start_moderate', label: 'Break phone early on — moderate', kind: 'BREAK_PHONE_START', minSeconds: 300, maxSeconds: 599, points: 0.5, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
  { id: 13, ruleKey: 'break_phone_start_severe', label: 'Break phone early on — severe', kind: 'BREAK_PHONE_START', minSeconds: 600, maxSeconds: null, points: 1, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
  { id: 14, ruleKey: 'break_phone_stop_minor', label: 'Break phone late off — minor', kind: 'BREAK_PHONE_STOP', minSeconds: 1, maxSeconds: 299, points: 0.25, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
  { id: 15, ruleKey: 'break_phone_stop_moderate', label: 'Break phone late off — moderate', kind: 'BREAK_PHONE_STOP', minSeconds: 300, maxSeconds: 599, points: 0.5, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
  { id: 16, ruleKey: 'break_phone_stop_severe', label: 'Break phone late off — severe', kind: 'BREAK_PHONE_STOP', minSeconds: 600, maxSeconds: null, points: 1, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
];

// A 15-minute break scheduled to start at 10:00 (36000s from midnight).
const sched = (startSec: number, lenSec: number): ScheduledSeg => ({ startSec, endSec: startSec + lenSec });
const actual = (startSec: number, lenSec: number): ActualSeg => ({ startSec, endSec: startSec + lenSec, durationSec: lenSec });

function run(
  scheduled: { breaks: ScheduledSeg[]; lunches: ScheduledSeg[] },
  act: { breaks: ActualSeg[]; lunches: ActualSeg[] },
  phone: PhonePresence | null = null,
) {
  return scoreDay(USER, D, 900, scheduled, act, phone, RULES, GRACE);
}

const noLunch = { lunches: [] as ScheduledSeg[] };
const noLunchAct = { lunches: [] as ActualSeg[] };

describe('scoreDay — nothing to score', () => {
  it('returns null when no break or lunch is scheduled', () => {
    expect(run({ breaks: [], lunches: [] }, { breaks: [], lunches: [] })).toBeNull();
  });
});

describe('duration', () => {
  it('within grace earns no occurrence but still emits a daily row', () => {
    const res = run(
      { breaks: [sched(36000, 900)], ...noLunch },
      { breaks: [actual(36000, 900 + 179)], ...noLunchAct },
    );
    expect(res).not.toBeNull();
    expect(res!.occurrences).toHaveLength(0);
    expect(res!.daily.break_actual_sec).toBe(1079);
  });

  it('3:00 over lands in the minor band', () => {
    const res = run(
      { breaks: [sched(36000, 900)], ...noLunch },
      { breaks: [actual(36000, 900 + 180)], ...noLunchAct },
    );
    const dur = res!.occurrences.find((o) => o.kind === 'BREAK_DURATION');
    expect(dur?.points).toBe(0.25);
    expect(dur?.deviation_seconds).toBe(180);
    expect(dur?.seq).toBe(1);
  });

  it('coming back early never earns points', () => {
    const res = run(
      { breaks: [sched(36000, 900)], ...noLunch },
      { breaks: [actual(36000, 600)], ...noLunchAct },
    );
    expect(res!.occurrences.find((o) => o.kind === 'BREAK_DURATION')).toBeUndefined();
  });
});

describe('missed segment', () => {
  it('scheduled break with no punch is a miss worth the flat rule', () => {
    const res = run(
      { breaks: [sched(36000, 900)], ...noLunch },
      { breaks: [], ...noLunchAct },
    );
    const miss = res!.occurrences.find((o) => o.kind === 'BREAK_MISSED');
    expect(miss?.points).toBe(1);
  });
});

describe('start-time', () => {
  it('5+ minutes off schedule records an occurrence-only (zero points)', () => {
    const res = run(
      { breaks: [sched(36000, 900)], ...noLunch },
      { breaks: [actual(36000 + 300, 900)], ...noLunchAct },
    );
    const start = res!.occurrences.find((o) => o.kind === 'BREAK_START');
    expect(start).toBeDefined();
    expect(start?.points).toBe(0);
    expect(start?.deviation_seconds).toBe(300);
  });

  it('under 5 minutes off is grace', () => {
    const res = run(
      { breaks: [sched(36000, 900)], ...noLunch },
      { breaks: [actual(36000 + 120, 900)], ...noLunchAct },
    );
    expect(res!.occurrences.find((o) => o.kind === 'BREAK_START')).toBeUndefined();
  });
});

describe('phone match — the whole point of the feature', () => {
  it('going on phone Break 10 min early minus 2 min grace is a START occurrence', () => {
    // Punched break 10:00-10:15; phone Break 09:50-10:15 → 600s early, minus 120s
    // grace = 480s → phone START occurrence, and no STOP (phone ended with punch).
    const phone: PhonePresence = { breaks: [{ startSec: 35400, endSec: 36900 }], lunches: [] };
    const res = run(
      { breaks: [sched(36000, 900)], ...noLunch },
      { breaks: [actual(36000, 900)], ...noLunchAct },
      phone,
    );
    const start = res!.occurrences.find((o) => o.kind === 'BREAK_PHONE_START');
    expect(start).toBeDefined();
    expect(start?.deviation_seconds).toBe(480);
    expect(res!.occurrences.find((o) => o.kind === 'BREAK_PHONE_STOP')).toBeUndefined();
    expect(res!.daily.phone_break_extra_sec).toBe(600);
  });

  it('staying on phone Break after the punch-out minus grace is a STOP occurrence', () => {
    // Punched break 10:00-10:15; phone Break 10:00-10:25 → 600s late, minus 60s
    // grace = 540s → phone STOP occurrence, and no START (phone started with punch).
    const phone: PhonePresence = { breaks: [{ startSec: 36000, endSec: 36900 + 600 }], lunches: [] };
    const res = run(
      { breaks: [sched(36000, 900)], ...noLunch },
      { breaks: [actual(36000, 900)], ...noLunchAct },
      phone,
    );
    const stop = res!.occurrences.find((o) => o.kind === 'BREAK_PHONE_STOP');
    expect(stop).toBeDefined();
    expect(stop?.deviation_seconds).toBe(540);
    expect(res!.occurrences.find((o) => o.kind === 'BREAK_PHONE_START')).toBeUndefined();
  });

  it('early AND late raises both a START and a STOP occurrence for the one break', () => {
    // Phone 09:50-10:25 vs punch 10:00-10:15: 600s early and 600s late.
    const phone: PhonePresence = { breaks: [{ startSec: 35400, endSec: 36900 + 600 }], lunches: [] };
    const res = run(
      { breaks: [sched(36000, 900)], ...noLunch },
      { breaks: [actual(36000, 900)], ...noLunchAct },
      phone,
    );
    const phones = res!.occurrences.filter((o) => o.kind.startsWith('BREAK_PHONE'));
    expect(phones.map((o) => o.kind).sort()).toEqual(['BREAK_PHONE_START', 'BREAK_PHONE_STOP']);
  });

  it('within the before/after tolerance is not scored', () => {
    const phone: PhonePresence = { breaks: [{ startSec: 36000 - 60, endSec: 36900 + 30 }], lunches: [] };
    const res = run(
      { breaks: [sched(36000, 900)], ...noLunch },
      { breaks: [actual(36000, 900)], ...noLunchAct },
      phone,
    );
    expect(res!.occurrences.some((o) => o.kind.startsWith('BREAK_PHONE'))).toBe(false);
  });

  it('no phone data means no phone occurrence', () => {
    const res = run(
      { breaks: [sched(36000, 900)], ...noLunch },
      { breaks: [actual(36000, 900)], ...noLunchAct },
      null,
    );
    expect(res!.occurrences.some((o) => o.kind.startsWith('BREAK_PHONE'))).toBe(false);
  });

  it('scores each break against its OWN punch — not a day-level union', () => {
    // Two breaks. Break 1's phone matches its punch (no occurrence). Break 2's
    // phone opens 10 min early. A union of both punches vs both phone spans would
    // smear the two together; per-instance pairing must charge only break 2.
    const phone: PhonePresence = {
      breaks: [
        { startSec: 36000, endSec: 36900 },          // break 1 phone == punch
        { startSec: 54000 - 600, endSec: 54900 },     // break 2 phone 10 min early
      ],
      lunches: [],
    };
    const res = run(
      { breaks: [sched(36000, 900), sched(54000, 900)], ...noLunch },
      { breaks: [actual(36000, 900), actual(54000, 900)], ...noLunchAct },
      phone,
    );
    const phones = res!.occurrences.filter((o) => o.kind.startsWith('BREAK_PHONE'));
    expect(phones).toHaveLength(1);
    expect(phones[0].kind).toBe('BREAK_PHONE_START');
    expect(phones[0].seq).toBe(2);
    expect(phones[0].deviation_seconds).toBe(480); // 600 early − 120 grace
    expect(phones[0].actual_start_sec).toBe(54000);
    expect(phones[0].phone_start_sec).toBe(53400);
  });

  it('does not pair a punch with a phone span it does not overlap', () => {
    // Morning punched break 10:00-10:15; the only phone-Break span is the
    // afternoon (15:00-15:20). They do not overlap, so there is no phone
    // occurrence — index/union pairing would have charged a bogus ~5h deviation.
    const phone: PhonePresence = { breaks: [{ startSec: 54000, endSec: 55200 }], lunches: [] };
    const res = run(
      { breaks: [sched(36000, 900)], ...noLunch },
      { breaks: [actual(36000, 900)], ...noLunchAct },
      phone,
    );
    expect(res!.occurrences.some((o) => o.kind.startsWith('BREAK_PHONE'))).toBe(false);
  });
});

describe('adherence exceptions (excused forgives the segment)', () => {
  const excuseBreak = (...seqs: number[]): DayExcusals => ({
    breaks: new Set(seqs),
    lunches: new Set<number>(),
  });

  it('an excused break forgives a long duration down to no points and 100% day', () => {
    // 15-min break run 10:00 long — excused clears the duration occurrence entirely
    // and the day reads fully adherent.
    const res = scoreDay(
      USER, D, 900,
      { breaks: [sched(36000, 900)], ...noLunch },
      { breaks: [actual(36000, 900 + 600)], ...noLunchAct },
      null, RULES, GRACE, excuseBreak(1),
    );
    expect(res!.occurrences.find((o) => o.kind === 'BREAK_DURATION')).toBeUndefined();
    expect(res!.daily.adherence_pct).toBe(100);
  });

  it('an excused break forgives a wrong start (either direction)', () => {
    const res = scoreDay(
      USER, D, 900,
      { breaks: [sched(36000, 900)], ...noLunch },
      { breaks: [actual(36000 + 600, 900)], ...noLunchAct },
      null, RULES, GRACE, excuseBreak(1),
    );
    expect(res!.occurrences.find((o) => o.kind === 'BREAK_START')).toBeUndefined();
  });

  it('an excused break forgives a miss', () => {
    // Scheduled break with no punch is normally a miss; excused suppresses it and
    // the day stays 100%.
    const res = scoreDay(
      USER, D, 900,
      { breaks: [sched(36000, 900)], ...noLunch },
      { breaks: [], ...noLunchAct },
      null, RULES, GRACE, excuseBreak(1),
    );
    expect(res!.occurrences.find((o) => o.kind === 'BREAK_MISSED')).toBeUndefined();
    expect(res!.daily.adherence_pct).toBe(100);
  });

  it('only forgives the excused instance, not its sibling', () => {
    // Two breaks both 10:00 long; excuse only break 2 → break 1 still charged.
    const res = scoreDay(
      USER, D, 900,
      { breaks: [sched(36000, 900), sched(54000, 900)], ...noLunch },
      { breaks: [actual(36000, 900 + 600), actual(54000, 900 + 600)], ...noLunchAct },
      null, RULES, GRACE, excuseBreak(2),
    );
    const durs = res!.occurrences.filter((o) => o.kind === 'BREAK_DURATION');
    expect(durs).toHaveLength(1);
    expect(durs[0].seq).toBe(1);
  });

  it('forgives the phone on the excused segment too', () => {
    // Phone 10 min early would normally be a START occurrence; excusing the break
    // forgives the phone that hangs off the same punch — no occurrence, no extra.
    const phone: PhonePresence = { breaks: [{ startSec: 35400, endSec: 36900 }], lunches: [] };
    const res = scoreDay(
      USER, D, 900,
      { breaks: [sched(36000, 900)], ...noLunch },
      { breaks: [actual(36000, 900)], ...noLunchAct },
      phone, RULES, GRACE, excuseBreak(1),
    );
    expect(res!.occurrences.some((o) => o.kind.startsWith('BREAK_PHONE'))).toBe(false);
    expect(res!.daily.phone_break_extra_sec).toBe(0);
  });

  it('forgives phone only on the excused instance, not its sibling', () => {
    // Two breaks, each with a phone span 10 min early. Excuse only break 2 → its
    // phone drops out, break 1's phone START still charges.
    const phone: PhonePresence = {
      breaks: [
        { startSec: 36000 - 600, endSec: 36900 },
        { startSec: 54000 - 600, endSec: 54900 },
      ],
      lunches: [],
    };
    const res = scoreDay(
      USER, D, 900,
      { breaks: [sched(36000, 900), sched(54000, 900)], ...noLunch },
      { breaks: [actual(36000, 900), actual(54000, 900)], ...noLunchAct },
      phone, RULES, GRACE, excuseBreak(2),
    );
    const phones = res!.occurrences.filter((o) => o.kind.startsWith('BREAK_PHONE'));
    expect(phones).toHaveLength(1);
    expect(phones[0].seq).toBe(1);
  });
});

describe('adherence_pct', () => {
  it('a flawless day reads 100', () => {
    const res = run(
      { breaks: [sched(36000, 900)], ...noLunch },
      { breaks: [actual(36000, 900)], ...noLunchAct },
    );
    expect(res!.daily.adherence_pct).toBe(100);
  });
});
