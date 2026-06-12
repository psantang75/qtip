/**
 * Legacy-record lock.
 *
 * Rows imported from the old QTIP system carry `is_legacy = 1`
 * (`coaching_sessions` and `write_ups`, stamped by
 * `scripts/migrate-production-data.ts`). These are historical HR/coaching
 * records: they must stay searchable and usable as prior-discipline
 * references, but their content is frozen — only Admins may modify them,
 * and every Admin override is written to `audit_logs` for traceability.
 *
 * Usage (transport layer, after the id is parsed):
 *
 *   const lock = await checkLegacyLock('coaching_session', sessionId, userId, role)
 *   if (!lock.allowed) return res.status(403).json({ success: false, message: lock.message, code: 'LEGACY_LOCKED' })
 *
 * A missing row reports `allowed: true` so the handler's own 404 / access
 * checks stay authoritative.
 */
import prisma from '../config/prisma'
import { Prisma } from '../generated/prisma/client'
import logger from '../config/logger'

export type LegacyEntity = 'coaching_session' | 'write_up'

const TABLE: Record<LegacyEntity, Prisma.Sql> = {
  coaching_session: Prisma.sql`coaching_sessions`,
  write_up: Prisma.sql`write_ups`,
}

export interface LegacyLockCheck {
  allowed: boolean
  message?: string
}

export const LEGACY_LOCKED_MESSAGE =
  'This is a legacy record imported from the previous system and is read-only. Contact an administrator if it must be changed.'

export async function checkLegacyLock(
  entity: LegacyEntity,
  id: number,
  userId: number,
  role: string | undefined,
): Promise<LegacyLockCheck> {
  if (!Number.isFinite(id) || id <= 0) return { allowed: true }

  const rows = await prisma.$queryRaw<Array<{ is_legacy: number }>>(
    Prisma.sql`SELECT is_legacy FROM ${TABLE[entity]} WHERE id = ${id}`,
  )
  if (!rows.length || !rows[0].is_legacy) return { allowed: true }

  if (role !== 'Admin') {
    return { allowed: false, message: LEGACY_LOCKED_MESSAGE }
  }

  // Admin override — allowed, but leave a trace.
  try {
    await prisma.auditLog.create({
      data: {
        user_id: userId,
        action: 'LEGACY_OVERRIDE',
        target_id: id,
        target_type: entity,
        details: JSON.stringify({ reason: 'admin modified a legacy (imported) record' }),
      },
    })
  } catch (err) {
    // Auditing must never block the admin action itself.
    logger.warn(`[legacyLock] failed to audit-log admin override on ${entity} ${id}:`, err)
  }
  return { allowed: true }
}
