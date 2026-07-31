/**
 * Apply-template and copy-prior-week — the same bulk shift write with a
 * different source. Both take a user-id array and a resolved list of target
 * dates, so one call covers day, week, or two weeks.
 *
 * Faithful reproduction: whatever the source has for a weekday is what the
 * target gets. A working day copies the window and segments; an explicit day
 * off copies the day off; a weekday the source does not cover clears the target
 * (there is no schedule that day, so none is written).
 *
 * The preview (dryRun) walks the identical code path and only tallies, so the
 * numbers the dialog shows cannot drift from what the write actually does.
 *
 * Bulk writes land as DRAFT and never touch a PUBLISHED day or a HOLIDAY/
 * CLOSURE — those are skipped and counted.
 */
import prisma from '../../config/prisma';
import { ScheduleScope, ScheduleServiceError } from './schedule.types';
import { assertCanWriteUsers } from './schedule.permissions';
import { fetchShiftsInRange, today } from './schedule.shift.service';
import {
  dayOfWeek, sourceDateFor, combineLocal, dateOnlyValue, dateStrFromDate,
  hmsFromTime, hmFromDateTime,
} from './schedule.dates';
import { getTemplate } from './schedule.template.service';
import { getCalendarDayTypes, isBlockedForScheduling } from '../../utils/businessCalendar';

export interface ApplyPreview {
  write: number;      // brand-new shifts
  overwrite: number;  // existing DRAFT shifts replaced
  clearDays: number;  // target days the source leaves uncovered (draft cleared)
  holiday: number;    // dates skipped as HOLIDAY / CLOSURE
  published: number;  // target days skipped because already published
}

interface ResolvedDay {
  is_day_off: boolean;
  start?: string; // 'HH:MM'
  end?: string;
  segments: Array<{ activity_type_id: number; start: string; end: string }>;
}

export interface ApplyParams {
  scope: ScheduleScope;
  mode: 'template' | 'copy';
  userIds: number[];
  dates: string[];
  templateId?: number;
  sourceWeekStart?: string;
  actorId: number;
  dryRun: boolean;
}

type Op =
  | { kind: 'write' | 'overwrite'; userId: number; date: string; resolved: ResolvedDay; existingId?: number }
  | { kind: 'clear'; userId: number; date: string; existingId: number }
  | { kind: 'skip-holiday' | 'skip-published' | 'noop'; userId: number; date: string };

/** Build the per-weekday resolver for template mode. */
async function templateResolver(templateId: number): Promise<(dow: number) => ResolvedDay | null> {
  const tpl = await getTemplate(templateId);
  const byDow = new Map<number, ResolvedDay>();
  for (const d of tpl.days) {
    byDow.set(d.day_of_week, {
      is_day_off: d.is_day_off,
      start: d.start_time ? hmsFromTime(d.start_time).slice(0, 5) : undefined,
      end: d.end_time ? hmsFromTime(d.end_time).slice(0, 5) : undefined,
      segments: d.segments.map((s) => ({
        activity_type_id: s.activity_type_id,
        start: hmsFromTime(s.start_time).slice(0, 5),
        end: hmsFromTime(s.end_time).slice(0, 5),
      })),
    });
  }
  return (dow) => byDow.get(dow) ?? null;
}

/** Build the per-target-date resolver for copy mode, keyed by source date. */
async function copyResolver(userIds: number[], sourceWeekStart: string, targetDates: string[]) {
  const sourceDates = targetDates.map((t) => sourceDateFor(t, sourceWeekStart));
  const from = sourceDates.reduce((a, b) => (a < b ? a : b));
  const to = sourceDates.reduce((a, b) => (a > b ? a : b));
  const shifts = await fetchShiftsInRange(userIds, from, to);
  const byKey = new Map<string, ResolvedDay>();
  for (const s of shifts) {
    byKey.set(`${s.user_id}:${dateStrFromDate(s.shift_date)}`, {
      is_day_off: s.is_day_off,
      start: s.start_at ? hmFromDateTime(s.start_at) : undefined,
      end: s.end_at ? hmFromDateTime(s.end_at) : undefined,
      segments: s.segments.map((seg) => ({
        activity_type_id: seg.activity_type_id,
        start: hmFromDateTime(seg.start_at),
        end: hmFromDateTime(seg.end_at),
      })),
    });
  }
  return (userId: number, targetDate: string): ResolvedDay | null =>
    byKey.get(`${userId}:${sourceDateFor(targetDate, sourceWeekStart)}`) ?? null;
}

async function buildOps(params: ApplyParams): Promise<Op[]> {
  const { mode, userIds, dates } = params;
  const from = dates.reduce((a, b) => (a < b ? a : b));
  const to = dates.reduce((a, b) => (a > b ? a : b));

  const existing = await fetchShiftsInRange(userIds, from, to);
  const existingByKey = new Map(existing.map((s) => [`${s.user_id}:${dateStrFromDate(s.shift_date)}`, s]));
  const dayTypes = await getCalendarDayTypes(dates);
  const td = today();

  const tplResolve = mode === 'template' ? await templateResolver(params.templateId!) : null;
  const copyResolve = mode === 'copy' ? await copyResolver(userIds, params.sourceWeekStart!, dates) : null;

  const ops: Op[] = [];
  for (const userId of userIds) {
    for (const date of dates) {
      if (isBlockedForScheduling(date, dayTypes)) {
        ops.push({ kind: 'skip-holiday', userId, date });
        continue;
      }
      const current = existingByKey.get(`${userId}:${date}`);
      if (current && current.status === 'PUBLISHED') {
        ops.push({ kind: 'skip-published', userId, date });
        continue;
      }
      const resolved = tplResolve ? tplResolve(dayOfWeek(date)) : copyResolve!(userId, date);

      if (!resolved) {
        if (current) ops.push({ kind: 'clear', userId, date, existingId: current.id });
        else ops.push({ kind: 'noop', userId, date });
        continue;
      }
      ops.push({
        kind: current ? 'overwrite' : 'write',
        userId, date, resolved, existingId: current?.id,
      });
    }
  }
  return ops;
}

function tally(ops: Op[]): ApplyPreview {
  const p: ApplyPreview = { write: 0, overwrite: 0, clearDays: 0, holiday: 0, published: 0 };
  for (const op of ops) {
    if (op.kind === 'write') p.write++;
    else if (op.kind === 'overwrite') p.overwrite++;
    else if (op.kind === 'clear') p.clearDays++;
    else if (op.kind === 'skip-holiday') p.holiday++;
    else if (op.kind === 'skip-published') p.published++;
  }
  return p;
}

/**
 * Preview and write share buildOps, so the dialog can never promise counts the
 * write does not deliver. dryRun returns the tally; otherwise the ops execute
 * in one transaction and the same tally is returned.
 */
export async function applySchedule(params: ApplyParams): Promise<ApplyPreview> {
  await assertCanWriteUsers(params.scope, params.userIds);
  if (params.mode === 'template' && !params.templateId) {
    throw new ScheduleServiceError('A template must be chosen', 400, 'NO_TEMPLATE');
  }
  if (params.mode === 'copy' && !params.sourceWeekStart) {
    throw new ScheduleServiceError('A source week must be chosen', 400, 'NO_SOURCE');
  }

  const ops = await buildOps(params);
  const preview = tally(ops);
  if (params.dryRun) return preview;

  await prisma.$transaction(async (tx) => {
    for (const op of ops) {
      if (op.kind === 'clear') {
        // Only draft rows ever reach here (published were skipped upstream).
        await tx.scheduleShift.delete({ where: { id: op.existingId } });
        continue;
      }
      if (op.kind !== 'write' && op.kind !== 'overwrite') continue;

      const r = op.resolved;
      const data = {
        is_day_off: r.is_day_off,
        start_at: r.is_day_off || !r.start ? null : combineLocal(op.date, r.start),
        end_at: r.is_day_off || !r.end ? null : combineLocal(op.date, r.end),
        source: (params.mode === 'template' ? 'TEMPLATE' : 'COPIED') as 'TEMPLATE' | 'COPIED',
        template_id: params.mode === 'template' ? params.templateId! : null,
        updated_by: params.actorId,
      };
      const segCreate = r.is_day_off
        ? []
        : r.segments.map((s, i) => ({
            activity_type_id: s.activity_type_id,
            start_at: combineLocal(op.date, s.start),
            end_at: combineLocal(op.date, s.end),
            sort_order: i,
          }));

      if (op.existingId) {
        await tx.scheduleShiftSegment.deleteMany({ where: { shift_id: op.existingId } });
        await tx.scheduleShift.update({
          where: { id: op.existingId },
          data: { ...data, status: 'DRAFT', segments: { create: segCreate } },
        });
      } else {
        await tx.scheduleShift.create({
          data: {
            user_id: op.userId,
            shift_date: dateOnlyValue(op.date),
            status: 'DRAFT',
            created_by: params.actorId,
            ...data,
            segments: { create: segCreate },
          },
        });
      }
    }
  });

  return preview;
}
