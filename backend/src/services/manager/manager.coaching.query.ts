/**
 * Shared filter / WHERE clause builder for the coaching session endpoints.
 *
 * The list and export handlers both apply the same set of filters
 * (csr, status, coaching_type, search, date range) so the SQL is generated
 * here once.
 *
 * Note: the resulting fragment is appended after `JOIN users u ON cs.csr_id`
 * + `JOIN departments d` so it always includes a `WHERE u.role_id = ? ...`
 * prefix, regardless of caller role.
 */
import { getCsrRoleId, getManagedDepartmentIds } from './manager.access'

export interface CoachingFilters {
  searchTerm?: string
  csrId?: string
  status?: string
  coachingType?: string
  startDate?: string
  endDate?: string
}

export interface CoachingScope {
  userId: number
  userRole: string | undefined
}

export interface CoachingWhereResult {
  /** Joined `WHERE` clause with all filters folded in (includes `WHERE` keyword). */
  whereSql: string
  params: unknown[]
}

export async function buildCoachingWhere(
  scope: CoachingScope,
  filters: CoachingFilters,
): Promise<CoachingWhereResult> {
  const csrRoleId = await getCsrRoleId()
  let whereSql: string
  const params: unknown[] = []

  if (scope.userRole === 'Manager') {
    // Limit to CSRs in departments this manager owns.
    whereSql = `
      JOIN department_managers dm ON d.id = dm.department_id
      WHERE u.role_id = ? AND u.is_active = 1 AND d.is_active = 1
        AND dm.manager_id = ? AND dm.is_active = 1`
    params.push(csrRoleId, scope.userId)
  } else {
    whereSql = `
      WHERE u.role_id = ? AND u.is_active = 1 AND d.is_active = 1`
    params.push(csrRoleId)
  }

  if (filters.searchTerm) {
    whereSql += ` AND (
      u.username LIKE ?
      OR EXISTS (
        SELECT 1 FROM coaching_session_topics cst
        JOIN list_items li_t ON cst.topic_id = li_t.id
        WHERE cst.coaching_session_id = cs.id
          AND li_t.label LIKE ?
      )
    )`
    params.push(`%${filters.searchTerm}%`, `%${filters.searchTerm}%`)
  }

  if (filters.csrId) {
    whereSql += ' AND cs.csr_id = ?'
    params.push(parseInt(filters.csrId, 10))
  }
  if (filters.status) {
    whereSql += ' AND cs.status = ?'
    params.push(filters.status)
  }
  if (filters.coachingType) {
    whereSql += ' AND cs.coaching_type = ?'
    params.push(filters.coachingType)
  }
  if (filters.startDate) {
    whereSql += ' AND DATE(cs.session_date) >= ?'
    params.push(filters.startDate)
  }
  if (filters.endDate) {
    whereSql += ' AND DATE(cs.session_date) <= ?'
    params.push(filters.endDate)
  }

  // Verify the manager can see anything; if their team is empty we still
  // want the query to run (returns empty) rather than throwing — keeps the
  // export endpoint consistent with the list endpoint.
  if (scope.userRole === 'Manager') {
    void (await getManagedDepartmentIds(scope.userId))
  }

  return { whereSql, params }
}

/**
 * Splits the raw `topics` / `topic_ids` GROUP_CONCAT strings into arrays for
 * the API response. Used by list, detail, create, and update flows.
 */
export function splitTopicAggregates(row: { topics?: string | null; topic_ids?: string | null }): {
  topics: string[]
  topic_ids: number[]
} {
  return {
    topics: row.topics ? row.topics.split(', ') : [],
    topic_ids: row.topic_ids
      ? row.topic_ids.split(',').map((id) => parseInt(id, 10))
      : [],
  }
}
