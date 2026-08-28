/**
 * The per-department rules that are not per-queue.
 *
 * One row per department, the same shape as schedule_coverage_threshold. A
 * department that has never been configured reads back defaults rather than
 * null, so the settings screen has something to render and the solver has
 * something to obey on day one.
 */
import prisma from '../../config/prisma';
import { createValidationError } from '../../utils/errorHandler';
import { assertCanWriteDepartment, loadViewableDepartment } from './queue.permissions';
import type { FillStrategy, QueueScope } from './queue.types';

export interface QueuePolicy {
  department_id: number;
  is_enabled: boolean;
  max_queues_per_person: number;
  require_min_one_per_queue: boolean;
  respect_pins: boolean;
  fill_strategy: FillStrategy;
  configured: boolean;
}

/**
 * Defaults chosen so an unconfigured department behaves conservatively: one
 * queue per person (no double-covering unless somebody opts in), the floor rule
 * on, pins honoured, and the priority order people already understand.
 */
const DEFAULTS = {
  is_enabled: false,
  max_queues_per_person: 1,
  require_min_one_per_queue: true,
  respect_pins: true,
  fill_strategy: 'PRIORITY' as FillStrategy,
};

export async function getPolicy(scope: QueueScope, departmentId: number): Promise<QueuePolicy> {
  const dept = await loadViewableDepartment(scope, departmentId);
  const row = await prisma.phoneQueuePolicy.findUnique({ where: { department_id: dept.id } });
  return {
    department_id: dept.id,
    is_enabled: row?.is_enabled ?? DEFAULTS.is_enabled,
    max_queues_per_person: row?.max_queues_per_person ?? DEFAULTS.max_queues_per_person,
    require_min_one_per_queue: row?.require_min_one_per_queue ?? DEFAULTS.require_min_one_per_queue,
    respect_pins: row?.respect_pins ?? DEFAULTS.respect_pins,
    fill_strategy: (row?.fill_strategy as FillStrategy | undefined) ?? DEFAULTS.fill_strategy,
    configured: !!row,
  };
}

export interface PolicyInput {
  is_enabled?: boolean;
  max_queues_per_person?: number;
  require_min_one_per_queue?: boolean;
  respect_pins?: boolean;
  fill_strategy?: FillStrategy;
}

export async function upsertPolicy(scope: QueueScope, departmentId: number, data: PolicyInput) {
  assertCanWriteDepartment(scope, departmentId);
  await loadViewableDepartment(scope, departmentId);

  if (data.max_queues_per_person !== undefined && data.max_queues_per_person < 1) {
    throw createValidationError('A person must be allowed at least one queue');
  }

  await prisma.phoneQueuePolicy.upsert({
    where: { department_id: departmentId },
    create: {
      department_id: departmentId,
      is_enabled: data.is_enabled ?? true,
      max_queues_per_person: data.max_queues_per_person ?? DEFAULTS.max_queues_per_person,
      require_min_one_per_queue: data.require_min_one_per_queue ?? DEFAULTS.require_min_one_per_queue,
      respect_pins: data.respect_pins ?? DEFAULTS.respect_pins,
      fill_strategy: data.fill_strategy ?? DEFAULTS.fill_strategy,
    },
    update: {
      ...(data.is_enabled !== undefined ? { is_enabled: data.is_enabled } : {}),
      ...(data.max_queues_per_person !== undefined ? { max_queues_per_person: data.max_queues_per_person } : {}),
      ...(data.require_min_one_per_queue !== undefined
        ? { require_min_one_per_queue: data.require_min_one_per_queue }
        : {}),
      ...(data.respect_pins !== undefined ? { respect_pins: data.respect_pins } : {}),
      ...(data.fill_strategy !== undefined ? { fill_strategy: data.fill_strategy } : {}),
    },
  });

  return getPolicy(scope, departmentId);
}
