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

const NO_ACCESS: InsightsAccessResult = {
  canAccess: false,
  dataScope: null,
  departmentKeys: [],
  employeeKey: null,
  pageId: null,
};

// Higher = broader. When a user qualifies for a page through more than one grant
// (e.g. a role grant AND a department grant), they get the most permissive scope
// — restricting below a scope they were explicitly granted would contradict it.
const SCOPE_RANK: Record<Scope, number> = { ALL: 4, DIVISION: 3, DEPARTMENT: 2, SELF: 1 };

function pickBroadestScope(scopes: (string | null | undefined)[]): Scope | null {
  let best: Scope | null = null;
  let bestRank = 0;
  for (const s of scopes) {
    if (!s) continue;
    const rank = SCOPE_RANK[s as Scope] ?? 0;
    if (rank > bestRank) { bestRank = rank; best = s as Scope; }
  }
  return best;
}

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
   * Access is additive: a page is accessible when the user's ROLE grant OR any
   * matching DEPARTMENT grant (on their department or an ancestor) allows it.
   * A non-expired user override still takes absolute precedence.
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

    // The user's own department + ancestors is needed only when department
    // grants exist at all. Resolve it once and reuse across every page.
    const userDeptSet = deptRows.length > 0 ? await this.userDeptAncestorSet(userId) : new Set<number>();

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

      // Department grants that allow access AND apply to this user (the grant's
      // department is the user's own or an ancestor of it).
      const applicableDeptScopes = deptGrants
        .filter(g => g.canAccess && userDeptSet.has(g.departmentKey))
        .map(g => g.dataScope);

      let canAccess: boolean;
      let dataScope: string | null;

      if (override) {
        canAccess = override.canAccess;
        if (!canAccess) { result.set(pageKey, { ...NO_ACCESS, pageId }); continue; }
        // Override grants access; scope from the override, else the role grant,
        // else the broadest applicable department grant.
        dataScope = override.dataScope ?? role?.dataScope ?? pickBroadestScope(applicableDeptScopes);
      } else {
        const roleAllows = role ? role.canAccess : false;
        const deptAllows = applicableDeptScopes.length > 0;
        canAccess = roleAllows || deptAllows;
        if (!canAccess) { result.set(pageKey, { ...NO_ACCESS, pageId }); continue; }
        const scopes: (string | null)[] = [];
        if (roleAllows) scopes.push(role!.dataScope);
        scopes.push(...applicableDeptScopes);
        dataScope = pickBroadestScope(scopes);
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

    // Department grants that allow access; narrowed to those applying to this
    // user (their department or an ancestor) only if any allow at all.
    let applicableDeptScopes: (string | null)[] = [];
    const allowingDeptGrants = deptRows.filter(r => !!r.can_access);
    if (allowingDeptGrants.length > 0) {
      const userDeptSet = await this.userDeptAncestorSet(userId);
      applicableDeptScopes = allowingDeptGrants
        .filter(r => userDeptSet.has(r.department_key as number))
        .map(r => (r.data_scope ?? null) as string | null);
    }

    const override = overrideRows.length > 0
      ? { canAccess: !!overrideRows[0].can_access, dataScope: (overrideRows[0].data_scope ?? null) as string | null }
      : null;
    const role = roleRows.length > 0
      ? { canAccess: !!roleRows[0].can_access, dataScope: (roleRows[0].data_scope ?? null) as string | null }
      : null;

    let canAccess: boolean;
    let dataScope: string | null;

    if (override) {
      canAccess = override.canAccess;
      if (!canAccess) return { ...NO_ACCESS, pageId };
      dataScope = override.dataScope ?? role?.dataScope ?? pickBroadestScope(applicableDeptScopes);
    } else {
      const roleAllows = role ? role.canAccess : false;
      const deptAllows = applicableDeptScopes.length > 0;
      canAccess = roleAllows || deptAllows;
      if (!canAccess) return { ...NO_ACCESS, pageId };
      const scopes: (string | null)[] = [];
      if (roleAllows) scopes.push(role!.dataScope);
      scopes.push(...applicableDeptScopes);
      dataScope = pickBroadestScope(scopes);
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
