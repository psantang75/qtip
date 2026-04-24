/**
 * Resolve a user's role from `users.role_id` if the caller didn't
 * pass it in.
 *
 * Extracted from the legacy `MySQLAnalyticsRepository` god class
 * during pre-production cleanup item #29 — the same 4-line lookup
 * was inlined into every public method, which made the role
 * resolution untestable and the repository methods harder to read.
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'

export async function resolveAnalyticsUserRole(
  user_id: number,
  userRole?: string,
): Promise<string | undefined> {
  if (userRole) return userRole
  const rows = await prisma.$queryRaw<{ role_name: string }[]>(
    Prisma.sql`SELECT r.role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ${user_id}`,
  )
  return rows[0]?.role_name
}
