/**
 * timeOff.derive — turns Paychex Non-Work punch blocks into schedule exceptions.
 *
 * Paychex is the system of record for time off. Every approved absence already
 * arrives in the punch export as a `Start Non-Work` block carrying a Pay Type
 * ("PTO - Approved", "Holiday", …). Without this module the attendance engine
 * sees the block as a short day and charges points for leave that was approved
 * weeks earlier — the single largest source of false points in the current data.
 *
 * Classification lives in timeOff.classify; this module owns the data and the
 * two ownership rules that keep it safe to run on every import:
 *
 *   1. MANUAL ENTRY WINS. A row a manager typed has no paychex_reference and is
 *      never touched; a derived row that would overlap one is dropped instead.
 *   2. FULL REFRESH, NOT UPSERT. Import-owned rows in the range are deleted and
 *      rebuilt from the feed, so PTO cancelled in Paychex disappears here too.
 *      Re-running changes nothing.
 */
import prisma from '../../config/prisma';
import logger from '../../config/logger';
import { getScheduledShifts } from '../attendance/scheduleProvider';
import type { ScheduledDay } from '../attendance/scheduleProvider';
import { classifyTimeOff, mergeBlocks } from './timeOff.classify';
import type { TimeOffBlock, WorkSpan } from './timeOff.classify';
import {
  addDays, combineLocal, dateOnlyValue, exceptionsOverlap, fmtLocal, parseLocal,
} from './schedule.dates';

/** Marks a row as owned by the importer. Manual rows never carry it. */
const REF_PREFIX = 'PCX';

/** The punch events that open a non-work block and a worked one. */
const NON_WORK_IN = 'Start Non-Work';
const WORK_IN = 'Clock In';
const WORK_OUT = 'Clock Out';

/**
 * Why a block did or did not become an exception. Everything other than FULL_DAY
 * and PARTIAL is a no-op, but they are no-ops for different reasons and the
 * review page has to say which: OUTSIDE_SHIFT can mean the schedule is stale,
 * while DAY_OFF on a company holiday is entirely expected.
 */
export type DeriveOutcome =
  | 'FULL_DAY'
  | 'PARTIAL'
  | 'NO_SHIFT'
  | 'DAY_OFF'
  | 'OUTSIDE_SHIFT'
  | 'MANUAL_OVERRIDE'
  | 'UNMAPPED';

export interface DeriveRow {
  user_id: number;
  username: string;
  exception_date: string;
  pay_type: string;
  type_label: string | null;
  outcome: DeriveOutcome;
  block_minutes: number;
  scheduled_minutes: number;
  is_full_day: boolean;
  start: string | null;
  end: string | null;
}

export interface DeriveResult {
  from: string;
  to: string;
  blocks: number;
  created: number;
  removed: number;
  rows: DeriveRow[];
}

interface Group {
  userId: number;
  dateStr: string;
  payType: string;
  blocks: TimeOffBlock[];
}

const key = (userId: number, dateStr: string) => `${userId}:${dateStr}`;
const normPayType = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * One pass over the punch feed for the range, split into the non-work blocks to
 * classify and the work punches that say which part of the shift was missed.
 */
async function loadFeed(from: string, to: string): Promise<{
  groups: Group[];
  work: Map<string, WorkSpan>;
}> {
  const punches = await prisma.punchRaw.findMany({
    where: { punch_in_at: { gte: parseLocal(from), lt: parseLocal(addDays(to, 1)) } },
    select: {
      user_id: true, punch_in_at: true, punch_out_at: true,
      punch_type_in: true, punch_type_out: true, pay_type: true,
    },
  });

  const groups = new Map<string, Group>();
  const work = new Map<string, WorkSpan>();

  for (const p of punches) {
    if (!p.punch_in_at) continue;
    const dateStr = fmtLocal(p.punch_in_at);

    if (p.punch_type_in === NON_WORK_IN && p.punch_out_at && p.pay_type) {
      const k = `${p.user_id}:${dateStr}:${p.pay_type}`;
      const g = groups.get(k)
        ?? groups.set(k, { userId: p.user_id, dateStr, payType: p.pay_type, blocks: [] }).get(k)!;
      g.blocks.push({ start: p.punch_in_at, end: p.punch_out_at });
      continue;
    }

    const k = key(p.user_id, dateStr);
    const span = work.get(k) ?? work.set(k, { first: null, last: null }).get(k)!;
    if (p.punch_type_in === WORK_IN && (!span.first || p.punch_in_at < span.first)) {
      span.first = p.punch_in_at;
    }
    if (p.punch_type_out === WORK_OUT && p.punch_out_at && (!span.last || p.punch_out_at > span.last)) {
      span.last = p.punch_out_at;
    }
  }

  return { groups: [...groups.values()], work };
}

/**
 * Rebuild import-owned exceptions for a date range from the punch feed.
 *
 * `dryRun` classifies without writing, which is what the Time Off Import review
 * page reads — the review is therefore always the live answer rather than a
 * snapshot that drifts from what the engine actually scored.
 */
export async function deriveTimeOffExceptions(
  from: string,
  to: string,
  opts: { dryRun?: boolean } = {},
): Promise<DeriveResult> {
  const dryRun = opts.dryRun ?? false;

  const types = await prisma.scheduleExceptionType.findMany({
    where: { paychex_pay_type: { not: null }, is_active: true },
    select: { id: true, label: true, type_key: true, paychex_pay_type: true },
  });
  const typeByPayType = new Map(types.map((t) => [normPayType(t.paychex_pay_type!), t]));

  const { groups, work } = await loadFeed(from, to);
  const blockCount = groups.reduce((n, g) => n + g.blocks.length, 0);

  // Clear first, so the schedule read below sees only manual rows and the overlap
  // check cannot trip over last run's output. A dry run cannot delete, so it
  // instead notes which rows a real run WOULD have cleared and ignores them —
  // otherwise the review would report every already-imported day as overridden
  // by hand, which is the opposite of what happened.
  const ownedRange = {
    exception_date: { gte: dateOnlyValue(from), lte: dateOnlyValue(to) },
    paychex_reference: { startsWith: `${REF_PREFIX}-` },
  };
  let removed = 0;
  let ownedIds = new Set<number>();
  if (dryRun) {
    const owned = await prisma.scheduleException.findMany({ where: ownedRange, select: { id: true } });
    ownedIds = new Set(owned.map((o) => o.id));
  } else {
    removed = (await prisma.scheduleException.deleteMany({ where: ownedRange })).count;
  }

  const userIds = [...new Set(groups.map((g) => g.userId))];
  const schedule = userIds.length
    ? await getScheduledShifts(userIds, parseLocal(from), parseLocal(to))
    : new Map<string, ScheduledDay>();

  const names = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true },
  });
  const nameById = new Map(names.map((u) => [u.id, u.username]));

  const rows: DeriveRow[] = [];
  const toCreate: Array<{
    user_id: number; date: string; type_id: number; shift_id: number;
    is_full_day: boolean; start: string | null; end: string | null; reference: string; notes: string;
  }> = [];

  // Manual rows already on a day, plus derived rows queued this run, so two pay
  // types on one day cannot both claim the same hour.
  const claimed = new Map<string, Array<{ is_full_day: boolean; starts_at: Date | null; ends_at: Date | null }>>();
  const claimsFor = (k: string) => claimed.get(k) ?? claimed.set(k, []).get(k)!;

  for (const g of groups.sort((a, b) => a.dateStr.localeCompare(b.dateStr))) {
    const k = key(g.userId, g.dateStr);
    const day = schedule.get(k);
    const type = typeByPayType.get(normPayType(g.payType));
    const base = {
      user_id: g.userId,
      username: nameById.get(g.userId) ?? `#${g.userId}`,
      exception_date: g.dateStr,
      pay_type: g.payType,
      type_label: type?.label ?? null,
      block_minutes: Math.round(
        mergeBlocks(g.blocks).reduce((s, b) => s + (b.end.getTime() - b.start.getTime()), 0) / 60000,
      ),
      scheduled_minutes: day?.scheduledMinutes ?? 0,
      is_full_day: false,
      start: null as string | null,
      end: null as string | null,
    };

    if (!type) { rows.push({ ...base, outcome: 'UNMAPPED' }); continue; }
    if (!day) { rows.push({ ...base, outcome: 'NO_SHIFT' }); continue; }

    const classified = classifyTimeOff(g.dateStr, day, g.blocks, work.get(k));
    if (classified.kind === 'DAY_OFF' || classified.kind === 'OUTSIDE_SHIFT') {
      rows.push({ ...base, outcome: classified.kind });
      continue;
    }

    if (!claimed.has(k)) {
      claimed.set(k, day.exceptions.filter((e) => !ownedIds.has(e.id)).map((e) => ({
        is_full_day: e.isFullDay,
        starts_at: e.start ? combineLocal(g.dateStr, e.start) : null,
        ends_at: e.end ? combineLocal(g.dateStr, e.end) : null,
      })));
    }

    const candidates = classified.kind === 'FULL_DAY'
      ? [{ is_full_day: true, start: null as string | null, end: null as string | null }]
      : classified.windows.map((w) => ({ is_full_day: false, start: w.start, end: w.end }));

    let written = 0;
    for (const c of candidates) {
      const candidate = {
        is_full_day: c.is_full_day,
        starts_at: c.start ? combineLocal(g.dateStr, c.start) : null,
        ends_at: c.end ? combineLocal(g.dateStr, c.end) : null,
      };
      if (exceptionsOverlap(claimsFor(k), candidate)) continue;
      claimsFor(k).push(candidate);

      const suffix = written === 0 ? '' : `-${written + 1}`;
      toCreate.push({
        user_id: g.userId,
        date: g.dateStr,
        type_id: type.id,
        shift_id: day.shiftId,
        is_full_day: c.is_full_day,
        start: c.start,
        end: c.end,
        reference: `${REF_PREFIX}-${g.userId}-${g.dateStr.replace(/-/g, '')}-${type.type_key}${suffix}`,
        notes: `Imported from Paychex (${g.payType}).`,
      });
      written++;
      rows.push({
        ...base,
        outcome: c.is_full_day ? 'FULL_DAY' : 'PARTIAL',
        is_full_day: c.is_full_day,
        start: c.start,
        end: c.end,
        block_minutes: classified.blockMinutes,
      });
    }
    if (written === 0) rows.push({ ...base, outcome: 'MANUAL_OVERRIDE' });
  }

  if (!dryRun && toCreate.length > 0) {
    await prisma.scheduleException.createMany({
      data: toCreate.map((c) => ({
        user_id: c.user_id,
        exception_date: dateOnlyValue(c.date),
        exception_type_id: c.type_id,
        shift_id: c.shift_id,
        is_full_day: c.is_full_day,
        starts_at: c.start ? combineLocal(c.date, c.start) : null,
        ends_at: c.end ? combineLocal(c.date, c.end) : null,
        notes: c.notes,
        paychex_reference: c.reference,
        entered_by: null,
      })),
    });
    logger.info(`[TIME OFF DERIVE] ${from}..${to}: removed ${removed}, created ${toCreate.length} from ${blockCount} blocks`);
  }

  return { from, to, blocks: blockCount, created: toCreate.length, removed, rows };
}
