import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../config/environment', () => ({
  desktimeConfig: { apiKey: 'secret-key', baseUrl: 'https://desktime.test/api/v2/json', timeoutMs: 1000, maxRetries: 1 },
}));
vi.mock('../../../config/logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { deskTimeService, flattenEmployees, productiveByEmail } from '../DeskTimeService';

const body = (date: string) => ({
  employees: {
    [date]: {
      '1': {
        id: 1, name: 'Andy', email: ' Andy@Example.com ', group: 'CS', arrived: '2026-09-23 08:01:12',
        left: '2026-09-23 16:30:00', late: true, onlineTime: 30000, desktimeTime: 28000, atWorkTime: 30500,
        productiveTime: 4213, productivity: 81.5, efficiency: '12.25',
      },
      '2': { id: 2, email: 'idle@example.com', arrived: false, left: false, productiveTime: 0 },
      '3': { id: 3, email: null, productiveTime: 900 },
    },
  },
});

const okResponse = (json: unknown) => ({ ok: true, status: 200, statusText: 'OK', json: async () => json }) as Response;

describe('flattenEmployees', () => {
  it('maps every field, lowercases the email and keeps zero-activity employees', () => {
    const out = flattenEmployees(body('2026-09-23'));
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      date: '2026-09-23', employeeId: 1, email: 'andy@example.com', name: 'Andy', group: 'CS',
      arrivedAt: '2026-09-23 08:01:12', leftAt: '2026-09-23 16:30:00', isLate: true,
      onlineSec: 30000, desktimeSec: 28000, atWorkSec: 30500, productiveSec: 4213,
      productivityPct: 81.5, efficiencyPct: 12.25,
    });
    expect(out[1]).toMatchObject({ email: 'idle@example.com', arrivedAt: null, leftAt: null, productiveSec: 0, isLate: false });
  });

  it('flattens a month payload with array buckets across several dates', () => {
    const out = flattenEmployees({
      employees: {
        '2026-09-01': [{ id: 7, email: 'a@x.com', productiveTime: '60' }],
        '2026-09-02': { '7': { id: 7, email: 'a@x.com', productiveTime: 120 } },
      },
    });
    expect(out.map((r) => [r.date, r.productiveSec])).toEqual([['2026-09-01', 60], ['2026-09-02', 120]]);
  });

  it('returns nothing for an empty payload', () => {
    expect(flattenEmployees({})).toEqual([]);
  });
});

describe('productiveByEmail', () => {
  it('keeps only the requested date', () => {
    const recs = flattenEmployees({
      employees: {
        '2026-09-01': [{ id: 7, email: 'a@x.com', productiveTime: 60 }],
        '2026-09-02': [{ id: 7, email: 'a@x.com', productiveTime: 120 }],
      },
    });
    expect([...productiveByEmail(recs, '2026-09-02')]).toEqual([['a@x.com', 120]]);
  });
});

describe('deskTimeService.getEmployeeDays', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it('requests a month and throws (rather than returning null) on failure', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(body('2026-09-23')));
    await deskTimeService.getEmployeeDays('2026-09-01', 'month');
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('period')).toBe('month');

    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, statusText: 'Forbidden' } as Response);
    await expect(deskTimeService.getEmployeeDays('2026-09-01', 'month')).rejects.toThrow('DeskTime 403');
  });
});

describe('deskTimeService.getProductiveSecondsByEmail', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    deskTimeService.clearCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('requests the day with the api key and caches the result', async () => {
    fetchMock.mockResolvedValue(okResponse(body('2026-09-23')));
    const first = await deskTimeService.getProductiveSecondsByEmail('2026-09-23');
    const second = await deskTimeService.getProductiveSecondsByEmail('2026-09-23');

    expect(first?.get('andy@example.com')).toBe(4213);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/v2/json/employees');
    expect(url.searchParams.get('apiKey')).toBe('secret-key');
    expect(url.searchParams.get('date')).toBe('2026-09-23');
    expect(url.searchParams.get('period')).toBe('day');
  });

  it('returns null on a non-retryable error instead of throwing', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' } as Response);
    await expect(deskTimeService.getProductiveSecondsByEmail('2026-09-21')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx once, then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Unavailable' } as Response)
      .mockResolvedValueOnce(okResponse(body('2026-09-20')));
    const out = await deskTimeService.getProductiveSecondsByEmail('2026-09-20');
    expect(out?.get('andy@example.com')).toBe(4213);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
