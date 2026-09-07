/**
 * Adherence exceptions — an approved reason logged against ONE break/lunch on ONE
 * day, mirroring attendance's ScheduleException. Adherence-only: at recompute the
 * engine forgives that segment's punch-side points (duration + start, or a miss)
 * when the referenced type is EXCUSED, and records only when it is UNEXCUSED. It
 * does NOT edit the schedule, punch/time clock, attendance, or phone rules — phone
 * stays measured off the actual punch.
 *
 * Keyed on (user, work_date, segment_kind, seq): seq is the occurrence index
 * (sorted-by-start within that kind), so each break/lunch is addressed
 * independently. Entered from the dedicated Adherence Exceptions page under the
 * sched_adherence_exceptions permission.
 */
import type { AdherenceSegmentKind } from '../../generated/prisma/client';
import prisma from '../../config/prisma';
import logger from '../../config/logger';
import { ScheduleScope, ScheduleServiceError } from '../scheduling/schedule.types';
import { assertCanWriteUsers } from '../scheduling/schedule.permissions';
import { dateOnlyValue, dateStrFromDate } from '../scheduling/schedule.dates';
import { recomputeRange } from './adherence.engine';

export interface AdherenceExceptionInput {
  user_id: number;
  work_date: string; // 'YYYY-MM-DD'
  segment_kind: AdherenceSegmentKind;
  seq: number;
  exception_type_id: number;
  reason?: string | null;
}

/**
 * Adherence points/percent are derived, never stored at write time: the engine
 * rebuilds a day from schedule, punch, phone and rules (now minus excused
 * segments). So after a write we recompute just that user's day so the
 * forgiveness lands immediately. The engine is idempotent and caps itself to the
 * punch watermark, so an out-of-coverage day is a safe no-op. Failures are logged
 * and swallowed — the row already committed and the next recompute heals the range.
 */
async function safeRecompute(date: string, userId: number): Promise<void> {
  try {
    await recomputeRange(date, date, [userId]);
  } catch (err) {
    logger.error('[ADHERENCE] recompute after exception change failed:', err);
  }
}

export async function listAdherenceExceptions(
  scope: ScheduleScope,
  filters: { from?: string; to?: string; userId?: number },
) {
  const where: Record<string, unknown> = {};
  if (scope.departmentIds !== null && scope.canViewAll) {
    where.user = { department_id: { in: scope.departmentIds } };
  } else if (!scope.canViewAll) {
    where.user_id = scope.viewerId;
  }
  if (filters.userId) where.user_id = filters.userId;
  if (filters.from || filters.to) {
    where.work_date = {
      ...(filters.from ? { gte: dateOnlyValue(filters.from) } : {}),
      ...(filters.to ? { lte: dateOnlyValue(filters.to) } : {}),
    };
  }
  const rows = await prisma.adherenceException.findMany({
    where,
    include: {
      user: { select: { username: true, department: { select: { department_name: true } } } },
      exception_type: { select: { label: true, is_excused: true } },
    },
    orderBy: { work_date: 'desc' },
    take: 1000,
  });
  return rows.map((e) => ({
    id: e.id,
    user_id: e.user_id,
    username: e.user.username,
    department_name: e.user.department?.department_name ?? null,
    work_date: dateStrFromDate(e.work_date),
    segment_kind: e.segment_kind,
    seq: e.seq,
    exception_type_id: e.exception_type_id,
    type_label: e.exception_type.label,
    is_excused: e.exception_type.is_excused,
    reason: e.reason,
  }));
}

/**
 * Create or update the exception for one break/lunch instance. One row per
 * (user, date, segment_kind, seq), so re-logging the same segment swaps the type.
 * Always recomputes that day so the report reflects the change at once.
 */
export async function upsertAdherenceException(
  scope: ScheduleScope,
  input: AdherenceExceptionInput,
  actorId: number,
) {
  await assertCanWriteUsers(scope, [input.user_id]);

  const type = await prisma.adherenceExceptionType.findUnique({ where: { id: input.exception_type_id } });
  if (!type || !type.is_active) {
    throw new ScheduleServiceError('Exception type not found or inactive', 400, 'INVALID_TYPE');
  }

  const key = {
    user_id: input.user_id,
    work_date: dateOnlyValue(input.work_date),
    segment_kind: input.segment_kind,
    seq: input.seq,
  };

  const saved = await prisma.adherenceException.upsert({
    where: { user_id_work_date_segment_kind_seq: key },
    create: { ...key, exception_type_id: input.exception_type_id, reason: input.reason ?? null, entered_by: actorId },
    update: { exception_type_id: input.exception_type_id, reason: input.reason ?? null, entered_by: actorId },
  });

  await safeRecompute(input.work_date, input.user_id);
  return saved;
}

export async function deleteAdherenceException(scope: ScheduleScope, id: number) {
  const ex = await prisma.adherenceException.findUnique({ where: { id } });
  if (!ex) throw new ScheduleServiceError('Adherence exception not found', 404, 'NOT_FOUND');
  await assertCanWriteUsers(scope, [ex.user_id]);
  const affectedUser = ex.user_id;
  const affectedDate = dateStrFromDate(ex.work_date);
  await prisma.adherenceException.delete({ where: { id } });
  await safeRecompute(affectedDate, affectedUser);
  return { success: true };
}
