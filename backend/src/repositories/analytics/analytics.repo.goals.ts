/**
 * Performance-goal repository module.
 *
 * Extracted from the legacy `MySQLAnalyticsRepository` god class
 * during pre-production cleanup item #29. Hosts:
 *
 *  - `getActiveGoalsRepo`  — list of active goals scoped to caller.
 *  - `getAverageQAScoreRepo` — mean total score for a goal.
 *  - `getAuditRateRepo`    — audits-per-QA ratio for a goal.
 *  - `getDisputeRateRepo`  — dispute % over audits for a goal.
 *
 * Department scope is duplicated across the metric queries; we use
 * a small private helper to keep the SQL fragments DRY.
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import type { ReportFilters } from '../../types/analytics.types'
import { resolveAnalyticsUserRole } from './analytics.repo.userRole'

interface GoalLike {
  scope?: string | null
  department_id?: number | null
}

function buildGoalDepartmentScope(
  goal: GoalLike,
  userRole: string | undefined,
  user_id: number,
): Prisma.Sql {
  if (goal.scope === 'DEPARTMENT' && goal.department_id) {
    return Prisma.sql`AND u.department_id = ${goal.department_id}`
  }
  if (userRole === 'Manager') {
    return Prisma.sql`AND u.department_id IN (
      SELECT DISTINCT dm.department_id
      FROM department_managers dm
      WHERE dm.manager_id = ${user_id} AND dm.is_active = 1
    )`
  }
  return Prisma.sql``
}

export async function getActiveGoalsRepo(
  user_id: number,
  userRole?: string,
  department_id?: number,
): Promise<any[]> {
  try {
    const role = await resolveAnalyticsUserRole(user_id, userRole)
    const conditions: Prisma.Sql[] = [Prisma.sql`pg.is_active = 1`]

    if (department_id) {
      conditions.push(Prisma.sql`(pg.scope = 'GLOBAL' OR (pg.scope = 'DEPARTMENT' AND pg.department_id = ${department_id}))`)
    } else if (role === 'Manager') {
      conditions.push(Prisma.sql`(pg.scope = 'GLOBAL' OR (pg.scope = 'DEPARTMENT' AND pg.department_id IN (
        SELECT DISTINCT dm.department_id
        FROM department_managers dm
        WHERE dm.manager_id = ${user_id} AND dm.is_active = 1
      )))`)
    }

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`

    return await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT pg.id, pg.goal_type, pg.target_value, pg.scope, pg.department_id
      FROM performance_goals pg
      ${whereClause}
    `)
  } catch (error) {
    logger.error('Error fetching active goals:', error)
    throw new Error('Failed to fetch active goals')
  }
}

export async function getAverageQAScoreRepo(
  filters: ReportFilters,
  user_id: number,
  userRole: string | undefined,
  goal: GoalLike,
): Promise<{ averageScore: number }> {
  try {
    const endDateWithTime = `${filters.end_date} 23:59:59`
    const extraWhere = buildGoalDepartmentScope(goal, userRole, user_id)

    const rows = await prisma.$queryRaw<{ avg_score: number | null }[]>(Prisma.sql`
      SELECT AVG(s.total_score) AS avg_score
      FROM submissions s
        INNER JOIN users u ON s.submitted_by = u.id
      WHERE s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}
        AND s.status IN ('SUBMITTED', 'FINALIZED')
        AND s.total_score IS NOT NULL
        ${extraWhere}
    `)

    return { averageScore: Number(rows[0]?.avg_score) || 0 }
  } catch (error) {
    logger.error('Error calculating average QA score:', error)
    throw new Error('Failed to calculate average QA score')
  }
}

export async function getAuditRateRepo(
  filters: ReportFilters,
  user_id: number,
  userRole: string | undefined,
  goal: GoalLike,
): Promise<{ auditRate: number }> {
  try {
    const endDateWithTime = `${filters.end_date} 23:59:59`
    const extraWhere = buildGoalDepartmentScope(goal, userRole, user_id)

    const rows = await prisma.$queryRaw<{ audit_count: bigint; qa_count: bigint }[]>(Prisma.sql`
      SELECT
        COUNT(DISTINCT s.id) AS audit_count,
        COUNT(DISTINCT s.submitted_by) AS qa_count
      FROM submissions s
        INNER JOIN users u ON s.submitted_by = u.id
      WHERE s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}
        AND s.status IN ('SUBMITTED', 'FINALIZED')
        ${extraWhere}
    `)

    const auditCount = Number(rows[0]?.audit_count) || 0
    const qaCount = Number(rows[0]?.qa_count) || 1
    return { auditRate: auditCount / qaCount }
  } catch (error) {
    logger.error('Error calculating audit rate:', error)
    throw new Error('Failed to calculate audit rate')
  }
}

export async function getDisputeRateRepo(
  filters: ReportFilters,
  user_id: number,
  userRole: string | undefined,
  goal: GoalLike,
): Promise<{ disputeRate: number }> {
  try {
    const endDateWithTime = `${filters.end_date} 23:59:59`
    const extraWhere = buildGoalDepartmentScope(goal, userRole, user_id)

    const rows = await prisma.$queryRaw<{ audit_count: bigint; dispute_count: bigint }[]>(Prisma.sql`
      SELECT
        COUNT(DISTINCT s.id) AS audit_count,
        COUNT(DISTINCT d.id) AS dispute_count
      FROM submissions s
        INNER JOIN users u ON s.submitted_by = u.id
        LEFT JOIN disputes d ON s.id = d.submission_id
      WHERE s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}
        AND s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
        ${extraWhere}
    `)

    const auditCount = Number(rows[0]?.audit_count) || 0
    const disputeCount = Number(rows[0]?.dispute_count) || 0
    const disputeRate = auditCount > 0 ? (disputeCount / auditCount) * 100 : 0
    return { disputeRate }
  } catch (error) {
    logger.error('Error calculating dispute rate:', error)
    throw new Error('Failed to calculate dispute rate')
  }
}

import logger from '../../config/logger';