/**
 * Exception log: single entry from the shift drawer and the bulk path that
 * writes one type across many people over a date range.
 *
 * Overlap is refused, never warned — two exceptions covering the same hour would
 * let the engine forgive it twice. Single entry throws on conflict; bulk skips
 * the conflicting day and counts it, so a closure across a team does not fail
 * because one person already has PTO.
 *
 * Bulk is deliberately NOT gated on publish state: logging that someone was late
 * last Tuesday is the normal case, and last Tuesday is exactly the locked week.
 */
import prisma from '../../config/prisma';
import logger from '../../config/logger';
import {
  ScheduleScope, ExceptionInput, ScheduleServiceError,
} from './schedule.types';
import { assertCanWriteUsers } from './schedule.permissions';
import {
  addDays, combineLocal, dateOnlyValue, dateStrFromDate, hmFromDateTime, exceptionsOverlap,
} from './schedule.dates';
import { recomputeRange } from '../attendance/attendance.engine';

/**
 * Attendance points are derived, never stored at exception-write time: the engine
 * rebuilds a day from the published schedule, punches and rules. So after an
 * exception is added or removed we recompute just that user's day(s) so points
 * add/remove immediately instead of waiting for the next punch import or admin
 * recalculate. The engine is idempotent (delete + reinsert per range) and caps
 * itself to the punch-feed watermark, so a call on an out-of-coverage day is a
 * safe no-op. Failures are logged and swallowed — the exception write already
 * committed and the next recompute will heal the range.
 */
async function safeRecompute(from: string, to: string, userIds: number[]): Promise<void> {
  try {
    await recomputeRange(from, to, userIds);
  } catch (err) {
    logger.error('[SCHEDULING] attendance recompute after exception change failed:', err);
  }
}

function windowInsideShift(start: string, end: string, shiftStart: string | null, shiftEnd: string | null): boolean {
  if (!shiftStart || !shiftEnd) return false;
  return start >= shiftStart && end <= shiftEnd;
}

export async function listExceptions(scope: ScheduleScope, filters: { from?: string; to?: string; userId?: number }) {
  const where: Record<string, unknown> = {};
  if (scope.departmentIds !== null && scope.canViewAll) {
    where.user = { department_id: { in: scope.departmentIds } };
  } else if (!scope.canViewAll) {
    where.user_id = scope.viewerId;
  }
  if (filters.userId) where.user_id = filters.userId;
  if (filters.from || filters.to) {
    where.exception_date = {
      ...(filters.from ? { gte: dateOnlyValue(filters.from) } : {}),
      ...(filters.to ? { lte: dateOnlyValue(filters.to) } : {}),
    };
  }
  const rows = await prisma.scheduleException.findMany({
    where,
    include: { exception_type: true, user: { select: { username: true, department: { select: { department_name: true } } } } },
    orderBy: { exception_date: 'desc' },
    take: 1000,
  });
  return rows.map((e) => ({
    id: e.id,
    user_id: e.user_id,
    username: e.user.username,
    department_name: e.user.department?.department_name ?? null,
    exception_date: dateStrFromDate(e.exception_date),
    exception_type_id: e.exception_type_id,
    label: e.exception_type.label,
    is_excused: e.exception_type.is_excused,
    is_full_day: e.is_full_day,
    start: e.starts_at ? hmFromDateTime(e.starts_at) : null,
    end: e.ends_at ? hmFromDateTime(e.ends_at) : null,
    notes: e.notes,
    is_imported: !!e.paychex_reference,
  }));
}

/** Create a single exception, refusing an overlap with the same day. */
export async function createException(scope: ScheduleScope, input: ExceptionInput, actorId: number) {
  await assertCanWriteUsers(scope, [input.user_id]);

  if (!input.is_full_day && (!input.start || !input.end)) {
    throw new ScheduleServiceError('A windowed exception needs a start and end', 400, 'MISSING_WINDOW');
  }
  if (!input.is_full_day && input.start! >= input.end!) {
    throw new ScheduleServiceError('End must be after start', 400, 'INVALID_WINDOW');
  }

  const shift = await prisma.scheduleShift.findUnique({
    where: { user_id_shift_date: { user_id: input.user_id, shift_date: dateOnlyValue(input.exception_date) } },
    select: { id: true, start_at: true, end_at: true },
  });

  if (!input.is_full_day && shift) {
    const ss = shift.start_at ? hmFromDateTime(shift.start_at) : null;
    const se = shift.end_at ? hmFromDateTime(shift.end_at) : null;
    if (!windowInsideShift(input.start!, input.end!, ss, se)) {
      throw new ScheduleServiceError('That window falls outside the scheduled shift', 400, 'OUTSIDE_SHIFT');
    }
  }

  const existing = await prisma.scheduleException.findMany({
    where: { user_id: input.user_id, exception_date: dateOnlyValue(input.exception_date) },
    select: { is_full_day: true, starts_at: true, ends_at: true },
  });
  const candidate = {
    is_full_day: input.is_full_day,
    starts_at: input.is_full_day ? null : combineLocal(input.exception_date, input.start!),
    ends_at: input.is_full_day ? null : combineLocal(input.exception_date, input.end!),
  };
  if (exceptionsOverlap(existing, candidate)) {
    throw new ScheduleServiceError('This overlaps an exception already logged for that day', 409, 'OVERLAP');
  }

  const created = await prisma.scheduleException.create({
    data: {
      user_id: input.user_id,
      exception_date: dateOnlyValue(input.exception_date),
      exception_type_id: input.exception_type_id,
      shift_id: shift?.id ?? null,
      is_full_day: input.is_full_day,
      starts_at: candidate.starts_at,
      ends_at: candidate.ends_at,
      notes: input.notes ?? null,
      paychex_reference: input.paychex_reference ?? null,
      entered_by: actorId,
    },
  });

  await safeRecompute(input.exception_date, input.exception_date, [input.user_id]);
  return created;
}

export async function deleteException(scope: ScheduleScope, id: number) {
  const ex = await prisma.scheduleException.findUnique({ where: { id } });
  if (!ex) throw new ScheduleServiceError('Exception not found', 404, 'NOT_FOUND');
  await assertCanWriteUsers(scope, [ex.user_id]);
  // Capture the scope before the row is gone, so we can rebuild that day's points.
  const affectedUser = ex.user_id;
  const affectedDate = dateStrFromDate(ex.exception_date);
  await prisma.scheduleException.delete({ where: { id } });
  await safeRecompute(affectedDate, affectedDate, [affectedUser]);
  return { success: true };
}

export interface BulkExceptionParams {
  scope: ScheduleScope;
  userIds: number[];
  from: string;
  to: string;
  exception_type_id: number;
  is_full_day: boolean;
  start?: string | null;
  end?: string | null;
  actorId: number;
  dryRun: boolean;
}

export interface BulkExceptionPreview {
  write: number;
  unscheduled: number; // no shift that day — nothing to measure against
  conflict: number;    // a non-overlapping exception could not be added
  outside: number;     // window falls outside that person's shift
}

/**
 * Log one exception per checked person per day in a range. Skips days with no
 * shift, days that already have an overlapping exception, and days where the
 * window falls outside that person's shift — each counted so the dialog is
 * honest. Writable on published and elapsed weeks by design.
 */
export async function bulkLogException(params: BulkExceptionParams): Promise<BulkExceptionPreview> {
  await assertCanWriteUsers(params.scope, params.userIds);
  if (params.to < params.from) throw new ScheduleServiceError('End date is before start date', 400, 'BAD_RANGE');
  if (!params.is_full_day && (!params.start || !params.end)) {
    throw new ScheduleServiceError('A windowed exception needs a start and end', 400, 'MISSING_WINDOW');
  }
  if (!params.is_full_day && params.start! >= params.end!) {
    throw new ScheduleServiceError('End must be after start', 400, 'INVALID_WINDOW');
  }

  const dates: string[] = [];
  for (let d = params.from; d <= params.to; d = addDays(d, 1)) dates.push(d);

  const shifts = await prisma.scheduleShift.findMany({
    where: { user_id: { in: params.userIds }, shift_date: { in: dates.map(dateOnlyValue) } },
    select: { id: true, user_id: true, shift_date: true, start_at: true, end_at: true },
  });
  const shiftByKey = new Map(shifts.map((s) => [`${s.user_id}:${dateStrFromDate(s.shift_date)}`, s]));

  const existing = await prisma.scheduleException.findMany({
    where: { user_id: { in: params.userIds }, exception_date: { in: dates.map(dateOnlyValue) } },
    select: { user_id: true, exception_date: true, is_full_day: true, starts_at: true, ends_at: true },
  });
  const existingByKey = new Map<string, Array<{ is_full_day: boolean; starts_at: Date | null; ends_at: Date | null }>>();
  for (const e of existing) {
    const key = `${e.user_id}:${dateStrFromDate(e.exception_date)}`;
    (existingByKey.get(key) ?? existingByKey.set(key, []).get(key)!).push(e);
  }

  const preview: BulkExceptionPreview = { write: 0, unscheduled: 0, conflict: 0, outside: 0 };
  const toCreate: Array<{ user_id: number; date: string; shift_id: number }> = [];

  for (const userId of params.userIds) {
    for (const date of dates) {
      const shift = shiftByKey.get(`${userId}:${date}`);
      if (!shift) { preview.unscheduled++; continue; }

      if (!params.is_full_day) {
        const ss = shift.start_at ? hmFromDateTime(shift.start_at) : null;
        const se = shift.end_at ? hmFromDateTime(shift.end_at) : null;
        if (!windowInsideShift(params.start!, params.end!, ss, se)) { preview.outside++; continue; }
      }

      const candidate = {
        is_full_day: params.is_full_day,
        starts_at: params.is_full_day ? null : combineLocal(date, params.start!),
        ends_at: params.is_full_day ? null : combineLocal(date, params.end!),
      };
      if (exceptionsOverlap(existingByKey.get(`${userId}:${date}`) ?? [], candidate)) { preview.conflict++; continue; }

      preview.write++;
      toCreate.push({ user_id: userId, date, shift_id: shift.id });
    }
  }

  if (params.dryRun || toCreate.length === 0) return preview;

  await prisma.$transaction(
    toCreate.map((c) =>
      prisma.scheduleException.create({
        data: {
          user_id: c.user_id,
          exception_date: dateOnlyValue(c.date),
          exception_type_id: params.exception_type_id,
          shift_id: c.shift_id,
          is_full_day: params.is_full_day,
          starts_at: params.is_full_day ? null : combineLocal(c.date, params.start!),
          ends_at: params.is_full_day ? null : combineLocal(c.date, params.end!),
          entered_by: params.actorId,
        },
      }),
    ),
  );

  // One range recompute covers every affected user-day; the engine narrows to the
  // days that actually changed. Runs after the write transaction commits.
  await safeRecompute(params.from, params.to, params.userIds);
  return preview;
}
