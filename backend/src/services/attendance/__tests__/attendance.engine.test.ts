/**
 * Contract tests for scoreDay — the function that turns one scheduled day plus
 * that day's punches into a compliance denominator and zero or more point-bearing
 * occurrences. Pure, so no DB.
 *
 * These cover the decisions that are expensive to get wrong in production because
 * they are invisible until somebody disputes a warning: which forgiveness path
 * wins, whether a flawless day reads exactly 100%, and whether an extreme late
 * becomes an absence instead of silently scoring nothing.
 *
 * Baseline shift is 09:00-17:00 with an unpaid 30-minute lunch, so
 * scheduledMinutes is 450 and a flawless day is 450 adherent.
 */
import { describe, it, expect } from 'vitest';
import { scoreDay } from '../attendance.engine';
import { classifyTimeOff } from '../../scheduling/timeOff.classify';
import type { PointRule } from '../attendance.rules';
import type { ScheduledDay, ScheduledException, ScheduledSegment } from '../scheduleProvider';

const D = '2026-07-15';
const USER = 42;

const RULES: PointRule[] = [
  { id: 1, ruleKey: 'late_3', label: 'Late 3+', kind: 'LATE', minSeconds: 181, maxSeconds: 959, points: 0.25, exceptionTypeId: null, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
  { id: 2, ruleKey: 'late_16', label: 'Late 16+', kind: 'LATE', minSeconds: 960, maxSeconds: 3659, points: 0.5, exceptionTypeId: null, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
  { id: 4, ruleKey: 'late_121', label: 'Late 121+', kind: 'LATE', minSeconds: 3660, maxSeconds: 28740, points: 1, exceptionTypeId: null, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
  { id: 5, ruleKey: 'leave_early', label: 'Leave Early', kind: 'EARLY_LEAVE', minSeconds: 181, maxSeconds: null, points: 0.5, exceptionTypeId: null, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
  { id: 6, ruleKey: 'absent', label: 'Absent', kind: 'ABSENT', minSeconds: 0, maxSeconds: null, points: 1, exceptionTypeId: null, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
  { id: 7, ruleKey: 'ncns', label: 'No Call / No Show', kind: 'EXCEPTION', minSeconds: 0, maxSeconds: null, points: 2, exceptionTypeId: 3, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
  { id: 8, ruleKey: 'unpaid_not_approved', label: 'Unpaid - Not Approved', kind: 'EXCEPTION', minSeconds: 0, maxSeconds: null, points: 1, exceptionTypeId: 2, effectiveFrom: '2000-01-01', effectiveTo: null, isActive: true },
];

const LUNCH: ScheduledSegment = {
  activity: 'Lunch', start: '12:00', end: '12:30', isPaid: false, countsAsCoverage: false,
};

function day(o: Partial<ScheduledDay> = {}): ScheduledDay {
  return {
    shiftId: 900,
    start: '09:00',
    end: '17:00',
    isDayOff: false,
    scheduledMinutes: 450,
    segments: [LUNCH],
    exceptions: [],
    ...o,
  };
}

function exception(o: Partial<ScheduledException> = {}): ScheduledException {
  return {
    id: 5001,
    typeId: 1,
    typeKey: 'pto',
    label: 'PTO',
    isExcused: true,
    isFullDay: true,
    affectsArrival: false,
    affectsDeparture: false,
    start: null,
    end: null,
    ...o,
  };
}

/** Local wall-clock instant on the test date. */
const at = (hhmm: string, dateStr = D): Date => new Date(`${dateStr}T${hhmm}:00`);

const punches = (first: string | null, last: string | null) => ({
  firstPunchAt: first ? at(first) : null,
  lastPunchAt: last ? at(last) : null,
});

describe('scoreDay — days that carry no denominator', () => {
  it('returns null for a day off', () => {
    expect(scoreDay(USER, D, day({ isDayOff: true }), punches('09:00', '17:00'), RULES)).toBeNull();
  });

  it('returns null when the shift has no times', () => {
    expect(scoreDay(USER, D, day({ start: null, end: null }), punches(null, null), RULES)).toBeNull();
  });

  it('returns null when scheduled minutes are zero', () => {
    expect(scoreDay(USER, D, day({ scheduledMinutes: 0 }), punches('09:00', '17:00'), RULES)).toBeNull();
  });
});

describe('scoreDay — a flawless day', () => {
  it('reads exactly 100% compliant and earns nothing', () => {
    const r = scoreDay(USER, D, day(), punches('09:00', '17:00'), RULES)!;
    expect(r.occurrences).toEqual([]);
    expect(r.daily.adherent_minutes).toBe(450);
    expect(r.daily.scheduled_minutes).toBe(450);
    expect(r.daily.late_seconds).toBe(0);
    expect(r.daily.is_absent).toBe(false);
  });

  it('does not reward arriving early or staying late', () => {
    const r = scoreDay(USER, D, day(), punches('08:30', '17:45'), RULES)!;
    expect(r.daily.adherent_minutes).toBe(450);
    expect(r.occurrences).toEqual([]);
  });
});

describe('scoreDay — grace', () => {
  it('records lateness inside grace without charging for it', () => {
    const r = scoreDay(USER, D, day(), punches('09:02', '17:00'), RULES)!;
    expect(r.occurrences).toEqual([]);
    // Stored anyway: the person who is 2 minutes late every day is invisible
    // to a pure point total, and Grace Used is what surfaces them.
    expect(r.daily.late_seconds).toBe(120);
  });
});

describe('scoreDay — late arrival', () => {
  it('charges the band the deviation falls in', () => {
    const r = scoreDay(USER, D, day(), punches('09:10', '17:00'), RULES)!;
    expect(r.occurrences).toHaveLength(1);
    expect(r.occurrences[0]).toMatchObject({ kind: 'LATE', rule_id: 1, points: 0.25, deviation_seconds: 600 });
    expect(r.occurrences[0].reason_label).toBe('Late 3+ (0:10:00)');
  });

  it('loses the late minutes from compliance', () => {
    const r = scoreDay(USER, D, day(), punches('09:30', '17:00'), RULES)!;
    expect(r.daily.adherent_minutes).toBe(420);
    expect(r.occurrences[0]).toMatchObject({ rule_id: 2, points: 0.5 });
  });

  it('becomes an absence when it exceeds the top band', () => {
    // 28740s past 09:00 is 16:59 — later than the ladder covers, so they were
    // not there. Without this the day would score zero points, the worst outcome.
    const r = scoreDay(USER, D, day(), punches('17:00', '17:00'), RULES)!;
    expect(r.daily.is_absent).toBe(true);
    expect(r.daily.adherent_minutes).toBe(0);
    expect(r.occurrences).toHaveLength(1);
    expect(r.occurrences[0]).toMatchObject({ kind: 'ABSENT', points: 1 });
    // The deviation is still recorded, so the detail row can explain itself.
    expect(r.daily.late_seconds).toBe(28800);
  });
});

describe('scoreDay — early departure', () => {
  it('charges the early-leave band', () => {
    const r = scoreDay(USER, D, day(), punches('09:00', '16:30'), RULES)!;
    expect(r.occurrences).toHaveLength(1);
    expect(r.occurrences[0]).toMatchObject({ kind: 'EARLY_LEAVE', points: 0.5, deviation_seconds: 1800 });
    expect(r.daily.adherent_minutes).toBe(420);
  });

  it('treats a missing clock-out as working to the end of shift', () => {
    // A missed punch is a data problem, not evidence somebody left early.
    // Guessing otherwise invents points that cannot be defended.
    const r = scoreDay(USER, D, day(), punches('09:00', null), RULES)!;
    expect(r.occurrences).toEqual([]);
    expect(r.daily.early_leave_seconds).toBe(0);
    expect(r.daily.adherent_minutes).toBe(450);
  });

  it('stacks with a late arrival on the same day', () => {
    // Policy decision: no daily cap. Late and left early are two separate
    // choices and both are charged.
    const r = scoreDay(USER, D, day(), punches('09:20', '16:00'), RULES)!;
    expect(r.occurrences.map(o => o.kind).sort()).toEqual(['EARLY_LEAVE', 'LATE']);
    expect(r.occurrences.reduce((s, o) => s + o.points, 0)).toBe(1);
  });
});

describe('scoreDay — absence', () => {
  it('charges a full absence when nobody punched', () => {
    const r = scoreDay(USER, D, day(), punches(null, null), RULES)!;
    expect(r.daily.is_absent).toBe(true);
    expect(r.daily.adherent_minutes).toBe(0);
    // Scheduled minutes remain, so the absence drags compliance down. Zeroing
    // them would make an absence free on the compliance metric.
    expect(r.daily.scheduled_minutes).toBe(450);
    expect(r.occurrences[0]).toMatchObject({ kind: 'ABSENT', points: 1 });
  });

  it('records the absence with no points when the policy has no absence rule', () => {
    const r = scoreDay(USER, D, day(), punches(null, null), RULES.filter(x => x.kind !== 'ABSENT'))!;
    expect(r.daily.is_absent).toBe(true);
    expect(r.occurrences).toEqual([]);
  });
});

describe('scoreDay — forgiveness', () => {
  it('a full-day excused exception suppresses everything and flags the day', () => {
    const r = scoreDay(USER, D, day({ exceptions: [exception()] }), punches(null, null), RULES)!;
    expect(r.occurrences).toEqual([]);
    expect(r.daily.is_excused).toBe(true);
    expect(r.daily.excused_exception_id).toBe(5001);
    expect(r.daily.is_absent).toBe(false);
  });

  it('excuses a day even when the punches would otherwise have been clean', () => {
    const r = scoreDay(USER, D, day({ exceptions: [exception()] }), punches('09:00', '17:00'), RULES)!;
    expect(r.daily.is_excused).toBe(true);
    // adherent stays 0; the rollup drops excused days from BOTH sides, so
    // leaving it at 0 cannot depress anyone's percentage.
    expect(r.daily.adherent_minutes).toBe(0);
  });

  it('a windowed excused exception forgives that much lateness', () => {
    const appt = exception({
      typeKey: 'appt', label: 'Appointment', isFullDay: false,
      affectsArrival: true, start: '09:00', end: '09:30',
    });
    const r = scoreDay(USER, D, day({ exceptions: [appt] }), punches('09:25', '17:00'), RULES)!;
    expect(r.occurrences).toEqual([]);
    expect(r.daily.late_seconds).toBe(0);
  });

  it('charges only the lateness beyond the forgiven window', () => {
    const appt = exception({
      typeKey: 'appt', label: 'Appointment', isFullDay: false,
      affectsArrival: true, start: '09:00', end: '09:10',
    });
    // 20 minutes late, 10 forgiven, so 10 remain — the 3+ band, not the 16+ one.
    const r = scoreDay(USER, D, day({ exceptions: [appt] }), punches('09:20', '17:00'), RULES)!;
    expect(r.daily.late_seconds).toBe(600);
    expect(r.occurrences[0]).toMatchObject({ rule_id: 1, points: 0.25 });
  });

  it('does not let an arrival-side window forgive an early departure', () => {
    const appt = exception({
      typeKey: 'appt', label: 'Appointment', isFullDay: false,
      affectsArrival: true, affectsDeparture: false, start: '09:00', end: '09:30',
    });
    const r = scoreDay(USER, D, day({ exceptions: [appt] }), punches('09:00', '16:00'), RULES)!;
    expect(r.occurrences.map(o => o.kind)).toEqual(['EARLY_LEAVE']);
  });

  it('forgives only the overlap, so a mid-shift window excuses no lateness at all', () => {
    // A 14:00-14:30 appointment cannot explain a 09:20 arrival. Crediting its raw
    // length would erase 30 minutes of lateness it never covered.
    const appt = exception({
      typeKey: 'appt', label: 'Appointment', isFullDay: false,
      affectsArrival: true, start: '14:00', end: '14:30',
    });
    const r = scoreDay(USER, D, day({ exceptions: [appt] }), punches('09:20', '17:00'), RULES)!;
    expect(r.daily.late_seconds).toBe(1200);
    expect(r.occurrences.map((o) => o.kind)).toEqual(['LATE']);
  });

  it('lets one both-edge type cover a full day or either edge without double-forgiving', () => {
    // This is what allows a single Paychex-linked type to replace the old
    // FULL_DAY/WINDOW pair. A 13:00-17:00 PTO block sits on the departure side, so
    // it must excuse the early leave and leave the late arrival fully charged.
    const pto = exception({
      typeKey: 'scheduled_pto', label: 'PTO - Approved', isFullDay: false,
      affectsArrival: true, affectsDeparture: true, start: '13:00', end: '17:00',
    });
    const r = scoreDay(USER, D, day({ exceptions: [pto] }), punches('09:20', '13:00'), RULES)!;
    expect(r.daily.early_leave_seconds).toBe(0);
    expect(r.daily.late_seconds).toBe(1200);
    expect(r.occurrences.map((o) => o.kind)).toEqual(['LATE']);
  });

  it('charges the part of a deviation the window leaves uncovered', () => {
    const pto = exception({
      typeKey: 'scheduled_pto', label: 'PTO - Approved', isFullDay: false,
      affectsArrival: true, affectsDeparture: true, start: '14:00', end: '17:00',
    });
    // Left at 13:30: four hours short, three of them excused by the block.
    const r = scoreDay(USER, D, day({ exceptions: [pto] }), punches('09:00', '13:30'), RULES)!;
    expect(r.daily.early_leave_seconds).toBe(1800);
    expect(r.occurrences.map((o) => o.kind)).toEqual(['EARLY_LEAVE']);
  });

  it('ignores an unexcused windowed exception', () => {
    const appt = exception({
      typeKey: 'late_notice', label: 'Called in late', isExcused: false, isFullDay: false,
      affectsArrival: true, start: '09:00', end: '09:30',
    });
    const r = scoreDay(USER, D, day({ exceptions: [appt] }), punches('09:20', '17:00'), RULES)!;
    expect(r.occurrences[0]).toMatchObject({ kind: 'LATE', points: 0.5 });
  });
});

describe('scoreDay — point-bearing exceptions', () => {
  it('a No Call / No Show replaces the derived absence rather than stacking', () => {
    const ncns = exception({ id: 7001, typeId: 3, typeKey: 'ncns', label: 'No Call / No Show', isExcused: false });
    const r = scoreDay(USER, D, day({ exceptions: [ncns] }), punches(null, null), RULES)!;
    expect(r.occurrences).toHaveLength(1);
    expect(r.occurrences[0]).toMatchObject({ kind: 'EXCEPTION', points: 2, reason_label: 'No Call / No Show' });
    expect(r.daily.is_absent).toBe(true);
  });

  it('falls back to a plain absence for an exception type that carries no points', () => {
    const other = exception({ typeId: 99, typeKey: 'unpaid', label: 'Unpaid day', isExcused: false });
    const r = scoreDay(USER, D, day({ exceptions: [other] }), punches(null, null), RULES)!;
    expect(r.occurrences).toHaveLength(1);
    expect(r.occurrences[0]).toMatchObject({ kind: 'ABSENT', points: 1 });
  });

  it('prefers a full-day excusal over a point-bearing exception on the same day', () => {
    const ncns = exception({ typeId: 3, typeKey: 'ncns', label: 'No Call / No Show', isExcused: false });
    const pto = exception({ id: 5002, typeId: 1, typeKey: 'pto', label: 'PTO', isExcused: true });
    const r = scoreDay(USER, D, day({ exceptions: [ncns, pto] }), punches(null, null), RULES)!;
    expect(r.daily.is_excused).toBe(true);
    expect(r.occurrences).toEqual([]);
  });

  it('charges the flat point only for a full day, not for part of one', () => {
    // PTO - Not Approved and Unpaid - Not Approved are EITHER types: a whole day
    // gone without approval is the flat point, but a couple of unapproved hours
    // is a late arrival or an early leave and has to be banded like one. Charging
    // the full-day point for twenty missing minutes would make an unapproved
    // long lunch cost the same as skipping the day.
    const partial = exception({
      typeId: 3, typeKey: 'ncns', label: 'No Call / No Show',
      isExcused: false, isFullDay: false,
      affectsArrival: true, affectsDeparture: true, start: '09:00', end: '09:20',
    });
    const r = scoreDay(USER, D, day({ exceptions: [partial] }), punches('09:20', '17:00'), RULES)!;
    expect(r.occurrences).toHaveLength(1);
    expect(r.occurrences[0]).toMatchObject({ kind: 'LATE', points: 0.5 });
    expect(r.daily.is_absent).toBe(false);
  });
});

/**
 * The two pay types added last, VTO and Jury Duty. Both are excused, so what is
 * worth pinning is that they behave like the other excused types rather than
 * having picked up any special case on the way in.
 */
describe('scoreDay — VTO and Jury Duty', () => {
  it('a full day of VTO leaves compliance entirely rather than scoring zero', () => {
    // The company offered the time off, so accepting it must not cost a point —
    // and must not drag the percentage down either, which counting the day as a
    // 0-of-450 shift would do.
    const vto = exception({ typeId: 21, typeKey: 'vto', label: 'VTO', isExcused: true });
    const r = scoreDay(USER, D, day({ exceptions: [vto] }), punches(null, null), RULES)!;
    expect(r.occurrences).toEqual([]);
    expect(r.daily.is_excused).toBe(true);
    expect(r.daily.is_absent).toBe(false);
    expect(r.daily.scheduled_minutes).toBe(450);
    expect(r.daily.adherent_minutes).toBe(0);
  });

  it('a morning in court forgives the late arrival it caused and nothing else', () => {
    const jury = exception({
      typeId: 13, typeKey: 'jury_duty', label: 'Jury Duty', isExcused: true, isFullDay: false,
      affectsArrival: true, affectsDeparture: true, start: '09:00', end: '12:00',
    });
    const r = scoreDay(USER, D, day({ exceptions: [jury] }), punches('12:00', '17:00'), RULES)!;
    expect(r.occurrences).toEqual([]);
    expect(r.daily.late_seconds).toBe(0);
  });

  it('leaves the part of the day the court did not account for still charged', () => {
    // Excused until noon, back at 12:30 instead of 12:00. Only the overlap is
    // forgiven, so the extra half hour is a late arrival on its own merits.
    const jury = exception({
      typeId: 13, typeKey: 'jury_duty', label: 'Jury Duty', isExcused: true, isFullDay: false,
      affectsArrival: true, affectsDeparture: true, start: '09:00', end: '12:00',
    });
    const r = scoreDay(USER, D, day({ exceptions: [jury] }), punches('12:30', '17:00'), RULES)!;
    expect(r.daily.late_seconds).toBe(1800);
    expect(r.occurrences.map(o => o.kind)).toEqual(['LATE']);
  });
});

/**
 * The two ends of the pipeline together, because the interesting part is the
 * hand-off from Paychex's units to ours.
 *
 * PTO is granted only in half days and whole days. Anything smaller is booked as
 * unpaid time at its real length, so a two-hour absence arrives as a two-hour
 * block rather than being rounded up into a half day. Either way the block only
 * says whether the day is whole or partial; the punches say what it costs.
 */
describe('unapproved time short of a full day scores as lateness', () => {
  /** The exception the importer would write for one unapproved block. */
  function derive(
    minutes: number,
    blockStart: string,
    work: { first: string; last: string },
  ): ScheduledException {
    const start = at(blockStart);
    const c = classifyTimeOff(D, day(), [{ start, end: new Date(start.getTime() + minutes * 60000) }], {
      first: at(work.first), last: at(work.last),
    });
    if (c.kind !== 'PARTIAL') throw new Error(`expected PARTIAL, got ${c.kind}`);
    return exception({
      typeId: 2, typeKey: 'unexcused_absence', label: 'Unpaid - Not Approved',
      isExcused: false, isFullDay: false, affectsArrival: true, affectsDeparture: true,
      start: c.windows[0].start, end: c.windows[0].end,
    });
  }

  it('two unapproved hours at the end of the day is an early leave', () => {
    const ex = derive(120, '15:00', { first: '09:00', last: '15:00' });
    expect(ex).toMatchObject({ start: '15:00', end: '17:00' });
    const r = scoreDay(USER, D, day({ exceptions: [ex] }), punches('09:00', '15:00'), RULES)!;
    expect(r.occurrences).toHaveLength(1);
    expect(r.occurrences[0]).toMatchObject({ kind: 'EARLY_LEAVE', deviation_seconds: 7200, points: 0.5 });
    expect(r.daily.is_absent).toBe(false);
  });

  it('two unapproved hours at the start of the day is a late arrival', () => {
    const ex = derive(120, '09:00', { first: '11:00', last: '17:00' });
    expect(ex).toMatchObject({ start: '09:00', end: '11:00' });
    const r = scoreDay(USER, D, day({ exceptions: [ex] }), punches('11:00', '17:00'), RULES)!;
    expect(r.occurrences).toHaveLength(1);
    expect(r.occurrences[0]).toMatchObject({ kind: 'LATE', deviation_seconds: 7200 });
    expect(r.daily.is_absent).toBe(false);
  });

  it('an unapproved half day is banded on the hours missed, not charged as a lost day', () => {
    // Four hours of leave reaches 13:30, not 13:00, because the unpaid lunch
    // costs clock time but no leave.
    const ex = derive(240, '09:00', { first: '13:30', last: '17:00' });
    expect(ex).toMatchObject({ start: '09:00', end: '13:30' });
    const r = scoreDay(USER, D, day({ exceptions: [ex] }), punches('13:30', '17:00'), RULES)!;
    expect(r.occurrences).toHaveLength(1);
    expect(r.occurrences[0]).toMatchObject({ kind: 'LATE', deviation_seconds: 16200 });
    expect(r.daily.is_absent).toBe(false);
  });

  it('still charges the flat point when the whole day was unapproved', () => {
    const whole = exception({
      typeId: 2, typeKey: 'unexcused_absence', label: 'Unpaid - Not Approved', isExcused: false,
    });
    const r = scoreDay(USER, D, day({ exceptions: [whole] }), punches(null, null), RULES)!;
    expect(r.occurrences).toHaveLength(1);
    expect(r.occurrences[0]).toMatchObject({ kind: 'EXCEPTION', points: 1, reason_label: 'Unpaid - Not Approved' });
    expect(r.daily.is_absent).toBe(true);
  });
});

describe('scoreDay — unpaid segments and overnight shifts', () => {
  it('excludes an unpaid lunch actually worked through', () => {
    // Working the lunch does not raise compliance above the schedule; the
    // denominator is net of unpaid time, so the numerator must be too.
    const r = scoreDay(USER, D, day(), punches('09:00', '17:00'), RULES)!;
    expect(r.daily.adherent_minutes).toBe(450);
  });

  it('counts a paid break as time worked', () => {
    const paidBreak: ScheduledSegment = { ...LUNCH, activity: 'Break', isPaid: true };
    const r = scoreDay(USER, D, day({ segments: [paidBreak], scheduledMinutes: 480 }), punches('09:00', '17:00'), RULES)!;
    expect(r.daily.adherent_minutes).toBe(480);
  });

  it('cannot exceed 100% when an unpaid segment sits outside the shift', () => {
    // Three days in the real data look like this: a shift shortened to 16:30 that
    // still carries its original 17:30 lunch. scheduleProvider now clamps the
    // deduction to the shift window, so scheduledMinutes is the full 240 and the
    // numerator cannot outrun it. Before the clamp this produced 100.21%.
    const strayLunch: ScheduledSegment = {
      activity: 'Lunch', start: '17:30', end: '18:00', isPaid: false, countsAsCoverage: false,
    };
    const d = day({ start: '12:30', end: '16:30', scheduledMinutes: 240, segments: [strayLunch] });
    const r = scoreDay(USER, D, d, { firstPunchAt: at('12:30'), lastPunchAt: at('16:30') }, RULES)!;
    expect(r.daily.adherent_minutes).toBe(240);
    expect(r.daily.adherent_minutes).toBeLessThanOrEqual(r.daily.scheduled_minutes);
  });

  it('deducts an unpaid break that falls after midnight on an overnight shift', () => {
    // 22:00-06:00 with a 02:00 lunch. Timed against the shift's own date the
    // segment would overlap nothing, leaving it in the numerator while the
    // schedule takes it out of the denominator.
    const nightLunch: ScheduledSegment = {
      activity: 'Lunch', start: '02:00', end: '02:30', isPaid: false, countsAsCoverage: false,
    };
    const overnight = day({ start: '22:00', end: '06:00', scheduledMinutes: 450, segments: [nightLunch] });
    const r = scoreDay(
      USER, D, overnight,
      { firstPunchAt: at('22:00'), lastPunchAt: at('06:00', '2026-07-16') },
      RULES,
    )!;
    expect(r.daily.adherent_minutes).toBe(450);
    expect(r.occurrences).toEqual([]);
  });

  it('rolls the end of an overnight shift to the next day', () => {
    // 22:00-06:00. Punching out at 06:00 the following morning is a full clean
    // shift, not an eight-hour early departure.
    const overnight = day({ start: '22:00', end: '06:00', scheduledMinutes: 480, segments: [] });
    const r = scoreDay(
      USER, D, overnight,
      { firstPunchAt: at('22:00'), lastPunchAt: at('06:00', '2026-07-16') },
      RULES,
    )!;
    expect(r.occurrences).toEqual([]);
    expect(r.daily.adherent_minutes).toBe(480);
  });
});
