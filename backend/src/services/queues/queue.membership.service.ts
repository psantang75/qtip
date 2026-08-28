/**
 * Who may staff which queue, and in what order they get pulled into one.
 *
 * The department view is the screen the request described: the department's
 * people, and for each of them the queues they belong to. It is built from the
 * scheduling roster so a person with no queues still appears — somebody with no
 * membership is exactly who a manager is looking for.
 */
import prisma from '../../config/prisma';
import { createNotFoundError, createValidationError } from '../../utils/errorHandler';
import { listRoster } from '../scheduling/schedule.permissions';
import { assertCanManageUsers, loadViewableDepartment } from './queue.permissions';
import type { QueueScope } from './queue.types';

export interface QueueMemberInput {
  user_id: number;
  is_home: boolean;
  person_priority: number;
  is_pinned: boolean;
  is_active?: boolean;
}

/** The department's people, each with the queues they belong to. */
export async function listDepartmentMembers(scope: QueueScope, departmentId: number) {
  const dept = await loadViewableDepartment(scope, departmentId);

  const roster = (await listRoster(scope)).filter((r) => r.department_id === departmentId);
  const userIds = roster.map((r) => r.id);

  const memberships = await prisma.phoneQueueMember.findMany({
    where: { user_id: { in: userIds.length ? userIds : [-1] }, queue: { is_active: true } },
    include: { queue: { select: { id: true, queue_name: true, color: true, sort_order: true } } },
  });

  const byUser = new Map<number, typeof memberships>();
  for (const m of memberships) {
    const list = byUser.get(m.user_id) ?? [];
    list.push(m);
    byUser.set(m.user_id, list);
  }

  return {
    department_id: dept.id,
    department_name: dept.department_name,
    people: roster.map((r) => {
      const mine = (byUser.get(r.id) ?? []).sort(
        (a, b) => a.queue.sort_order - b.queue.sort_order || a.queue.queue_name.localeCompare(b.queue.queue_name),
      );
      return {
        user_id: r.id,
        username: r.username,
        queues: mine.map((m) => ({
          queue_id: m.queue.id,
          queue_name: m.queue.queue_name,
          color: m.queue.color,
          is_home: m.is_home,
          person_priority: m.person_priority,
          is_pinned: m.is_pinned,
          is_active: m.is_active,
        })),
        home_queue_id: mine.find((m) => m.is_home)?.queue.id ?? null,
      };
    }),
  };
}

/** Membership of one queue, for the queue-side editor. */
export async function listQueueMembers(scope: QueueScope, queueId: number) {
  const queue = await prisma.phoneQueue.findUnique({
    where: { id: queueId },
    select: { id: true, queue_name: true },
  });
  if (!queue) throw createNotFoundError('Queue not found');

  const roster = await listRoster(scope);
  const visibleIds = new Set(roster.map((r) => r.id));

  const members = await prisma.phoneQueueMember.findMany({
    where: { queue_id: queueId },
    include: { user: { select: { username: true, department_id: true } } },
    orderBy: { person_priority: 'asc' },
  });

  return {
    queue_id: queue.id,
    queue_name: queue.queue_name,
    // A manager may only see their own people's rows, but the queue is global,
    // so filtering here keeps a scoped viewer from enumerating the whole company.
    members: members
      .filter((m) => visibleIds.has(m.user_id))
      .map((m) => ({
        user_id: m.user_id,
        username: m.user.username,
        department_id: m.user.department_id,
        is_home: m.is_home,
        person_priority: m.person_priority,
        is_pinned: m.is_pinned,
        is_active: m.is_active,
      })),
  };
}

/**
 * Replace a queue's membership for the people the caller may manage.
 *
 * Rows for users outside the caller's scope are left untouched rather than
 * deleted — a global queue is shared, and a manager saving their own team must
 * not silently empty another department's side of it.
 */
export async function saveQueueMembers(scope: QueueScope, queueId: number, members: QueueMemberInput[]) {
  const queue = await prisma.phoneQueue.findUnique({ where: { id: queueId }, select: { id: true } });
  if (!queue) throw createNotFoundError('Queue not found');

  const userIds = members.map((m) => m.user_id);
  if (new Set(userIds).size !== userIds.length) {
    throw createValidationError('A person can only be listed once per queue');
  }
  await assertCanManageUsers(scope, userIds);

  const manageable = await manageableUserIds(scope);

  await prisma.$transaction(async (tx) => {
    await tx.phoneQueueMember.deleteMany({
      where: {
        queue_id: queueId,
        ...(manageable === null ? {} : { user_id: { in: manageable.length ? manageable : [-1] } }),
      },
    });
    if (members.length === 0) return;
    await tx.phoneQueueMember.createMany({
      data: members.map((m) => ({
        queue_id: queueId,
        user_id: m.user_id,
        is_home: m.is_home,
        person_priority: m.person_priority,
        is_pinned: m.is_pinned,
        is_active: m.is_active ?? true,
      })),
    });
  });

  // A person has at most one home queue: adopting this one drops the others.
  const newHomes = members.filter((m) => m.is_home).map((m) => m.user_id);
  if (newHomes.length > 0) {
    await prisma.phoneQueueMember.updateMany({
      where: { user_id: { in: newHomes }, queue_id: { not: queueId }, is_home: true },
      data: { is_home: false },
    });
  }

  return listQueueMembers(scope, queueId);
}

/** User ids the scope may manage; null when unrestricted. */
async function manageableUserIds(scope: QueueScope): Promise<number[] | null> {
  if (scope.departmentIds === null) return null;
  const users = await prisma.user.findMany({
    where: { department_id: { in: scope.departmentIds.length ? scope.departmentIds : [-1] } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}
