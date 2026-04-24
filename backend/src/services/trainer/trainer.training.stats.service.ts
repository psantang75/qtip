/**
 * Training stats: active courses / enrollments / completion rate.
 *
 * Powers `GET /api/trainer/stats`. Validates that the caller is a real
 * trainer (role_id 4, active) before counting — every other reachable
 * trainer endpoint already gates on the same role via `authorizeTrainer`,
 * but this method historically did the lookup itself and the existing
 * frontend test surface depends on the 404 envelope it returns.
 *
 * Migrated from the deleted `services/TrainerService.ts` during the
 * pre-production review (item #29). The other two methods on that class
 * (`getDashboardStats`, `getCSRActivity`) were dead code — the live
 * controller had its own inline implementations with subtly different
 * SQL — so they were not migrated.
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import { TrainerServiceError } from './trainer.types'

export interface TrainingStats {
  activeCourses:    number
  totalEnrollments: number
  completionRate:   number
}

export async function getTrainingStats(trainerId: number): Promise<TrainingStats> {
  const trainerRows = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
    SELECT id FROM users WHERE id = ${trainerId} AND role_id = 4 AND is_active = 1
  `)

  if (trainerRows.length === 0) {
    throw new TrainerServiceError('Trainer not found or inactive', 404, 'TRAINER_NOT_FOUND')
  }

  const [activeCoursesRows, totalEnrollmentsRows, completionRateRows] = await Promise.all([
    prisma.$queryRaw<{ activeCourses: number }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT e.course_id) AS activeCourses
      FROM enrollments e
      WHERE e.course_id IS NOT NULL
    `),
    prisma.$queryRaw<{ totalEnrollments: number }[]>(Prisma.sql`
      SELECT COUNT(*) AS totalEnrollments FROM enrollments
    `),
    prisma.$queryRaw<{ total: number; completed: number }[]>(Prisma.sql`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS completed
      FROM enrollments
    `),
  ])

  const total     = Number(completionRateRows[0]?.total)     || 0
  const completed = Number(completionRateRows[0]?.completed) || 0
  const rate      = total > 0 ? Math.round((completed / total) * 100) : 0

  return {
    activeCourses:    Number(activeCoursesRows[0]?.activeCourses)       || 0,
    totalEnrollments: Number(totalEnrollmentsRows[0]?.totalEnrollments) || 0,
    completionRate:   rate,
  }
}
