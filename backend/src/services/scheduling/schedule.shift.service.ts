/**
 * Shift reads and edits: the grid payload, single-shift upsert, and the
 * publish / unpublish / lock lifecycle. Apply-template and copy-period live in
 * schedule.apply.service.ts (they are bulk shift writes sharing this file's
 * conflict rules).
 *
 * DRAFT is invisible to non-viewAll viewers and to the provider — enforced here
 * in the service, never merely filtered in the UI. Publishing is what creates
 * attendance denominators.
 */
import prisma from '../../config/prisma';
import { Prisma } from '../../generated/prisma/client';
import {
  ScheduleScope, ShiftInput, ScheduleServiceError,
} from './schedule.types';
import { assertCanWriteUsers, listRoster } from './schedule.permissions';
import {
  fmtLocal, combineLocal, dateOnlyValue, dateStrFromDate, hmFromDateTime, isShiftLocked,
} from './schedule.dates';

export function today(): string {
  return fmtLocal(new Date());
}

/** Fetch raw shifts (with segments) for a set of users across a date range. */
export async function fetchShiftsInRange(userIds: number[], from: string, to: string, publishedOnly = false) {
  if (userIds.length === 0) return [];
  return prisma.scheduleShift.findMany({
    where: {
      user_id: { in: userIds },
      shift_date: { gte: dateOnlyValue(from), lte: dateOnlyValue(to) },
      ...(publishedOnly ? { status: 'PUBLISHED' as const } : {}),
    },
    include: {
      segments: { include: { activity_type: true }, orderBy: { sort_order: 'asc' } },
    },
  });
}

/**
 * One payload for the grid: roster, shifts (with segments), and the exceptions
 * for the same range. Every view renders exceptions as coloured segments of the
 * shift bar, so a separate exceptions fetch would tear.
 */
export async function readGrid(scope: ScheduleScope, from: string, to: string) {
  const roster = await listRoster(scope);
  const userIds = roster.map((r) => r.id);

  const shifts = await fetchShiftsInRange(userIds, from, to, !scope.canViewAll);

  const exceptions = await prisma.scheduleException.findMany({
    where: {
      user_id: { in: userIds.length ? userIds : [-1] },
      exception_date: { gte: dateOnlyValue(from), lte: dateOnlyValue(to) },
    },
    include: { exception_type: true },
  });

  const td = today();
  return {
    roster,
    shifts: shifts.map((s) => ({
      id: s.id,
      user_id: s.user_id,
      shift_date: dateStrFromDate(s.shift_date),
      is_day_off: s.is_day_off,
      start: s.start_at ? hmFromDateTime(s.start_at) : null,
      end: s.end_at ? hmFromDateTime(s.end_at) : null,
      notes: s.notes,
      status: s.status,
      source: s.source,
      template_id: s.template_id,
      locked: isShiftLocked(dateStrFromDate(s.shift_date), s.status, td),
      segments: s.segments.map((seg) => ({
        activity_type_id: seg.activity_type_id,
        label: seg.activity_type.label,
        is_paid: seg.activity_type.is_paid,
        color: seg.activity_type.color,
        start: hmFromDateTime(seg.start_at),
        end: hmFromDateTime(seg.end_at),
      })),
    })),
    exceptions: exceptions.map((e) => ({
      id: e.id,
      user_id: e.user_id,
      exception_date: dateStrFromDate(e.exception_date),
      exception_type_id: e.exception_type_id,
      label: e.exception_type.label,
      is_excused: e.exception_type.is_excused,
      is_full_day: e.is_full_day,
      start: e.starts_at ? hmFromDateTime(e.starts_at) : null,
      end: e.ends_at ? hmFromDateTime(e.ends_at) : null,
      notes: e.notes,
    })),
  };
}

/** Self schedule — published shifts only, for the signed-in viewer. */
export async function readMySchedule(viewerId: number, from: string, to: string) {
  const shifts = await fetchShiftsInRange([viewerId], from, to, true);
  return shifts.map((s) => ({
    id: s.id,
    shift_date: dateStrFromDate(s.shift_date),
    is_day_off: s.is_day_off,
    start: s.start_at ? hmFromDateTime(s.start_at) : null,
    end: s.end_at ? hmFromDateTime(s.end_at) : null,
    segments: s.segments.map((seg) => ({
      label: seg.activity_type.label,
      start: hmFromDateTime(seg.start_at),
      end: hmFromDateTime(seg.end_at),
    })),
  }));
}

function segmentCreate(dateStr: string, segments: ShiftInput['segments']) {
  return (segments ?? []).map((s, i) => ({
    activity_type_id: s.activity_type_id,
    start_at: combineLocal(dateStr, s.start),
    end_at: combineLocal(dateStr, s.end),
    sort_order: i,
  }));
}

/** Create or replace a single shift (and its segments) for one person/day. */
export async function upsertShift(scope: ScheduleScope, input: ShiftInput, actorId: number) {
  await assertCanWriteUsers(scope, [input.user_id]);

  const existing = await prisma.scheduleShift.findUnique({
    where: { user_id_shift_date: { user_id: input.user_id, shift_date: dateOnlyValue(input.shift_date) } },
  });
  if (existing && isShiftLocked(input.shift_date, existing.status, today())) {
    throw new ScheduleServiceError('This week is published and has elapsed, so it is locked', 423, 'LOCKED');
  }
  if (!input.is_day_off && (!input.start || !input.end)) {
    throw new ScheduleServiceError('A working shift needs a start and end', 400, 'MISSING_TIMES');
  }

  const base = {
    is_day_off: input.is_day_off,
    start_at: input.is_day_off || !input.start ? null : combineLocal(input.shift_date, input.start),
    end_at: input.is_day_off || !input.end ? null : combineLocal(input.shift_date, input.end),
    notes: input.notes ?? null,
    updated_by: actorId,
  };

  return prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.scheduleShiftSegment.deleteMany({ where: { shift_id: existing.id } });
      return tx.scheduleShift.update({
        where: { id: existing.id },
        data: { ...base, source: 'MANUAL', segments: { create: input.is_day_off ? [] : segmentCreate(input.shift_date, input.segments) } },
        include: { segments: true },
      });
    }
    return tx.scheduleShift.create({
      data: {
        user_id: input.user_id,
        shift_date: dateOnlyValue(input.shift_date),
        status: 'DRAFT',
        source: 'MANUAL',
        created_by: actorId,
        ...base,
        segments: { create: input.is_day_off ? [] : segmentCreate(input.shift_date, input.segments) },
      },
      include: { segments: true },
    });
  });
}

export async function deleteShift(scope: ScheduleScope, shiftId: number) {
  const shift = await prisma.scheduleShift.findUnique({ where: { id: shiftId } });
  if (!shift) throw new ScheduleServiceError('Shift not found', 404, 'NOT_FOUND');
  await assertCanWriteUsers(scope, [shift.user_id]);
  if (isShiftLocked(dateStrFromDate(shift.shift_date), shift.status, today())) {
    throw new ScheduleServiceError('This shift is locked', 423, 'LOCKED');
  }
  await prisma.scheduleShift.delete({ where: { id: shiftId } });
  return { success: true };
}

async function auditRow(tx: Prisma.TransactionClient, actorId: number, action: string, details: object) {
  await tx.auditLog.create({
    data: { user_id: actorId, action, target_type: 'schedule_shift', details: JSON.stringify(details) },
  });
}

/**
 * Publish a set of people's shifts across a date range. Only DRAFT rows move.
 * Publishing an elapsed week is allowed but requires confirmElapsed and writes
 * an AuditLog row, because it retroactively changes reported numbers. locked_at
 * is set for days that are already elapsed.
 */
export async function publishRange(
  scope: ScheduleScope,
  userIds: number[],
  dates: string[],
  actorId: number,
  confirmElapsed: boolean,
) {
  await assertCanWriteUsers(scope, userIds);
  const td = today();
  const drafts = await prisma.scheduleShift.findMany({
    where: {
      user_id: { in: userIds },
      shift_date: { in: dates.map(dateOnlyValue) },
      status: 'DRAFT',
    },
  });
  if (drafts.length === 0) return { published: 0, elapsed: 0 };

  const elapsed = drafts.filter((s) => dateStrFromDate(s.shift_date) < td);
  if (elapsed.length > 0 && !confirmElapsed) {
    throw new ScheduleServiceError(
      `This range has already passed. Publishing adds ${elapsed.length} scheduled days to attendance history.`,
      409,
      'CONFIRM_ELAPSED',
    );
  }

  return prisma.$transaction(async (tx) => {
    for (const s of drafts) {
      const isElapsedDay = dateStrFromDate(s.shift_date) < td;
      await tx.scheduleShift.update({
        where: { id: s.id },
        data: { status: 'PUBLISHED', updated_by: actorId, locked_at: isElapsedDay ? new Date() : null },
      });
    }
    if (elapsed.length > 0) {
      await auditRow(tx, actorId, 'schedule.publish_elapsed', { userIds, dates, elapsedDays: elapsed.length });
    }
    return { published: drafts.length, elapsed: elapsed.length };
  });
}

/** Revert PUBLISHED back to DRAFT — future-only. Elapsed days are refused. */
export async function unpublishRange(scope: ScheduleScope, userIds: number[], dates: string[], actorId: number) {
  await assertCanWriteUsers(scope, userIds);
  const td = today();
  if (dates.some((d) => d < td)) {
    throw new ScheduleServiceError('Cannot unpublish a week that has already elapsed', 423, 'ELAPSED');
  }
  const res = await prisma.scheduleShift.updateMany({
    where: { user_id: { in: userIds }, shift_date: { in: dates.map(dateOnlyValue) }, status: 'PUBLISHED' },
    data: { status: 'DRAFT', locked_at: null, updated_by: actorId },
  });
  return { unpublished: res.count };
}

/**
 * Admin override to unlock a published+elapsed shift for correction. Writes an
 * AuditLog row because it reopens reported history.
 */
export async function adminUnlockShift(scope: ScheduleScope, shiftId: number, actorId: number) {
  if (!scope.isAdmin) {
    throw new ScheduleServiceError('Only an admin can unlock an elapsed published week', 403, 'ADMIN_ONLY');
  }
  const shift = await prisma.scheduleShift.findUnique({ where: { id: shiftId } });
  if (!shift) throw new ScheduleServiceError('Shift not found', 404, 'NOT_FOUND');
  return prisma.$transaction(async (tx) => {
    const updated = await tx.scheduleShift.update({ where: { id: shiftId }, data: { locked_at: null, updated_by: actorId } });
    await auditRow(tx, actorId, 'schedule.admin_unlock', { shiftId, user_id: shift.user_id, shift_date: dateStrFromDate(shift.shift_date) });
    return updated;
  });
}

/**
 * Cancel a deactivated user's future shifts. Called from the user-admin flow so
 * a departed employee stops generating attendance denominators. Past shifts are
 * left intact as history.
 */
export async function cancelFutureShiftsForUser(userId: number): Promise<number> {
  const res = await prisma.scheduleShift.deleteMany({
    where: { user_id: userId, shift_date: { gte: dateOnlyValue(today()) } },
  });
  return res.count;
}
