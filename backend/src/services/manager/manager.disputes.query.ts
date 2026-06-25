/**
 * Shared filter / WHERE clause builder for the manager dispute endpoints.
 *
 * `getManagerTeamDisputes` (paginated list) and `exportManagerTeamDisputes`
 * (Excel export) historically duplicated the entire 80-line filter block.
 * Both code paths now call `buildDisputeWhere` and consume the same
 * `whereSql` + `params` pair.
 */
import { getCsrRoleId } from './manager.access'

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
  /**
   * Departments this viewer may see, resolved from page access by the
   * controller (NOT from a hard-coded role string):
   *   - `null`  => no department restriction (Admin org-wide; QA, which is
   *                author-scoped below, is also passed null).
   *   - `[]`    => the viewer manages no departments => no rows.
   *   - ids     => limit to CSRs in these departments.
   */
  scopedDepartmentIds: number[] | null
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

  // QA reviewers only see disputes against their own audits, and only after the
  // dispute has been adjusted (i.e. the QA needs to revisit it). This is an
  // intentional author self-scope that the Page Access level cannot override —
  // it is surfaced to admins via PAGE_ROLE_NOTES['quality_disputes'][2] in
  // frontend/src/pages/admin/AppPageAccessPage.tsx. Keep the two in sync.
  // QA is author-bound, not department-bound, so the department scope below
  // does not apply to it (the controller passes `scopedDepartmentIds = null`).
  if (scope.userRole === 'QA') {
    conditions.push('d.status = ?')
    params.push('ADJUSTED')
    conditions.push('s.submitted_by = ?')
    params.push(scope.userId)
  } else if (scope.scopedDepartmentIds !== null) {
    // Department-bound viewers (e.g. Managers) are limited to their assigned
    // departments. No departments => no rows.
    if (scope.scopedDepartmentIds.length === 0) {
      return { hasScope: false, whereSql: '', params: [] }
    }
    conditions.push(`csr.department_id IN (${scope.scopedDepartmentIds.map(() => '?').join(',')})`)
    params.push(...scope.scopedDepartmentIds)
  }

  conditions.push('csr.role_id = ?')
  conditions.push('csr.is_active = 1')
  params.push(csrRoleId)

  if (scope.userRole !== 'QA' && filters.statusFilter) {
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
