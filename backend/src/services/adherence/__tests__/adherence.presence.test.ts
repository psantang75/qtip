import { describe, it, expect } from 'vitest';
import {
  isFullDayAbsence, absenceWindows, absentScheduledSeqs, overlapsAny,
} from '../adherence.presence';
import type { PresenceException } from '../adherence.presence';

const fullDay = (over: Partial<PresenceException> = {}): PresenceException => ({
  isFullDay: true, start: null, end: null, ...over,
});
const windowed = (start: string, end: string): PresenceException => ({
  isFullDay: false, start, end,
});

describe('isFullDayAbsence', () => {
  it('is true when any exception is a full day, excused or not', () => {
    expect(isFullDayAbsence([fullDay()])).toBe(true);
    expect(isFullDayAbsence([windowed('09:00', '11:00'), fullDay()])).toBe(true);
  });
  it('is false when every exception is windowed', () => {
    expect(isFullDayAbsence([windowed('09:00', '11:00')])).toBe(false);
    expect(isFullDayAbsence([])).toBe(false);
  });
});

describe('absenceWindows', () => {
  it('skips full-day rows and untimed windows', () => {
    expect(absenceWindows([fullDay(), { isFullDay: false, start: null, end: null }])).toEqual([]);
  });
  it('converts HH:MM to seconds and rolls midnight', () => {
    expect(absenceWindows([windowed('09:00', '11:00')])).toEqual([{ startSec: 32400, endSec: 39600 }]);
    expect(absenceWindows([windowed('22:00', '02:00')])).toEqual([{ startSec: 79200, endSec: 93600 }]);
  });
});

describe('overlapsAny / absentScheduledSeqs', () => {
  const morning = { startSec: 36000, endSec: 36900 }; // 10:00-10:15
  const afternoon = { startSec: 54000, endSec: 54900 }; // 15:00-15:15
  const late = absenceWindows([windowed('09:00', '09:20')]);
  const amOut = absenceWindows([windowed('09:00', '12:00')]);

  it('a late window does not cover a 10:00 break', () => {
    expect(overlapsAny(morning.startSec, morning.endSec, late)).toBe(false);
    expect(absentScheduledSeqs([morning, afternoon], late).size).toBe(0);
  });
  it('a 9-12 exception covers the morning break only', () => {
    expect(absentScheduledSeqs([morning, afternoon], amOut)).toEqual(new Set([1]));
  });
});
