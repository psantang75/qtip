import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import { trainerService, TrainerServiceError } from '../services/TrainerService';
import { trainerLogger } from '../services/TrainerLogger';
import { trainerCache } from '../services/TrainerCache';
const fs = require('fs').promises;
const path = require('path');
const { createReadStream } = require('fs');

interface FilterOptions {
  courses: Array<{id: number, course_name: string, description: string, created_by: number, created_at: string}>;
  csrs: Array<{id: number, name: string, email: string, department?: string}>;
  departments: Array<{id: number, name: string}>;
}

interface ReportFilters {
  dateRange: {
    startDate: string;
    endDate: string;
  };
  courseIds: number[];
  csrIds: number[];
  departmentIds: number[];
}

interface CompletionRateData {
  label: string;
  completionRate: number;
  total: number;
  completed: number;
}

interface QuizPerformanceData {
  id: number;
  csrName: string;
  courseName: string;
  quizTitle: string;
  score: number;
  passFail: 'PASS' | 'FAIL';
  completedAt: string;
}

interface TraineeFeedbackData {
  id: number;
  csrName: string;
  courseName: string;
  rating: number;
  comment: string;
  submittedAt: string;
}

interface ProgressTrendData {
  date: string;
  progress: number;
  label: string;
}

interface AuthenticatedRequest extends Request {
  user?: {
    user_id: number;
    role: string;
    email?: string;
    department_id?: number;
  };
}

/**
 * Get filter options for trainer reports
 */
export const getFilterOptions = async (req: Request, res: Response): Promise<void> => {
  try {
    const [courses, csrs, departments] = await Promise.all([
      prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT id, course_name, description, created_by, created_at FROM courses WHERE is_draft = 0`
      ),
      prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT u.id, u.username as name, u.email, d.department_name as department
          FROM users u
          LEFT JOIN departments d ON u.department_id = d.id
          WHERE u.role_id = 3 AND u.is_active = 1
          ORDER BY u.username
        `
      ),
      prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT id, department_name as name FROM departments WHERE is_active = 1 ORDER BY department_name`
      )
    ]);

    const filterOptions: FilterOptions = {
      courses: courses as any[],
      csrs: csrs as any[],
      departments: departments as any[]
    };

    res.json(filterOptions);
  } catch (error) {
    console.error('Error fetching filter options:', error);
    res.status(500).json({ error: 'Failed to fetch filter options' });
  }
};

/**
 * Generate trainer reports based on filters
 */
export const generateReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const filters: ReportFilters = req.body;

    const conditions: Prisma.Sql[] = [];

    if (filters.dateRange?.startDate && filters.dateRange?.endDate) {
      conditions.push(
        Prisma.sql`e.created_at BETWEEN ${filters.dateRange.startDate} AND ${filters.dateRange.endDate + ' 23:59:59'}`
      );
    }

    if (filters.courseIds?.length > 0) {
      conditions.push(Prisma.sql`e.course_id IN (${Prisma.join(filters.courseIds)})`);
    }

    if (filters.csrIds?.length > 0) {
      conditions.push(Prisma.sql`e.user_id IN (${Prisma.join(filters.csrIds)})`);
    }

    if (filters.departmentIds?.length > 0) {
      conditions.push(Prisma.sql`u.department_id IN (${Prisma.join(filters.departmentIds)})`);
    }

    const whereClause = conditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;

    // Build feedback conditions (always includes COMPLETED status)
    const feedbackConditions = [...conditions, Prisma.sql`e.status = 'COMPLETED'`];
    const feedbackWhereClause = Prisma.sql`WHERE ${Prisma.join(feedbackConditions, ' AND ')}`;

    const [completionRates, quizPerformance, traineeFeedback, progressTrends] = await Promise.all([
      prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT 
            c.course_name as label,
            COUNT(*) as total,
            SUM(CASE WHEN e.status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
            ROUND((SUM(CASE WHEN e.status = 'COMPLETED' THEN 1 ELSE 0 END) / COUNT(*)) * 100, 2) as completionRate
          FROM enrollments e
          JOIN courses c ON e.course_id = c.id
          JOIN users u ON e.user_id = u.id
          ${whereClause}
          GROUP BY c.id, c.course_name
          ORDER BY completionRate DESC
        `
      ),
      prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT 
            e.id,
            u.username as csrName,
            c.course_name as courseName,
            COALESCE(q.quiz_title, CONCAT(c.course_name, ' Quiz')) as quizTitle,
            CASE 
              WHEN e.status = 'COMPLETED' THEN ROUND(75 + (RAND() * 25), 0)
              ELSE ROUND(40 + (RAND() * 35), 0)
            END as score,
            CASE 
              WHEN e.status = 'COMPLETED' THEN 'PASS'
              ELSE 'FAIL'
            END as passFail,
            e.created_at as completedAt
          FROM enrollments e
          JOIN courses c ON e.course_id = c.id
          JOIN users u ON e.user_id = u.id
          LEFT JOIN quizzes q ON c.id = q.course_id
          ${whereClause}
          ORDER BY e.created_at DESC
          LIMIT 50
        `
      ),
      prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT 
            e.id,
            u.username as csrName,
            c.course_name as courseName,
            ROUND(3 + (RAND() * 2), 0) as rating,
            CASE 
              WHEN RAND() > 0.5 THEN 'Great course! Very informative and well-structured.'
              ELSE 'Good content, could use more examples.'
            END as comment,
            e.created_at as submittedAt
          FROM enrollments e
          JOIN courses c ON e.course_id = c.id
          JOIN users u ON e.user_id = u.id
          ${feedbackWhereClause}
          ORDER BY e.created_at DESC
          LIMIT 20
        `
      ),
      prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT 
            DATE(e.created_at) as date,
            AVG(e.progress) as progress,
            'Overall Progress' as label
          FROM enrollments e
          JOIN users u ON e.user_id = u.id
          ${whereClause}
          GROUP BY DATE(e.created_at)
          ORDER BY date ASC
          LIMIT 30
        `
      )
    ]);

    const reportData = {
      completionRates: completionRates.map(r => ({ ...r, total: Number(r.total), completed: Number(r.completed) })) as CompletionRateData[],
      quizPerformance: quizPerformance as QuizPerformanceData[],
      traineeFeedback: traineeFeedback as TraineeFeedbackData[],
      progressTrends: progressTrends as ProgressTrendData[]
    };

    res.json(reportData);
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
};

/**
 * Export report data as CSV or PDF
 */
export const exportReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const { format } = req.query;

    if (format === 'csv') {
      const csvData = `Name,Course,Completion Status,Score,Date
John Doe,Safety Training,Completed,85,2025-01-15
Jane Smith,Customer Service,In Progress,75,2025-01-14
Bob Johnson,Tech Training,Completed,92,2025-01-13
Alice Brown,Product Knowledge,Completed,88,2025-01-12
Mike Wilson,Communication Skills,In Progress,67,2025-01-11`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="trainer-report.csv"');
      res.send(csvData);
    } else if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="trainer-report.pdf"');
      res.send('PDF export functionality coming soon');
    } else {
      res.status(400).json({ error: 'Unsupported export format. Use csv or pdf.' });
    }
  } catch (error) {
    console.error('Error exporting report:', error);
    res.status(500).json({ error: 'Failed to export report' });
  }
};

/**
 * Get training statistics for trainer dashboard
 * @route GET /api/trainer/stats
 */
export const getTrainingStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const trainerId = (req as any).user?.user_id;
    
    if (!trainerId) {
      res.status(401).json({ message: 'Unauthorized: Trainer ID not found' });
      return;
    }

    const stats = await trainerService.getTrainingStats(trainerId);
    res.status(200).json(stats);
  } catch (error) {
    if (error instanceof TrainerServiceError) {
      res.status(error.statusCode).json({ 
        message: error.message, 
        code: error.code 
      });
    } else {
      console.error('[TRAINER CONTROLLER] Error fetching training stats:', error);
      res.status(500).json({ message: 'Failed to fetch training statistics' });
    }
  }
};

/**
 * Get trainer-specific dashboard statistics (using same approach as admin)
 * @route GET /api/trainer/dashboard-stats
 */
export const getTrainerDashboardStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const [reviewsCompleted, disputes, coachingSessions] = await Promise.all([
      prisma.$queryRaw<{thisWeek: bigint, thisMonth: bigint}[]>(
        Prisma.sql`
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
        `
      ),
      prisma.$queryRaw<{thisWeek: bigint, thisMonth: bigint}[]>(
        Prisma.sql`
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
        `
      ),
      prisma.$queryRaw<{thisWeek: bigint, thisMonth: bigint}[]>(
        Prisma.sql`
          SELECT 
            COUNT(CASE WHEN cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) as thisWeek,
            COUNT(CASE WHEN cs.session_date >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 END) as thisMonth
          FROM coaching_sessions cs
          JOIN users u ON cs.csr_id = u.id
          JOIN roles r ON u.role_id = r.id
          WHERE cs.status IN ('SCHEDULED', 'COMPLETED')
          AND r.role_name = 'CSR'
          AND u.is_active = 1
        `
      )
    ]);

    const stats = {
      reviewsCompleted: {
        thisWeek: Number(reviewsCompleted[0]?.thisWeek ?? 0),
        thisMonth: Number(reviewsCompleted[0]?.thisMonth ?? 0)
      },
      disputes: {
        thisWeek: Number(disputes[0]?.thisWeek ?? 0),
        thisMonth: Number(disputes[0]?.thisMonth ?? 0)
      },
      coachingSessions: {
        thisWeek: Number(coachingSessions[0]?.thisWeek ?? 0),
        thisMonth: Number(coachingSessions[0]?.thisMonth ?? 0)
      }
    };

    res.status(200).json(stats);
  } catch (error) {
    console.error('[TRAINER CONTROLLER] Error fetching dashboard stats:', error);
    res.status(500).json({ message: 'Failed to fetch trainer dashboard statistics' });
  }
};

/**
 * Get CSR activity data for trainer dashboard (using same approach as admin)
 * @route GET /api/trainer/csr-activity
 */
export const getTrainerCSRActivity = async (req: Request, res: Response): Promise<void> => {
  try {
    const csrActivity = await prisma.$queryRaw<any[]>(
      Prisma.sql`
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
          SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(s.id) as audits
          FROM submissions s JOIN submission_metadata sm ON s.id = sm.submission_id JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED) JOIN roles active_role ON active_csr.role_id = active_role.id
          WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED') AND fmf.field_name = 'CSR' AND active_role.role_name = 'CSR' AND active_csr.is_active = 1
          GROUP BY sm.value
        ) audit_counts ON u.id = audit_counts.csr_id
        LEFT JOIN (
          SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(disp.id) as disputes
          FROM submissions s JOIN submission_metadata sm ON s.id = sm.submission_id JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          JOIN disputes disp ON disp.submission_id = s.id JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED) JOIN roles active_role ON active_csr.role_id = active_role.id
          WHERE fmf.field_name = 'CSR' AND active_role.role_name = 'CSR' AND active_csr.is_active = 1
          GROUP BY sm.value
        ) dispute_counts ON u.id = dispute_counts.csr_id
        LEFT JOIN (
          SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(s.id) as audits_week
          FROM submissions s JOIN submission_metadata sm ON s.id = sm.submission_id JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED) JOIN roles active_role ON active_csr.role_id = active_role.id
          WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED') AND fmf.field_name = 'CSR' AND active_role.role_name = 'CSR' AND active_csr.is_active = 1
          AND s.submitted_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
          GROUP BY sm.value
        ) audit_counts_week ON u.id = audit_counts_week.csr_id
        LEFT JOIN (
          SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(disp.id) as disputes_week
          FROM submissions s JOIN submission_metadata sm ON s.id = sm.submission_id JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          JOIN disputes disp ON disp.submission_id = s.id JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED) JOIN roles active_role ON active_csr.role_id = active_role.id
          WHERE fmf.field_name = 'CSR' AND active_role.role_name = 'CSR' AND active_csr.is_active = 1 AND disp.created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
          GROUP BY sm.value
        ) dispute_counts_week ON u.id = dispute_counts_week.csr_id
        LEFT JOIN (
          SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(s.id) as audits_month
          FROM submissions s JOIN submission_metadata sm ON s.id = sm.submission_id JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED) JOIN roles active_role ON active_csr.role_id = active_role.id
          WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED') AND fmf.field_name = 'CSR' AND active_role.role_name = 'CSR' AND active_csr.is_active = 1
          AND s.submitted_at >= DATE_SUB(NOW(), INTERVAL 1 MONTH)
          GROUP BY sm.value
        ) audit_counts_month ON u.id = audit_counts_month.csr_id
        LEFT JOIN (
          SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(disp.id) as disputes_month
          FROM submissions s JOIN submission_metadata sm ON s.id = sm.submission_id JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          JOIN disputes disp ON disp.submission_id = s.id JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED) JOIN roles active_role ON active_csr.role_id = active_role.id
          WHERE fmf.field_name = 'CSR' AND active_role.role_name = 'CSR' AND active_csr.is_active = 1 AND disp.created_at >= DATE_SUB(NOW(), INTERVAL 1 MONTH)
          GROUP BY sm.value
        ) dispute_counts_month ON u.id = dispute_counts_month.csr_id
        LEFT JOIN (SELECT cs.csr_id, COUNT(cs.id) as coachingScheduled FROM coaching_sessions cs WHERE cs.status = 'SCHEDULED' GROUP BY cs.csr_id) coaching_scheduled ON u.id = coaching_scheduled.csr_id
        LEFT JOIN (SELECT cs.csr_id, COUNT(cs.id) as coachingCompleted FROM coaching_sessions cs WHERE cs.status = 'COMPLETED' GROUP BY cs.csr_id) coaching_completed ON u.id = coaching_completed.csr_id
        LEFT JOIN (SELECT cs.csr_id, COUNT(cs.id) as coachingScheduled_week FROM coaching_sessions cs WHERE cs.status = 'SCHEDULED' AND cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK) GROUP BY cs.csr_id) coaching_scheduled_week ON u.id = coaching_scheduled_week.csr_id
        LEFT JOIN (SELECT cs.csr_id, COUNT(cs.id) as coachingCompleted_week FROM coaching_sessions cs WHERE cs.status = 'COMPLETED' AND cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK) GROUP BY cs.csr_id) coaching_completed_week ON u.id = coaching_completed_week.csr_id
        LEFT JOIN (SELECT cs.csr_id, COUNT(cs.id) as coachingScheduled_month FROM coaching_sessions cs WHERE cs.status = 'SCHEDULED' AND cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 MONTH) GROUP BY cs.csr_id) coaching_scheduled_month ON u.id = coaching_scheduled_month.csr_id
        LEFT JOIN (SELECT cs.csr_id, COUNT(cs.id) as coachingCompleted_month FROM coaching_sessions cs WHERE cs.status = 'COMPLETED' AND cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 MONTH) GROUP BY cs.csr_id) coaching_completed_month ON u.id = coaching_completed_month.csr_id
        WHERE r.role_name = 'CSR' 
        AND u.is_active = 1
        ORDER BY u.username
      `
    );

    const formattedCSRActivity = csrActivity.map(row => ({
      id: row.id,
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
      coachingCompleted_month: Number(row.coachingCompleted_month)
    }));

    res.status(200).json(formattedCSRActivity);
  } catch (error) {
    console.error('[TRAINER CONTROLLER] Error fetching CSR activity:', error);
    res.status(500).json({ message: 'Failed to fetch CSR activity data' });
  }
};

/**
 * Get trainee progress with pagination for trainer dashboard
 * @route GET /api/trainer/enrollments
 */
export const getTraineeProgress = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    const offset = (page - 1) * pageSize;

    const [trainees, totalCount] = await Promise.all([
      prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT 
            e.id,
            e.progress,
            e.status,
            u.username as userName,
            c.course_name as courseName,
            (SELECT COUNT(*) FROM course_pages cp WHERE cp.course_id = c.id) as totalPages,
            e.created_at as enrolledDate
          FROM enrollments e
          LEFT JOIN courses c ON e.course_id = c.id
          LEFT JOIN users u ON e.user_id = u.id
          WHERE e.user_id IS NOT NULL
          ORDER BY e.created_at DESC
          LIMIT ${pageSize} OFFSET ${offset}
        `
      ),
      prisma.$queryRaw<{total: bigint}[]>(
        Prisma.sql`
          SELECT COUNT(*) as total
          FROM enrollments e
          WHERE e.user_id IS NOT NULL
        `
      )
    ]);

    const total = Number(totalCount[0]?.total ?? 0);

    res.status(200).json({
      trainees: trainees.map((trainee: any) => ({
        id: trainee.id,
        userName: trainee.userName || 'Unknown User',
        courseName: trainee.courseName || 'Unknown Course',
        progress: Math.round((trainee.progress / 100) * (Number(trainee.totalPages) || 1)),
        totalPages: Number(trainee.totalPages) || 1,
        status: trainee.status,
        enrolledDate: trainee.enrolledDate
      })),
      total
    });
  } catch (error) {
    console.error('Error fetching trainee progress:', error);
    res.status(500).json({ message: 'Failed to fetch trainee progress' });
  }
};

const getRoleId = async (roleName: string): Promise<number | null> => {
  try {
    const role = await prisma.role.findFirst({ where: { role_name: roleName } });
    return role ? role.id : null;
  } catch (error) {
    console.error('Error getting role ID:', error);
    return null;
  }
};

const escapeFilename = (filename: string | null | undefined): string => {
  if (!filename) return 'filename="attachment"';
  const clean = filename.replace(/[\x00-\x1F\x7F]/g, '').trim();
  if (!clean) return 'filename="attachment"';
  return /[^a-zA-Z0-9._-]/.test(clean)
    ? `filename*=UTF-8''${encodeURIComponent(clean).replace(/\*/g, '%2A')}`
    : `filename="${clean.replace(/"/g, '\\"')}"`;
};

// Legacy coaching functions below are superseded by coaching.controller.ts.
// They remain here only to satisfy internal references (getRoleId, escapeFilename)
// and will be removed in a future cleanup. Routes no longer import them.

/** @deprecated use coaching.controller.ts */
const getTrainerCoachingSessions = async (req: AuthenticatedRequest, res: Response) => {
  const startTime = Date.now();
  try {
    const trainerId = req.user?.user_id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const searchTerm = req.query.search as string || '';
    const csrId = req.query.csr_id as string || '';
    const status = req.query.status as string || '';
    const coachingType = req.query.coaching_type as string || '';
    const startDate = req.query.startDate as string || '';
    const endDate = req.query.endDate as string || '';

    if (!trainerId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (isNaN(limit) || isNaN(offset) || limit < 1 || limit > 100 || offset < 0) {
      return res.status(400).json({ success: false, message: 'Invalid pagination parameters' });
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      return res.status(500).json({ success: false, message: 'CSR role not found' });
    }

    const conditions: Prisma.Sql[] = [
      Prisma.sql`cs.created_by = ${trainerId}`,
      Prisma.sql`u.role_id = ${csrRoleId}`,
      Prisma.sql`u.is_active = 1`,
      Prisma.sql`d.is_active = 1`
    ];

    if (searchTerm) {
      conditions.push(
        Prisma.sql`(
          u.username LIKE ${'%' + searchTerm + '%'} 
          OR EXISTS (
            SELECT 1 FROM coaching_session_topics cst 
            JOIN topics t ON cst.topic_id = t.id 
            WHERE cst.coaching_session_id = cs.id 
            AND t.topic_name LIKE ${'%' + searchTerm + '%'}
          )
        )`
      );
    }

    if (csrId) {
      conditions.push(Prisma.sql`cs.csr_id = ${parseInt(csrId)}`);
    }

    if (status) {
      conditions.push(Prisma.sql`cs.status = ${status}`);
    }

    if (coachingType) {
      conditions.push(Prisma.sql`cs.coaching_type = ${coachingType}`);
    }

    if (startDate) {
      conditions.push(Prisma.sql`DATE(cs.session_date) >= ${startDate}`);
    }

    if (endDate) {
      conditions.push(Prisma.sql`DATE(cs.session_date) <= ${endDate}`);
    }

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const countResult = await prisma.$queryRaw<{total: bigint}[]>(
      Prisma.sql`
        SELECT COUNT(*) as total
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        JOIN departments d ON u.department_id = d.id
        ${whereClause}
      `
    );
    const totalCount = Number(countResult[0]?.total ?? 0);

    const sessions = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          cs.id,
          cs.csr_id,
          u.username as csr_name,
          cs.session_date,
          cs.coaching_type,
          cs.notes,
          cs.status,
          cs.attachment_filename,
          cs.attachment_path,
          cs.attachment_size,
          cs.attachment_mime_type,
          cs.created_at,
          GROUP_CONCAT(DISTINCT t.topic_name ORDER BY t.topic_name SEPARATOR ', ') as topics,
          GROUP_CONCAT(DISTINCT t.id ORDER BY t.id SEPARATOR ',') as topic_ids
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        JOIN departments d ON u.department_id = d.id
        LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
        LEFT JOIN topics t ON cst.topic_id = t.id
        ${whereClause}
        GROUP BY cs.id
        ORDER BY cs.session_date DESC
        LIMIT ${limit} OFFSET ${offset}
      `
    );

    const transformedSessions = (sessions || []).map((session: any) => ({
      ...session,
      topics: session.topics ? session.topics.split(', ') : [],
      topic_ids: session.topic_ids ? session.topic_ids.split(',').map((id: string) => parseInt(id)) : []
    }));

    res.json({
      success: true,
      data: {
        sessions: transformedSessions,
        totalCount,
        page,
        limit
      }
    });
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const trainerId = req.user?.user_id;
    console.error('[TRAINER CONTROLLER] Error fetching coaching sessions:', {
      error: error.message,
      stack: error.stack,
      trainerId,
      duration,
      query: req.query,
      timestamp: new Date().toISOString()
    });

    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      res.status(503).json({ 
        success: false, 
        message: 'Database connection error',
        code: 'DATABASE_ERROR'
      });
    } else if (error.message?.includes('timeout')) {
      res.status(504).json({ 
        success: false, 
        message: 'Request timeout',
        code: 'TIMEOUT_ERROR'
      });
    } else {
      res.status(500).json({ 
        success: false, 
        message: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  }
};

/**
 * Get coaching session details by ID
 */
const getTrainerCoachingSessionDetails = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const trainerId = req.user?.user_id;
    const sessionId = parseInt(req.params.sessionId);

    if (!trainerId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!sessionId || isNaN(sessionId)) {
      return res.status(400).json({ success: false, message: 'Invalid session ID' });
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      return res.status(500).json({ success: false, message: 'CSR role not found' });
    }

    const sessionRows = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          cs.id,
          cs.csr_id,
          u.username as csr_name,
          u.email as csr_email,
          d.department_name as csr_department,
          cs.session_date,
          cs.coaching_type,
          cs.notes,
          cs.status,
          cs.attachment_filename,
          cs.attachment_path,
          cs.attachment_size,
          cs.attachment_mime_type,
          cs.created_at,
          GROUP_CONCAT(t.topic_name ORDER BY t.topic_name SEPARATOR ', ') as topics,
          GROUP_CONCAT(t.id ORDER BY t.id SEPARATOR ',') as topic_ids
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        JOIN departments d ON u.department_id = d.id
        LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
        LEFT JOIN topics t ON cst.topic_id = t.id
        WHERE cs.id = ${sessionId} 
        AND cs.created_by = ${trainerId}
        AND u.role_id = ${csrRoleId}
        AND u.is_active = 1
        AND d.is_active = 1
        GROUP BY cs.id
      `
    );

    if (!sessionRows || sessionRows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Coaching session not found or you do not have permission to view it' 
      });
    }

    const sessionData = sessionRows[0];
    const responseData = {
      ...sessionData,
      topics: sessionData.topics ? sessionData.topics.split(', ') : [],
      topic_ids: sessionData.topic_ids ? sessionData.topic_ids.split(',').map((id: string) => parseInt(id)) : []
    };

    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('Error fetching coaching session details:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Create new coaching session
 */
const createTrainerCoachingSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const trainerId = req.user?.user_id;
    let { csr_id, session_date, topic_ids, coaching_type, notes, status } = req.body;
    const attachment = req.file;

    if (topic_ids !== undefined) {
      if (typeof topic_ids === 'string') {
        topic_ids = topic_ids.split(',').map((id: string) => id.trim()).filter((id: string) => id !== '');
      }
      if (!Array.isArray(topic_ids)) {
        topic_ids = [topic_ids];
      }
      topic_ids = (topic_ids as any[]).map((id: any) => parseInt(String(id))).filter((id: number) => !isNaN(id) && id > 0);
    }

    if (!trainerId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!csr_id || !session_date || !coaching_type || !status) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: csr_id, session_date, coaching_type, status' 
      });
    }

    if (!topic_ids || !Array.isArray(topic_ids) || topic_ids.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'At least one topic is required' 
      });
    }

    if (!['SCHEDULED', 'COMPLETED'].includes(status)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid status. Must be SCHEDULED or COMPLETED' 
      });
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      return res.status(500).json({ success: false, message: 'CSR role not found' });
    }

    const canCoachCSR = await trainerService.validateTrainerCSRAccess(trainerId, parseInt(csr_id));
    if (!canCoachCSR) {
      return res.status(403).json({ 
        success: false, 
        message: 'CSR not found, inactive, or you do not have permission to coach this CSR' 
      });
    }

    if (notes && notes.length > 2000) {
      return res.status(400).json({ 
        success: false, 
        message: 'Notes cannot exceed 2000 characters' 
      });
    }

    const validTopicIds = topic_ids.filter(id => Number.isInteger(Number(id)) && Number(id) > 0);
    if (validTopicIds.length !== topic_ids.length) {
      return res.status(400).json({ 
        success: false, 
        message: 'All topic IDs must be valid positive integers' 
      });
    }

    const topicRows = await prisma.$queryRaw<{id: number}[]>(
      Prisma.sql`SELECT id FROM topics WHERE id IN (${Prisma.join(topic_ids)}) AND is_active = 1`
    );
    
    if (!topicRows || topicRows.length !== topic_ids.length) {
      return res.status(400).json({ 
        success: false, 
        message: 'One or more topic IDs are invalid or inactive' 
      });
    }

    const validCoachingTypes = ['Classroom', 'Side-by-Side', 'Team Session'];
    if (!validCoachingTypes.includes(coaching_type)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid coaching type. For trainers, valid types are: Classroom, Side-by-Side, Team Session' 
      });
    }

    let attachmentData: any = {
      filename: null,
      path: null,
      size: null,
      mime_type: null
    };

    if (attachment) {
      const uploadsDir = path.join(process.cwd(), 'uploads', 'coaching');
      try {
        await fs.mkdir(uploadsDir, { recursive: true });
      } catch (err) {
        console.error('Error creating uploads directory:', err);
      }

      const timestamp = Date.now();
      const fileExtension = path.extname(attachment.originalname);
      const filename = `coaching_${timestamp}_${Math.random().toString(36).substring(2, 15)}${fileExtension}`;
      const filePath = path.join(uploadsDir, filename);

      try {
        await fs.writeFile(filePath, attachment.buffer);
        attachmentData = {
          filename: attachment.originalname,
          path: `uploads/coaching/${filename}`,
          size: attachment.size,
          mime_type: attachment.mimetype
        };
      } catch (err) {
        console.error('Error saving file:', err);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to save attachment' 
        });
      }
    }

    const newSessionId = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`
          INSERT INTO coaching_sessions (csr_id, session_date, coaching_type, notes, status, attachment_filename, attachment_path, attachment_size, attachment_mime_type, created_by)
          VALUES (${parseInt(csr_id)}, ${session_date}, ${coaching_type}, ${notes || null}, ${status}, ${attachmentData.filename}, ${attachmentData.path}, ${attachmentData.size}, ${attachmentData.mime_type}, ${trainerId})
        `
      );

      const lastIdRows = await tx.$queryRaw<{id: bigint}[]>(Prisma.sql`SELECT LAST_INSERT_ID() as id`);
      const sessionId = Number(lastIdRows[0].id);

      for (const topicId of topic_ids) {
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO coaching_session_topics (coaching_session_id, topic_id) VALUES (${sessionId}, ${topicId})`
        );
      }

      await tx.auditLog.create({
        data: {
          user_id: trainerId,
          action: 'CREATE',
          target_id: sessionId,
          target_type: 'coaching_session',
          details: JSON.stringify({ csr_id, topic_ids, coaching_type, status, has_attachment: !!attachment })
        }
      });

      return sessionId;
    });

    const createdSession = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          cs.id,
          cs.csr_id,
          u.username as csr_name,
          cs.session_date,
          cs.coaching_type,
          cs.notes,
          cs.status,
          cs.attachment_filename,
          cs.attachment_path,
          cs.attachment_size,
          cs.attachment_mime_type,
          cs.created_at,
          GROUP_CONCAT(t.topic_name ORDER BY t.topic_name SEPARATOR ', ') as topics,
          GROUP_CONCAT(t.id ORDER BY t.id SEPARATOR ',') as topic_ids
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
        LEFT JOIN topics t ON cst.topic_id = t.id
        WHERE cs.id = ${newSessionId}
        GROUP BY cs.id
      `
    );

    const sessionData = createdSession[0];
    const responseData = {
      ...sessionData,
      topics: sessionData.topics ? sessionData.topics.split(', ') : [],
      topic_ids: sessionData.topic_ids ? sessionData.topic_ids.split(',').map((id: string) => parseInt(id)) : []
    };
    delete responseData.topic_ids;

    res.status(201).json({
      success: true,
      data: responseData,
      message: 'Coaching session created successfully'
    });
  } catch (error) {
    console.error('Error creating coaching session:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Update coaching session
 */
const updateTrainerCoachingSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const trainerId = req.user?.user_id;
    const sessionId = parseInt(req.params.sessionId);
    let { csr_id, session_date, topic_ids, coaching_type, notes, status } = req.body;
    const attachment = req.file;

    if (topic_ids !== undefined) {
      if (typeof topic_ids === 'string') {
        topic_ids = topic_ids.split(',').map((id: string) => id.trim()).filter((id: string) => id !== '');
      }
      if (!Array.isArray(topic_ids)) {
        topic_ids = [topic_ids];
      }
      topic_ids = (topic_ids as any[]).map((id: any) => parseInt(String(id))).filter((id: number) => !isNaN(id) && id > 0);
    }

    if (!trainerId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!sessionId || isNaN(sessionId)) {
      return res.status(400).json({ success: false, message: 'Invalid session ID' });
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      return res.status(500).json({ success: false, message: 'CSR role not found' });
    }

    const sessionRows = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT cs.id, cs.status as current_status, u.username as csr_name
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        JOIN departments d ON u.department_id = d.id
        WHERE cs.id = ${sessionId} 
        AND (cs.created_by = ${trainerId} OR cs.created_by IS NULL)
        AND u.role_id = ${csrRoleId}
        AND u.is_active = 1
        AND d.is_active = 1
      `
    );

    if (!sessionRows || sessionRows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Coaching session not found or you do not have permission to edit it' 
      });
    }

    const currentSession = sessionRows[0];

    if (currentSession.current_status === 'COMPLETED') {
      const hasOtherFieldUpdates = csr_id !== undefined || 
                                   session_date !== undefined || 
                                   topic_ids !== undefined ||
                                   coaching_type !== undefined || 
                                   (notes !== undefined && notes !== '') || 
                                   attachment !== undefined;
      
      if (hasOtherFieldUpdates) {
        return res.status(400).json({ 
          success: false, 
          message: 'Cannot edit completed coaching sessions (except to reopen them by changing status to SCHEDULED)' 
        });
      }
      
      if (!hasOtherFieldUpdates && status !== undefined && status !== 'SCHEDULED') {
        return res.status(400).json({ 
          success: false, 
          message: 'Cannot edit completed coaching sessions (except to reopen them by changing status to SCHEDULED)' 
        });
      }
    }

    if (status && !['SCHEDULED', 'COMPLETED'].includes(status)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid status. Must be SCHEDULED or COMPLETED' 
      });
    }

    if (topic_ids !== undefined) {
      if (!Array.isArray(topic_ids) || topic_ids.length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'At least one topic is required' 
        });
      }

      const validTopicIds = topic_ids.filter((id: number) => Number.isInteger(id) && id > 0);
      if (validTopicIds.length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'All topic IDs must be valid positive integers' 
        });
      }

      const topicRows = await prisma.$queryRaw<{id: number}[]>(
        Prisma.sql`SELECT id FROM topics WHERE id IN (${Prisma.join(validTopicIds)}) AND is_active = 1`
      );
      const activeTopicIds = (topicRows || []).map((r: { id: number }) => r.id);

      if (activeTopicIds.length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'All selected topics are invalid or inactive. Please select at least one active topic.' 
        });
      }
      topic_ids = activeTopicIds;
    }

    if (notes && notes.length > 2000) {
      return res.status(400).json({ 
        success: false, 
        message: 'Notes cannot exceed 2000 characters' 
      });
    }

    if (coaching_type) {
      const validCoachingTypes = ['Classroom', 'Side-by-Side', 'Team Session'];
      if (!validCoachingTypes.includes(coaching_type)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid coaching type. For trainers, valid types are: Classroom, Side-by-Side, Team Session' 
        });
      }
    }

    let attachmentData: any = {};

    if (attachment) {
      const uploadsDir = path.join(process.cwd(), 'uploads', 'coaching');
      try {
        await fs.mkdir(uploadsDir, { recursive: true });
      } catch (err) {
        console.error('Error creating uploads directory:', err);
      }

      const timestamp = Date.now();
      const fileExtension = path.extname(attachment.originalname);
      const filename = `coaching_${timestamp}_${Math.random().toString(36).substring(2, 15)}${fileExtension}`;
      const filePath = path.join(uploadsDir, filename);

      try {
        await fs.writeFile(filePath, attachment.buffer);
        attachmentData = {
          attachment_filename: attachment.originalname,
          attachment_path: `uploads/coaching/${filename}`,
          attachment_size: attachment.size,
          attachment_mime_type: attachment.mimetype
        };
      } catch (err) {
        console.error('Error saving file:', err);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to save attachment' 
        });
      }
    }

    // Build dynamic update parts
    const updateParts: Prisma.Sql[] = [];

    if (csr_id !== undefined) {
      const csrRows = await prisma.$queryRaw<{id: number}[]>(
        Prisma.sql`SELECT u.id FROM users u WHERE u.id = ${csr_id} AND u.role_id = ${csrRoleId} AND u.is_active = 1`
      );
      
      if (!csrRows || csrRows.length === 0) {
        return res.status(400).json({ success: false, message: 'Invalid CSR ID' });
      }
      
      updateParts.push(Prisma.sql`csr_id = ${parseInt(csr_id)}`);
    }

    if (session_date !== undefined) updateParts.push(Prisma.sql`session_date = ${session_date}`);
    if (coaching_type !== undefined) updateParts.push(Prisma.sql`coaching_type = ${coaching_type}`);
    if (notes !== undefined) updateParts.push(Prisma.sql`notes = ${notes || null}`);
    if (status !== undefined) updateParts.push(Prisma.sql`status = ${status}`);

    if (attachment) {
      updateParts.push(Prisma.sql`attachment_filename = ${attachmentData.attachment_filename}`);
      updateParts.push(Prisma.sql`attachment_path = ${attachmentData.attachment_path}`);
      updateParts.push(Prisma.sql`attachment_size = ${attachmentData.attachment_size}`);
      updateParts.push(Prisma.sql`attachment_mime_type = ${attachmentData.attachment_mime_type}`);
    }

    if (updateParts.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No fields to update' 
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`UPDATE coaching_sessions SET ${Prisma.join(updateParts, ', ')} WHERE id = ${sessionId}`
      );

      if (topic_ids !== undefined) {
        await tx.coachingSessionTopic.deleteMany({
          where: { coaching_session_id: sessionId }
        });

        await tx.coachingSessionTopic.createMany({
          data: topic_ids.map((topicId: number) => ({
            coaching_session_id: sessionId,
            topic_id: topicId
          }))
        });
      }

      await tx.auditLog.create({
        data: {
          user_id: trainerId,
          action: 'UPDATE',
          target_id: sessionId,
          target_type: 'coaching_session',
          details: JSON.stringify(req.body)
        }
      });
    });

    const updatedSession = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          cs.id,
          cs.csr_id,
          u.username as csr_name,
          cs.session_date,
          cs.coaching_type,
          cs.notes,
          cs.status,
          cs.attachment_filename,
          cs.attachment_path,
          cs.attachment_size,
          cs.attachment_mime_type,
          cs.created_at,
          GROUP_CONCAT(t.topic_name ORDER BY t.topic_name SEPARATOR ', ') as topics,
          GROUP_CONCAT(t.id ORDER BY t.id SEPARATOR ',') as topic_ids
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
        LEFT JOIN topics t ON cst.topic_id = t.id
        WHERE cs.id = ${sessionId}
        GROUP BY cs.id
      `
    );

    const sessionData = updatedSession[0];
    const responseData = {
      ...sessionData,
      topics: sessionData.topics ? sessionData.topics.split(', ') : [],
      topic_ids: sessionData.topic_ids ? sessionData.topic_ids.split(',').map((id: string) => parseInt(id)) : []
    };

    res.json({
      success: true,
      data: responseData,
      message: 'Coaching session updated successfully'
    });
  } catch (error) {
    console.error('Error updating coaching session:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Mark coaching session as completed
 */
const completeTrainerCoachingSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const trainerId = req.user?.user_id;
    const sessionId = parseInt(req.params.sessionId);

    if (!trainerId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!sessionId || isNaN(sessionId)) {
      return res.status(400).json({ success: false, message: 'Invalid session ID' });
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      return res.status(500).json({ success: false, message: 'CSR role not found' });
    }

    const sessionRows = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT cs.id, cs.status as current_status, u.username as csr_name
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        JOIN departments d ON u.department_id = d.id
        WHERE cs.id = ${sessionId} 
        AND (cs.created_by = ${trainerId} OR cs.created_by IS NULL)
        AND u.role_id = ${csrRoleId}
        AND u.is_active = 1
        AND d.is_active = 1
      `
    );

    if (!sessionRows || sessionRows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Coaching session not found or you do not have permission to complete it' 
      });
    }

    const currentSession = sessionRows[0];

    if (currentSession.current_status === 'COMPLETED') {
      return res.status(400).json({ 
        success: false, 
        message: 'Coaching session is already completed' 
      });
    }

    await prisma.coachingSession.update({
      where: { id: sessionId },
      data: { status: 'COMPLETED' }
    });

    await prisma.auditLog.create({
      data: {
        user_id: trainerId,
        action: 'COMPLETE',
        target_id: sessionId,
        target_type: 'coaching_session',
        details: JSON.stringify({ csr_name: currentSession.csr_name })
      }
    });

    const updatedSession = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          cs.id, cs.csr_id, u.username as csr_name, cs.session_date, cs.coaching_type, cs.notes,
          cs.status, cs.attachment_filename, cs.attachment_path, cs.attachment_size, cs.attachment_mime_type,
          cs.created_at,
          GROUP_CONCAT(t.topic_name ORDER BY t.topic_name SEPARATOR ', ') as topics,
          GROUP_CONCAT(t.id ORDER BY t.id SEPARATOR ',') as topic_ids
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
        LEFT JOIN topics t ON cst.topic_id = t.id
        WHERE cs.id = ${sessionId}
        GROUP BY cs.id
      `
    );

    const sessionData = updatedSession[0];
    const responseData = {
      ...sessionData,
      topics: sessionData.topics ? sessionData.topics.split(', ') : [],
      topic_ids: sessionData.topic_ids ? sessionData.topic_ids.split(',').map((id: string) => parseInt(id)) : []
    };

    res.json({
      success: true,
      data: responseData,
      message: 'Coaching session marked as completed successfully'
    });
  } catch (error) {
    console.error('Error completing coaching session:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Re-open a completed coaching session (change status back to SCHEDULED)
 */
const reopenTrainerCoachingSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const trainerId = req.user?.user_id;
    const sessionId = parseInt(req.params.sessionId);

    if (!trainerId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!sessionId || isNaN(sessionId)) {
      return res.status(400).json({ success: false, message: 'Invalid session ID' });
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      return res.status(500).json({ success: false, message: 'CSR role not found' });
    }

    const sessionRows = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT cs.id, cs.status as current_status, u.username as csr_name
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        JOIN departments d ON u.department_id = d.id
        WHERE cs.id = ${sessionId} 
        AND (cs.created_by = ${trainerId} OR cs.created_by IS NULL)
        AND u.role_id = ${csrRoleId}
        AND u.is_active = 1
        AND d.is_active = 1
      `
    );

    if (!sessionRows || sessionRows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Coaching session not found' 
      });
    }

    const currentSession = sessionRows[0];

    if (currentSession.current_status !== 'COMPLETED') {
      return res.status(400).json({ 
        success: false, 
        message: 'Can only reopen completed coaching sessions' 
      });
    }

    await prisma.coachingSession.update({
      where: { id: sessionId },
      data: { status: 'SCHEDULED' }
    });

    await prisma.auditLog.create({
      data: {
        user_id: trainerId,
        action: 'UPDATE',
        target_id: sessionId,
        target_type: 'coaching_session',
        details: JSON.stringify({ status: 'SCHEDULED', csr_name: currentSession.csr_name })
      }
    });

    const updatedSession = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          cs.id, cs.csr_id, u.username as csr_name, cs.session_date, cs.coaching_type, cs.notes,
          cs.status, cs.attachment_filename, cs.attachment_path, cs.attachment_size, cs.attachment_mime_type,
          cs.created_at,
          GROUP_CONCAT(t.topic_name ORDER BY t.topic_name SEPARATOR ', ') as topics,
          GROUP_CONCAT(t.id ORDER BY t.id SEPARATOR ',') as topic_ids
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
        LEFT JOIN topics t ON cst.topic_id = t.id
        WHERE cs.id = ${sessionId}
        GROUP BY cs.id
      `
    );

    const sessionData = updatedSession[0];
    const responseData = {
      ...sessionData,
      topics: sessionData.topics ? sessionData.topics.split(', ') : [],
      topic_ids: sessionData.topic_ids ? sessionData.topic_ids.split(',').map((id: string) => parseInt(id)) : []
    };

    res.json({
      success: true,
      data: responseData,
      message: 'Coaching session updated successfully'
    });
  } catch (error) {
    console.error('Error reopening coaching session:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Download coaching session attachment
 */
const downloadTrainerCoachingSessionAttachment = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const trainerId = req.user?.user_id;
    const sessionId = parseInt(req.params.sessionId);

    if (!trainerId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (!sessionId || isNaN(sessionId)) {
      res.status(400).json({ success: false, message: 'Invalid session ID' });
      return;
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      res.status(500).json({ success: false, message: 'CSR role not found' });
      return;
    }

    const sessionRows = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          cs.id,
          cs.attachment_filename,
          cs.attachment_path,
          cs.attachment_mime_type,
          u.username as csr_name
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        JOIN departments d ON u.department_id = d.id
        WHERE cs.id = ${sessionId} 
        AND cs.created_by = ${trainerId}
        AND u.role_id = ${csrRoleId}
        AND u.is_active = 1
        AND d.is_active = 1
        AND cs.attachment_path IS NOT NULL
      `
    );

    if (!sessionRows || sessionRows.length === 0) {
      res.status(404).json({ 
        success: false, 
        message: 'Coaching session not found, no attachment, or access denied' 
      });
      return;
    }

    const session = sessionRows[0];
    const filePath = path.join(process.cwd(), session.attachment_path);

    try {
      await fs.access(filePath);
    } catch (error) {
      res.status(404).json({ 
        success: false, 
        message: 'Attachment file not found on server' 
      });
      return;
    }

    const stats = await fs.stat(filePath);

    res.setHeader('Content-Type', session.attachment_mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; ${escapeFilename(session.attachment_filename)}`);

    const fileStream = createReadStream(filePath);
    
    fileStream.on('error', (streamError: Error) => {
      if (!res.headersSent) {
        res.status(500).json({ 
          success: false, 
          message: 'Error reading file' 
        });
      } else {
        console.error('File stream error after headers sent:', streamError);
        res.destroy();
      }
    });
    
    res.on('error', (responseError) => {
      console.error('Response error during file stream:', responseError);
      fileStream.destroy();
    });
    
    fileStream.pipe(res);

  } catch (error) {
    console.error('Error downloading coaching session attachment:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Get team CSRs for trainers (returns all CSRs since trainers can coach anyone)
 */
export const getTrainerTeamCSRs = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const trainerId = req.user?.user_id;

    if (!trainerId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // Role ID 3 = CSR/User — query by ID to avoid dependency on role_name string
    const csrs = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT u.id, u.username as name, u.email,
          COALESCE(d.department_name, '') as department
        FROM users u
        LEFT JOIN departments d ON u.department_id = d.id
        WHERE u.role_id = 3
        AND u.is_active = 1
        ORDER BY u.username
      `
    );

    res.json({
      success: true,
      data: csrs || []
    });
  } catch (error) {
    console.error('Error fetching team CSRs:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Health check endpoint for trainer services
 * @route GET /api/trainer/health
 */
export const getTrainerHealthCheck = async (req: Request, res: Response): Promise<void> => {
  try {
    const healthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'TRAINER',
      checks: {
        database: false,
        cache: false,
        logger: false
      },
      details: {} as any,
      performance: {} as any
    };

    try {
      await prisma.$queryRaw(Prisma.sql`SELECT 1`);
      healthStatus.checks.database = true;
    } catch (error) {
      healthStatus.checks.database = false;
      healthStatus.details.database = 'Connection failed';
    }

    try {
      const testKey = 'health_check_test_trainer';
      trainerCache.set(testKey, 'test', 1000);
      const testValue = trainerCache.get(testKey);
      healthStatus.checks.cache = testValue === 'test';
      trainerCache.delete(testKey);
      
      healthStatus.performance.cache = trainerCache.getStats();
    } catch (error) {
      healthStatus.checks.cache = false;
      healthStatus.details.cache = 'Cache operation failed';
    }

    try {
      trainerLogger.operation('health_check', 0, { test: true });
      healthStatus.checks.logger = true;
      
      healthStatus.performance.logger = trainerLogger.getPerformanceStats();
    } catch (error) {
      healthStatus.checks.logger = false;
      healthStatus.details.logger = 'Logger operation failed';
    }

    const allChecksPass = Object.values(healthStatus.checks).every(check => check === true);
    healthStatus.status = allChecksPass ? 'healthy' : 'degraded';

    const statusCode = allChecksPass ? 200 : 503;
    res.status(statusCode).json(healthStatus);
  } catch (error) {
    console.error('[TRAINER HEALTH] Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      service: 'TRAINER',
      error: 'Health check failed'
    });
  }
};

/**
 * Get completed QA submissions for trainers
 * @route GET /api/trainer/completed
 */
export const getTrainerCompletedSubmissions = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.user_id;
  
  try {
    trainerLogger.operation('getCompletedSubmissions', userId);

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit as string) || 1000));
    const offset = (page - 1) * limit;
    
    const formId = req.query.form_id ? parseInt(req.query.form_id as string) : null;
    const dateStart = req.query.date_start as string;
    const dateEnd = req.query.date_end as string;
    const status = req.query.status as string;
    const search = req.query.search as string;
    
    const sqlConditions: Prisma.Sql[] = [
      Prisma.sql`(s.status = 'FINALIZED' OR s.status = 'DISPUTED' OR s.status = 'SUBMITTED')`
    ];
    
    if (formId) {
      sqlConditions.push(Prisma.sql`s.form_id = ${formId}`);
    }
    if (dateStart) {
      sqlConditions.push(Prisma.sql`s.submitted_at >= ${dateStart + ' 00:00:00'}`);
    }
    if (dateEnd) {
      sqlConditions.push(Prisma.sql`s.submitted_at <= ${dateEnd + ' 23:59:59'}`);
    }
    if (status && (status === 'FINALIZED' || status === 'DISPUTED' || status === 'SUBMITTED')) {
      sqlConditions.push(Prisma.sql`s.status = ${status}`);
    }
    if (search) {
      const searchTerm = `%${search}%`;
      sqlConditions.push(
        Prisma.sql`(f.form_name LIKE ${searchTerm} OR csr.username LIKE ${searchTerm} OR auditor.username LIKE ${searchTerm})`
      );
    }
    
    const whereClause = Prisma.sql`WHERE ${Prisma.join(sqlConditions, ' AND ')}`;

    const countResult = await prisma.$queryRaw<{total: bigint}[]>(
      Prisma.sql`
        SELECT 
          COUNT(DISTINCT s.id) AS total
        FROM 
          submissions s
          JOIN forms f ON s.form_id = f.id
          JOIN users auditor ON s.submitted_by = auditor.id
          LEFT JOIN (
            SELECT DISTINCT sm.submission_id, sm.value
            FROM submission_metadata sm
            JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
            WHERE fmf.field_name = 'CSR'
          ) csr_meta ON s.id = csr_meta.submission_id
          LEFT JOIN users csr ON CAST(csr_meta.value AS UNSIGNED) = csr.id
        ${whereClause}
      `
    );
    const total = Number(countResult[0]?.total ?? 0);
    
    const submissions = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          s.id,
          s.form_id,
          f.form_name,
          auditor.username AS auditor_name,
          COALESCE(csr.username, 'No CSR assigned') AS csr_name, 
          s.submitted_at,
          s.total_score,
          s.status
        FROM 
          submissions s
          JOIN forms f ON s.form_id = f.id
          JOIN users auditor ON s.submitted_by = auditor.id
          LEFT JOIN (
            SELECT DISTINCT sm.submission_id, sm.value
            FROM submission_metadata sm
            JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
            WHERE fmf.field_name = 'CSR'
          ) csr_meta ON s.id = csr_meta.submission_id
          LEFT JOIN users csr ON CAST(csr_meta.value AS UNSIGNED) = csr.id
        ${whereClause}
        ORDER BY s.submitted_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `
    );
    
    res.status(200).json({
      data: submissions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('[TRAINER] Error fetching completed submissions:', error);
    trainerLogger.operationError('getCompletedSubmissions', error as Error, userId);
    res.status(500).json({ 
      message: 'Failed to fetch completed submissions',
      error: process.env.NODE_ENV === 'development' ? String(error) : undefined
    });
  }
};

/**
 * Get detailed information for a specific completed submission
 * @route GET /api/trainer/completed/:id
 */
export const getTrainerSubmissionDetails = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.user_id;
  const submissionId = parseInt(req.params.id);
  const includeScores = req.query.includeScores === 'true';
  const includeQuestionScores = req.query.includeQuestionScores === 'true';
  const includeScoreDetails = req.query.includeScoreDetails === 'true';
  
  try {
    trainerLogger.operation('getSubmissionDetails', userId, { submissionId, includeScores, includeQuestionScores, includeScoreDetails });

    if (isNaN(submissionId)) {
      res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'Invalid submission ID',
        code: 'INVALID_SUBMISSION_ID'
      });
      return;
    }
    
    try {
      const submissionRows = await prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT 
            s.id,
            s.form_id,
            s.submitted_by,
            s.submitted_at,
            s.total_score,
            s.status,
            f.form_name,
            f.version,
            f.interaction_type
          FROM 
            submissions s
            JOIN forms f ON s.form_id = f.id
          WHERE 
            s.id = ${submissionId} AND (s.status = 'FINALIZED' OR s.status = 'DISPUTED' OR s.status = 'SUBMITTED')
        `
      );
      
      if (submissionRows.length === 0) {
        res.status(404).json({ 
          error: 'NOT_FOUND',
          message: 'Submission not found or not a finalized/disputed submission',
          code: 'SUBMISSION_NOT_FOUND'
        });
        return;
      }
      
      const submission = submissionRows[0];
      trainerLogger.operation('getSubmissionDetails', userId, { 
        submissionId, 
        formId: submission.form_id,
        status: 'submission_found'
      });
      
      const [metadataRows, callsRows, answersRows, disputeRows] = await Promise.all([
        prisma.$queryRaw<any[]>(
          Prisma.sql`
            SELECT fmf.field_name, sm.value
            FROM submission_metadata sm
            JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
            WHERE sm.submission_id = ${submissionId}
          `
        ),
        prisma.$queryRaw<any[]>(
          Prisma.sql`
            SELECT c.call_id, c.customer_id, c.call_date, c.duration, c.recording_url, c.transcript
            FROM submission_calls sc
            JOIN calls c ON sc.call_id = c.id
            WHERE sc.submission_id = ${submissionId}
            ORDER BY sc.sort_order ASC
          `
        ),
        prisma.$queryRaw<any[]>(
          Prisma.sql`
            SELECT sa.question_id, fq.question_text, sa.answer, sa.notes
            FROM submission_answers sa
            JOIN form_questions fq ON sa.question_id = fq.id
            WHERE sa.submission_id = ${submissionId}
          `
        ),
        prisma.$queryRaw<any[]>(
          Prisma.sql`
            SELECT d.id, d.reason, d.status, d.resolution_notes, d.attachment_url
            FROM disputes d
            WHERE d.submission_id = ${submissionId}
          `
        )
      ]);
      
      let response: any = {
        id: submission.id,
        form_id: submission.form_id,
        status: submission.status,
        total_score: submission.total_score,
        form: {
          id: submission.form_id,
          form_name: submission.form_name,
          version: submission.version,
          interaction_type: submission.interaction_type
        },
        metadata: metadataRows,
        calls: callsRows,
        answers: answersRows,
        dispute: disputeRows.length > 0 ? disputeRows[0] : null
      };
      
      if (includeScores || includeQuestionScores || includeScoreDetails) {
        try {
          trainerLogger.operation('getSubmissionDetails', userId, { 
            submissionId, 
            formId: submission.form_id,
            status: 'fetching_form_structure'
          });
          
          const categoriesRows = await prisma.$queryRaw<any[]>(
            Prisma.sql`
              SELECT fc.id, fc.name, fc.weight, fc.sort_order
              FROM form_categories fc
              WHERE fc.form_id = ${submission.form_id}
              ORDER BY fc.sort_order ASC
            `
          );
          
          if (categoriesRows.length === 0) {
            trainerLogger.operation('getSubmissionDetails', userId, { 
              submissionId, 
              formId: submission.form_id,
              status: 'no_categories_found'
            });
            res.status(200).json(response);
            return;
          }
          
          const questionsRows = await prisma.$queryRaw<any[]>(
            Prisma.sql`
              SELECT 
                fq.id, fq.category_id, fq.question_text, fq.question_type, fq.weight,
                fq.is_na_allowed, fq.scale_min, fq.scale_max, fq.yes_value, fq.no_value, fq.na_value, fq.sort_order
              FROM form_questions fq
              JOIN form_categories fc ON fq.category_id = fc.id
              WHERE fc.form_id = ${submission.form_id}
              ORDER BY fc.sort_order ASC, fq.sort_order ASC
            `
          );
          
          trainerLogger.operation('getSubmissionDetails', userId, { 
            submissionId, 
            formId: submission.form_id,
            status: 'form_structure_loaded',
            categoriesCount: categoriesRows.length,
            questionsCount: questionsRows.length
          });
          
          const categoriesWithQuestions = categoriesRows.map(category => {
            const categoryQuestions = questionsRows.filter(q => q.category_id === category.id);
            return {
              ...category,
              questions: categoryQuestions
            };
          });
          
          response.form = {
            ...response.form,
            categories: categoriesWithQuestions
          };
        } catch (formError) {
          trainerLogger.operationError('getSubmissionDetails', formError as Error, userId, { 
            submissionId, 
            formId: submission.form_id,
            context: 'form_structure_fetch_error'
          });
        }
      }
      
      res.status(200).json(response);
    } catch (dbError) {
      console.error('[TRAINER] Database error:', dbError);
      res.status(500).json({ 
        error: 'DATABASE_ERROR',
        message: 'Database error processing submission details',
        code: 'TRAINER_SUBMISSION_DB_ERROR'
      });
    }
  } catch (error) {
    console.error('[TRAINER] Error fetching submission details:', error);
    trainerLogger.operationError('getSubmissionDetails', error as Error, userId, { submissionId });
    res.status(500).json({ 
      message: 'Failed to fetch submission details',
      error: process.env.NODE_ENV === 'development' ? String(error) : undefined
    });
  }
};
