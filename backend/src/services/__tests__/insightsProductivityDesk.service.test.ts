import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query, getProductiveSecondsByEmail } = vi.hoisted(() => ({
  query: vi.fn(),
  getProductiveSecondsByEmail: vi.fn(),
}));

vi.mock('../../config/database', () => ({ default: { query }, getDatabasePool: vi.fn() }));
vi.mock('../../config/environment', () => ({ phoneDatabaseConfig: null }));
vi.mock('../desktime/DeskTimeService', () => ({ deskTimeService: { getProductiveSecondsByEmail } }));

import { deskFieldsFor, loadDeskInputs, type DeskInputs } from '../insightsProductivityDesk.service';

const inputs = (desk: Map<string, number> | null, warehouse: [string, number][] = []): DeskInputs => ({
  deskMinByEmail: desk,
  warehouseMinByGuid: new Map(warehouse),
});

describe('deskFieldsFor', () => {
  it('adds productive desk time and In Warehouse time over paid time', () => {
    const f = deskFieldsFor(inputs(new Map([['a@x.com', 300]]), [['g1', 60]]), 'a@x.com', 'g1', 480);
    expect(f).toEqual({ deskProductiveMin: 300, warehouseMin: 60, deskUtilizationPct: 75 });
  });

  it('counts zero warehouse time when the agent has no phone identity', () => {
    const f = deskFieldsFor(inputs(new Map([['a@x.com', 240]]), [['g1', 60]]), 'a@x.com', undefined, 480);
    expect(f.warehouseMin).toBe(0);
    expect(f.deskUtilizationPct).toBe(50);
  });

  it('reports unknown (null), never 0%, when DeskTime has no row for the agent', () => {
    const f = deskFieldsFor(inputs(new Map(), [['g1', 60]]), 'a@x.com', 'g1', 480);
    expect(f).toEqual({ deskProductiveMin: null, warehouseMin: 60, deskUtilizationPct: null });
  });

  it('reports unknown when DeskTime is unavailable', () => {
    expect(deskFieldsFor(inputs(null), 'a@x.com', 'g1', 480).deskUtilizationPct).toBeNull();
  });

  it('reports 0% with no paid time rather than dividing by zero', () => {
    expect(deskFieldsFor(inputs(new Map([['a@x.com', 30]])), 'a@x.com', undefined, 0).deskUtilizationPct).toBe(0);
  });
});

describe('loadDeskInputs productive source', () => {
  beforeEach(() => { query.mockReset(); getProductiveSecondsByEmail.mockReset(); });

  it('uses the stored fact rows for the day and skips the live API', async () => {
    query.mockResolvedValue([[{ email: 'a@x.com', sec: 600 }]]);
    const out = await loadDeskInputs([], '2026-09-09', '2026-09-09 00:00:00', '2026-09-10 00:00:00');
    expect(query.mock.calls[0][1]).toEqual([20260909]);
    expect(out.deskMinByEmail?.get('a@x.com')).toBe(10);
    expect(getProductiveSecondsByEmail).not.toHaveBeenCalled();
  });

  it('falls back to live DeskTime when the day is not stored yet', async () => {
    query.mockResolvedValue([[]]);
    getProductiveSecondsByEmail.mockResolvedValue(new Map([['a@x.com', 1200]]));
    const out = await loadDeskInputs([], '2026-09-24', '2026-09-24 00:00:00', '2026-09-25 00:00:00');
    expect(getProductiveSecondsByEmail).toHaveBeenCalledWith('2026-09-24');
    expect(out.deskMinByEmail?.get('a@x.com')).toBe(20);
  });
});
