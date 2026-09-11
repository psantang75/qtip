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

export interface EmployeeJoinOptions {
  /** Alias of the fact/source table holding the employee foreign key. Default `f`. */
  factAlias?: string;
  /** Employee foreign key column. Default `<factAlias>.employee_key`. */
  factColumn?: string;
  /** Alias bound to the employee's CURRENT row — what callers should read. Default `e`. */
  alias?: string;
  /** Alias bound to the (possibly superseded) row the fact points at. Default `fe`. */
  versionAlias?: string;
  /** Emit LEFT JOINs, for readers that keep rows with no employee match. */
  left?: boolean;
  /** Extra predicate on the current row, e.g. `e.is_active = 1`. */
  extra?: string;
}

/**
 * Join a fact to the employee's CURRENT dimension row, surviving Type-2 churn.
 *
 * `ie_dim_employee` is a Type-2 dimension: EmployeeSyncWorker responds to a
 * change of department, role, title, manager or active flag by closing the
 * existing row (`is_current = 0`) and inserting a new one with a NEW
 * `employee_key`. Facts are stamped with whichever key was current when they
 * were LOADED, so the obvious join —
 *
 *     JOIN ie_dim_employee e ON e.is_current = 1 AND e.employee_key = f.employee_key
 *
 * — stops matching every row loaded before that person's most recent change.
 * With an inner join their history silently disappears from the report instead
 * of moving departments; with a left join it survives but reads as unattributed.
 * Either way the report quietly loses data, and it gets worse with every reorg.
 *
 * So resolve through the business key: land on the row the fact actually points
 * at to read `user_id`, then hop to that user's current row. Attribution is
 * therefore always by CURRENT department and role — move an agent to Tech
 * Support and their whole history moves with them — and no row is ever dropped
 * for predating a change. Both hops hit a dimension of a few dozen rows.
 *
 * Read every employee attribute off `alias` (the current row). `versionAlias`
 * exists only to carry `user_id` across, and is what the as-of-load state looked
 * like — do not filter on it.
 */
export function currentEmployeeJoin(opts: EmployeeJoinOptions = {}): string {
  const {
    factAlias = 'f', alias = 'e', versionAlias = 'fe', left = false, extra,
  } = opts;
  const factColumn = opts.factColumn ?? `${factAlias}.employee_key`;
  const join = left ? 'LEFT JOIN' : 'JOIN';
  return `${join} ie_dim_employee ${versionAlias} ON ${versionAlias}.employee_key = ${factColumn}
     ${join} ie_dim_employee ${alias} ON ${alias}.is_current = 1 AND ${alias}.user_id = ${versionAlias}.user_id${extra ? ` AND ${extra}` : ''}`;
}
