import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import { getDescendantDepartmentKeys } from '../utils/departmentHierarchy';

export interface InsightsAccessResult {
  canAccess: boolean;
  dataScope: 'ALL' | 'DIVISION' | 'DEPARTMENT' | 'SELF' | null;
  departmentKeys: number[];
  employeeKey: number | null;
  pageId: number | null;
}

const NO_ACCESS: InsightsAccessResult = {
  canAccess: false,
  dataScope: null,
  departmentKeys: [],
  employeeKey: null,
  pageId: null,
};

export class InsightsPermissionService {
  /**
   * Resolve access for every active page in a single batch.
   *
   * Used by `getInsightsNavigation` (one nav request per page load) so the
   * old per-page loop — which fired ~4 queries per page (page lookup, role
   * grant, user override, employee scope) — collapses to a constant 4
   * queries regardless of how many pages exist. Falls back to per-page
   * `resolveAccess` semantics so any divergence here is bug-for-bug
   * identical with the single-page path.
   */
  async resolveAccessForAllPages(
    userId: number,
    roleId: number,
  ): Promise<Map<string, InsightsAccessResult>> {
    const [
      [pageRows],
      [roleRows],
      [overrideRows],
    ] = await Promise.all([
      pool.execute<RowDataPacket[]>(
        'SELECT id, page_key FROM ie_page WHERE is_active = 1',
      ),
      pool.execute<RowDataPacket[]>(
        'SELECT page_id, can_access, data_scope FROM ie_page_role_access WHERE role_id = ?',
        [roleId],
      ),
      pool.execute<RowDataPacket[]>(
        `SELECT page_id, can_access, data_scope
         FROM ie_page_user_override
         WHERE user_id = ?
           AND (expires_at IS NULL OR expires_at > NOW())`,
        [userId],
      ),
    ]);

    type Grant = { canAccess: boolean; dataScope: string | null };
    const roleGrants = new Map<number, Grant>();
    for (const r of roleRows) {
      roleGrants.set(r.page_id as number, {
        canAccess: !!r.can_access,
        dataScope: (r.data_scope ?? null) as string | null,
      });
    }
    const overrideGrants = new Map<number, Grant>();
    for (const r of overrideRows) {
      overrideGrants.set(r.page_id as number, {
        canAccess: !!r.can_access,
        dataScope: (r.data_scope ?? null) as string | null,
      });
    }

    // Decide which pages are accessible BEFORE doing any per-scope work, and
    // collect the distinct scopes we need to materialize.
    const decisions = new Map<string, { pageId: number; scope: 'ALL' | 'DIVISION' | 'DEPARTMENT' | 'SELF' }>();
    const result = new Map<string, InsightsAccessResult>();
    let needsEmployee = false;

    for (const p of pageRows) {
      const pageId = p.id as number;
      const pageKey = p.page_key as string;
      const override = overrideGrants.get(pageId);
      const role = roleGrants.get(pageId);

      let canAccess = false;
      let dataScope: string | null = null;
      if (override) {
        canAccess = override.canAccess;
        dataScope = override.dataScope;
      }
      if (!override || dataScope === null) {
        if (!role && !override) {
          result.set(pageKey, { ...NO_ACCESS, pageId });
          continue;
        }
        if (!override && role) canAccess = role.canAccess;
        if (dataScope === null && role) dataScope = role.dataScope;
      }
      if (!canAccess || !dataScope) {
        result.set(pageKey, { ...NO_ACCESS, pageId });
        continue;
      }
      const scope = dataScope as 'ALL' | 'DIVISION' | 'DEPARTMENT' | 'SELF';
      if (scope !== 'ALL') needsEmployee = true;
      decisions.set(pageKey, { pageId, scope });
    }

    // Materialize the employee row + descendant departments once, then fan
    // them out to the per-page results.
    let employeeKey: number | null = null;
    let deptKey: number | null = null;
    let divisionKeys: number[] | null = null;
    if (needsEmployee) {
      const [empRows] = await pool.execute<RowDataPacket[]>(
        'SELECT employee_key, department_key FROM ie_dim_employee WHERE user_id = ? AND is_current = 1',
        [userId],
      );
      employeeKey = empRows.length > 0 ? (empRows[0].employee_key as number) : null;
      deptKey = empRows.length > 0 ? (empRows[0].department_key as number | null) : null;
    }

    for (const [pageKey, { pageId, scope }] of decisions) {
      if (scope === 'ALL') {
        result.set(pageKey, { canAccess: true, dataScope: 'ALL', departmentKeys: [], employeeKey: null, pageId });
        continue;
      }
      if (scope === 'SELF') {
        result.set(pageKey, { canAccess: true, dataScope: 'SELF', departmentKeys: [], employeeKey, pageId });
        continue;
      }
      if (scope === 'DEPARTMENT') {
        result.set(pageKey, {
          canAccess: true,
          dataScope: 'DEPARTMENT',
          departmentKeys: deptKey != null ? [deptKey] : [],
          employeeKey: null,
          pageId,
        });
        continue;
      }
      // DIVISION — descendant lookup is one query per dept root, but every
      // DIVISION-scoped page for the same user resolves to the same set, so
      // we fetch it once and reuse.
      if (deptKey == null) {
        result.set(pageKey, { canAccess: true, dataScope: 'DIVISION', departmentKeys: [], employeeKey: null, pageId });
        continue;
      }
      if (divisionKeys === null) divisionKeys = await getDescendantDepartmentKeys(deptKey);
      result.set(pageKey, {
        canAccess: true,
        dataScope: 'DIVISION',
        departmentKeys: divisionKeys,
        employeeKey: null,
        pageId,
      });
    }
    return result;
  }

  async resolveAccess(
    userId: number,
    roleId: number,
    pageKey: string
  ): Promise<InsightsAccessResult> {
    const [pageRows] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM ie_page WHERE page_key = ? AND is_active = 1',
      [pageKey]
    );

    if (pageRows.length === 0) return NO_ACCESS;
    const pageId = pageRows[0].id as number;

    let canAccess = false;
    let dataScope: string | null = null;

    const [overrideRows] = await pool.execute<RowDataPacket[]>(
      `SELECT can_access, data_scope FROM ie_page_user_override
       WHERE page_id = ? AND user_id = ?
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [pageId, userId]
    );

    if (overrideRows.length > 0) {
      canAccess = !!overrideRows[0].can_access;
      dataScope = overrideRows[0].data_scope ?? null;
    }

    if (overrideRows.length === 0 || dataScope === null) {
      const [roleRows] = await pool.execute<RowDataPacket[]>(
        `SELECT can_access, data_scope FROM ie_page_role_access
         WHERE page_id = ? AND role_id = ?`,
        [pageId, roleId]
      );

      if (roleRows.length === 0 && overrideRows.length === 0) return { ...NO_ACCESS, pageId };

      if (overrideRows.length === 0) {
        canAccess = !!roleRows[0].can_access;
      }
      if (dataScope === null && roleRows.length > 0) {
        dataScope = roleRows[0].data_scope;
      }
    }

    if (!canAccess) return { ...NO_ACCESS, pageId };

    if (!dataScope) return { ...NO_ACCESS, pageId };
    const scope = dataScope as 'ALL' | 'DIVISION' | 'DEPARTMENT' | 'SELF';
    return this.resolveScope(userId, scope, pageId);
  }

  private async resolveScope(
    userId: number,
    scope: 'ALL' | 'DIVISION' | 'DEPARTMENT' | 'SELF',
    pageId: number
  ): Promise<InsightsAccessResult> {
    if (scope === 'ALL') {
      return { canAccess: true, dataScope: 'ALL', departmentKeys: [], employeeKey: null, pageId };
    }

    const [empRows] = await pool.execute<RowDataPacket[]>(
      'SELECT employee_key, department_key FROM ie_dim_employee WHERE user_id = ? AND is_current = 1',
      [userId]
    );

    const employeeKey = empRows.length > 0 ? (empRows[0].employee_key as number) : null;
    const deptKey = empRows.length > 0 ? (empRows[0].department_key as number | null) : null;

    if (scope === 'SELF') {
      return { canAccess: true, dataScope: 'SELF', departmentKeys: [], employeeKey, pageId };
    }

    if (scope === 'DEPARTMENT') {
      return {
        canAccess: true,
        dataScope: 'DEPARTMENT',
        departmentKeys: deptKey != null ? [deptKey] : [],
        employeeKey: null,
        pageId,
      };
    }

    if (scope === 'DIVISION') {
      if (deptKey == null) {
        return { canAccess: true, dataScope: 'DIVISION', departmentKeys: [], employeeKey: null, pageId };
      }
      const keys = await getDescendantDepartmentKeys(deptKey);
      return { canAccess: true, dataScope: 'DIVISION', departmentKeys: keys, employeeKey: null, pageId };
    }

    return NO_ACCESS;
  }
}
