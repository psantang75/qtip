/**
 * Admin-managed lists behind scheduling: exception types, activity types, and
 * per-department coverage thresholds. Read paths are open to any scheduling
 * viewer (the grid and editors need them); writes are admin-only, enforced at
 * the route layer via authorizePage.
 *
 * Soft-delete via is_active, never hard delete — a type that produced real rows
 * is referenced by history. is_system blocks deletion of seeded rows.
 */
import prisma from '../../config/prisma';
import { ScheduleServiceError } from './schedule.types';

// ── Exception types ──────────────────────────────────────────────────────────

export function listExceptionTypes(includeInactive = false) {
  return prisma.scheduleExceptionType.findMany({
    where: includeInactive ? {} : { is_active: true },
    orderBy: { sort_order: 'asc' },
  });
}

export async function createExceptionType(data: {
  type_key: string;
  label: string;
  description?: string | null;
  is_excused: boolean;
  duration_mode: 'FULL_DAY' | 'WINDOW' | 'EITHER';
  affects_arrival?: boolean;
  affects_departure?: boolean;
}) {
  const exists = await prisma.scheduleExceptionType.findUnique({ where: { type_key: data.type_key } });
  if (exists) throw new ScheduleServiceError('An exception type with that key already exists', 409, 'DUPLICATE');
  const max = await prisma.scheduleExceptionType.aggregate({ _max: { sort_order: true } });
  return prisma.scheduleExceptionType.create({
    data: { ...data, sort_order: (max._max.sort_order ?? 0) + 10 },
  });
}

export async function updateExceptionType(id: number, data: Record<string, unknown>) {
  const row = await prisma.scheduleExceptionType.findUnique({ where: { id } });
  if (!row) throw new ScheduleServiceError('Exception type not found', 404, 'NOT_FOUND');
  return prisma.scheduleExceptionType.update({ where: { id }, data });
}

export async function setExceptionTypeActive(id: number, isActive: boolean) {
  const row = await prisma.scheduleExceptionType.findUnique({ where: { id } });
  if (!row) throw new ScheduleServiceError('Exception type not found', 404, 'NOT_FOUND');
  if (row.is_system && !isActive) {
    throw new ScheduleServiceError('System exception types cannot be deactivated', 400, 'IS_SYSTEM');
  }
  return prisma.scheduleExceptionType.update({ where: { id }, data: { is_active: isActive } });
}

export async function reorderExceptionTypes(order: Array<{ id: number; sort_order: number }>) {
  await prisma.$transaction(order.map((o) =>
    prisma.scheduleExceptionType.update({ where: { id: o.id }, data: { sort_order: o.sort_order } }),
  ));
  return listExceptionTypes(true);
}

// ── Activity types ───────────────────────────────────────────────────────────

export function listActivityTypes(includeInactive = false) {
  return prisma.scheduleActivityType.findMany({
    where: includeInactive ? {} : { is_active: true },
    orderBy: { sort_order: 'asc' },
  });
}

export async function createActivityType(data: {
  label: string;
  is_paid: boolean;
  counts_as_coverage?: boolean;
  color?: string | null;
}) {
  const exists = await prisma.scheduleActivityType.findUnique({ where: { label: data.label } });
  if (exists) throw new ScheduleServiceError('An activity type with that label already exists', 409, 'DUPLICATE');
  const max = await prisma.scheduleActivityType.aggregate({ _max: { sort_order: true } });
  return prisma.scheduleActivityType.create({ data: { ...data, sort_order: (max._max.sort_order ?? 0) + 10 } });
}

export async function updateActivityType(id: number, data: Record<string, unknown>) {
  const row = await prisma.scheduleActivityType.findUnique({ where: { id } });
  if (!row) throw new ScheduleServiceError('Activity type not found', 404, 'NOT_FOUND');
  return prisma.scheduleActivityType.update({ where: { id }, data });
}

export async function setActivityTypeActive(id: number, isActive: boolean) {
  const row = await prisma.scheduleActivityType.findUnique({ where: { id } });
  if (!row) throw new ScheduleServiceError('Activity type not found', 404, 'NOT_FOUND');
  if (row.is_system && !isActive) {
    throw new ScheduleServiceError('System activity types cannot be deactivated', 400, 'IS_SYSTEM');
  }
  return prisma.scheduleActivityType.update({ where: { id }, data: { is_active: isActive } });
}

// ── Coverage thresholds ──────────────────────────────────────────────────────

export function listCoverageThresholds() {
  return prisma.scheduleCoverageThreshold.findMany({
    include: { department: { select: { department_name: true } } },
    orderBy: { department_id: 'asc' },
  });
}

export async function upsertCoverageThreshold(data: { department_id: number; green_min: number; yellow_min: number }) {
  if (data.yellow_min > data.green_min) {
    throw new ScheduleServiceError('Yellow minimum cannot exceed green minimum', 400, 'INVALID_RANGE');
  }
  return prisma.scheduleCoverageThreshold.upsert({
    where: { department_id: data.department_id },
    create: data,
    update: { green_min: data.green_min, yellow_min: data.yellow_min },
  });
}

export async function deleteCoverageThreshold(departmentId: number) {
  const row = await prisma.scheduleCoverageThreshold.findUnique({ where: { department_id: departmentId } });
  if (!row) throw new ScheduleServiceError('Coverage threshold not found', 404, 'NOT_FOUND');
  await prisma.scheduleCoverageThreshold.delete({ where: { department_id: departmentId } });
  return { success: true };
}
