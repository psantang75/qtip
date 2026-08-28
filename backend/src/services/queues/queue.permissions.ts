/**
 * Department guards for phone queues, mirroring campaigns/campaign.permissions.
 *
 * Queue authority IS schedule authority: if you may build a department's
 * schedule, you may say which queues its people staff. So this builds on
 * `resolveScope` rather than inventing a second notion of scope.
 *
 * The client always names the department, so every read and write re-checks that
 * id against the viewer's scope here — page-level `edit` says you MAY edit, never
 * whose.
 */
import prisma from '../../config/prisma';
import { createAuthorizationError, createNotFoundError } from '../../utils/errorHandler';
import { resolveScope } from '../scheduling/schedule.permissions';
import type { AuthReq, QueueScope } from './queue.types';

export { resolveScope };

/** Guard a read of one department. Throws 403 when out of scope. */
export function assertCanViewDepartment(scope: QueueScope, departmentId: number): void {
  if (scope.canViewAll) {
    if (scope.departmentIds === null) return; // Admin / Director-ALL
    if (!scope.departmentIds.includes(departmentId)) {
      throw createAuthorizationError('That department is outside your scope');
    }
    return;
  }
  throw createAuthorizationError('You do not have permission to view queue coverage');
}

/** Guard a write to one department. */
export function assertCanWriteDepartment(scope: QueueScope, departmentId: number): void {
  if (!scope.canViewAll) {
    throw createAuthorizationError('You do not have permission to edit phone queues');
  }
  if (scope.departmentIds === null) return;
  if (!scope.departmentIds.includes(departmentId)) {
    throw createAuthorizationError('That department is outside your scope');
  }
}

/** Load a department the viewer may see, or fail with the right status. */
export async function loadViewableDepartment(scope: QueueScope, departmentId: number) {
  assertCanViewDepartment(scope, departmentId);
  const dept = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { id: true, department_name: true },
  });
  if (!dept) throw createNotFoundError('Department not found');
  return dept;
}

/**
 * Assert the scope may manage queue membership for every one of userIds.
 *
 * Deliberately a queue-side twin of scheduling's `assertCanWriteUsers` rather
 * than a call to it: that one throws `ScheduleServiceError`, and this surface
 * uses the canonical `AppError` envelope. The rule enforced is identical — a
 * manager must own the department of every target user, and the server never
 * trusts the id list the client sent.
 */
export async function assertCanManageUsers(scope: QueueScope, userIds: number[]): Promise<void> {
  if (!scope.canViewAll) throw createAuthorizationError('You do not have permission to edit phone queues');
  if (scope.departmentIds === null || userIds.length === 0) return;

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, department_id: true },
  });
  if (users.length !== new Set(userIds).size) throw createNotFoundError('One or more users were not found');

  const allowed = new Set(scope.departmentIds);
  for (const u of users) {
    if (u.department_id === null || !allowed.has(u.department_id)) {
      throw createAuthorizationError('One or more users are outside your departments');
    }
  }
}

/**
 * The departments this viewer may pick from, for the page's department selector.
 * Ordered by name so the control is stable between loads.
 */
export async function listScopedDepartments(req: AuthReq) {
  const scope = await resolveScope(req);
  if (!scope.canViewAll) return { scope, departments: [] };

  const departments = await prisma.department.findMany({
    where: {
      is_active: true,
      ...(scope.departmentIds === null ? {} : { id: { in: scope.departmentIds } }),
    },
    select: { id: true, department_name: true },
    orderBy: { department_name: 'asc' },
  });
  return { scope, departments };
}
