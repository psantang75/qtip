import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import { trainerLogger } from './TrainerLogger';
import { trainerCache } from './TrainerCache';

interface TrainerDashboardStats {
  reviewsCompleted: {
    thisWeek: number;
    thisMonth: number;
  };
  disputes: {
    thisWeek: number;
    thisMonth: number;
  };
  coachingSessions: {
    thisWeek: number;
    thisMonth: number;
  };
  trainingAssignments: {
    thisWeek: number;
    thisMonth: number;
  };
}

interface TrainerCSRActivityData {
  id: number;
  name: string;
  department: string;
  audits: number;
  disputes: number;
  coachingScheduled: number;
  coachingCompleted: number;
  audits_week: number;
  disputes_week: number;
  audits_month: number;
  disputes_month: number;
  coachingScheduled_week: number;
  coachingCompleted_week: number;
  coachingScheduled_month: number;
  coachingCompleted_month: number;
}

export class TrainerServiceError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = 'TRAINER_SERVICE_ERROR'
  ) {
    super(message);
    this.name = 'TrainerServiceError';
  }
}

export class TrainerService {
  /**
   * Get trainer-specific dashboard statistics
   * Trainers see organization-wide stats but with emphasis on training/coaching metrics
   */
  async getDashboardStats(trainerId: number): Promise<TrainerDashboardStats> {
    const startTime = Date.now();
    trainerLogger.operation('getDashboardStats', trainerId);

    // Temporarily disable cache to ensure fresh data
    // const cacheKey = trainerCache.getDashboardStatsKey(trainerId);
    // const cachedStats = trainerCache.get<TrainerDashboardStats>(cacheKey);
    // if (cachedStats) {
    //   trainerLogger.operation('getDashboardStats', trainerId, { source: 'cache' });
    //   trainerLogger.performance('getDashboardStats', startTime, trainerId, true);
    //   return cachedStats;
    // }

    try {
      const [reviewsRows, disputesRows, coachingRows, trainingRows] = await Promise.all([
        prisma.$queryRaw<{ thisWeek: number; thisMonth: number }[]>(Prisma.sql`
          SELECT
            COUNT(CASE WHEN s.submitted_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) as thisWeek,
            COUNT(CASE WHEN s.submitted_at >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 END) as thisMonth
          FROM submissions s
          JOIN submission_metadata sm ON s.id = sm.submission_id
          JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          JOIN users u ON u.id = CAST(sm.value AS UNSIGNED)
          JOIN roles r ON u.role_id = r.id
          WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
          AND fmf.field_name = 'CSR'
          AND r.role_name = 'CSR'
          AND u.is_active = 1
        `),
        prisma.$queryRaw<{ thisWeek: number; thisMonth: number }[]>(Prisma.sql`
          SELECT
            COUNT(CASE WHEN d.created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) as thisWeek,
            COUNT(CASE WHEN d.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 END) as thisMonth
          FROM disputes d
          JOIN submissions s ON d.submission_id = s.id
          JOIN submission_metadata sm ON s.id = sm.submission_id
          JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          JOIN users u ON u.id = CAST(sm.value AS UNSIGNED)
          JOIN roles r ON u.role_id = r.id
          WHERE fmf.field_name = 'CSR'
          AND r.role_name = 'CSR'
          AND u.is_active = 1
        `),
        prisma.$queryRaw<{ thisWeek: number; thisMonth: number }[]>(Prisma.sql`
          SELECT
            COUNT(CASE WHEN cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) as thisWeek,
            COUNT(CASE WHEN cs.session_date >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 END) as thisMonth
          FROM coaching_sessions cs
          JOIN users u ON cs.csr_id = u.id
          JOIN roles r ON u.role_id = r.id
          WHERE cs.status = 'COMPLETED'
          AND r.role_name = 'CSR'
          AND u.is_active = 1
        `),
        prisma.$queryRaw<{ thisWeek: number; thisMonth: number }[]>(Prisma.sql`
          SELECT
            COUNT(CASE WHEN e.created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) as thisWeek,
            COUNT(CASE WHEN e.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 END) as thisMonth
          FROM enrollments e
          JOIN courses c ON e.course_id = c.id
          WHERE c.instructor_id = ${trainerId}
        `)
      ]);

      // Debug logging for disputes
      console.log('[TRAINER SERVICE] Disputes query result:', disputesRows[0]);
      console.log('[TRAINER SERVICE] Raw disputes data:', {
        thisWeek: disputesRows[0]?.thisWeek,
        thisMonth: disputesRows[0]?.thisMonth
      });

      const result = {
        reviewsCompleted: {
          thisWeek: Number(reviewsRows[0]?.thisWeek) || 0,
          thisMonth: Number(reviewsRows[0]?.thisMonth) || 0
        },
        disputes: {
          thisWeek: Number(disputesRows[0]?.thisWeek) || 0,
          thisMonth: Number(disputesRows[0]?.thisMonth) || 0
        },
        coachingSessions: {
          thisWeek: Number(coachingRows[0]?.thisWeek) || 0,
          thisMonth: Number(coachingRows[0]?.thisMonth) || 0
        },
        trainingAssignments: {
          thisWeek: Number(trainingRows[0]?.thisWeek) || 0,
          thisMonth: Number(trainingRows[0]?.thisMonth) || 0
        }
      };

      // Debug logging for final result
      console.log('[TRAINER SERVICE] Final dashboard stats result:', result);

      // Cache the result for 5 minutes (temporarily disabled)
      // trainerCache.set(cacheKey, result, 5 * 60 * 1000);

      trainerLogger.performance('getDashboardStats', startTime, trainerId, true);
      return result;
    } catch (error) {
      trainerLogger.performance('getDashboardStats', startTime, trainerId, false);
      if (error instanceof TrainerServiceError) {
        trainerLogger.operationError('getDashboardStats', error, trainerId);
        throw error;
      }
      const serviceError = new TrainerServiceError('Failed to fetch trainer dashboard statistics');
      trainerLogger.operationError('getDashboardStats', serviceError, trainerId);
      throw serviceError;
    }
  }

  /**
   * Get CSR activity data with focus on training and coaching metrics
   * Trainers see all CSRs they can potentially coach
   */
  async getCSRActivity(trainerId: number): Promise<TrainerCSRActivityData[]> {
    try {
      const csrActivity = await prisma.$queryRaw<TrainerCSRActivityData[]>(Prisma.sql`
        SELECT
          u.id,
          u.username as name,
          d.department_name as department,
          COALESCE(audit_counts.audits, 0) as audits,
          COALESCE(dispute_counts.disputes, 0) as disputes,
          COALESCE(coaching_scheduled.coachingScheduled, 0) as coachingScheduled,
          COALESCE(coaching_completed.coachingCompleted, 0) as coachingCompleted,
          COALESCE(audit_counts_week.audits_week, 0) as audits_week,
          COALESCE(dispute_counts_week.disputes_week, 0) as disputes_week,
          COALESCE(audit_counts_month.audits_month, 0) as audits_month,
          COALESCE(dispute_counts_month.disputes_month, 0) as disputes_month,
          COALESCE(coaching_scheduled_week.coachingScheduled_week, 0) as coachingScheduled_week,
          COALESCE(coaching_completed_week.coachingCompleted_week, 0) as coachingCompleted_week,
          COALESCE(coaching_scheduled_month.coachingScheduled_month, 0) as coachingScheduled_month,
          COALESCE(coaching_completed_month.coachingCompleted_month, 0) as coachingCompleted_month
        FROM users u
        JOIN roles r ON u.role_id = r.id
        LEFT JOIN departments d ON u.department_id = d.id
        LEFT JOIN (
          SELECT
            CAST(sm.value AS UNSIGNED) as csr_id,
            COUNT(s.id) as audits
          FROM submissions s
          JOIN submission_metadata sm ON s.id = sm.submission_id
          JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
          JOIN roles active_role ON active_csr.role_id = active_role.id
          WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
          AND fmf.field_name = 'CSR'
          AND active_role.role_name = 'CSR'
          AND active_csr.is_active = 1
          GROUP BY sm.value
        ) audit_counts ON u.id = audit_counts.csr_id
        LEFT JOIN (
          SELECT
            CAST(sm.value AS UNSIGNED) as csr_id,
            COUNT(disp.id) as disputes
          FROM submissions s
          JOIN submission_metadata sm ON s.id = sm.submission_id
          JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          JOIN disputes disp ON disp.submission_id = s.id
          JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
          JOIN roles active_role ON active_csr.role_id = active_role.id
          WHERE fmf.field_name = 'CSR'
          AND active_role.role_name = 'CSR'
          AND active_csr.is_active = 1
          GROUP BY sm.value
        ) dispute_counts ON u.id = dispute_counts.csr_id
        LEFT JOIN (
          SELECT
            CAST(sm.value AS UNSIGNED) as csr_id,
            COUNT(s.id) as audits_week
          FROM submissions s
          JOIN submission_metadata sm ON s.id = sm.submission_id
          JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
          JOIN roles active_role ON active_csr.role_id = active_role.id
          WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
          AND fmf.field_name = 'CSR'
          AND active_role.role_name = 'CSR'
          AND active_csr.is_active = 1
          AND s.submitted_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
          GROUP BY sm.value
        ) audit_counts_week ON u.id = audit_counts_week.csr_id
        LEFT JOIN (
          SELECT
            CAST(sm.value AS UNSIGNED) as csr_id,
            COUNT(disp.id) as disputes_week
          FROM submissions s
          JOIN submission_metadata sm ON s.id = sm.submission_id
          JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          JOIN disputes disp ON disp.submission_id = s.id
          JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
          JOIN roles active_role ON active_csr.role_id = active_role.id
          WHERE fmf.field_name = 'CSR'
          AND active_role.role_name = 'CSR'
          AND active_csr.is_active = 1
          AND disp.created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
          GROUP BY sm.value
        ) dispute_counts_week ON u.id = dispute_counts_week.csr_id
        LEFT JOIN (
          SELECT
            CAST(sm.value AS UNSIGNED) as csr_id,
            COUNT(s.id) as audits_month
          FROM submissions s
          JOIN submission_metadata sm ON s.id = sm.submission_id
          JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
          JOIN roles active_role ON active_csr.role_id = active_role.id
          WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
          AND fmf.field_name = 'CSR'
          AND active_role.role_name = 'CSR'
          AND active_csr.is_active = 1
          AND s.submitted_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
          GROUP BY sm.value
        ) audit_counts_month ON u.id = audit_counts_month.csr_id
        LEFT JOIN (
          SELECT
            CAST(sm.value AS UNSIGNED) as csr_id,
            COUNT(disp.id) as disputes_month
          FROM submissions s
          JOIN submission_metadata sm ON s.id = sm.submission_id
          JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          JOIN disputes disp ON disp.submission_id = s.id
          JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
          JOIN roles active_role ON active_csr.role_id = active_role.id
          WHERE fmf.field_name = 'CSR'
          AND active_role.role_name = 'CSR'
          AND active_csr.is_active = 1
          AND disp.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
          GROUP BY sm.value
        ) dispute_counts_month ON u.id = dispute_counts_month.csr_id
        LEFT JOIN (
          SELECT
            cs.csr_id,
            COUNT(cs.id) as coachingScheduled
          FROM coaching_sessions cs
          WHERE cs.status = 'SCHEDULED'
          GROUP BY cs.csr_id
        ) coaching_scheduled ON u.id = coaching_scheduled.csr_id
        LEFT JOIN (
          SELECT
            cs.csr_id,
            COUNT(cs.id) as coachingCompleted
          FROM coaching_sessions cs
          WHERE cs.status = 'COMPLETED'
          GROUP BY cs.csr_id
        ) coaching_completed ON u.id = coaching_completed.csr_id
        LEFT JOIN (
          SELECT
            cs.csr_id,
            COUNT(cs.id) as coachingScheduled_week
          FROM coaching_sessions cs
          WHERE cs.status = 'SCHEDULED'
          AND cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
          GROUP BY cs.csr_id
        ) coaching_scheduled_week ON u.id = coaching_scheduled_week.csr_id
        LEFT JOIN (
          SELECT
            cs.csr_id,
            COUNT(cs.id) as coachingCompleted_week
          FROM coaching_sessions cs
          WHERE cs.status = 'COMPLETED'
          AND cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
          GROUP BY cs.csr_id
        ) coaching_completed_week ON u.id = coaching_completed_week.csr_id
        LEFT JOIN (
          SELECT
            cs.csr_id,
            COUNT(cs.id) as coachingScheduled_month
          FROM coaching_sessions cs
          WHERE cs.status = 'SCHEDULED'
          AND cs.session_date >= DATE_FORMAT(NOW(), '%Y-%m-01')
          GROUP BY cs.csr_id
        ) coaching_scheduled_month ON u.id = coaching_scheduled_month.csr_id
        LEFT JOIN (
          SELECT
            cs.csr_id,
            COUNT(cs.id) as coachingCompleted_month
          FROM coaching_sessions cs
          WHERE cs.status = 'COMPLETED'
          AND cs.session_date >= DATE_FORMAT(NOW(), '%Y-%m-01')
          GROUP BY cs.csr_id
        ) coaching_completed_month ON u.id = coaching_completed_month.csr_id
        WHERE r.role_name = 'CSR'
        AND u.is_active = 1
        ORDER BY u.username
      `);

      return csrActivity.map(row => ({
        id: Number(row.id),
        name: row.name,
        department: row.department || 'No Department',
        audits: Number(row.audits),
        disputes: Number(row.disputes),
        coachingScheduled: Number(row.coachingScheduled),
        coachingCompleted: Number(row.coachingCompleted),
        audits_week: Number(row.audits_week),
        disputes_week: Number(row.disputes_week),
        audits_month: Number(row.audits_month),
        disputes_month: Number(row.disputes_month),
        coachingScheduled_week: Number(row.coachingScheduled_week),
        coachingCompleted_week: Number(row.coachingCompleted_week),
        coachingScheduled_month: Number(row.coachingScheduled_month),
        coachingCompleted_month: Number(row.coachingCompleted_month),
      }));
    } catch (error) {
      trainerLogger.operationError('getCSRActivity', error as Error, trainerId);
      throw new TrainerServiceError('Failed to get CSR activity', 500);
    }
  }

  /**
   * Validate if trainer can coach a specific CSR
   * Trainers can coach any active CSR in the system
   */
  async validateTrainerCSRAccess(trainerId: number, csr_id: number): Promise<boolean> {
    try {
      const trainerRows = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        SELECT id FROM users WHERE id = ${trainerId} AND role_id = 4 AND is_active = 1
      `);

      if (trainerRows.length === 0) {
        return false;
      }

      const csrRows = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        SELECT u.id
        FROM users u
        JOIN departments d ON u.department_id = d.id
        WHERE u.id = ${csr_id}
        AND u.role_id = 3
        AND u.is_active = 1
        AND d.is_active = 1
      `);

      return csrRows.length > 0;
    } catch (error) {
      console.error('[TRAINER SERVICE] Error validating trainer-CSR access:', error);
      return false;
    }
  }

  /**
   * Get training statistics for trainer dashboard
   */
  async getTrainingStats(trainerId: number): Promise<{
    activeCourses: number;
    totalEnrollments: number;
    completionRate: number;
  }> {
    try {
      const trainerRows = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        SELECT id FROM users WHERE id = ${trainerId} AND role_id = 4 AND is_active = 1
      `);

      if (trainerRows.length === 0) {
        throw new TrainerServiceError('Trainer not found or inactive', 404, 'TRAINER_NOT_FOUND');
      }

      const [activeCoursesRows, totalEnrollmentsRows, completionRateRows] = await Promise.all([
        prisma.$queryRaw<{ activeCourses: number }[]>(Prisma.sql`
          SELECT COUNT(DISTINCT e.course_id) as activeCourses
          FROM enrollments e
          WHERE e.course_id IS NOT NULL
        `),
        prisma.$queryRaw<{ totalEnrollments: number }[]>(Prisma.sql`
          SELECT COUNT(*) as totalEnrollments FROM enrollments
        `),
        prisma.$queryRaw<{ total: number; completed: number }[]>(Prisma.sql`
          SELECT
            COUNT(*) as total,
            COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed
          FROM enrollments
        `)
      ]);

      const total = Number(completionRateRows[0]?.total) || 0;
      const completed = Number(completionRateRows[0]?.completed) || 0;
      const rate = total > 0 ? Math.round((completed / total) * 100) : 0;

      return {
        activeCourses: Number(activeCoursesRows[0]?.activeCourses) || 0,
        totalEnrollments: Number(totalEnrollmentsRows[0]?.totalEnrollments) || 0,
        completionRate: rate
      };
    } catch (error) {
      if (error instanceof TrainerServiceError) {
        throw error;
      }
      console.error('[TRAINER SERVICE] Error fetching training stats:', error);
      throw new TrainerServiceError('Failed to fetch training statistics');
    }
  }
}

// Export singleton instance
export const trainerService = new TrainerService();
