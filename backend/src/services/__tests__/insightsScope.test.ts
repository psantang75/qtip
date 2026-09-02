/**
 * Unit tests for resolveDeptFilter — the shared Insights data-scoping primitive.
 *
 * The security-critical contract is that DEPARTMENT/DIVISION scope FAILS CLOSED:
 * a viewer whose resolved department set is empty (e.g. a manager with no
 * profile department and no managed departments) must see NOTHING, never every
 * department's data. ALL/SELF continue to return an empty filter (ALL = no
 * restriction, SELF = filtered by user id at the handler level).
 *
 * The pool is mocked so this runs without a database; only the
 * DEPARTMENT/DIVISION-with-keys path touches it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const execute = vi.fn();

vi.mock('../../config/database', () => ({
  default: { execute: (...args: unknown[]) => execute(...args) },
}));

import { resolveDeptFilter, NO_MATCH_DEPARTMENT_ID } from '../insightsScope';
import type { InsightsAccessResult } from '../InsightsPermissionService';

beforeEach(() => vi.clearAllMocks());

const access = (over: Partial<InsightsAccessResult>): InsightsAccessResult => ({
  canAccess: true,
  dataScope: 'ALL',
  departmentKeys: [],
  employeeKey: null,
  pageId: 1,
  ...over,
});

describe('resolveDeptFilter', () => {
  it('ALL scope with no requested departments returns an empty (unrestricted) filter', async () => {
    const result = await resolveDeptFilter(access({ dataScope: 'ALL' }));
    expect(result).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('ALL scope honours numeric requested department ids without a DB lookup', async () => {
    const result = await resolveDeptFilter(access({ dataScope: 'ALL' }), '3, 7');
    expect(result).toEqual([3, 7]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('SELF scope returns an empty filter (scoped by user id elsewhere)', async () => {
    const result = await resolveDeptFilter(access({ dataScope: 'SELF' }));
    expect(result).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('DEPARTMENT scope with no resolved departments FAILS CLOSED (impossible id)', async () => {
    const result = await resolveDeptFilter(access({ dataScope: 'DEPARTMENT', departmentKeys: [] }));
    expect(result).toEqual([NO_MATCH_DEPARTMENT_ID]);
    // No department set to map, so it must not fall through to an all-data query.
    expect(execute).not.toHaveBeenCalled();
  });

  it('DIVISION scope with no resolved departments FAILS CLOSED (impossible id)', async () => {
    const result = await resolveDeptFilter(access({ dataScope: 'DIVISION', departmentKeys: [] }));
    expect(result).toEqual([NO_MATCH_DEPARTMENT_ID]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('DEPARTMENT scope maps warehouse keys to operational department ids', async () => {
    execute.mockResolvedValue([[{ department_id: 10 }, { department_id: 11 }], []]);
    const result = await resolveDeptFilter(access({ dataScope: 'DEPARTMENT', departmentKeys: [100, 101] }));
    expect(result).toEqual([10, 11]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('DEPARTMENT scope whose keys map to zero live ids FAILS CLOSED', async () => {
    execute.mockResolvedValue([[], []]);
    const result = await resolveDeptFilter(access({ dataScope: 'DEPARTMENT', departmentKeys: [999] }));
    expect(result).toEqual([NO_MATCH_DEPARTMENT_ID]);
  });
});
