/**
 * Controller/HTTP-layer tests for the Insights Admin KPI controller.
 *
 * This is the pilot for the "add controller tests" cleanup item and guards the
 * Prisma migration of this controller: the response-shape contract the frontend
 * depends on (threshold_count mapping, YYYY-MM-DD threshold dates, the
 * is_current-gated department_name join) and the AppError envelope (404/400 via
 * next()). Prisma is mocked, so these run without a database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/prisma', () => {
  const db = {
    ieKpi: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    ieKpiThreshold: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
  return { default: db };
});

import prisma from '../../config/prisma';
import {
  listKpis,
  getThresholds,
  setThreshold,
  deleteThreshold,
} from '../insightsAdminKpi.controller';

const db = prisma as unknown as {
  ieKpi: { findMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  ieKpiThreshold: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
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
});

describe('listKpis', () => {
  it('maps the threshold _count into a flat threshold_count field', async () => {
    db.ieKpi.findMany.mockResolvedValue([
      { id: 1, kpi_code: 'aht', is_active: true, _count: { thresholds: 3 } },
    ]);
    const res = mockRes();
    const next = vi.fn();

    await listKpis({} as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith([
      { id: 1, kpi_code: 'aht', is_active: true, threshold_count: 3 },
    ]);
  });
});

describe('getThresholds', () => {
  it('formats dates as YYYY-MM-DD and gates department_name on is_current', async () => {
    db.ieKpiThreshold.findMany.mockResolvedValue([
      {
        id: 5,
        kpi_id: 2,
        department_key: null,
        goal_value: '90.00',
        warning_value: null,
        critical_value: null,
        effective_from: new Date('2026-01-15T00:00:00.000Z'),
        effective_to: null,
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
        department: null,
      },
      {
        id: 6,
        kpi_id: 2,
        department_key: 10,
        goal_value: '80.00',
        warning_value: null,
        critical_value: null,
        effective_from: new Date('2026-02-20T00:00:00.000Z'),
        effective_to: new Date('2026-03-01T00:00:00.000Z'),
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
        department: { department_name: 'Sales', is_current: true },
      },
      {
        id: 7,
        kpi_id: 2,
        department_key: 11,
        goal_value: null,
        warning_value: null,
        critical_value: null,
        effective_from: new Date('2026-02-20T00:00:00.000Z'),
        effective_to: null,
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
        department: { department_name: 'Stale', is_current: false },
      },
    ]);
    const res = mockRes();
    const next = vi.fn();

    await getThresholds({ params: { id: '2' } } as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    const body = res.body as Array<Record<string, unknown>>;
    expect(body[0].effective_from).toBe('2026-01-15');
    expect(body[0].effective_to).toBeNull();
    expect(body[0].department_name).toBeNull();
    expect(body[1].effective_from).toBe('2026-02-20');
    expect(body[1].effective_to).toBe('2026-03-01');
    expect(body[1].department_name).toBe('Sales');
    // is_current === false must present as Global (null), matching the legacy join.
    expect(body[2].department_name).toBeNull();
  });

  it('rejects a non-numeric id with a 400 AppError via next()', async () => {
    const res = mockRes();
    const next = vi.fn();

    await getThresholds({ params: { id: 'abc' } } as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((next.mock.calls[0][0] as { statusCode: number }).statusCode).toBe(400);
  });
});

describe('setThreshold', () => {
  it('creates a new threshold when none exists and returns a 201 with a formatted date', async () => {
    db.ieKpiThreshold.findFirst.mockResolvedValue(null);
    db.ieKpiThreshold.create.mockResolvedValue({
      id: 9,
      kpi_id: 2,
      department_key: null,
      goal_value: '90.00',
      warning_value: null,
      critical_value: null,
      effective_from: new Date('2026-02-01T00:00:00.000Z'),
      effective_to: null,
    });
    const res = mockRes();
    const next = vi.fn();

    await setThreshold(
      { params: { id: '2' }, body: { effective_from: '2026-02-01', goal_value: 90 }, user: { user_id: 1 } } as never,
      res as never,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect((res.body as { effective_from: string }).effective_from).toBe('2026-02-01');
    expect(db.ieKpiThreshold.create).toHaveBeenCalledTimes(1);
  });
});

describe('deleteThreshold', () => {
  it('returns a 404 AppError via next() when nothing was deleted', async () => {
    db.ieKpiThreshold.deleteMany.mockResolvedValue({ count: 0 });
    const res = mockRes();
    const next = vi.fn();

    await deleteThreshold({ params: { id: '2', thresholdId: '99' } } as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((next.mock.calls[0][0] as { statusCode: number }).statusCode).toBe(404);
  });
});
