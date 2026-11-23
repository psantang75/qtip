import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../../config/database', () => ({ getDatabasePool: () => ({ query }) }));
vi.mock('../../config/environment', () => ({ phoneDatabaseConfig: { host: 'phone' } }));

import { AFTER_CALL_STATUSES, loadPresenceSeconds } from '../insightsPhonePresence';

const DAY = ['2026-11-23 00:00:00', '2026-11-23 23:59:59'] as const;

describe('AFTER_CALL_STATUSES', () => {
  it('is exactly the after-call statuses, never the Genesys wrap-up', () => {
    expect([...AFTER_CALL_STATUSES]).toEqual(['Wrap Pending', 'Follow-Up Extended']);
  });
});

describe('loadPresenceSeconds', () => {
  beforeEach(() => query.mockReset());

  it('matches statuses by label and returns seconds per agent', async () => {
    query.mockResolvedValue([[{ guid: 'g1', sec: '630' }, { guid: 'g2', sec: null }]]);
    const out = await loadPresenceSeconds(['g1', 'g2'], AFTER_CALL_STATUSES, ...DAY);

    expect(out).toEqual(new Map([['g1', 630], ['g2', 0]]));
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('sp.LabelName IN (?,?)');
    expect(sql).not.toMatch(/OrgPresenceID\s*=\s*'/);
    expect(params).toEqual(['g1', 'g2', 'Wrap Pending', 'Follow-Up Extended', ...DAY]);
  });

  it('skips the query when there is nobody or nothing to look up', async () => {
    expect(await loadPresenceSeconds([], AFTER_CALL_STATUSES, ...DAY)).toEqual(new Map());
    expect(await loadPresenceSeconds(['g1'], [], ...DAY)).toEqual(new Map());
    expect(query).not.toHaveBeenCalled();
  });
});
