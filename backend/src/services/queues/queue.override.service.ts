/**
 * The manual layer over the computed plan.
 *
 * ASSIGN forces somebody onto a queue; EXCLUDE keeps them off it. The solver
 * applies both as CONSTRAINTS before its own rules run, so a manager's call
 * always beats the automation and the automation fills in around it — the point
 * of the feature is that the automatic answer is a good default, not an
 * argument.
 *
 * An override carries a WINDOW, because the thing being corrected is usually an
 * hour of it: "put Mitch on Inbound while Jamie is at lunch". The window is
 * shaped exactly like a partial-day `schedule_exception` — nullable
 * starts_at/ends_at, both null meaning all day — so the same 'HH:MM' API strings
 * and the same combineLocal/hmFromDateTime helpers carry it.
 *
 * There is deliberately no unique key across the window columns. MySQL cannot
 * express "no two rows may overlap", and a key that included start_time would
 * silently permit two contradictory rows starting a minute apart. So writes
 * delete whatever they overlap and then insert, which is both idempotent
 * (double-clicking cannot duplicate) and the natural way to extend or shrink an
 * existing override. It is the same delete-then-create shape as
 * campaign.override.service.
 */
import prisma from '../../config/prisma';
import type { Prisma } from '../../generated/prisma/client';
import { createNotFoundError, createValidationError } from '../../utils/errorHandler';
import { combineLocal, dateOnlyValue, dateStrFromDate, hmFromDateTime } from '../scheduling/schedule.dates';
import { assertCanManageUsers, assertCanWriteDepartment, loadViewableDepartment } from './queue.permissions';
import type { QueueScope } from './queue.types';

export type OverrideAction = 'ASSIGN' | 'EXCLUDE';

export interface OverrideInput {
  department_id: number;
  assignment_date: string; // 'YYYY-MM-DD'
  user_id: number;
  queue_id: number;
  action: OverrideAction;
  /** 'HH:MM'. Both omitted means the whole day. */
  start?: string | null;
  end?: string | null;
}

/** Narrow a match to rows whose window overlaps [startsAt, endsAt). */
function overlapWhere(
  key: Prisma.PhoneQueueAssignmentOverrideWhereInput,
  startsAt: Date | null,
  endsAt: Date | null,
): Prisma.PhoneQueueAssignmentOverrideWhereInput {
  // An all-day write overlaps everything, and an existing all-day row is
  // overlapped by everything, so both cases skip the interval test entirely.
  if (!startsAt || !endsAt) return key;
  return {
    ...key,
    OR: [
      { starts_at: null },
      { ends_at: null },
      { AND: [{ starts_at: { lt: endsAt } }, { ends_at: { gt: startsAt } }] },
    ],
  };
}

export async function listOverrides(scope: QueueScope, departmentId: number, date: string) {
  await loadViewableDepartment(scope, departmentId);
  const rows = await prisma.phoneQueueAssignmentOverride.findMany({
    where: { department_id: departmentId, assignment_date: dateOnlyValue(date) },
    include: {
      user: { select: { username: true } },
      queue: { select: { queue_name: true } },
    },
    orderBy: [{ starts_at: 'asc' }, { id: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id,
    department_id: r.department_id,
    assignment_date: dateStrFromDate(r.assignment_date),
    user_id: r.user_id,
    username: r.user.username,
    queue_id: r.queue_id,
    queue_name: r.queue.queue_name,
    action: r.action as OverrideAction,
    start: r.starts_at ? hmFromDateTime(r.starts_at) : null,
    end: r.ends_at ? hmFromDateTime(r.ends_at) : null,
  }));
}

/** Resolve and validate the window, or throw. */
function windowOf(date: string, start?: string | null, end?: string | null) {
  const hasStart = !!start;
  const hasEnd = !!end;
  if (hasStart !== hasEnd) {
    throw createValidationError('An override window needs both a start and an end');
  }
  if (!hasStart) return { startsAt: null, endsAt: null };
  if (start! >= end!) throw createValidationError('End must be after start');
  return { startsAt: combineLocal(date, start!), endsAt: combineLocal(date, end!) };
}

export async function setOverride(scope: QueueScope, input: OverrideInput, actorId: number) {
  assertCanWriteDepartment(scope, input.department_id);
  await loadViewableDepartment(scope, input.department_id);
  await assertCanManageUsers(scope, [input.user_id]);

  const queue = await prisma.phoneQueue.findUnique({ where: { id: input.queue_id }, select: { id: true } });
  if (!queue) throw createNotFoundError('Queue not found');

  const key = {
    department_id: input.department_id,
    assignment_date: dateOnlyValue(input.assignment_date),
    user_id: input.user_id,
    queue_id: input.queue_id,
  };
  const { startsAt, endsAt } = windowOf(input.assignment_date, input.start, input.end);

  await prisma.$transaction([
    prisma.phoneQueueAssignmentOverride.deleteMany({ where: overlapWhere(key, startsAt, endsAt) }),
    prisma.phoneQueueAssignmentOverride.create({
      data: { ...key, action: input.action, starts_at: startsAt, ends_at: endsAt, created_by: actorId },
    }),
  ]);

  return listOverrides(scope, input.department_id, input.assignment_date);
}

export interface ClearInput {
  department_id: number;
  assignment_date: string;
  user_id: number;
  /** Omit to clear every queue — "put this person back on automatic". */
  queue_id?: number;
  start?: string | null;
  end?: string | null;
}

/**
 * Hand a window back to the solver. Distinct from writing an EXCLUDE: excluding
 * somebody is a decision the solver must keep honouring, whereas clearing means
 * "I was wrong to intervene here, work it out yourself".
 */
export async function clearOverrides(scope: QueueScope, input: ClearInput) {
  assertCanWriteDepartment(scope, input.department_id);
  await loadViewableDepartment(scope, input.department_id);

  const { startsAt, endsAt } = windowOf(input.assignment_date, input.start, input.end);
  const key = {
    department_id: input.department_id,
    assignment_date: dateOnlyValue(input.assignment_date),
    user_id: input.user_id,
    ...(input.queue_id != null ? { queue_id: input.queue_id } : {}),
  };

  await prisma.phoneQueueAssignmentOverride.deleteMany({
    where: overlapWhere(key, startsAt, endsAt),
  });

  return listOverrides(scope, input.department_id, input.assignment_date);
}

export async function deleteOverride(scope: QueueScope, id: number) {
  const row = await prisma.phoneQueueAssignmentOverride.findUnique({ where: { id } });
  if (!row) throw createNotFoundError('Override not found');
  assertCanWriteDepartment(scope, row.department_id);
  await prisma.phoneQueueAssignmentOverride.delete({ where: { id } });
  return { success: true };
}
