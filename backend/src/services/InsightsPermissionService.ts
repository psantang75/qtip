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
