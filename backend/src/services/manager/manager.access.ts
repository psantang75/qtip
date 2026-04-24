/**
 * Shared access-control helpers used by every manager handler:
 *   - role id lookup (cached) for the CSR role
 *   - manager-to-department mapping resolution
 *
 * Centralising these here removes the duplicated `getRoleId` cache and
 * department lookup that previously appeared in nearly every controller
 * handler in the legacy `manager.controller.ts`.
 */
import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { serviceLogger } from '../../config/logger'
import { ManagerServiceError } from './manager.types'

/**
 * Process-local cache so we don't re-query the `roles` table on every request.
 * The CSR role is stored as 'User' in some legacy installs, so we accept both.
 */
let csrRoleIdCache: number | null = null

export async function getCsrRoleId(): Promise<number> {
  if (csrRoleIdCache) return csrRoleIdCache

  try {
    const role = await prisma.role.findFirst({
      where: { role_name: { in: ['CSR', 'User'] } },
      select: { id: true },
    })
    if (!role) {
      throw new ManagerServiceError('CSR role not found', 500, 'CSR_ROLE_MISSING')
    }
    csrRoleIdCache = role.id
    return role.id
  } catch (error) {
    if (error instanceof ManagerServiceError) throw error
    serviceLogger.error('MANAGER', 'getCsrRoleId failed', error as Error)
    throw new ManagerServiceError('Failed to resolve CSR role', 500, 'CSR_ROLE_LOOKUP_FAILED')
  }
}

/**
 * @returns Active department ids the given manager owns. Empty array means
 *          the manager has no team — callers should short-circuit and return
 *          an empty result set rather than treating it as an error.
 */
export async function getManagedDepartmentIds(managerId: number): Promise<number[]> {
  const rows = await prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    SELECT DISTINCT d.id
    FROM departments d
    INNER JOIN department_managers dm ON d.id = dm.department_id
    WHERE dm.manager_id = ${managerId} AND dm.is_active = 1 AND d.is_active = 1
  `)
  return rows.map((dept) => dept.id)
}

/**
 * Returns active department ids visible to the caller.
 * - `Manager`: only the departments they own.
 * - any other authorised role: every active department.
 *
 * Used by handlers (dashboard, csr-activity) that show org-wide aggregates
 * to non-Manager roles but scope to the manager's own team for Managers.
 */
export async function getVisibleDepartmentIds(
  managerId: number,
  userRole: string | undefined,
): Promise<number[]> {
  if (userRole === 'Manager') {
    return getManagedDepartmentIds(managerId)
  }
  const rows = await prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    SELECT DISTINCT d.id FROM departments d WHERE d.is_active = 1
  `)
  return rows.map((dept) => dept.id)
}
