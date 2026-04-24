/**
 * Trainer dashboard counters: reviews / disputes / coaching sessions.
 *
 * Powers `GET /api/trainer/dashboard-stats`. Org-wide aggregates with
 * week + month windows. Coaching status filter is `IN ('SCHEDULED',
 * 'COMPLETED')` — kept verbatim from the legacy controller so the live
 * response does not change. The orphaned `TrainerService.getDashboardStats`
 * (which returned an additional `trainingAssignments` field and only
 * counted COMPLETED coaching) was deleted with the old TrainerService.ts
 * during the pre-production review (item #29).
 */

import prisma from '../../config/prisma'
import { Prisma } from '../../generated/prisma/client'
import type { TrainerDashboardStats } from './trainer.types'

export async function getTrainerDashboardStats(): Promise<TrainerDashboardStats> {
  const [reviewsCompleted, disputes, coachingSessions] = await Promise.all([
    prisma.$queryRaw<{ thisWeek: bigint; thisMonth: bigint }[]>(Prisma.sql`
      SELECT
        COUNT(CASE WHEN s.submitted_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) AS thisWeek,
        COUNT(CASE WHEN s.submitted_at >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 END) AS thisMonth
      FROM submissions s
      JOIN submission_metadata sm   ON s.id = sm.submission_id
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      JOIN users u                  ON u.id = CAST(sm.value AS UNSIGNED)
      JOIN roles r                  ON u.role_id = r.id
      WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
        AND fmf.field_name = 'CSR'
        AND r.role_name    = 'CSR'
        AND u.is_active    = 1
    `),
    prisma.$queryRaw<{ thisWeek: bigint; thisMonth: bigint }[]>(Prisma.sql`
      SELECT
        COUNT(CASE WHEN d.created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) AS thisWeek,
        COUNT(CASE WHEN d.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 END) AS thisMonth
      FROM disputes d
      JOIN submissions s            ON d.submission_id = s.id
      JOIN submission_metadata sm   ON s.id = sm.submission_id
      JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
      JOIN users u                  ON u.id = CAST(sm.value AS UNSIGNED)
      JOIN roles r                  ON u.role_id = r.id
      WHERE fmf.field_name = 'CSR'
        AND r.role_name    = 'CSR'
        AND u.is_active    = 1
    `),
    prisma.$queryRaw<{ thisWeek: bigint; thisMonth: bigint }[]>(Prisma.sql`
      SELECT
        COUNT(CASE WHEN cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) AS thisWeek,
        COUNT(CASE WHEN cs.session_date >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 END) AS thisMonth
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id  = u.id
      JOIN roles r ON u.role_id  = r.id
      WHERE cs.status IN ('SCHEDULED', 'COMPLETED')
        AND r.role_name = 'CSR'
        AND u.is_active = 1
    `),
  ])

  return {
    reviewsCompleted: {
      thisWeek:  Number(reviewsCompleted[0]?.thisWeek  ?? 0),
      thisMonth: Number(reviewsCompleted[0]?.thisMonth ?? 0),
    },
    disputes: {
      thisWeek:  Number(disputes[0]?.thisWeek  ?? 0),
      thisMonth: Number(disputes[0]?.thisMonth ?? 0),
    },
    coachingSessions: {
      thisWeek:  Number(coachingSessions[0]?.thisWeek  ?? 0),
      thisMonth: Number(coachingSessions[0]?.thisMonth ?? 0),
    },
  }
}
