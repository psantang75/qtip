/**
 * Shared filter / WHERE clause builder for the manager dispute endpoints.
 *
 * `getManagerTeamDisputes` (paginated list) and `exportManagerTeamDisputes`
 * (Excel export) historically duplicated the entire 80-line filter block.
 * Both code paths now call `buildDisputeWhere` and consume the same
 * `whereSql` + `params` pair.
 */
import { getCsrRoleId, getManagedDepartmentIds } from './manager.access'

export interface DisputeFilters {
  csrFilter?: string
  statusFilter?: string
  searchTerm?: string
  formFilter?: string
  formName?: string
  startDate?: string
  endDate?: string
}

export interface DisputeScope {
  userId: number
  userRole: string | undefined
}

export interface DisputeWhereResult {
  /** Whether the caller has any departments. Empty list => return empty result. */
  hasScope: boolean
  whereSql: string
  params: unknown[]
}

export async function buildDisputeWhere(
  scope: DisputeScope,
  filters: DisputeFilters,
): Promise<DisputeWhereResult> {
  const csrRoleId = await getCsrRoleId()
  const conditions: string[] = []
  const params: unknown[] = []

  if (scope.userRole === 'Manager') {
    const departmentIds = await getManagedDepartmentIds(scope.userId)
    if (departmentIds.length === 0) {
      return { hasScope: false, whereSql: '', params: [] }
    }
    conditions.push(`csr.department_id IN (${departmentIds.map(() => '?').join(',')})`)
    params.push(...departmentIds)
  }

  conditions.push('csr.role_id = ?')
  conditions.push('csr.is_active = 1')
  params.push(csrRoleId)

  // QA reviewers only see disputes against their own audits, and only after the
  // dispute has been adjusted (i.e. the QA needs to revisit it).
  if (scope.userRole === 'QA') {
    conditions.push('d.status = ?')
    params.push('ADJUSTED')
    conditions.push('s.submitted_by = ?')
    params.push(scope.userId)
  } else if (filters.statusFilter) {
    conditions.push('d.status = ?')
    params.push(filters.statusFilter)
  }

  if (filters.csrFilter) {
    conditions.push('csr.id = ?')
    params.push(filters.csrFilter)
  }
  if (filters.searchTerm) {
    conditions.push('(csr.username LIKE ? OR f.form_name LIKE ?)')
    params.push(`%${filters.searchTerm}%`, `%${filters.searchTerm}%`)
  }
  if (filters.formName) {
    conditions.push('f.form_name LIKE ?')
    params.push(`%${filters.formName}%`)
  }
  if (filters.formFilter) {
    conditions.push('f.id = ?')
    params.push(filters.formFilter)
  }
  if (filters.startDate) {
    conditions.push('DATE(d.created_at) >= ?')
    params.push(filters.startDate)
  }
  if (filters.endDate) {
    conditions.push('DATE(d.created_at) <= ?')
    params.push(filters.endDate)
  }

  return { hasScope: true, whereSql: conditions.join(' AND '), params }
}
