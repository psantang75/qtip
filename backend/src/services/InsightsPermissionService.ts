import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import { getDescendantDepartmentKeys, getAncestorDepartmentKeys } from '../utils/departmentHierarchy';

export interface InsightsAccessResult {
  canAccess: boolean;
  dataScope: 'ALL' | 'DIVISION' | 'DEPARTMENT' | 'SELF' | null;
  departmentKeys: number[];
  employeeKey: number | null;
  pageId: number | null;
}

type Scope = 'ALL' | 'DIVISION' | 'DEPARTMENT' | 'SELF';

// Admin (role 1) bypasses the department gate entirely and can reach every
// active page. See the layered-funnel resolution in resolveAccess below.
const ADMIN_ROLE_ID = 1;

const NO_ACCESS: InsightsAccessResult = {
  canAccess: false,
  dataScope: null,
  departmentKeys: [],
  employeeKey: null,
  pageId: null,
};

export class InsightsPermissionService {
  /**
   * The viewing user's own department_key plus all of its ancestors. A
   * department-level page grant on department `G` applies to this user when
   * `G` is in this set — i.e. a grant on a parent department cascades down to
   * every descendant. Empty when the user has no conformed (current) employee
   * row or no department.
   */
  private async userDeptAncestorSet(userId: number): Promise<Set<number>> {
    const [empRows] = await pool.execute<RowDataPacket[]>(
      'SELECT department_key FROM ie_dim_employee WHERE user_id = ? AND is_current = 1',
      [userId],
    );
    const deptKey = empRows.length > 0 ? (empRows[0].department_key as number | null) : null;
    if (deptKey == null) return new Set();
    return new Set(await getAncestorDepartmentKeys(deptKey));
  }

  /**
   * Resolve access for every active page in a single batch.
   *
   * Used by `getInsightsNavigation` (one nav request per page load) so the
   * old per-page loop — which fired ~4 queries per page (page lookup, role
   * grant, user override, employee scope) — collapses to a constant number of
   * queries regardless of how many pages exist. Falls back to per-page
   * `resolveAccess` semantics so any divergence here is bug-for-bug
   * identical with the single-page path.
   *
   * Access is a layered funnel (see resolveAccess for the canonical order):
   * a non-expired user override wins outright; Admin (role 1) bypasses the
   * department gate; otherwise the DEPARTMENT gate (opt-in — only engages when
   * the page has any department grant) must pass, and then the ROLE grant
   * decides access and the data scope.
   */
  async resolveAccessForAllPages(
    userId: number,
    roleId: number,
  ): Promise<Map<string, InsightsAccessResult>> {
    const [
      [pageRows],
      [roleRows],
      [overrideRows],
      [deptRows],
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
      pool.execute<RowDataPacket[]>(
        'SELECT page_id, department_key, can_access, data_scope FROM ie_page_department_access',
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
    type DeptGrant = { departmentKey: number; canAccess: boolean; dataScope: string | null };
    const deptGrantsByPage = new Map<number, DeptGrant[]>();
    for (const r of deptRows) {
      const pid = r.page_id as number;
      if (!deptGrantsByPage.has(pid)) deptGrantsByPage.set(pid, []);
      deptGrantsByPage.get(pid)!.push({
        departmentKey: r.department_key as number,
        canAccess: !!r.can_access,
        dataScope: (r.data_scope ?? null) as string | null,
      });
    }

    // The user's own department + ancestors is needed only to evaluate the
    // department gate — i.e. for non-Admin users when department grants exist
    // at all. Admin bypasses the gate, so skip the lookup entirely for them.
    const userDeptSet = (roleId !== ADMIN_ROLE_ID && deptRows.length > 0)
      ? await this.userDeptAncestorSet(userId)
      : new Set<number>();

    // Decide which pages are accessible BEFORE doing any per-scope work, and
    // collect the distinct scopes we need to materialize.
    const decisions = new Map<string, { pageId: number; scope: Scope }>();
    const result = new Map<string, InsightsAccessResult>();
    let needsEmployee = false;

    for (const p of pageRows) {
      const pageId = p.id as number;
      const pageKey = p.page_key as string;
      const override = overrideGrants.get(pageId);
      const role = roleGrants.get(pageId);
      const deptGrants = deptGrantsByPage.get(pageId) ?? [];

      let dataScope: string | null;

      if (override) {
        // 1. Override — the final word, either way.
        if (!override.canAccess) { result.set(pageKey, { ...NO_ACCESS, pageId }); continue; }
        dataScope = override.dataScope ?? role?.dataScope ?? 'ALL';
      } else if (roleId === ADMIN_ROLE_ID) {
        // 2. Admin bypass — reaches every page; scope from its role grant if any.
        dataScope = (role?.canAccess && role.dataScope) ? role.dataScope : 'ALL';
      } else {
        // 3. Department gate (opt-in): only engages when the page has department
        //    grants. When it does, the user's dept (or an ancestor) must match.
        const allowingDeptGrants = deptGrants.filter(g => g.canAccess);
        if (allowingDeptGrants.length > 0) {
          const inAllowedDept = allowingDeptGrants.some(g => userDeptSet.has(g.departmentKey));
          if (!inAllowedDept) { result.set(pageKey, { ...NO_ACCESS, pageId }); continue; }
        }
        // 4. Role grant decides access + the data scope.
        if (!role || !role.canAccess || !role.dataScope) { result.set(pageKey, { ...NO_ACCESS, pageId }); continue; }
        dataScope = role.dataScope;
      }

      if (!dataScope) { result.set(pageKey, { ...NO_ACCESS, pageId }); continue; }
      const scope = dataScope as Scope;
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

  /**
   * The set of department keys a page's data covers, defined by its department
   * grants (`ie_page_department_access`, can_access = 1) and expanded to include
   * each granted department's descendants — a grant on a parent covers the whole
   * subtree, mirroring the department gate's ancestor cascade. Empty when the
   * page has no department grants (population is then left to the caller's own
   * defaults). This is a report-population definition, distinct from the
   * per-viewer data scope in `resolveAccess`.
   */
  async getPageDepartmentScope(pageKey: string): Promise<number[]> {
    const [pageRows] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM ie_page WHERE page_key = ? AND is_active = 1',
      [pageKey],
    );
    if (pageRows.length === 0) return [];
    const [deptRows] = await pool.execute<RowDataPacket[]>(
      'SELECT department_key FROM ie_page_department_access WHERE page_id = ? AND can_access = 1',
      [pageRows[0].id as number],
    );
    if (deptRows.length === 0) return [];
    const keys = new Set<number>();
    for (const r of deptRows) {
      const root = r.department_key as number;
      keys.add(root);
      for (const k of await getDescendantDepartmentKeys(root)) keys.add(k);
    }
    return [...keys];
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

    const [overrideRows] = await pool.execute<RowDataPacket[]>(
      `SELECT can_access, data_scope FROM ie_page_user_override
       WHERE page_id = ? AND user_id = ?
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [pageId, userId]
    );

    const [roleRows] = await pool.execute<RowDataPacket[]>(
      `SELECT can_access, data_scope FROM ie_page_role_access
       WHERE page_id = ? AND role_id = ?`,
      [pageId, roleId]
    );

    const [deptRows] = await pool.execute<RowDataPacket[]>(
      `SELECT department_key, can_access, data_scope FROM ie_page_department_access
       WHERE page_id = ?`,
      [pageId]
    );

    const override = overrideRows.length > 0
      ? { canAccess: !!overrideRows[0].can_access, dataScope: (overrideRows[0].data_scope ?? null) as string | null }
      : null;
    const role = roleRows.length > 0
      ? { canAccess: !!roleRows[0].can_access, dataScope: (roleRows[0].data_scope ?? null) as string | null }
      : null;

    // Layered funnel — evaluated in strict precedence:
    let dataScope: string | null;

    if (override) {
      // 1. Override — the final word, grant or deny.
      if (!override.canAccess) return { ...NO_ACCESS, pageId };
      dataScope = override.dataScope ?? role?.dataScope ?? 'ALL';
    } else if (roleId === ADMIN_ROLE_ID) {
      // 2. Admin bypass — reaches every page; scope from its role grant if any.
      dataScope = (role?.canAccess && role.dataScope) ? role.dataScope : 'ALL';
    } else {
      // 3. Department gate (opt-in): engages only when the page has department
      //    grants. When it does, the user's department (or an ancestor of it)
      //    must be in the allowed set, otherwise access is denied.
      const allowingDeptGrants = deptRows.filter(r => !!r.can_access);
      if (allowingDeptGrants.length > 0) {
        const userDeptSet = await this.userDeptAncestorSet(userId);
        const inAllowedDept = allowingDeptGrants.some(r => userDeptSet.has(r.department_key as number));
        if (!inAllowedDept) return { ...NO_ACCESS, pageId };
      }
      // 4. Role grant decides access + the data scope.
      if (!role || !role.canAccess || !role.dataScope) return { ...NO_ACCESS, pageId };
      dataScope = role.dataScope;
    }

    if (!dataScope) return { ...NO_ACCESS, pageId };
    return this.resolveScope(userId, dataScope as Scope, pageId);
  }

  private async resolveScope(
    userId: number,
    scope: Scope,
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
