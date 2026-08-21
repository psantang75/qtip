/**
 * Shared scope primitives for the Agent Activity + Productivity Insights reports.
 *
 * ONE definition of "who is an agent" for the section, so the role/subtree rule
 * cannot drift across the readers (Call/Tickets/Email in insightsAgentActivity),
 * the Productivity roster + day drill-down, and the Workload daily aggregator.
 * Each of those previously carried its own copy of these two constants and the
 * department guard — this is the single source they now import.
 */
export type Area = 'sales' | 'csr';

/** Only CSR-role employees are agents in these reports. */
export const AGENT_ROLE = 'CSR';

/**
 * The Sales department subtree root. The 'sales' area is everything under it;
 * the 'csr' area is its complement. Matched via ie_dim_department.hierarchy_path.
 */
export const SALES_DEPT_ROOT_PATH = '/Sales Department - All';

/**
 * The area's department predicate over an `ie_dim_department` alias (default
 * `dpt`). 'sales' keeps the Sales subtree; 'csr' reads its complement (COALESCE
 * so a not-yet-backfilled hierarchy_path still counts as non-Sales). Returns the
 * SQL fragment plus the two params it binds (the root path, twice) — identical
 * to the inline guards it replaces.
 */
export function areaDeptGuard(area: Area, alias = 'dpt'): { sql: string; params: string[] } {
  const coalesced = `COALESCE(${alias}.hierarchy_path, '')`;
  const sql = area === 'csr'
    ? `${coalesced} <> ? AND ${coalesced} NOT LIKE CONCAT(?, '/%')`
    : `(${alias}.hierarchy_path = ? OR ${alias}.hierarchy_path LIKE CONCAT(?, '/%'))`;
  return { sql, params: [SALES_DEPT_ROOT_PATH, SALES_DEPT_ROOT_PATH] };
}
