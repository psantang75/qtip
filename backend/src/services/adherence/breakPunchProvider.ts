/**
 * breakPunchProvider — the ACTUAL break/lunch side of adherence. Reads the paid
 * Break and unpaid Meal blocks out of punch_raw and returns, per scheduled day,
 * the break and lunch instances the agent actually took (start, end, length).
 *
 * punch_raw stores SEGMENTS: each row spans two punch events. A `Break` pay_type
 * block is one paid rest; a `Meal` pay_type block is the unpaid lunch. There can
 * be more than one break in a day, so instances are returned as a list.
 *
 * Blocks are assigned to the nearest scheduled-day anchor by their start instant
 * (mirroring punchProvider), so a block never lands on the wrong day and an
 * overnight shift's segments stay with the shift they belong to.
 */
import prisma from '../../config/prisma';
import type { PunchWindow } from '../attendance/punchProvider';

export type { PunchWindow };

export interface PunchSegment {
  start: Date;
  end: Date;
  durationSec: number;
}

export interface PunchSegments {
  breaks: PunchSegment[];
  lunches: PunchSegment[];
}

const BREAK_PAY_TYPES = new Set(['Break']);
const MEAL_PAY_TYPES = new Set(['Meal']);

/** How far a block may sit from a shift anchor and still belong to it (12h). */
const MAX_ASSIGN_MS = 12 * 60 * 60 * 1000;

const key = (userId: number, dateStr: string) => `${userId}:${dateStr}`;

interface Anchor {
  dateStr: string;
  startMs: number;
}

/** Nearest anchor to an instant by its start edge, or null when nothing is close. */
function nearestAnchor(anchors: Anchor[], punchMs: number): Anchor | null {
  let best: Anchor | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const a of anchors) {
    const dist = Math.abs(punchMs - a.startMs);
    if (dist < bestDist) {
      bestDist = dist;
      best = a;
    }
  }
  return best !== null && bestDist <= MAX_ASSIGN_MS ? best : null;
}

/**
 * Actual break/lunch instances per scheduled day, keyed `${userId}:${YYYY-MM-DD}`.
 * One query for the whole range. A window with no matched blocks gets empty lists;
 * the engine decides whether that is a missed break/lunch (it depends on whether
 * the segment was scheduled, which only the engine sees).
 */
export async function getPunchSegments(windows: PunchWindow[]): Promise<Map<string, PunchSegments>> {
  const out = new Map<string, PunchSegments>();
  if (windows.length === 0) return out;

  const userIds = [...new Set(windows.map((w) => w.userId))];
  const earliest = new Date(Math.min(...windows.map((w) => w.start.getTime())) - MAX_ASSIGN_MS);
  const latest = new Date(Math.max(...windows.map((w) => w.end.getTime())) + MAX_ASSIGN_MS);

  const anchorsByUser = new Map<number, Anchor[]>();
  for (const w of windows) {
    const list = anchorsByUser.get(w.userId) ?? [];
    list.push({ dateStr: w.dateStr, startMs: w.start.getTime() });
    anchorsByUser.set(w.userId, list);
    out.set(key(w.userId, w.dateStr), { breaks: [], lunches: [] });
  }

  const rows = await prisma.punchRaw.findMany({
    where: {
      user_id: { in: userIds },
      punch_in_at: { gte: earliest, lte: latest },
      punch_out_at: { not: null },
      pay_type: { in: ['Break', 'Meal'] },
    },
    select: { user_id: true, punch_in_at: true, punch_out_at: true, pay_type: true },
  });

  for (const r of rows) {
    if (!r.punch_in_at || !r.punch_out_at || !r.pay_type) continue;
    const anchors = anchorsByUser.get(r.user_id);
    if (!anchors) continue;
    const anchor = nearestAnchor(anchors, r.punch_in_at.getTime());
    if (!anchor) continue;

    const slot = out.get(key(r.user_id, anchor.dateStr));
    if (!slot) continue;
    const durationSec = Math.max(0, Math.round((r.punch_out_at.getTime() - r.punch_in_at.getTime()) / 1000));
    const seg: PunchSegment = { start: r.punch_in_at, end: r.punch_out_at, durationSec };
    if (BREAK_PAY_TYPES.has(r.pay_type)) slot.breaks.push(seg);
    else if (MEAL_PAY_TYPES.has(r.pay_type)) slot.lunches.push(seg);
  }

  // Order instances by start so seq is stable and the first break is seq 1.
  for (const seg of out.values()) {
    seg.breaks.sort((a, b) => a.start.getTime() - b.start.getTime());
    seg.lunches.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  return out;
}
