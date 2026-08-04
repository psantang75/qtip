/**
 * Campaign LIBRARY — the shared, global set of categories (with a color) and
 * campaign items (with a timing rule). Edited once in List Management; writes
 * are admin-only, enforced at the route layer. Mirrors the scheduling list
 * services: soft-delete via is_active, sort_order on both levels, +10 gaps.
 *
 * Colors live at the category level; items inherit their category's color when
 * projected onto the calendar.
 */
import prisma from '../../config/prisma';
import { ScheduleServiceError } from '../scheduling/schedule.types';

type AnchorType = 'BD_FROM_START' | 'BD_FROM_END' | 'RELATIVE_TO_CAMPAIGN';

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function assertColor(color: string): void {
  if (!HEX.test(color)) throw new ScheduleServiceError('Color must be a hex value like #00aeef', 400, 'INVALID_COLOR');
}

// ── Categories ────────────────────────────────────────────────────────────────

/** Every category with its items nested, ordered by sort_order at both levels. */
export function listCategories(includeInactive = false) {
  return prisma.campaignCategory.findMany({
    where: includeInactive ? {} : { is_active: true },
    orderBy: { sort_order: 'asc' },
    include: {
      items: {
        where: includeInactive ? {} : { is_active: true },
        orderBy: { sort_order: 'asc' },
      },
    },
  });
}

export async function createCategory(data: { name: string; color?: string }) {
  const name = data.name?.trim();
  if (!name) throw new ScheduleServiceError('Category name is required', 400, 'INVALID_INPUT');
  const color = data.color?.trim() || '#00aeef';
  assertColor(color);
  const exists = await prisma.campaignCategory.findUnique({ where: { name } });
  if (exists) throw new ScheduleServiceError('A category with that name already exists', 409, 'DUPLICATE');
  const max = await prisma.campaignCategory.aggregate({ _max: { sort_order: true } });
  return prisma.campaignCategory.create({
    data: { name, color, sort_order: (max._max.sort_order ?? 0) + 10 },
  });
}

export async function updateCategory(id: number, data: { name?: string; color?: string }) {
  const row = await prisma.campaignCategory.findUnique({ where: { id } });
  if (!row) throw new ScheduleServiceError('Category not found', 404, 'NOT_FOUND');
  const patch: { name?: string; color?: string } = {};
  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) throw new ScheduleServiceError('Category name is required', 400, 'INVALID_INPUT');
    const clash = await prisma.campaignCategory.findFirst({ where: { name, id: { not: id } } });
    if (clash) throw new ScheduleServiceError('A category with that name already exists', 409, 'DUPLICATE');
    patch.name = name;
  }
  if (data.color !== undefined) {
    const color = data.color.trim();
    assertColor(color);
    patch.color = color;
  }
  return prisma.campaignCategory.update({ where: { id }, data: patch });
}

export async function setCategoryActive(id: number, isActive: boolean) {
  const row = await prisma.campaignCategory.findUnique({ where: { id } });
  if (!row) throw new ScheduleServiceError('Category not found', 404, 'NOT_FOUND');
  return prisma.campaignCategory.update({ where: { id }, data: { is_active: isActive } });
}

export async function reorderCategories(order: Array<{ id: number; sort_order: number }>) {
  await prisma.$transaction(order.map((o) =>
    prisma.campaignCategory.update({ where: { id: o.id }, data: { sort_order: o.sort_order } }),
  ));
  return listCategories(true);
}

// ── Items ─────────────────────────────────────────────────────────────────────

interface ItemCreate {
  category_id: number;
  label: string;
  anchor_type?: AnchorType;
  anchor_offset?: number;
  anchor_ref_item_id?: number | null;
  not_on_friday?: boolean;
}

async function assertRefValid(anchor_type: AnchorType | undefined, ref: number | null | undefined, selfId?: number): Promise<void> {
  if (anchor_type === 'RELATIVE_TO_CAMPAIGN') {
    if (!ref) throw new ScheduleServiceError('A reference campaign is required for a relative rule', 400, 'REF_REQUIRED');
    if (selfId && ref === selfId) throw new ScheduleServiceError('A campaign cannot reference itself', 400, 'REF_SELF');
    const refRow = await prisma.campaignItem.findUnique({ where: { id: ref } });
    if (!refRow) throw new ScheduleServiceError('Reference campaign not found', 404, 'REF_NOT_FOUND');
  }
}

export async function createItem(data: ItemCreate) {
  const label = data.label?.trim();
  if (!label) throw new ScheduleServiceError('Campaign label is required', 400, 'INVALID_INPUT');
  const cat = await prisma.campaignCategory.findUnique({ where: { id: data.category_id } });
  if (!cat) throw new ScheduleServiceError('Category not found', 404, 'CATEGORY_NOT_FOUND');
  const anchor_type = data.anchor_type ?? 'BD_FROM_START';
  await assertRefValid(anchor_type, data.anchor_ref_item_id);
  const max = await prisma.campaignItem.aggregate({ where: { category_id: data.category_id }, _max: { sort_order: true } });
  return prisma.campaignItem.create({
    data: {
      category_id: data.category_id,
      label,
      anchor_type,
      anchor_offset: data.anchor_offset ?? 1,
      anchor_ref_item_id: anchor_type === 'RELATIVE_TO_CAMPAIGN' ? (data.anchor_ref_item_id ?? null) : null,
      not_on_friday: data.not_on_friday ?? false,
      sort_order: (max._max.sort_order ?? 0) + 10,
    },
  });
}

export async function updateItem(id: number, data: Partial<ItemCreate>) {
  const row = await prisma.campaignItem.findUnique({ where: { id } });
  if (!row) throw new ScheduleServiceError('Campaign not found', 404, 'NOT_FOUND');
  const anchor_type = (data.anchor_type ?? row.anchor_type) as AnchorType;
  const ref = data.anchor_ref_item_id !== undefined ? data.anchor_ref_item_id : row.anchor_ref_item_id;
  await assertRefValid(anchor_type, ref, id);
  const patch: Record<string, unknown> = {};
  if (data.category_id !== undefined && data.category_id !== row.category_id) {
    const cat = await prisma.campaignCategory.findUnique({ where: { id: data.category_id } });
    if (!cat) throw new ScheduleServiceError('Category not found', 404, 'CATEGORY_NOT_FOUND');
    patch.category_id = data.category_id;
    // The old sort_order is meaningless in the new category, so land it last.
    const max = await prisma.campaignItem.aggregate({ where: { category_id: data.category_id }, _max: { sort_order: true } });
    patch.sort_order = (max._max.sort_order ?? 0) + 10;
  }
  if (data.label !== undefined) {
    const label = data.label.trim();
    if (!label) throw new ScheduleServiceError('Campaign label is required', 400, 'INVALID_INPUT');
    patch.label = label;
  }
  if (data.anchor_type !== undefined) patch.anchor_type = anchor_type;
  if (data.anchor_offset !== undefined) patch.anchor_offset = data.anchor_offset;
  if (data.not_on_friday !== undefined) patch.not_on_friday = data.not_on_friday;
  // Keep the ref column consistent with the (possibly new) anchor type.
  patch.anchor_ref_item_id = anchor_type === 'RELATIVE_TO_CAMPAIGN' ? (ref ?? null) : null;
  return prisma.campaignItem.update({ where: { id }, data: patch });
}

export async function setItemActive(id: number, isActive: boolean) {
  const row = await prisma.campaignItem.findUnique({ where: { id } });
  if (!row) throw new ScheduleServiceError('Campaign not found', 404, 'NOT_FOUND');
  return prisma.campaignItem.update({ where: { id }, data: { is_active: isActive } });
}

export async function reorderItems(order: Array<{ id: number; sort_order: number }>) {
  await prisma.$transaction(order.map((o) =>
    prisma.campaignItem.update({ where: { id: o.id }, data: { sort_order: o.sort_order } }),
  ));
  return listCategories(true);
}
