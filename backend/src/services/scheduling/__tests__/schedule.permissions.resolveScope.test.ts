/**
 * resolveScope must not treat Trainer/QA (or any non-Manager) with viewAll as
 * a manager of zero departments — that emptied campaign schedule lists in prod.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../config/prisma', () => ({ default: {} }));
vi.mock('../../manager/manager.access', () => ({
  getManagedDepartmentIds: vi.fn(),
}));

import { getManagedDepartmentIds } from '../../manager/manager.access';
import { resolveScope } from '../schedule.permissions';
import type { AuthReq } from '../schedule.types';

const managedMock = getManagedDepartmentIds as unknown as ReturnType<typeof vi.fn>;

function req(role: string, canViewAll: boolean): AuthReq {
  return {
    user: { user_id: 42, role },
    pageAccess: {
      pageKey: 'sched_campaigns',
      level: canViewAll ? 'ALL' : 'OWN',
      canView: true,
      canViewAll,
      canEdit: false,
    },
  } as AuthReq;
}

describe('resolveScope', () => {
  beforeEach(() => {
    managedMock.mockReset();
  });

  it('self-scopes when the page grant is view-only', async () => {
    const scope = await resolveScope(req('Trainer', false));
    expect(scope).toEqual({ viewerId: 42, canViewAll: false, departmentIds: null, isAdmin: false });
    expect(managedMock).not.toHaveBeenCalled();
  });

  it('leaves Admin unrestricted', async () => {
    const scope = await resolveScope(req('Admin', true));
    expect(scope.canViewAll).toBe(true);
    expect(scope.departmentIds).toBeNull();
    expect(scope.isAdmin).toBe(true);
    expect(managedMock).not.toHaveBeenCalled();
  });

  it('leaves Director unrestricted', async () => {
    const scope = await resolveScope(req('Director', true));
    expect(scope).toEqual({ viewerId: 42, canViewAll: true, departmentIds: null, isAdmin: false });
    expect(managedMock).not.toHaveBeenCalled();
  });

  it('scopes Managers to managed departments', async () => {
    managedMock.mockResolvedValue([3, 7]);
    const scope = await resolveScope(req('Manager', true));
    expect(scope).toEqual({ viewerId: 42, canViewAll: true, departmentIds: [3, 7], isAdmin: false });
    expect(managedMock).toHaveBeenCalledWith(42);
  });

  it('does not empty Trainer viewAll via department_managers', async () => {
    const scope = await resolveScope(req('Trainer', true));
    expect(scope).toEqual({ viewerId: 42, canViewAll: true, departmentIds: null, isAdmin: false });
    expect(managedMock).not.toHaveBeenCalled();
  });

  it('does not empty QA viewAll via department_managers', async () => {
    const scope = await resolveScope(req('QA', true));
    expect(scope).toEqual({ viewerId: 42, canViewAll: true, departmentIds: null, isAdmin: false });
    expect(managedMock).not.toHaveBeenCalled();
  });
});
