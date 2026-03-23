import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import cacheService from '../services/CacheService';
import { handleDatabaseError } from '../utils/errorHandler';
import logger from '../config/logger';

export interface CSRDashboardStats {
  reviewsCompleted: { thisWeek: number; thisMonth: number };
  disputes: { thisWeek: number; thisMonth: number };
  coachingSessions: { thisWeek: number; thisMonth: number };
}

export interface CSRActivityData {
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

export class CSRRepository {

  static async getDashboardStats(csr_id: number): Promise<CSRDashboardStats> {
    const startTime = Date.now();

    try {
      const cached = cacheService.getCSRDashboardStats(csr_id);
      if (cached) {
        logger.debug('CSR dashboard stats served from cache', { csr_id, duration: Date.now() - startTime });
        return cached;
      }

      const csrIdStr = csr_id.toString();

      const [reviewsCompleted, disputes, coachingSessions] = await Promise.all([
        prisma.$queryRaw<{ thisWeek: number; thisMonth: number }[]>(Prisma.sql`
          SELECT 
            COUNT(CASE WHEN s.submitted_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) as thisWeek,
            COUNT(CASE WHEN s.submitted_at >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 END) as thisMonth
          FROM submissions s
          JOIN submission_metadata sm ON s.id = sm.submission_id
          JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
          AND fmf.field_name = 'CSR'
          AND sm.value = ${csrIdStr}
        `),

        prisma.$queryRaw<{ thisWeek: number; thisMonth: number }[]>(Prisma.sql`
          SELECT 
            COUNT(CASE WHEN d.created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK) AND d.status = 'OPEN' THEN 1 END) as thisWeek,
            COUNT(CASE WHEN d.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01') AND d.status = 'OPEN' THEN 1 END) as thisMonth
          FROM disputes d
          JOIN submissions s ON d.submission_id = s.id
          JOIN submission_metadata sm ON s.id = sm.submission_id
          JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          WHERE fmf.field_name = 'CSR'
          AND CAST(sm.value AS UNSIGNED) = ${csr_id}
        `),

        prisma.$queryRaw<{ thisWeek: number; thisMonth: number }[]>(Prisma.sql`
          SELECT 
            COUNT(CASE WHEN cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) as thisWeek,
            COUNT(CASE WHEN cs.session_date >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 END) as thisMonth
          FROM coaching_sessions cs
          WHERE cs.status = 'COMPLETED'
          AND cs.csr_id = ${csr_id}
        `),
      ]);

      const stats: CSRDashboardStats = {
        reviewsCompleted: {
          thisWeek: Number(reviewsCompleted[0]?.thisWeek) || 0,
          thisMonth: Number(reviewsCompleted[0]?.thisMonth) || 0,
        },
        disputes: {
          thisWeek: Number(disputes[0]?.thisWeek) || 0,
          thisMonth: Number(disputes[0]?.thisMonth) || 0,
        },
        coachingSessions: {
          thisWeek: Number(coachingSessions[0]?.thisWeek) || 0,
          thisMonth: Number(coachingSessions[0]?.thisMonth) || 0,
        },
      };

      cacheService.setCSRDashboardStats(csr_id, stats);
      logger.info('CSR dashboard stats retrieved from database', { csr_id, duration: Date.now() - startTime, cacheSet: true });
      return stats;
    } catch (error: any) {
      logger.error('Error fetching CSR dashboard stats', { csr_id, error: error.message, duration: Date.now() - startTime });
      throw handleDatabaseError(error, { csr_id, operation: 'getDashboardStats' });
    }
  }

  static async getCSRActivity(csr_id: number): Promise<CSRActivityData[]> {
    const startTime = Date.now();

    try {
      const cached = cacheService.getCSRActivity(csr_id);
      if (cached) {
        logger.debug('CSR activity served from cache', { csr_id, duration: Date.now() - startTime });
        return cached;
      }

      const csrIdStr = csr_id.toString();

      const csrActivity = await prisma.$queryRaw<any[]>(Prisma.sql`
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
        LEFT JOIN (SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(s.id) as audits FROM submissions s JOIN submission_metadata sm ON s.id = sm.submission_id JOIN form_metadata_fields fmf ON sm.field_id = fmf.id WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED') AND fmf.field_name = 'CSR' AND sm.value = ${csrIdStr} GROUP BY sm.value) audit_counts ON u.id = audit_counts.csr_id
        LEFT JOIN (SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(disp.id) as disputes FROM submissions s JOIN submission_metadata sm ON s.id = sm.submission_id JOIN form_metadata_fields fmf ON sm.field_id = fmf.id JOIN disputes disp ON disp.submission_id = s.id WHERE fmf.field_name = 'CSR' AND sm.value = ${csrIdStr} AND disp.status = 'OPEN' GROUP BY sm.value) dispute_counts ON u.id = dispute_counts.csr_id
        LEFT JOIN (SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(s.id) as audits_week FROM submissions s JOIN submission_metadata sm ON s.id = sm.submission_id JOIN form_metadata_fields fmf ON sm.field_id = fmf.id WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED') AND fmf.field_name = 'CSR' AND sm.value = ${csrIdStr} AND s.submitted_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK) GROUP BY sm.value) audit_counts_week ON u.id = audit_counts_week.csr_id
        LEFT JOIN (SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(disp.id) as disputes_week FROM submissions s JOIN submission_metadata sm ON s.id = sm.submission_id JOIN form_metadata_fields fmf ON sm.field_id = fmf.id JOIN disputes disp ON disp.submission_id = s.id WHERE fmf.field_name = 'CSR' AND sm.value = ${csrIdStr} AND disp.created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK) AND disp.status = 'OPEN' GROUP BY sm.value) dispute_counts_week ON u.id = dispute_counts_week.csr_id
        LEFT JOIN (SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(s.id) as audits_month FROM submissions s JOIN submission_metadata sm ON s.id = sm.submission_id JOIN form_metadata_fields fmf ON sm.field_id = fmf.id WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED') AND fmf.field_name = 'CSR' AND sm.value = ${csrIdStr} AND s.submitted_at >= DATE_FORMAT(NOW(), '%Y-%m-01') GROUP BY sm.value) audit_counts_month ON u.id = audit_counts_month.csr_id
        LEFT JOIN (SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(disp.id) as disputes_month FROM submissions s JOIN submission_metadata sm ON s.id = sm.submission_id JOIN form_metadata_fields fmf ON sm.field_id = fmf.id JOIN disputes disp ON disp.submission_id = s.id WHERE fmf.field_name = 'CSR' AND sm.value = ${csrIdStr} AND disp.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01') AND disp.status = 'OPEN' GROUP BY sm.value) dispute_counts_month ON u.id = dispute_counts_month.csr_id
        LEFT JOIN (SELECT cs.csr_id, COUNT(cs.id) as coachingScheduled FROM coaching_sessions cs WHERE cs.status = 'SCHEDULED' AND cs.csr_id = ${csr_id} GROUP BY cs.csr_id) coaching_scheduled ON u.id = coaching_scheduled.csr_id
        LEFT JOIN (SELECT cs.csr_id, COUNT(cs.id) as coachingCompleted FROM coaching_sessions cs WHERE cs.status = 'COMPLETED' AND cs.csr_id = ${csr_id} GROUP BY cs.csr_id) coaching_completed ON u.id = coaching_completed.csr_id
        LEFT JOIN (SELECT cs.csr_id, COUNT(cs.id) as coachingScheduled_week FROM coaching_sessions cs WHERE cs.status = 'SCHEDULED' AND cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK) AND cs.csr_id = ${csr_id} GROUP BY cs.csr_id) coaching_scheduled_week ON u.id = coaching_scheduled_week.csr_id
        LEFT JOIN (SELECT cs.csr_id, COUNT(cs.id) as coachingCompleted_week FROM coaching_sessions cs WHERE cs.status = 'COMPLETED' AND cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK) AND cs.csr_id = ${csr_id} GROUP BY cs.csr_id) coaching_completed_week ON u.id = coaching_completed_week.csr_id
        LEFT JOIN (SELECT cs.csr_id, COUNT(cs.id) as coachingScheduled_month FROM coaching_sessions cs WHERE cs.status = 'SCHEDULED' AND cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 MONTH) AND cs.csr_id = ${csr_id} GROUP BY cs.csr_id) coaching_scheduled_month ON u.id = coaching_scheduled_month.csr_id
        LEFT JOIN (SELECT cs.csr_id, COUNT(cs.id) as coachingCompleted_month FROM coaching_sessions cs WHERE cs.status = 'COMPLETED' AND cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 MONTH) AND cs.csr_id = ${csr_id} GROUP BY cs.csr_id) coaching_completed_month ON u.id = coaching_completed_month.csr_id
        WHERE r.role_name = 'CSR' 
        AND u.is_active = 1
        AND u.id = ${csr_id}
        ORDER BY u.username
      `);

      const activity: CSRActivityData[] = csrActivity.map((row) => ({
        id: row.id,
        name: row.name,
        department: row.department || 'No Department',
        audits: Number(row.audits) || 0,
        disputes: Number(row.disputes) || 0,
        coachingScheduled: Number(row.coachingScheduled) || 0,
        coachingCompleted: Number(row.coachingCompleted) || 0,
        audits_week: Number(row.audits_week) || 0,
        disputes_week: Number(row.disputes_week) || 0,
        audits_month: Number(row.audits_month) || 0,
        disputes_month: Number(row.disputes_month) || 0,
        coachingScheduled_week: Number(row.coachingScheduled_week) || 0,
        coachingCompleted_week: Number(row.coachingCompleted_week) || 0,
        coachingScheduled_month: Number(row.coachingScheduled_month) || 0,
        coachingCompleted_month: Number(row.coachingCompleted_month) || 0,
      }));

      cacheService.setCSRActivity(csr_id, activity);
      logger.info('CSR activity retrieved from database', { csr_id, recordCount: activity.length, duration: Date.now() - startTime, cacheSet: true });
      return activity;
    } catch (error: any) {
      logger.error('Error fetching CSR activity', { csr_id, error: error.message, duration: Date.now() - startTime });
      throw handleDatabaseError(error, { csr_id, operation: 'getCSRActivity' });
    }
  }

  static async getCSRQAStats(csr_id: number): Promise<{ avgScore: number; totalAudits: number }> {
    const startTime = Date.now();

    try {
      const cached = cacheService.getCSRQAStats(csr_id);
      if (cached) {
        logger.debug('CSR QA stats served from cache', { csr_id, duration: Date.now() - startTime });
        return cached;
      }

      const csrIdStr = csr_id.toString();
      const rows = await prisma.$queryRaw<{ avg_score: number | null; total_audits: number }[]>(Prisma.sql`
        SELECT 
          AVG(s.total_score) as avg_score,
          COUNT(*) as total_audits
        FROM submissions s
        JOIN submission_metadata sm ON sm.submission_id = s.id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        WHERE fmf.field_name = 'CSR' AND sm.value = ${csrIdStr} AND s.status = 'FINALIZED'
        AND s.submitted_at > DATE_SUB(NOW(), INTERVAL 90 DAY)
      `);

      const stats = {
        avgScore: Number(rows[0]?.avg_score) || 0,
        totalAudits: Number(rows[0]?.total_audits) || 0,
      };

      cacheService.setCSRQAStats(csr_id, stats);
      logger.debug('CSR QA stats retrieved from database', { csr_id, stats, duration: Date.now() - startTime, cacheSet: true });
      return stats;
    } catch (error: any) {
      logger.error('Error fetching CSR QA stats', { csr_id, error: error.message, duration: Date.now() - startTime });
      throw handleDatabaseError(error, { csr_id, operation: 'getCSRQAStats' });
    }
  }

  static async getCSRTrainingStats(csr_id: number): Promise<{ completed: number; assigned: number }> {
    const startTime = Date.now();

    try {
      const cached = cacheService.getCSRTrainingStats(csr_id);
      if (cached) {
        logger.debug('CSR training stats served from cache', { csr_id, duration: Date.now() - startTime });
        return cached;
      }

      const [completedCount, assignedCount] = await prisma.$transaction([
        prisma.enrollment.count({ where: { user_id: csr_id, status: 'COMPLETED' } }),
        prisma.enrollment.count({ where: { user_id: csr_id } }),
      ]);

      const stats = { completed: completedCount, assigned: assignedCount };

      cacheService.setCSRTrainingStats(csr_id, stats);
      logger.debug('CSR training stats retrieved from database', { csr_id, stats, duration: Date.now() - startTime, cacheSet: true });
      return stats;
    } catch (error: any) {
      logger.error('Error fetching CSR training stats', { csr_id, error: error.message, duration: Date.now() - startTime });
      throw handleDatabaseError(error, { csr_id, operation: 'getCSRTrainingStats' });
    }
  }

  static invalidateCSRCache(csr_id: number): void {
    cacheService.invalidateCSRCache(csr_id);
    logger.info('CSR cache invalidated', { csr_id });
  }

  static async healthCheck(): Promise<boolean> {
    try {
      await prisma.$queryRaw(Prisma.sql`SELECT 1`);
      return true;
    } catch (error: any) {
      logger.error('CSR Repository health check failed', { error: error.message });
      return false;
    }
  }
}
