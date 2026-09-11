/**
 * ONE definition of "which support calls count" over `ie_fact_support_call`.
 *
 * Shared by the Call Length report page and the Call Transcripts on-demand
 * report so a transcript download can never cover a call the page wouldn't
 * count — if the two drifted, an analyst would be reasoning about a population
 * the dashboard never showed them.
 *
 * Population = CSR-role agents outside the Sales subtree, resolved through the
 * employee dimension's business key so a department move doesn't drop history
 * (see `currentEmployeeJoin`).
 */
import { AGENT_ROLE, areaDeptGuard, currentEmployeeJoin } from '../../insightsAgentScope';

export interface SupportCallScopeFilters {
  fromKey: number;
  toKey: number;
  /** Set for a SELF-scoped viewer; pins the population to that one employee. */
  selfEmployeeKey?: number | null;
  departments?: string[];
  /** Agent display names (`ie_fact_support_call.agent_name`). */
  users?: string[];
}

export interface SqlPredicate {
  where: string[];
  params: (string | number)[];
}

export interface SupportCallScope {
  /** Employee + department joins, in order, for a fact aliased `f`. */
  joins: string;
  /**
   * The report POPULATION — period, role, area subtree and any SELF pin. A
   * viewer's own restriction belongs here and not in `layered`, so the filter
   * controls can never widen them past their own row.
   */
  base: SqlPredicate;
  /** `base` plus the user's department/agent selections. */
  layered: SqlPredicate;
}

export function supportCallScope(f: SupportCallScopeFilters): SupportCallScope {
  const guard = areaDeptGuard('csr');
  const joins = `${currentEmployeeJoin()}
     JOIN ie_dim_department dpt ON dpt.is_current = 1 AND dpt.department_key = e.department_key`;

  const where = ['f.date_key BETWEEN ? AND ?', 'e.role_name = ?', guard.sql];
  const params: (string | number)[] = [f.fromKey, f.toKey, AGENT_ROLE, ...guard.params];
  if (f.selfEmployeeKey != null) {
    // The CURRENT row's key, not the fact's: the caller's key is current, while
    // their older calls carry superseded Type-2 keys. Filtering f.employee_key
    // would hide a SELF viewer's own history from them after any record change.
    where.push('e.employee_key = ?');
    params.push(f.selfEmployeeKey);
  }

  const layeredWhere = [...where];
  const layeredParams = [...params];
  if (f.departments?.length) {
    layeredWhere.push(`dpt.department_name IN (${f.departments.map(() => '?').join(',')})`);
    layeredParams.push(...f.departments);
  }
  if (f.users?.length) {
    layeredWhere.push(`f.agent_name IN (${f.users.map(() => '?').join(',')})`);
    layeredParams.push(...f.users);
  }

  return {
    joins,
    base: { where, params },
    layered: { where: layeredWhere, params: layeredParams },
  };
}

/** `WHERE a AND b AND …` for a predicate built by `supportCallScope`. */
export function whereSql(p: SqlPredicate): string {
  return `WHERE ${p.where.join(' AND ')}`;
}
