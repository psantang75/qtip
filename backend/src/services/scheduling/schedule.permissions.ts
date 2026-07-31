/**
 * Scope resolution and write-guarding for scheduling.
 *
 * Page-level `edit` says you MAY edit schedules; it does not say WHOSE. Every
 * write re-checks the target user's department against the manager's list, the
 * same second line of defence the write-ups services use.
 */
import prisma from '../../config/prisma';
import { getManagedDepartmentIds } from '../manager/manager.access';
import { AuthReq, ScheduleScope, ScheduleServiceError } from './schedule.types';

/**
 * Resolve which departments a viewer may see/write. Admin and Director-with-ALL
 * are unrestricted (null); a manager is limited to their managed departments;
 * anyone else self-scopes (departmentIds is irrelevant, canViewAll false).
 */
export async function resolveScope(req: AuthReq): Promise<ScheduleScope> {
  const viewerId = req.user!.user_id;
  const isAdmin = req.user!.role === 'Admin';
  const canViewAll = req.pageAccess?.canViewAll ?? false;

  if (!canViewAll) {
    return { viewerId, canViewAll: false, departmentIds: null, isAdmin: false };
  }
  if (isAdmin) {
    return { viewerId, canViewAll: true, departmentIds: null, isAdmin: true };
  }
  // Director-with-ALL sees everyone too; managers are department-scoped.
  if (req.user!.role === 'Director') {
    return { viewerId, canViewAll: true, departmentIds: null, isAdmin: false };
  }
  const departmentIds = await getManagedDepartmentIds(viewerId);
  return { viewerId, canViewAll: true, departmentIds, isAdmin: false };
}

/** True when a manager scoped to managedDeptIds may write for targetDeptId. */
export function canManagerWriteFor(managedDeptIds: number[], targetDeptId: number | null): boolean {
  if (targetDeptId === null) return false;
  return managedDeptIds.includes(targetDeptId);
}

/**
 * Assert the scope may write shifts/exceptions for every one of userIds. Admin
 * and Director-ALL pass unconditionally. A manager must own the department of
 * every target user; anything else is a 403 — the server never trusts the id
 * list the client sends.
 */
export async function assertCanWriteUsers(scope: ScheduleScope, userIds: number[]): Promise<void> {
  if (!scope.canViewAll) {
    throw new ScheduleServiceError('You do not have permission to edit schedules', 403, 'FORBIDDEN');
  }
  if (scope.departmentIds === null) return; // unrestricted

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, department_id: true },
  });
  const allowed = new Set(scope.departmentIds);
  for (const u of users) {
    if (u.department_id === null || !allowed.has(u.department_id)) {
      throw new ScheduleServiceError('One or more users are outside your departments', 403, 'OUT_OF_SCOPE');
    }
  }
  if (users.length !== new Set(userIds).size) {
    throw new ScheduleServiceError('One or more users were not found', 404, 'USER_NOT_FOUND');
  }
}

export interface RosterUser {
  id: number;
  username: string;
  department_id: number | null;
  department_name: string | null;
}

/**
 * The people a viewer may schedule, grouped-ready for the grid. Admin sees all
 * active users including the department-less under an Unassigned grouping;
 * managers/directors see their scoped departments; a self viewer sees only
 * themselves.
 */
export async function listRoster(scope: ScheduleScope): Promise<RosterUser[]> {
  if (!scope.canViewAll) {
    const me = await prisma.user.findUnique({
      where: { id: scope.viewerId },
      select: { id: true, username: true, department_id: true, department: { select: { department_name: true } } },
    });
    if (!me) return [];
    return [{ id: me.id, username: me.username, department_id: me.department_id, department_name: me.department?.department_name ?? null }];
  }

  const where =
    scope.departmentIds === null
      ? { is_active: true }
      : { is_active: true, department_id: { in: scope.departmentIds } };

  const users = await prisma.user.findMany({
    where,
    select: { id: true, username: true, department_id: true, department: { select: { department_name: true } } },
    orderBy: [{ department_id: 'asc' }, { username: 'asc' }],
  });
  return users.map((u) => ({
    id: u.id,
    username: u.username,
    department_id: u.department_id,
    department_name: u.department?.department_name ?? null,
  }));
}
