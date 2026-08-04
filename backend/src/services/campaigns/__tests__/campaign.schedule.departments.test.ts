/**
 * A campaign calendar is shown to several departments. The rules under test:
 * the visible-to list is rewritten wholesale, the owning department_id (which
 * backs the unique name and the write guard) always stays inside that list, and
 * a manager cannot point a calendar at a department outside their scope.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/prisma', () => {
  const db = {
    campaignSchedule: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    campaignScheduleDepartment: { deleteMany: vi.fn(), createMany: vi.fn() },
    campaignScheduleMonth: { findMany: vi.fn() },
    department: { count: vi.fn() },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(db)),
  };
  return { default: db };
});
vi.mock('../../scheduling/schedule.permissions', () => ({ resolveScope: vi.fn() }));

import prisma from '../../../config/prisma';
import { resolveScope } from '../../scheduling/schedule.permissions';
import { normalizeDepartmentIds, updateSchedule } from '../campaign.schedule.service';
import { visibleDeptIdsOf } from '../campaign.permissions';
import type { AuthReq } from '../../scheduling/schedule.types';

const db = prisma as unknown as {
  campaignSchedule: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }
  campaignScheduleDepartment: { deleteMany: ReturnType<typeof vi.fn>; createMany: ReturnType<typeof vi.fn> }
  campaignScheduleMonth: { findMany: ReturnType<typeof vi.fn> }
  department: { count: ReturnType<typeof vi.fn> }
};
const resolveScopeMock = resolveScope as unknown as ReturnType<typeof vi.fn>;
const req = {} as AuthReq;

/** A manager over departments 1 and 2 — department 9 is outside their scope. */
const manager = { viewerId: 7, canViewAll: true, departmentIds: [1, 2], isAdmin: false };

const existing = {
  id: 5, name: 'AR Calendar', department_id: 1, is_active: true, status: 'PUBLISHED' as const,
  department: { department_name: 'Customer Service' },
  departments: [{ department_id: 1 }],
};

const updatedRow = (deptIds: number[], owner = deptIds[0]) => ({
  ...existing, department_id: owner,
  departments: deptIds.map((id) => ({
    department_id: id,
    department: { department_name: id === 1 ? 'Customer Service' : `Dept ${id}` },
  })),
});

beforeEach(() => {
  vi.clearAllMocks();
  resolveScopeMock.mockResolvedValue(manager);
  db.campaignSchedule.findUnique.mockResolvedValue(existing);
  db.campaignSchedule.findFirst.mockResolvedValue(null);
  db.campaignScheduleMonth.findMany.mockResolvedValue([]);
  db.department.count.mockImplementation(({ where }: { where: { id: { in: number[] } } }) => where.id.in.length);
});

describe('normalizeDepartmentIds', () => {
  it('de-duplicates and sorts, so the owning department is deterministic', () => {
    expect(normalizeDepartmentIds([2, 1, 2])).toEqual([1, 2]);
    expect(normalizeDepartmentIds(undefined)).toEqual([]);
  });
});

describe('visibleDeptIdsOf', () => {
  it('includes the owner even when the link rows say nothing', () => {
    expect(visibleDeptIdsOf({ department_id: 3, departments: [] })).toEqual([3]);
    expect(visibleDeptIdsOf({ department_id: 3, departments: [{ department_id: 3 }, { department_id: 4 }] })).toEqual([3, 4]);
  });
});

describe('updateSchedule departments', () => {
  it('adds a department without disturbing the owner', async () => {
    db.campaignSchedule.update.mockResolvedValue(updatedRow([1, 2]));
    const dto = await updateSchedule(req, 5, { department_ids: [2, 1] });

    expect(db.campaignScheduleDepartment.deleteMany).toHaveBeenCalledWith({
      where: { schedule_id: 5, department_id: { notIn: [1, 2] } },
    });
    expect(db.campaignScheduleDepartment.createMany).toHaveBeenCalledWith({
      data: [{ schedule_id: 5, department_id: 1 }, { schedule_id: 5, department_id: 2 }],
      skipDuplicates: true,
    });
    expect(dto.departments.map((d) => d.id)).toEqual([1, 2]);
  });

  it('re-points the owner when the owning department is dropped, and re-checks the name', async () => {
    db.campaignSchedule.update.mockResolvedValue(updatedRow([2]));
    await updateSchedule(req, 5, { department_ids: [2] });

    expect(db.campaignSchedule.findFirst).toHaveBeenCalledWith({
      where: { department_id: 2, name: 'AR Calendar', id: { not: 5 } },
    });
    expect(db.campaignSchedule.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ department_id: 2 }) }),
    );
  });

  it('refuses a department outside the writer scope and writes nothing', async () => {
    await expect(updateSchedule(req, 5, { department_ids: [1, 9] })).rejects.toMatchObject({
      statusCode: 403, code: 'OUT_OF_SCOPE',
    });
    expect(db.campaignScheduleDepartment.deleteMany).not.toHaveBeenCalled();
    expect(db.campaignSchedule.update).not.toHaveBeenCalled();
  });

  it('refuses an empty pick, so a calendar is never orphaned', async () => {
    await expect(updateSchedule(req, 5, { department_ids: [] })).rejects.toMatchObject({
      statusCode: 400, code: 'INVALID_INPUT',
    });
    expect(db.campaignSchedule.update).not.toHaveBeenCalled();
  });

  it('leaves the department list alone when only the name changes', async () => {
    db.campaignSchedule.update.mockResolvedValue(updatedRow([1]));
    await updateSchedule(req, 5, { name: 'AR Calendar 2026' });

    expect(db.campaignScheduleDepartment.deleteMany).not.toHaveBeenCalled();
    expect(db.campaignSchedule.findFirst).toHaveBeenCalledWith({
      where: { department_id: 1, name: 'AR Calendar 2026', id: { not: 5 } },
    });
  });
});
