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
import { hmFromTime, timeValue } from './schedule.dates';

// Normalize a blank/whitespace value to null. Category grouping needs it, and
// paychex_pay_type is UNIQUE — a second row storing '' would be rejected as a
// duplicate of the first "not linked" type.
const normBlank = (v: unknown): string | null | undefined => {
  if (v === undefined) return undefined;
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

const NULLABLE_TEXT = new Set(['category', 'paychex_pay_type']);

// Only these columns may be patched from the generic list editor.
function pick<T extends Record<string, unknown>>(data: Record<string, unknown>, keys: string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in data) out[k] = NULLABLE_TEXT.has(k) ? normBlank(data[k]) : data[k];
  return out as Partial<T>;
}

// Derive a unique type_key slug from a label when the caller doesn't supply one.
async function uniqueTypeKey(label: string): Promise<string> {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 45) || 'type';
  let candidate = base;
  let n = 2;
   
  while (await prisma.scheduleExceptionType.findUnique({ where: { type_key: candidate } })) {
    candidate = `${base}_${n++}`.slice(0, 50);
  }
  return candidate;
}

// ── Exception types ──────────────────────────────────────────────────────────

export function listExceptionTypes(includeInactive = false) {
  return prisma.scheduleExceptionType.findMany({
    where: includeInactive ? {} : { is_active: true },
    orderBy: { sort_order: 'asc' },
  });
}

export async function createExceptionType(data: {
  type_key?: string;
  label: string;
  category?: string | null;
  description?: string | null;
  paychex_pay_type?: string | null;
  is_excused?: boolean;
  duration_mode?: 'FULL_DAY' | 'WINDOW' | 'EITHER';
  affects_arrival?: boolean;
  affects_departure?: boolean;
}) {
  const type_key = data.type_key?.trim() || (await uniqueTypeKey(data.label));
  const exists = await prisma.scheduleExceptionType.findUnique({ where: { type_key } });
  if (exists) throw new ScheduleServiceError('An exception type with that key already exists', 409, 'DUPLICATE');
  const max = await prisma.scheduleExceptionType.aggregate({ _max: { sort_order: true } });
  return prisma.scheduleExceptionType.create({
    data: {
      type_key,
      label: data.label,
      category: normBlank(data.category) ?? null,
      description: data.description ?? null,
      paychex_pay_type: normBlank(data.paychex_pay_type) ?? null,
      is_excused: data.is_excused ?? false,
      duration_mode: data.duration_mode ?? 'EITHER',
      affects_arrival: data.affects_arrival ?? false,
      affects_departure: data.affects_departure ?? false,
      sort_order: (max._max.sort_order ?? 0) + 10,
    },
  });
}

export async function updateExceptionType(id: number, data: Record<string, unknown>) {
  const row = await prisma.scheduleExceptionType.findUnique({ where: { id } });
  if (!row) throw new ScheduleServiceError('Exception type not found', 404, 'NOT_FOUND');
  const patch = pick(data, ['label', 'category', 'description', 'paychex_pay_type', 'is_excused', 'duration_mode', 'affects_arrival', 'affects_departure']);
  if (patch.paychex_pay_type) {
    const clash = await prisma.scheduleExceptionType.findFirst({
      where: { paychex_pay_type: patch.paychex_pay_type as string, id: { not: id } },
      select: { label: true },
    });
    if (clash) {
      throw new ScheduleServiceError(
        `That Paychex pay type is already linked to "${clash.label}"`, 409, 'DUPLICATE_PAY_TYPE',
      );
    }
  }
  return prisma.scheduleExceptionType.update({ where: { id }, data: patch });
}

export async function setExceptionTypeActive(id: number, isActive: boolean) {
  const row = await prisma.scheduleExceptionType.findUnique({ where: { id } });
  if (!row) throw new ScheduleServiceError('Exception type not found', 404, 'NOT_FOUND');
  // System types can be hidden (deactivated) — is_system only guards deletion,
  // which we never offer for these. Hiding just removes them from the picker.
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
  category?: string | null;
  is_paid?: boolean;
  counts_as_coverage?: boolean;
  color?: string | null;
}) {
  const exists = await prisma.scheduleActivityType.findUnique({ where: { label: data.label } });
  if (exists) throw new ScheduleServiceError('An activity type with that label already exists', 409, 'DUPLICATE');
  const max = await prisma.scheduleActivityType.aggregate({ _max: { sort_order: true } });
  return prisma.scheduleActivityType.create({
    data: {
      label: data.label,
      category: normBlank(data.category) ?? null,
      is_paid: data.is_paid ?? true,
      counts_as_coverage: data.counts_as_coverage ?? false,
      color: data.color ?? null,
      sort_order: (max._max.sort_order ?? 0) + 10,
    },
  });
}

export async function updateActivityType(id: number, data: Record<string, unknown>) {
  const row = await prisma.scheduleActivityType.findUnique({ where: { id } });
  if (!row) throw new ScheduleServiceError('Activity type not found', 404, 'NOT_FOUND');
  const patch = pick(data, ['label', 'category', 'is_paid', 'counts_as_coverage', 'color']);
  return prisma.scheduleActivityType.update({ where: { id }, data: patch });
}

export async function setActivityTypeActive(id: number, isActive: boolean) {
  const row = await prisma.scheduleActivityType.findUnique({ where: { id } });
  if (!row) throw new ScheduleServiceError('Activity type not found', 404, 'NOT_FOUND');
  if (row.is_system && !isActive) {
    throw new ScheduleServiceError('System activity types cannot be deactivated', 400, 'IS_SYSTEM');
  }
  return prisma.scheduleActivityType.update({ where: { id }, data: { is_active: isActive } });
}

export async function reorderActivityTypes(order: Array<{ id: number; sort_order: number }>) {
  await prisma.$transaction(order.map((o) =>
    prisma.scheduleActivityType.update({ where: { id: o.id }, data: { sort_order: o.sort_order } }),
  ));
  return listActivityTypes(true);
}

// ── Coverage thresholds ──────────────────────────────────────────────────────

// Return one row per active department, merged with its saved threshold (or
// sensible defaults when never configured). This is a settings surface, so the
// caller always sees the full department list, not just configured rows.
export async function listCoverageThresholds() {
  const [depts, rows, windows] = await Promise.all([
    prisma.department.findMany({ where: { is_active: true }, select: { id: true, department_name: true }, orderBy: { department_name: 'asc' } }),
    prisma.scheduleCoverageThreshold.findMany(),
    prisma.scheduleCoverageWindow.findMany({ orderBy: [{ department_id: 'asc' }, { sort_order: 'asc' }] }),
  ]);
  const byDept = new Map(rows.map((r) => [r.department_id, r]));
  const winByDept = new Map<number, typeof windows>();
  for (const w of windows) {
    const list = winByDept.get(w.department_id) ?? [];
    list.push(w);
    winByDept.set(w.department_id, list);
  }
  return depts.map((d) => {
    const r = byDept.get(d.id);
    return {
      department_id: d.id,
      department_name: d.department_name,
      is_enabled: r?.is_enabled ?? false,
      green_min: r?.green_min ?? 2,
      yellow_min: r?.yellow_min ?? 1,
      configured: !!r,
      windows: (winByDept.get(d.id) ?? []).map((w) => ({
        id: w.id,
        start: hmFromTime(w.start_time),
        end: hmFromTime(w.end_time),
        green_min: w.green_min,
        yellow_min: w.yellow_min,
      })),
    };
  });
}

export async function upsertCoverageThreshold(data: { department_id: number; green_min: number; yellow_min: number; is_enabled?: boolean }) {
  if (data.yellow_min > data.green_min) {
    throw new ScheduleServiceError('Yellow minimum cannot exceed green minimum', 400, 'INVALID_RANGE');
  }
  return prisma.scheduleCoverageThreshold.upsert({
    where: { department_id: data.department_id },
    create: { department_id: data.department_id, green_min: data.green_min, yellow_min: data.yellow_min, is_enabled: data.is_enabled ?? true },
    update: { green_min: data.green_min, yellow_min: data.yellow_min, ...(data.is_enabled !== undefined ? { is_enabled: data.is_enabled } : {}) },
  });
}

export async function deleteCoverageThreshold(departmentId: number) {
  const row = await prisma.scheduleCoverageThreshold.findUnique({ where: { department_id: departmentId } });
  if (!row) throw new ScheduleServiceError('Coverage threshold not found', 404, 'NOT_FOUND');
  await prisma.scheduleCoverageThreshold.delete({ where: { department_id: departmentId } });
  return { success: true };
}

// ── Coverage windows ─────────────────────────────────────────────────────────

// Time-of-day staffing bars for a department. Replaces the whole set atomically
// — the editor sends the full list, so a diff would only add complexity. Times
// are 'HH:MM' 24h; zero-padded so a lexical compare is a chronological compare.
export interface CoverageWindowInput {
  start: string;
  end: string;
  green_min: number;
  yellow_min: number;
}

export async function saveCoverageWindows(departmentId: number, windows: CoverageWindowInput[]) {
  const dept = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!dept) throw new ScheduleServiceError('Department not found', 404, 'NOT_FOUND');

  const sorted = [...windows].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i];
    if (w.end <= w.start) {
      throw new ScheduleServiceError('A time frame must end after it starts', 400, 'INVALID_RANGE');
    }
    if (w.yellow_min > w.green_min) {
      throw new ScheduleServiceError('Yellow minimum cannot exceed green minimum', 400, 'INVALID_RANGE');
    }
    if (i > 0 && w.start < sorted[i - 1].end) {
      throw new ScheduleServiceError('Time frames cannot overlap', 400, 'OVERLAP');
    }
  }

  await prisma.$transaction([
    prisma.scheduleCoverageWindow.deleteMany({ where: { department_id: departmentId } }),
    ...(sorted.length
      ? [prisma.scheduleCoverageWindow.createMany({
          data: sorted.map((w, i) => ({
            department_id: departmentId,
            start_time: timeValue(w.start),
            end_time: timeValue(w.end),
            green_min: w.green_min,
            yellow_min: w.yellow_min,
            sort_order: i,
          })),
        })]
      : []),
  ]);

  return listCoverageThresholds();
}
