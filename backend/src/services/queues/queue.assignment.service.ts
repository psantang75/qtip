/**
 * Which queues a department staffs, and its numbers for each.
 *
 * Read returns EVERY active queue in the library merged with this department's
 * assignment, so the settings screen always shows the full list rather than only
 * the configured rows — same shape as listCoverageThresholds.
 *
 * Write replaces the whole set atomically, like saveCoverageWindows: the editor
 * sends the complete list, so diffing would only add ways to be wrong.
 */
import prisma from '../../config/prisma';
import { createValidationError } from '../../utils/errorHandler';
import { hmFromTime, timeValue } from '../scheduling/schedule.dates';
import { assertCanWriteDepartment, loadViewableDepartment } from './queue.permissions';
import type { QueueScope } from './queue.types';

export interface QueueWindowInput {
  start: string; // 'HH:MM'
  end: string;
  min_agents: number;
  target_agents: number;
  max_agents?: number | null;
}

export interface QueueAssignmentInput {
  queue_id: number;
  is_active: boolean;
  fill_priority: number;
  min_agents: number;
  target_agents: number;
  max_agents?: number | null;
  windows?: QueueWindowInput[];
}

/** Shared numeric sanity, applied to the queue row and to each of its windows. */
function assertNumbers(label: string, min: number, target: number, max: number | null | undefined): void {
  if (min < 0 || target < 0) throw createValidationError(`${label}: headcounts cannot be negative`);
  if (target < min) throw createValidationError(`${label}: target cannot be below the minimum`);
  if (max != null && max < target) throw createValidationError(`${label}: maximum cannot be below the target`);
}

function assertWindows(queueLabel: string, windows: QueueWindowInput[]): QueueWindowInput[] {
  const sorted = [...windows].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i];
    if (w.end <= w.start) throw createValidationError(`${queueLabel}: a time frame must end after it starts`);
    assertNumbers(`${queueLabel} ${w.start}\u2013${w.end}`, w.min_agents, w.target_agents, w.max_agents);
    if (i > 0 && w.start < sorted[i - 1].end) {
      throw createValidationError(`${queueLabel}: time frames cannot overlap`);
    }
  }
  return sorted;
}

/** Every active queue, merged with this department's settings for it. */
export async function listDepartmentQueues(scope: QueueScope, departmentId: number) {
  const dept = await loadViewableDepartment(scope, departmentId);

  const [queues, assignments] = await Promise.all([
    prisma.phoneQueue.findMany({
      where: { is_active: true },
      orderBy: [{ sort_order: 'asc' }, { queue_name: 'asc' }],
    }),
    prisma.phoneQueueDepartment.findMany({
      where: { department_id: departmentId },
      include: { windows: { orderBy: { sort_order: 'asc' } } },
    }),
  ]);

  const byQueue = new Map(assignments.map((a) => [a.queue_id, a]));

  return {
    department_id: dept.id,
    department_name: dept.department_name,
    queues: queues.map((q) => {
      const a = byQueue.get(q.id);
      return {
        queue_id: q.id,
        queue_name: q.queue_name,
        queue_code: q.queue_code,
        color: q.color,
        assigned: !!a,
        is_active: a?.is_active ?? false,
        fill_priority: a?.fill_priority ?? 100,
        min_agents: a?.min_agents ?? 1,
        target_agents: a?.target_agents ?? 1,
        max_agents: a?.max_agents ?? null,
        windows: (a?.windows ?? []).map((w) => ({
          start: hmFromTime(w.start_time),
          end: hmFromTime(w.end_time),
          min_agents: w.min_agents,
          target_agents: w.target_agents,
          max_agents: w.max_agents,
        })),
      };
    }),
  };
}

/**
 * Replace this department's queue assignments. A queue omitted from the payload
 * is unassigned; its day overrides survive because they hang off the queue, not
 * the assignment, and become live again if it is reassigned.
 */
export async function saveDepartmentQueues(
  scope: QueueScope,
  departmentId: number,
  rows: QueueAssignmentInput[],
) {
  assertCanWriteDepartment(scope, departmentId);
  await loadViewableDepartment(scope, departmentId);

  const queueIds = rows.map((r) => r.queue_id);
  if (new Set(queueIds).size !== queueIds.length) {
    throw createValidationError('A queue can only be listed once for a department');
  }

  const known = await prisma.phoneQueue.findMany({
    where: { id: { in: queueIds.length ? queueIds : [-1] } },
    select: { id: true, queue_name: true },
  });
  const nameById = new Map(known.map((q) => [q.id, q.queue_name]));
  if (known.length !== queueIds.length) throw createValidationError('One or more queues no longer exist');

  const prepared = rows.map((r) => {
    const label = nameById.get(r.queue_id) ?? `Queue ${r.queue_id}`;
    assertNumbers(label, r.min_agents, r.target_agents, r.max_agents);
    return { ...r, windows: assertWindows(label, r.windows ?? []) };
  });

  await prisma.$transaction(async (tx) => {
    // Deleting the assignments cascades their windows, so the set is rebuilt
    // whole rather than reconciled row by row.
    await tx.phoneQueueDepartment.deleteMany({ where: { department_id: departmentId } });

    for (const r of prepared) {
      const created = await tx.phoneQueueDepartment.create({
        data: {
          queue_id: r.queue_id,
          department_id: departmentId,
          fill_priority: r.fill_priority,
          min_agents: r.min_agents,
          target_agents: r.target_agents,
          max_agents: r.max_agents ?? null,
          is_active: r.is_active,
        },
        select: { id: true },
      });
      if (r.windows.length === 0) continue;
      await tx.phoneQueueWindow.createMany({
        data: r.windows.map((w, i) => ({
          queue_department_id: created.id,
          start_time: timeValue(w.start),
          end_time: timeValue(w.end),
          min_agents: w.min_agents,
          target_agents: w.target_agents,
          max_agents: w.max_agents ?? null,
          sort_order: i,
        })),
      });
    }
  });

  return listDepartmentQueues(scope, departmentId);
}
