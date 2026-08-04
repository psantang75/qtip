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
 * KNOWN GAP (deferred by decision, affects every Insights page equally, not just
 * attendance): DEPARTMENT scope returns only the viewer's own department_id and
 * does NOT cascade to child departments, nor does it consult department_managers.
 * A manager whose users.department_id is NULL therefore resolves to an EMPTY
 * filter, which produces no SQL and so fails OPEN. The Page Access grants in use
 * today give Manager the ALL scope, which sidesteps it. See
 * utils/departmentHierarchy.ts for the descendant helpers a fix would use.
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
  userId: number,
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
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT department_id FROM users WHERE id = ?',
    [userId],
  );
  const deptId = rows[0]?.department_id as number | null;
  return deptId ? [deptId] : [];
}
