/**
 * The global phone queue library: the set of queues that exist at all.
 *
 * Admin-only writes, gated at the route. Mirrors the campaign library and the
 * scheduling list types — soft delete via is_active, never a hard delete, because
 * a queue that ever appeared on a plan is referenced by membership and by day
 * overrides. Deactivating simply removes it from the pickers.
 */
import prisma from '../../config/prisma';
import { createNotFoundError, createValidationError, AppError, ErrorType } from '../../utils/errorHandler';

const normBlank = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? null : s;
};

export interface QueueCreateInput {
  queue_name: string;
  queue_code?: string | null;
  description?: string | null;
  color?: string | null;
}

export type QueueUpdateInput = Partial<QueueCreateInput>;

export function listQueues(includeInactive = false) {
  return prisma.phoneQueue.findMany({
    where: includeInactive ? {} : { is_active: true },
    orderBy: [{ sort_order: 'asc' }, { queue_name: 'asc' }],
  });
}

/** The library plus, for each queue, which departments already use it. */
export async function listQueuesWithDepartments(includeInactive = false) {
  const queues = await prisma.phoneQueue.findMany({
    where: includeInactive ? {} : { is_active: true },
    orderBy: [{ sort_order: 'asc' }, { queue_name: 'asc' }],
    include: {
      departments: {
        select: {
          department_id: true,
          fill_priority: true,
          min_agents: true,
          target_agents: true,
          max_agents: true,
          is_active: true,
          department: { select: { department_name: true } },
        },
        orderBy: { fill_priority: 'asc' },
      },
    },
  });
  return queues.map((q) => ({
    id: q.id,
    queue_name: q.queue_name,
    queue_code: q.queue_code,
    description: q.description,
    color: q.color,
    sort_order: q.sort_order,
    is_active: q.is_active,
    departments: q.departments.map((d) => ({
      department_id: d.department_id,
      department_name: d.department.department_name,
      fill_priority: d.fill_priority,
      min_agents: d.min_agents,
      target_agents: d.target_agents,
      max_agents: d.max_agents,
      is_active: d.is_active,
    })),
  }));
}

async function assertNameFree(queueName: string, exceptId?: number): Promise<void> {
  const clash = await prisma.phoneQueue.findFirst({
    where: { queue_name: queueName, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) {
    throw new AppError('A queue with that name already exists', ErrorType.VALIDATION_ERROR, 409);
  }
}

export async function createQueue(data: QueueCreateInput) {
  const queue_name = data.queue_name.trim();
  if (!queue_name) throw createValidationError('A queue needs a name');
  await assertNameFree(queue_name);

  const max = await prisma.phoneQueue.aggregate({ _max: { sort_order: true } });
  return prisma.phoneQueue.create({
    data: {
      queue_name,
      queue_code: normBlank(data.queue_code),
      description: normBlank(data.description),
      color: normBlank(data.color) ?? '#00aeef',
      sort_order: (max._max.sort_order ?? 0) + 10,
    },
  });
}

export async function updateQueue(id: number, data: QueueUpdateInput) {
  const row = await prisma.phoneQueue.findUnique({ where: { id } });
  if (!row) throw createNotFoundError('Queue not found');

  const queue_name = data.queue_name?.trim();
  if (queue_name !== undefined) {
    if (!queue_name) throw createValidationError('A queue needs a name');
    await assertNameFree(queue_name, id);
  }

  return prisma.phoneQueue.update({
    where: { id },
    data: {
      ...(queue_name !== undefined ? { queue_name } : {}),
      ...(data.queue_code !== undefined ? { queue_code: normBlank(data.queue_code) } : {}),
      ...(data.description !== undefined ? { description: normBlank(data.description) } : {}),
      ...(data.color !== undefined ? { color: normBlank(data.color) ?? '#00aeef' } : {}),
    },
  });
}

export async function setQueueActive(id: number, isActive: boolean) {
  const row = await prisma.phoneQueue.findUnique({ where: { id } });
  if (!row) throw createNotFoundError('Queue not found');
  return prisma.phoneQueue.update({ where: { id }, data: { is_active: isActive } });
}

export async function reorderQueues(order: Array<{ id: number; sort_order: number }>) {
  await prisma.$transaction(
    order.map((o) => prisma.phoneQueue.update({ where: { id: o.id }, data: { sort_order: o.sort_order } })),
  );
  return listQueues(true);
}
