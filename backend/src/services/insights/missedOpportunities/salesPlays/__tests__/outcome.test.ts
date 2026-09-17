/**
 * Outcome labeler tests. The miner must only learn from calls with a known
 * result, and WON must win ties (a number that eventually ordered is a win even
 * if an earlier sibling lead was marked lost). Anything unresolvable is UNKNOWN
 * so the miner simply skips it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { executeQuery, getFarEndNumbers, resolveContactIds } = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  getFarEndNumbers: vi.fn(),
  resolveContactIds: vi.fn(),
}));

vi.mock('../../../../../utils/databaseUtils', () => ({ executeQuery }));
vi.mock('../../crmLink', () => ({ getFarEndNumbers, resolveContactIds }));

import { labelCallOutcome } from '../outcome';

/** Route executeQuery by which table the SQL touches. */
function stubCrm({ leads, order, lost }: { leads: number[]; order: boolean; lost: boolean }) {
  executeQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('tblCustomerLead')) return leads.map((CustomerLeadID) => ({ CustomerLeadID }));
    if (sql.includes('tblOrders')) return order ? [{ n: 1 }] : [];
    if (sql.includes('tblTask')) return lost ? [{ n: 1 }] : [];
    return [];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getFarEndNumbers.mockResolvedValue(['3145551212']);
  resolveContactIds.mockResolvedValue([101]);
});

describe('labelCallOutcome', () => {
  it('returns UNKNOWN when the call has no far-end number', async () => {
    getFarEndNumbers.mockResolvedValue([]);
    expect(await labelCallOutcome('conv')).toBe('UNKNOWN');
  });

  it('returns UNKNOWN when no contact matches the number', async () => {
    resolveContactIds.mockResolvedValue([]);
    expect(await labelCallOutcome('conv')).toBe('UNKNOWN');
  });

  it('returns UNKNOWN when the contact has no leads', async () => {
    stubCrm({ leads: [], order: false, lost: false });
    expect(await labelCallOutcome('conv')).toBe('UNKNOWN');
  });

  it('labels WON when the lead produced an order', async () => {
    stubCrm({ leads: [55], order: true, lost: false });
    expect(await labelCallOutcome('conv')).toBe('WON');
  });

  it('labels LOST when a lead-task carries a Lost status and there is no order', async () => {
    stubCrm({ leads: [55], order: false, lost: true });
    expect(await labelCallOutcome('conv')).toBe('LOST');
  });

  it('prefers WON over LOST when both are present', async () => {
    stubCrm({ leads: [55, 56], order: true, lost: true });
    expect(await labelCallOutcome('conv')).toBe('WON');
  });

  it('returns UNKNOWN when the lead is neither ordered nor lost', async () => {
    stubCrm({ leads: [55], order: false, lost: false });
    expect(await labelCallOutcome('conv')).toBe('UNKNOWN');
  });
});
