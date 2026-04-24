/**
 * Team roster lookup for managers — list of CSRs in the manager's department(s).
 *
 * Used by the QA / Manager filter dropdowns (qaService.getTeamCSRs).
 */
import prisma from '../../config/prisma'
import { getCsrRoleId, getManagedDepartmentIds } from './manager.access'
import { ManagerServiceError } from './manager.types'

export interface TeamCsrOption {
  id: number
  username: string
  email: string | null
  department_name: string
}

export interface TeamCsrResult {
  data: TeamCsrOption[]
  total: number
}

export async function listManagerTeamCsrs(userId: number): Promise<TeamCsrResult> {
  const departmentIds = await getManagedDepartmentIds(userId)
  if (departmentIds.length === 0) {
    throw new ManagerServiceError(
      'No departments assigned to this manager',
      403,
      'NO_DEPARTMENTS',
      'plain',
    )
  }

  const csrRoleId = await getCsrRoleId()

  const rows = await prisma.$queryRawUnsafe<Array<{
    id: number
    username: string
    email: string | null
    department_name: string
  }>>(
    `SELECT u.id, u.username, u.email, d.department_name
     FROM users u
     JOIN departments d ON u.department_id = d.id
     WHERE u.department_id IN (${departmentIds.map(() => '?').join(',')})
       AND u.role_id = ?
       AND u.is_active = 1
     ORDER BY u.username ASC`,
    ...departmentIds,
    csrRoleId,
  )

  return { data: rows, total: rows.length }
}
