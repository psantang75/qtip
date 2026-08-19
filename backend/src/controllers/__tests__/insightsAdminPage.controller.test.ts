/**
 * Controller/HTTP-layer tests for the Insights Admin Page-access controller.
 *
 * Guards the Prisma migration of this controller: the response-shape contract
 * the frontend `insightsService.ts` types depend on (flattened
 * `role_access[].role_name`, `department_access[].{department_name,hierarchy_path}`
 * sorted by name, `IePageUserOverride.{user_name,granter_name}`) and the
 * AppError envelope (400 invalid id, 403 unauthenticated, 404 missing override
 * via next()). Prisma + the QC cache are mocked, so these run without a
 * database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/prisma', () => {
  const db = {
    iePage: { findMany: vi.fn() },
    iePageRoleAccess: { deleteMany: vi.fn(), createMany: vi.fn() },
    iePageDepartmentAccess: { deleteMany: vi.fn(), createMany: vi.fn() },
    ieDimDepartment: { findMany: vi.fn() },
    iePageUserOverride: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn().mockResolvedValue([]),
  };
  return { default: db };
});

vi.mock('../../middleware/qcCache', () => ({ qcCacheClear: vi.fn() }));

import prisma from '../../config/prisma';
import { qcCacheClear } from '../../middleware/qcCache';
import {
  listPages,
  updatePageAccess,
  updatePageDepartmentAccess,
  listOverrides,
  createOverride,
  deleteOverride,
} from '../insightsAdminPage.controller';

const db = prisma as unknown as {
  iePage: { findMany: ReturnType<typeof vi.fn> };
  iePageRoleAccess: { deleteMany: ReturnType<typeof vi.fn>; createMany: ReturnType<typeof vi.fn> };
  iePageDepartmentAccess: { deleteMany: ReturnType<typeof vi.fn>; createMany: ReturnType<typeof vi.fn> };
  ieDimDepartment: { findMany: ReturnType<typeof vi.fn> };
  iePageUserOverride: {
    findMany: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

function mockRes() {
  const res: {
    statusCode: number;
    body: unknown;
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  } = {
    statusCode: 200,
    body: undefined,
    status: vi.fn((c: number) => {
      res.statusCode = c;
      return res;
    }),
    json: vi.fn((b: unknown) => {
      res.body = b;
      return res;
    }),
  };
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockResolvedValue([]);
});

describe('listPages', () => {
  it('flattens role/department joins and sorts departments by name', async () => {
    db.iePage.findMany.mockResolvedValue([
      {
        id: 1,
        page_key: 'qc_coaching',
        category: 'QC',
        sort_order: 1,
        role_access: [
          { page_id: 1, role_id: 2, can_access: true, data_scope: 'SELF', role: { role_name: 'qa' } },
        ],
        department_access: [
          {
            page_id: 1,
            department_key: 20,
            can_access: true,
            data_scope: 'DEPARTMENT',
            department: { department_name: 'Zeta', hierarchy_path: '/2/' },
          },
          {
            page_id: 1,
            department_key: 10,
            can_access: true,
            data_scope: 'DEPARTMENT',
            department: { department_name: 'Alpha', hierarchy_path: '/1/' },
          },
        ],
      },
    ]);
    const res = mockRes();
    const next = vi.fn();

    await listPages({} as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    const body = res.body as Array<Record<string, any>>;
    expect(body[0].page_key).toBe('qc_coaching');
    // role join flattened to role_name; nested `role` object stripped.
    expect(body[0].role_access[0]).toEqual({
      page_id: 1,
      role_id: 2,
      can_access: true,
      data_scope: 'SELF',
      role_name: 'qa',
    });
    // department join flattened AND sorted by department_name (Alpha before Zeta).
    expect(body[0].department_access.map((d: any) => d.department_name)).toEqual(['Alpha', 'Zeta']);
    expect(body[0].department_access[0].hierarchy_path).toBe('/1/');
    expect(body[0].department_access[0].department).toBeUndefined();
  });
});

describe('updatePageAccess', () => {
  it('replace-sets role grants in a transaction and clears the QC cache', async () => {
    const res = mockRes();
    const next = vi.fn();

    await updatePageAccess(
      { params: { id: '7' }, body: { roles: [{ role_id: 2, can_access: true, data_scope: 'SELF' }] } } as never,
      res as never,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(db.iePageRoleAccess.deleteMany).toHaveBeenCalledWith({ where: { page_id: 7 } });
    expect(db.iePageRoleAccess.createMany).toHaveBeenCalledTimes(1);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(qcCacheClear).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual({ success: true });
  });

  it('rejects a non-numeric page id with a 400 AppError via next()', async () => {
    const res = mockRes();
    const next = vi.fn();

    await updatePageAccess({ params: { id: 'abc' }, body: { roles: [] } } as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((next.mock.calls[0][0] as { statusCode: number }).statusCode).toBe(400);
  });
});

describe('updatePageDepartmentAccess', () => {
  it('clears grants without a createMany when departments is empty', async () => {
    const res = mockRes();
    const next = vi.fn();

    await updatePageDepartmentAccess(
      { params: { id: '3' }, body: { departments: [] } } as never,
      res as never,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(db.iePageDepartmentAccess.deleteMany).toHaveBeenCalledWith({ where: { page_id: 3 } });
    expect(db.iePageDepartmentAccess.createMany).not.toHaveBeenCalled();
    expect(qcCacheClear).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual({ success: true });
  });
});

describe('listOverrides', () => {
  it('flattens the user/granter joins into user_name/granter_name', async () => {
    db.iePageUserOverride.findMany.mockResolvedValue([
      {
        id: 5,
        page_id: 2,
        user_id: 42,
        can_access: true,
        user: { username: 'alice' },
        granter: { username: 'boss' },
      },
    ]);
    const res = mockRes();
    const next = vi.fn();

    await listOverrides({ params: { id: '2' } } as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    const body = res.body as Array<Record<string, any>>;
    expect(body[0].user_name).toBe('alice');
    expect(body[0].granter_name).toBe('boss');
    expect(body[0].user).toBeUndefined();
    expect(body[0].granter).toBeUndefined();
  });
});

describe('createOverride', () => {
  it('upserts the override and returns 201 with the compact payload', async () => {
    db.iePageUserOverride.upsert.mockResolvedValue({ id: 9 });
    const res = mockRes();
    const next = vi.fn();

    await createOverride(
      {
        params: { id: '2' },
        body: { user_id: 42, can_access: true, data_scope: 'DEPARTMENT' },
        user: { user_id: 1 },
      } as never,
      res as never,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(db.iePageUserOverride.upsert).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body).toEqual({
      id: 9,
      page_id: 2,
      user_id: 42,
      can_access: true,
      data_scope: 'DEPARTMENT',
    });
  });

  it('returns a 403 AppError via next() when the caller is not authenticated', async () => {
    const res = mockRes();
    const next = vi.fn();

    await createOverride(
      { params: { id: '2' }, body: { user_id: 42, can_access: true } } as never,
      res as never,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect((next.mock.calls[0][0] as { statusCode: number }).statusCode).toBe(403);
    expect(db.iePageUserOverride.upsert).not.toHaveBeenCalled();
  });
});

describe('deleteOverride', () => {
  it('returns a 404 AppError via next() when nothing was deleted', async () => {
    db.iePageUserOverride.deleteMany.mockResolvedValue({ count: 0 });
    const res = mockRes();
    const next = vi.fn();

    await deleteOverride({ params: { id: '2', overrideId: '99' } } as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((next.mock.calls[0][0] as { statusCode: number }).statusCode).toBe(404);
  });

  it('returns { success: true } when a row was deleted', async () => {
    db.iePageUserOverride.deleteMany.mockResolvedValue({ count: 1 });
    const res = mockRes();
    const next = vi.fn();

    await deleteOverride({ params: { id: '2', overrideId: '5' } } as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.body).toEqual({ success: true });
  });
});
