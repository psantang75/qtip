/**
 * Presence gate for adherence. Attendance exceptions mean the person was not
 * here; those intervals drop out of the adherence universe entirely (not scored
 * as a miss, not credited as 100%). Excused vs unexcused does not matter —
 * attendance already owns that call. Adherence exceptions (they WERE here, this
 * break was approved) are a different path in the engine.
 */
export interface PresenceException {
  isFullDay: boolean;
  start: string | null;
  end: string | null;
}

export interface SecRange {
  startSec: number;
  endSec: number;
}

function hmToSec(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 3600 + m * 60;
}

/** Full-day PTO / unpaid / NCNS / sick — approved or not. The whole day is out. */
export function isFullDayAbsence(exceptions: PresenceException[]): boolean {
  return exceptions.some((e) => e.isFullDay);
}

/**
 * Timed "not here" windows. Full-day rows are handled separately. A windowed
 * row with no start/end cannot be placed, so it suppresses nothing.
 */
export function absenceWindows(exceptions: PresenceException[]): SecRange[] {
  const out: SecRange[] = [];
  for (const e of exceptions) {
    if (e.isFullDay || !e.start || !e.end) continue;
    const startSec = hmToSec(e.start);
    let endSec = hmToSec(e.end);
    if (endSec <= startSec) endSec += 24 * 3600;
    out.push({ startSec, endSec });
  }
  return out;
}

export function overlapsAny(startSec: number, endSec: number, windows: SecRange[]): boolean {
  return windows.some((w) => Math.min(endSec, w.endSec) - Math.max(startSec, w.startSec) > 0);
}

/** 1-based seqs of scheduled segments whose window overlaps a "not here" block. */
export function absentScheduledSeqs(
  scheduled: Array<{ startSec: number; endSec: number }>,
  windows: SecRange[],
): Set<number> {
  const seqs = new Set<number>();
  scheduled.forEach((s, i) => {
    if (overlapsAny(s.startSec, s.endSec, windows)) seqs.add(i + 1);
  });
  return seqs;
}
