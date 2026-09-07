/**
 * Adherence exception TYPES — the catalog of reasons (excused / unexcused) that a
 * per-person adherence exception references. The twin of scheduling's
 * schedule.listTypes exception-type surface, edited in Admin > List Management >
 * Adherence. is_excused alone decides scoring (see adherence.engine).
 *
 * Read paths are open to any adherence-exception viewer (the entry page needs the
 * active types); writes are admin-only, enforced at the route layer. Soft-delete
 * via is_active, never hard delete — a type that produced real rows is referenced
 * by history. is_system blocks nothing but deletion, which we never offer.
 */
import prisma from '../../config/prisma';
import { ScheduleServiceError } from '../scheduling/schedule.types';

// Normalize a blank/whitespace category to null so grouping stays clean.
const normBlank = (v: unknown): string | null | undefined => {
  if (v === undefined) return undefined;
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

const NULLABLE_TEXT = new Set(['category']);

function pick(data: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in data) out[k] = NULLABLE_TEXT.has(k) ? normBlank(data[k]) : data[k];
  return out;
}

// Derive a unique type_key slug from a label when the caller doesn't supply one.
async function uniqueTypeKey(label: string): Promise<string> {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 45) || 'type';
  let candidate = base;
  let n = 2;
  while (await prisma.adherenceExceptionType.findUnique({ where: { type_key: candidate } })) {
    candidate = `${base}_${n++}`.slice(0, 50);
  }
  return candidate;
}

export function listAdherenceExceptionTypes(includeInactive = false) {
  return prisma.adherenceExceptionType.findMany({
    where: includeInactive ? {} : { is_active: true },
    orderBy: { sort_order: 'asc' },
  });
}

export async function createAdherenceExceptionType(data: {
  type_key?: string;
  label: string;
  category?: string | null;
  description?: string | null;
  is_excused?: boolean;
}) {
  const type_key = data.type_key?.trim() || (await uniqueTypeKey(data.label));
  const exists = await prisma.adherenceExceptionType.findUnique({ where: { type_key } });
  if (exists) throw new ScheduleServiceError('An exception type with that key already exists', 409, 'DUPLICATE');
  const max = await prisma.adherenceExceptionType.aggregate({ _max: { sort_order: true } });
  return prisma.adherenceExceptionType.create({
    data: {
      type_key,
      label: data.label,
      category: normBlank(data.category) ?? null,
      description: data.description ?? null,
      is_excused: data.is_excused ?? false,
      sort_order: (max._max.sort_order ?? 0) + 10,
    },
  });
}

export async function updateAdherenceExceptionType(id: number, data: Record<string, unknown>) {
  const row = await prisma.adherenceExceptionType.findUnique({ where: { id } });
  if (!row) throw new ScheduleServiceError('Exception type not found', 404, 'NOT_FOUND');
  const patch = pick(data, ['label', 'category', 'description', 'is_excused']);
  return prisma.adherenceExceptionType.update({ where: { id }, data: patch });
}

export async function setAdherenceExceptionTypeActive(id: number, isActive: boolean) {
  const row = await prisma.adherenceExceptionType.findUnique({ where: { id } });
  if (!row) throw new ScheduleServiceError('Exception type not found', 404, 'NOT_FOUND');
  return prisma.adherenceExceptionType.update({ where: { id }, data: { is_active: isActive } });
}

export async function reorderAdherenceExceptionTypes(order: Array<{ id: number; sort_order: number }>) {
  await prisma.$transaction(order.map((o) =>
    prisma.adherenceExceptionType.update({ where: { id: o.id }, data: { sort_order: o.sort_order } }),
  ));
  return listAdherenceExceptionTypes(true);
}
