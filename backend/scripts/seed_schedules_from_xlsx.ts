/**
 * One-off importer: seed work schedules (shifts + break/lunch segments) from an
 * Excel export into schedule_shift / schedule_shift_segment.
 *
 *   npx ts-node scripts/seed_schedules_from_xlsx.ts ["path/to/file.xlsx"] [--dry-run]
 *
 * Expected columns (row 0 = header):
 *   User ID | First Name | Last Name | State | Start Time | End Time
 * where `State` is one of: Work Shift | 1st Break | Lunch | 2nd Break and the
 * time columns are Excel serial datetimes. Employees are matched to
 * users.username ("First Last"), case-insensitive. Shifts are written PUBLISHED
 * and the import is idempotent (re-running replaces the same user/date shifts).
 */

import 'dotenv/config';
import * as path from 'path';
import * as XLSX from '@e965/xlsx';
import prisma from '../src/config/prisma';
import { combineLocal, dateOnlyValue } from '../src/services/scheduling/schedule.dates';

const DEFAULT_XLSX = 'C:/Users/psantangelo/Downloads/90 Day Schedules.xlsx';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
// Never overwrite a shift that already exists for a user/date.
const skipExisting = args.includes('--skip-existing');
const flagValue = (name: string): string | undefined => {
  const p = `--${name}=`;
  return args.find((a) => a.startsWith(p))?.slice(p.length);
};
// Optional inclusive date-window filters on shift date ('YYYY-MM-DD').
const fromDate = flagValue('from');
const toDate = flagValue('to');
// Publish state for the written shifts. DRAFT keeps them unpublished/editable.
const status = (flagValue('status') ?? 'PUBLISHED').toUpperCase() === 'DRAFT' ? 'DRAFT' : 'PUBLISHED';
const xlsxPath = args.find((a) => !a.startsWith('--')) ?? DEFAULT_XLSX;

const pad = (n: number) => String(n).padStart(2, '0');

/** Convert an Excel serial datetime to local-component date + time strings. */
function excelToParts(serial: number): { date: string; hm: string } {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return { date, hm };
}

interface SegmentDraft {
  activity_type_id: number;
  start: string;
  end: string;
}
interface ShiftDraft {
  username: string;
  date: string;
  start?: string;
  end?: string;
  segments: SegmentDraft[];
}

async function main(): Promise<void> {
  const wb = XLSX.readFile(xlsxPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, defval: '' });

  // Activity type ids, resolved by label so we never hard-code an autoincrement.
  const activityTypes = await prisma.scheduleActivityType.findMany({
    select: { id: true, label: true },
  });
  const actByLabel = new Map(activityTypes.map((a) => [a.label.toLowerCase(), a.id]));
  const breakId = actByLabel.get('break');
  const lunchId = actByLabel.get('lunch');
  if (!breakId || !lunchId) {
    throw new Error(`Missing activity types (Break=${breakId}, Lunch=${lunchId})`);
  }

  // username (lowercased "first last") -> user id
  const users = await prisma.user.findMany({ select: { id: true, username: true } });
  const userByName = new Map(users.map((u) => [u.username.trim().toLowerCase(), u.id]));

  const drafts = new Map<string, ShiftDraft>();
  const unmatched = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r[0] === '' || r[1] === '') continue;
    const first = String(r[1]).trim();
    const last = String(r[2]).trim();
    const state = String(r[3]).trim().toLowerCase();
    const startSerial = Number(r[4]);
    const endSerial = Number(r[5]);
    if (!startSerial || !endSerial) continue;

    const username = `${first} ${last}`;
    const start = excelToParts(startSerial);
    const end = excelToParts(endSerial);
    const key = `${username.toLowerCase()}|${start.date}`;

    let draft = drafts.get(key);
    if (!draft) {
      draft = { username, date: start.date, segments: [] };
      drafts.set(key, draft);
    }

    if (state === 'work shift') {
      draft.start = start.hm;
      draft.end = end.hm;
    } else if (state.includes('lunch')) {
      draft.segments.push({ activity_type_id: lunchId, start: start.hm, end: end.hm });
    } else if (state.includes('break')) {
      draft.segments.push({ activity_type_id: breakId, start: start.hm, end: end.hm });
    }
  }

  // Group drafts by user so each user is written in a single transaction.
  const byUser = new Map<number, ShiftDraft[]>();
  let skippedNoWindow = 0;
  let skippedOutOfRange = 0;
  for (const draft of drafts.values()) {
    if (fromDate && draft.date < fromDate) {
      skippedOutOfRange++;
      continue;
    }
    if (toDate && draft.date > toDate) {
      skippedOutOfRange++;
      continue;
    }
    const userId = userByName.get(draft.username.toLowerCase());
    if (!userId) {
      unmatched.add(draft.username);
      continue;
    }
    if (!draft.start || !draft.end) {
      skippedNoWindow++;
      continue;
    }
    // The source export can repeat an identical day block; collapse exact
    // duplicate segments so we don't double-count the same break/lunch.
    const seen = new Set<string>();
    draft.segments = draft.segments.filter((s) => {
      const k = `${s.activity_type_id}|${s.start}|${s.end}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    draft.segments.sort((a, b) => a.start.localeCompare(b.start));
    const list = byUser.get(userId) ?? [];
    list.push(draft);
    byUser.set(userId, list);
  }

  const totalShifts = [...byUser.values()].reduce((n, l) => n + l.length, 0);
  const rangeLabel = fromDate || toDate ? ` (date window ${fromDate ?? '...'}..${toDate ?? '...'})` : '';
  console.log(`Parsed ${drafts.size} shift-days -> ${totalShifts} candidate(s) across ${byUser.size} users${rangeLabel}.`);
  if (skippedOutOfRange) console.log(`Skipped ${skippedOutOfRange} day(s) outside the date window.`);
  if (skippedNoWindow) console.log(`Skipped ${skippedNoWindow} day(s) with no Work Shift row.`);
  if (unmatched.size) {
    console.log(`UNMATCHED usernames (${unmatched.size}): ${[...unmatched].join(', ')}`);
  } else {
    console.log('UNMATCHED usernames: none');
  }

  if (dryRun) {
    console.log('--dry-run: no rows written.');
    return;
  }

  let written = 0;
  let skippedExisting = 0;
  for (const [userId, list] of byUser) {
    await prisma.$transaction(async (tx) => {
      for (const draft of list) {
        const start_at = combineLocal(draft.date, draft.start!);
        const end_at = combineLocal(draft.date, draft.end!);
        const segCreate = draft.segments.map((s, idx) => ({
          activity_type_id: s.activity_type_id,
          start_at: combineLocal(draft.date, s.start),
          end_at: combineLocal(draft.date, s.end),
          sort_order: idx,
        }));

        const existing = await tx.scheduleShift.findUnique({
          where: { user_id_shift_date: { user_id: userId, shift_date: dateOnlyValue(draft.date) } },
          select: { id: true },
        });

        if (existing && skipExisting) {
          skippedExisting++;
          continue;
        }

        if (existing) {
          await tx.scheduleShiftSegment.deleteMany({ where: { shift_id: existing.id } });
          await tx.scheduleShift.update({
            where: { id: existing.id },
            data: {
              is_day_off: false,
              start_at,
              end_at,
              status,
              source: 'MANUAL',
              segments: { create: segCreate },
            },
          });
        } else {
          await tx.scheduleShift.create({
            data: {
              user_id: userId,
              shift_date: dateOnlyValue(draft.date),
              is_day_off: false,
              start_at,
              end_at,
              status,
              source: 'MANUAL',
              segments: { create: segCreate },
            },
          });
        }
        written++;
      }
    });
  }

  if (skippedExisting) console.log(`Skipped ${skippedExisting} shift(s) that already existed (--skip-existing).`);
  console.log(`Done. Wrote ${written} shifts as ${status}.`);
}

main()
  .catch((err) => {
    console.error('seed_schedules_from_xlsx failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
