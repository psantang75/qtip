/**
 * Retire punch segments a new Paychex file replaced.
 *
 * The importer upserts on Post ID, which heals an edit that keeps its id. Paychex
 * sometimes reissues the same timecard under new Post IDs and leaves the old ones
 * out of the file. Those leftovers used to stay in punch_raw and get summed again,
 * so a corrected day showed the right clock bar (the copies overlap) and twice
 * the paid hours.
 *
 * For each person in the file, any stored segment whose punch-in falls on a
 * calendar day the file covers, and whose Post ID the file does not contain, is
 * removed. Days outside that person's own span in this file are left alone, so a
 * one-day correction cannot wipe the rest of their history.
 */
import prisma from '../../config/prisma';
import { addDays, fmtLocal, parseLocal } from '../scheduling/schedule.dates';

export interface KeptPunch {
  userId: number;
  postId: string;
  punchInAt: Date | null;
}

export interface SupersedeWindow {
  userId: number;
  /** Inclusive local midnight of the earliest punch-in day in the file. */
  from: Date;
  /** Exclusive local midnight after the latest punch-in day in the file. */
  to: Date;
  keepPostIds: string[];
}

/** One window per user who has at least one punch-in in the file. */
export function supersedeWindows(punches: KeptPunch[]): SupersedeWindow[] {
  const byUser = new Map<number, { posts: string[]; min: string | null; max: string | null }>();
  for (const p of punches) {
    let slot = byUser.get(p.userId);
    if (!slot) {
      slot = { posts: [], min: null, max: null };
      byUser.set(p.userId, slot);
    }
    slot.posts.push(p.postId);
    if (!p.punchInAt) continue;
    const day = fmtLocal(p.punchInAt);
    if (slot.min === null || day < slot.min) slot.min = day;
    if (slot.max === null || day > slot.max) slot.max = day;
  }

  const out: SupersedeWindow[] = [];
  for (const [userId, slot] of byUser) {
    if (!slot.min || !slot.max || slot.posts.length === 0) continue;
    out.push({
      userId,
      from: parseLocal(slot.min),
      to: parseLocal(addDays(slot.max, 1)),
      keepPostIds: slot.posts,
    });
  }
  return out;
}

/** Delete superseded segments. Returns how many rows were removed. */
export async function retireSupersededPunches(punches: KeptPunch[]): Promise<number> {
  let removed = 0;
  for (const w of supersedeWindows(punches)) {
    const res = await prisma.punchRaw.deleteMany({
      where: {
        user_id: w.userId,
        punch_in_at: { gte: w.from, lt: w.to },
        post_id: { notIn: w.keepPostIds },
      },
    });
    removed += res.count;
  }
  return removed;
}
