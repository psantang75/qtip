/**
 * Campaign scoping guards, mirroring scheduling/schedule.permissions.
 *
 * Every campaign service answers the same two questions — may this viewer SEE
 * this schedule, and may they WRITE to it — so they live here rather than being
 * restated per service. Both build on resolveScope: Admin/Director see all
 * departments, Managers only the ones they manage, everyone else only their own.
 *
 * A schedule is visible to SEVERAL departments (campaign_schedule_department), so
 * a view check asks whether the viewer's scope intersects that list. Writes still
 * hang off the owning department_id.
 */
import prisma from '../../config/prisma';
import { AuthReq, ScheduleScope, ScheduleServiceError } from '../scheduling/schedule.types';
import { resolveScope } from '../scheduling/schedule.permissions';

/** Department ids the viewer may SEE schedules for. null = all. */
export async function viewableDeptIds(req: AuthReq): Promise<{ scope: ScheduleScope; deptIds: number[] | null }> {
  const scope = await resolveScope(req);
  if (scope.canViewAll) return { scope, deptIds: scope.departmentIds }; // null = all
  const me = await prisma.user.findUnique({ where: { id: scope.viewerId }, select: { department_id: true } });
  return { scope, deptIds: me?.department_id != null ? [me.department_id] : [] };
}

export async function loadSchedule(id: number) {
  const row = await prisma.campaignSchedule.findUnique({
    where: { id },
    include: {
      department: { select: { department_name: true } },
      departments: { select: { department_id: true } },
    },
  });
  if (!row) throw new ScheduleServiceError('Schedule not found', 404, 'NOT_FOUND');
  return row;
}

/** The departments a schedule is visible to, owner included. */
export const visibleDeptIdsOf = (
  schedule: { department_id: number; departments: Array<{ department_id: number }> },
): number[] => [...new Set([schedule.department_id, ...schedule.departments.map((d) => d.department_id)])];

/** Guard a write for a target department. Throws 403 when out of scope. */
export function assertCanWriteDepartment(scope: ScheduleScope, departmentId: number): void {
  if (!scope.canViewAll) {
    throw new ScheduleServiceError('You do not have permission to edit campaign schedules', 403, 'FORBIDDEN');
  }
  if (scope.departmentIds === null) return; // Admin / Director-ALL
  if (!scope.departmentIds.includes(departmentId)) {
    throw new ScheduleServiceError('That department is outside your scope', 403, 'OUT_OF_SCOPE');
  }
}

/** Every department a schedule is being pointed at must be writable. */
export function assertCanWriteDepartments(scope: ScheduleScope, departmentIds: number[]): void {
  for (const id of departmentIds) assertCanWriteDepartment(scope, id);
}

/** Assert the scope may write to the schedule's department, returning the row. */
export async function assertCanWriteSchedule(scope: ScheduleScope, id: number) {
  const row = await loadSchedule(id);
  assertCanWriteDepartment(scope, row.department_id);
  return row;
}

/**
 * Assert the viewer may see the schedule at all, returning their scope and the
 * row. Says nothing about publish state — callers that serve month data pair
 * this with assertMonthVisible.
 */
export async function assertCanViewSchedule(req: AuthReq, id: number) {
  const scope = await resolveScope(req);
  const schedule = await loadSchedule(id);
  const visibleTo = visibleDeptIdsOf(schedule);
  if (scope.canViewAll) {
    if (scope.departmentIds !== null && !visibleTo.some((d) => scope.departmentIds!.includes(d))) {
      throw new ScheduleServiceError('That schedule is outside your scope', 403, 'OUT_OF_SCOPE');
    }
    return { scope, schedule };
  }
  const me = await prisma.user.findUnique({ where: { id: scope.viewerId }, select: { department_id: true } });
  if (me?.department_id == null || !visibleTo.includes(me.department_id)) {
    throw new ScheduleServiceError('That schedule is outside your scope', 403, 'OUT_OF_SCOPE');
  }
  return { scope, schedule };
}
