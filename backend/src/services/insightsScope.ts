/**
 * insightsScope — the data-scoping primitives every Insights report shares.
 *
 * `resolveDeptFilter` used to be module-private inside insightsQC.controller.ts.
 * A second consumer (CSR Attendance) would have meant a second copy, and two
 * copies of a permission rule drift — so it lives here and the QC controller
 * imports it.
 *
 * `deptClause` is re-exported rather than relocated: eight modules already
 * import it from qcQueryHelpers, and rewriting all of them to gain nothing but a
 * new path is churn. New Insights code should import both from here.
 *
 * DEPARTMENT/DIVISION scope is driven by the department set the permission
 * service already resolved (`access.departmentKeys`): the viewer's profile
 * department PLUS every department they manage on the Departments tab
 * (`department_managers`), expanded to descendants for DIVISION. A manager whose
 * users.department_id is NULL is therefore scoped to the departments assigned to
 * them rather than resolving to an empty (fail-open) filter. See
 * InsightsPermissionService.userBaseDepartmentKeys for how the set is built.
 */
import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import type { InsightsAccessResult } from './InsightsPermissionService';

export { deptClause } from './qcQueryHelpers';
export type { SqlFragment } from './qcQueryHelpers';

/**
 * The department ids a viewer's query must be restricted to. An EMPTY array means
 * "no department restriction" — callers pass it to deptClause, which then emits
 * no SQL. SELF scope also returns empty, because it is filtered by user_id at the
 * handler level instead.
 *
 * With ALL scope, `reqDepts` (the UI's department filter) is honoured and accepts
 * either ids or department names.
 */
export async function resolveDeptFilter(
  access: InsightsAccessResult,
  reqDepts?: string,
): Promise<number[]> {
  if (access.dataScope === 'ALL') {
    if (reqDepts) {
      const parts = reqDepts.split(',').map((s) => s.trim()).filter(Boolean);
      const numericIds = parts.map(Number).filter((n) => !isNaN(n) && n > 0);
      if (numericIds.length === parts.length) return numericIds;
      const ph = parts.map(() => '?').join(',');
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM departments WHERE department_name IN (${ph})`,
        parts,
      );
      return rows.map((r) => r.id as number);
    }
    return [];
  }
  if (access.dataScope === 'SELF') return [];
  // DEPARTMENT / DIVISION: the permission service already resolved the exact set
  // of warehouse department_keys this viewer may see (profile department + the
  // departments they manage on the Departments tab, expanded to descendants for
  // DIVISION). Map those keys back to operational department ids for the query
  // filter. An empty set means the viewer has neither a profile department nor a
  // managed department, so there is nothing to scope to.
  if (access.departmentKeys.length === 0) return [];
  const ph = access.departmentKeys.map(() => '?').join(',');
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT department_id FROM ie_dim_department
     WHERE department_key IN (${ph}) AND is_current = 1`,
    access.departmentKeys,
  );
  return rows.map((r) => r.department_id as number);
}
