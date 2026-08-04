/**
 * Campaign SCHEDULES — named calendars shown to one or more departments, plus
 * their membership (which library campaigns are enabled). One calendar often
 * serves several departments, so the same plan is published once instead of
 * being copied per department. Department scoping reuses the scheduling module's
 * resolveScope: Admin/Director-ALL see everything, Managers are limited to the
 * departments they manage, and everyone else (agents) sees only the schedules
 * their own department is on, read-only.
 *
 * Publish state (campaign.publish.service) narrows that further: an agent's list
 * excludes draft schedules and any schedule with no released month, and each DTO
 * carries the released months so the client can bound month navigation.
 */
import prisma from '../../config/prisma';
import { AuthReq, ScheduleServiceError } from '../scheduling/schedule.types';
import { resolveScope } from '../scheduling/schedule.permissions';
import {
  assertCanViewSchedule, assertCanWriteDepartments, assertCanWriteSchedule, viewableDeptIds,
} from './campaign.permissions';
import { canSeeDrafts, publishedMonthsBySchedule, type PublishStatus } from './campaign.publish.service';

export interface ScheduleDepartmentDto { id: number; department_name: string }

export interface ScheduleDto {
  id: number;
  name: string;
  /** Every department the calendar is visible to, by name. Never empty. */
  departments: ScheduleDepartmentDto[];
  is_active: boolean;
  status: PublishStatus;
  /** Released months as 'YYYY-MM', ascending. Agents may only open these. */
  published_months: string[];
}

interface ScheduleRow {
  id: number; name: string; department_id: number; is_active: boolean;
  status: PublishStatus;
  department?: { department_name: string } | null;
  departments?: Array<{ department_id: number; department?: { department_name: string } | null }>;
}

/** The link rows, falling back to the owner so a DTO is never department-less. */
function departmentsOf(r: ScheduleRow): ScheduleDepartmentDto[] {
  const out = (r.departments ?? [])
    .filter((d) => d.department != null)
    .map((d) => ({ id: d.department_id, department_name: d.department!.department_name }));
  if (out.length === 0 && r.department) out.push({ id: r.department_id, department_name: r.department.department_name });
  return out.sort((a, b) => a.department_name.localeCompare(b.department_name));
}

const toDto = (r: ScheduleRow, published_months: string[] = []): ScheduleDto => ({
  id: r.id, name: r.name, departments: departmentsOf(r),
  is_active: r.is_active, status: r.status, published_months,
});

const withDepartments = {
  department: { select: { department_name: true } },
  departments: { include: { department: { select: { department_name: true } } } },
} as const;

/**
 * Normalise a department pick: de-duplicated and ascending, so the owning
 * department is deterministic (the lowest id) and the link rows are stable.
 */
export function normalizeDepartmentIds(ids: number[] | undefined): number[] {
  return [...new Set(ids ?? [])].sort((a, b) => a - b);
}

/** Schedules the viewer may see, ordered by name. */
export async function listSchedules(req: AuthReq, includeInactive = false): Promise<ScheduleDto[]> {
  const { scope, deptIds } = await viewableDeptIds(req);
  if (deptIds !== null && deptIds.length === 0) return [];
  const rows = await prisma.campaignSchedule.findMany({
    where: {
      // Retired schedules are an editor's concern (they reactivate them), so only
      // a viewer with write reach is ever shown one.
      ...(includeInactive && scope.canViewAll ? {} : { is_active: true }),
      ...(deptIds === null ? {} : { departments: { some: { department_id: { in: deptIds } } } }),
      // An agent never sees a draft schedule, nor one with nothing released yet —
      // it would open on a month they are not allowed to read.
      ...(canSeeDrafts(scope) ? {} : { status: 'PUBLISHED', months: { some: { status: 'PUBLISHED' } } }),
    },
    include: withDepartments,
    orderBy: [{ name: 'asc' }],
  });
  const published = await publishedMonthsBySchedule(rows.map((r) => r.id));
  return rows.map((r) => toDto(r, published.get(r.id) ?? []));
}

/** Departments the viewer may CREATE schedules for (write scope). */
export async function listWritableDepartments(req: AuthReq): Promise<Array<{ id: number; department_name: string }>> {
  const scope = await resolveScope(req);
  if (!scope.canViewAll) return [];
  const where = scope.departmentIds === null
    ? { is_active: true }
    : { is_active: true, id: { in: scope.departmentIds } };
  return prisma.department.findMany({ where, select: { id: true, department_name: true }, orderBy: { department_name: 'asc' } });
}

/** Reject a pick that is empty or points at a department that doesn't exist. */
async function assertDepartmentsExist(ids: number[]): Promise<void> {
  if (ids.length === 0) throw new ScheduleServiceError('Pick at least one department', 400, 'INVALID_INPUT');
  const found = await prisma.department.count({ where: { id: { in: ids } } });
  if (found !== ids.length) throw new ScheduleServiceError('Department not found', 404, 'DEPARTMENT_NOT_FOUND');
}

/** The name must stay unique within the owning department (uq_..._dept_name). */
async function assertNameFree(name: string, ownerDeptId: number, exceptId?: number): Promise<void> {
  const clash = await prisma.campaignSchedule.findFirst({
    where: { department_id: ownerDeptId, name, ...(exceptId != null ? { id: { not: exceptId } } : {}) },
  });
  if (clash) throw new ScheduleServiceError('That department already has a schedule with that name', 409, 'DUPLICATE');
}

const cleanName = (raw: string | undefined): string => {
  const name = raw?.trim();
  if (!name) throw new ScheduleServiceError('Schedule name is required', 400, 'INVALID_INPUT');
  return name;
};

export async function createSchedule(req: AuthReq, data: { name: string; department_ids: number[] }): Promise<ScheduleDto> {
  const scope = await resolveScope(req);
  const deptIds = normalizeDepartmentIds(data.department_ids);
  assertCanWriteDepartments(scope, deptIds);
  const name = cleanName(data.name);
  await assertDepartmentsExist(deptIds);
  await assertNameFree(name, deptIds[0]);
  const created = await prisma.campaignSchedule.create({
    data: {
      name, department_id: deptIds[0], created_by: scope.viewerId,
      departments: { create: deptIds.map((department_id) => ({ department_id })) },
    },
    include: withDepartments,
  });
  return toDto(created);
}

/**
 * Rename, re-scope or retire a schedule. Re-scoping rewrites the visible-to list
 * and re-points department_id at the lowest of the new picks, so the owning
 * department (which the unique name and the write guard hang off) always stays
 * inside the list rather than becoming a department that can no longer see it.
 */
export async function updateSchedule(
  req: AuthReq, id: number,
  data: { name?: string; is_active?: boolean; department_ids?: number[] },
): Promise<ScheduleDto> {
  const scope = await resolveScope(req);
  const existing = await assertCanWriteSchedule(scope, id);

  const deptIds = data.department_ids !== undefined ? normalizeDepartmentIds(data.department_ids) : null;
  if (deptIds) {
    assertCanWriteDepartments(scope, deptIds);
    await assertDepartmentsExist(deptIds);
  }
  const owner = deptIds ? deptIds[0] : existing.department_id;

  const patch: { name?: string; is_active?: boolean; department_id?: number } = {};
  if (data.name !== undefined) patch.name = cleanName(data.name);
  if (data.is_active !== undefined) patch.is_active = data.is_active;
  if (deptIds) patch.department_id = owner;
  if (patch.name !== undefined || owner !== existing.department_id) {
    await assertNameFree(patch.name ?? existing.name, owner, id);
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (deptIds) {
      await tx.campaignScheduleDepartment.deleteMany({ where: { schedule_id: id, department_id: { notIn: deptIds } } });
      await tx.campaignScheduleDepartment.createMany({
        data: deptIds.map((department_id) => ({ schedule_id: id, department_id })),
        skipDuplicates: true,
      });
    }
    return tx.campaignSchedule.update({ where: { id }, data: patch, include: withDepartments });
  });
  const published = await publishedMonthsBySchedule([id]);
  return toDto(updated, published.get(id) ?? []);
}

export async function deleteSchedule(req: AuthReq, id: number) {
  const scope = await resolveScope(req);
  await assertCanWriteSchedule(scope, id);
  await prisma.campaignSchedule.delete({ where: { id } });
  return { success: true };
}

// ── Membership (the "build" step) ────────────────────────────────────────────

export interface MembershipRow {
  campaign_item_id: number;
  label: string;
  category_id: number;
  category_name: string;
  color: string;
  category_sort: number;
  item_sort: number;
  is_enabled: boolean;
}

/**
 * Membership for a schedule: every ACTIVE library campaign, flagged enabled or
 * not. A campaign with no membership row defaults to enabled — so a fresh
 * schedule includes everything until the manager disables some.
 */
export async function getMembership(req: AuthReq, id: number): Promise<MembershipRow[]> {
  await assertCanViewSchedule(req, id);
  const [cats, memberships] = await Promise.all([
    prisma.campaignCategory.findMany({
      where: { is_active: true },
      orderBy: { sort_order: 'asc' },
      include: { items: { where: { is_active: true }, orderBy: { sort_order: 'asc' } } },
    }),
    prisma.campaignScheduleItem.findMany({ where: { schedule_id: id } }),
  ]);
  const disabled = new Set(memberships.filter((m) => !m.is_enabled).map((m) => m.campaign_item_id));
  const out: MembershipRow[] = [];
  for (const c of cats) {
    for (const it of c.items) {
      out.push({
        campaign_item_id: it.id, label: it.label,
        category_id: c.id, category_name: c.name, color: c.color,
        category_sort: c.sort_order, item_sort: it.sort_order,
        is_enabled: !disabled.has(it.id),
      });
    }
  }
  return out;
}

/** Enable/disable a campaign in a schedule. Upserts the membership row. */
export async function setMembership(req: AuthReq, id: number, campaign_item_id: number, is_enabled: boolean) {
  const scope = await resolveScope(req);
  await assertCanWriteSchedule(scope, id);
  const item = await prisma.campaignItem.findUnique({ where: { id: campaign_item_id } });
  if (!item) throw new ScheduleServiceError('Campaign not found', 404, 'ITEM_NOT_FOUND');
  await prisma.campaignScheduleItem.upsert({
    where: { schedule_id_campaign_item_id: { schedule_id: id, campaign_item_id } },
    create: { schedule_id: id, campaign_item_id, is_enabled },
    update: { is_enabled },
  });
  return { success: true };
}
