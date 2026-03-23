import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import { serviceLogger } from '../config/logger';
import { promises as fs } from 'fs';
import { createReadStream } from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

/**
 * Properly escape filename for Content-Disposition header
 * Uses RFC 5987 encoding for filenames with special characters
 */
const escapeFilename = (filename: string | null | undefined): string => {
  if (!filename) {
    return 'filename="attachment"';
  }

  const cleanFilename = filename.replace(/[\x00-\x1F\x7F]/g, '').trim();

  if (!cleanFilename) {
    return 'filename="attachment"';
  }

  const needsEncoding = /[^a-zA-Z0-9._-]/.test(cleanFilename);

  if (needsEncoding) {
    const encoded = encodeURIComponent(cleanFilename).replace(/\*/g, '%2A');
    return `filename*=UTF-8''${encoded}`;
  }

  return `filename="${cleanFilename.replace(/"/g, '\\"')}"`;
};

// Extend Request type to include user property
interface AuthenticatedRequest extends Request {
  user?: {
    user_id: number;
    role: string;
    email: string;
    department_id?: number;
  };
}

// Cache for role IDs to avoid repeated database queries
let roleCache: { [key: string]: number } = {};

// Helper function to get role ID by role name
const getRoleId = async (role_name: string): Promise<number | null> => {
  if (roleCache[role_name]) {
    return roleCache[role_name];
  }

  try {
    const role = await prisma.role.findFirst({
      where: { role_name: role_name },
      select: { id: true }
    });

    if (role) {
      roleCache[role_name] = role.id;
      return role.id;
    }
  } catch (error) {
    console.error(`Error fetching role ID for ${role_name}:`, error);
  }

  return null;
};

interface AdminDashboardStats {
  reviewsCompleted: { thisWeek: number; thisMonth: number };
  disputes: { thisWeek: number; thisMonth: number };
  coachingSessions: { thisWeek: number; thisMonth: number };
}

interface CSRActivityData {
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

/**
 * Get admin dashboard statistics
 * @route GET /api/admin/stats
 */
export const getAdminStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const [reviewsCompleted, disputes, coachingSessions] = await Promise.all([
      prisma.$queryRaw<{ thisWeek: bigint; thisMonth: bigint }[]>`
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
      `,
      prisma.$queryRaw<{ thisWeek: bigint; thisMonth: bigint }[]>`
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
      `,
      prisma.$queryRaw<{ thisWeek: bigint; thisMonth: bigint }[]>`
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
    ]);

    const stats: AdminDashboardStats = {
      reviewsCompleted: {
        thisWeek: Number(reviewsCompleted[0]?.thisWeek || 0),
        thisMonth: Number(reviewsCompleted[0]?.thisMonth || 0)
      },
      disputes: {
        thisWeek: Number(disputes[0]?.thisWeek || 0),
        thisMonth: Number(disputes[0]?.thisMonth || 0)
      },
      coachingSessions: {
        thisWeek: Number(coachingSessions[0]?.thisWeek || 0),
        thisMonth: Number(coachingSessions[0]?.thisMonth || 0)
      }
    };

    res.status(200).json(stats);
  } catch (error) {
    serviceLogger.error('admin', 'getAdminStats', error as Error, req.user?.user_id);
    res.status(500).json({ message: 'Failed to fetch admin dashboard statistics' });
  }
};

/**
 * Get CSR activity data for admin dashboard
 * @route GET /api/admin/csr-activity
 */
export const getCSRActivity = async (req: Request, res: Response): Promise<void> => {
  try {
    const csrActivity = await prisma.$queryRaw<any[]>`
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
        FROM submissions s
        JOIN submission_metadata sm ON s.id = sm.submission_id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
        JOIN roles active_role ON active_csr.role_id = active_role.id
        WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
        AND fmf.field_name = 'CSR' AND active_role.role_name = 'CSR' AND active_csr.is_active = 1
        GROUP BY sm.value
      ) audit_counts ON u.id = audit_counts.csr_id
      LEFT JOIN (
        SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(disp.id) as disputes
        FROM submissions s
        JOIN submission_metadata sm ON s.id = sm.submission_id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        JOIN disputes disp ON disp.submission_id = s.id
        JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
        JOIN roles active_role ON active_csr.role_id = active_role.id
        WHERE fmf.field_name = 'CSR' AND active_role.role_name = 'CSR' AND active_csr.is_active = 1
        GROUP BY sm.value
      ) dispute_counts ON u.id = dispute_counts.csr_id
      LEFT JOIN (
        SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(s.id) as audits_week
        FROM submissions s
        JOIN submission_metadata sm ON s.id = sm.submission_id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
        JOIN roles active_role ON active_csr.role_id = active_role.id
        WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
        AND fmf.field_name = 'CSR' AND active_role.role_name = 'CSR' AND active_csr.is_active = 1
        AND s.submitted_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
        GROUP BY sm.value
      ) audit_counts_week ON u.id = audit_counts_week.csr_id
      LEFT JOIN (
        SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(disp.id) as disputes_week
        FROM submissions s
        JOIN submission_metadata sm ON s.id = sm.submission_id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        JOIN disputes disp ON disp.submission_id = s.id
        JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
        JOIN roles active_role ON active_csr.role_id = active_role.id
        WHERE fmf.field_name = 'CSR' AND active_role.role_name = 'CSR' AND active_csr.is_active = 1
        AND disp.created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
        GROUP BY sm.value
      ) dispute_counts_week ON u.id = dispute_counts_week.csr_id
      LEFT JOIN (
        SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(s.id) as audits_month
        FROM submissions s
        JOIN submission_metadata sm ON s.id = sm.submission_id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
        JOIN roles active_role ON active_csr.role_id = active_role.id
        WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
        AND fmf.field_name = 'CSR' AND active_role.role_name = 'CSR' AND active_csr.is_active = 1
        AND s.submitted_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
        GROUP BY sm.value
      ) audit_counts_month ON u.id = audit_counts_month.csr_id
      LEFT JOIN (
        SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(disp.id) as disputes_month
        FROM submissions s
        JOIN submission_metadata sm ON s.id = sm.submission_id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        JOIN disputes disp ON disp.submission_id = s.id
        JOIN users active_csr ON active_csr.id = CAST(sm.value AS UNSIGNED)
        JOIN roles active_role ON active_csr.role_id = active_role.id
        WHERE fmf.field_name = 'CSR' AND active_role.role_name = 'CSR' AND active_csr.is_active = 1
        AND disp.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
        GROUP BY sm.value
      ) dispute_counts_month ON u.id = dispute_counts_month.csr_id
      LEFT JOIN (
        SELECT cs.csr_id, COUNT(cs.id) as coachingScheduled
        FROM coaching_sessions cs WHERE cs.status = 'SCHEDULED' GROUP BY cs.csr_id
      ) coaching_scheduled ON u.id = coaching_scheduled.csr_id
      LEFT JOIN (
        SELECT cs.csr_id, COUNT(cs.id) as coachingCompleted
        FROM coaching_sessions cs WHERE cs.status = 'COMPLETED' GROUP BY cs.csr_id
      ) coaching_completed ON u.id = coaching_completed.csr_id
      LEFT JOIN (
        SELECT cs.csr_id, COUNT(cs.id) as coachingScheduled_week
        FROM coaching_sessions cs WHERE cs.status = 'SCHEDULED'
        AND cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK) GROUP BY cs.csr_id
      ) coaching_scheduled_week ON u.id = coaching_scheduled_week.csr_id
      LEFT JOIN (
        SELECT cs.csr_id, COUNT(cs.id) as coachingCompleted_week
        FROM coaching_sessions cs WHERE cs.status = 'COMPLETED'
        AND cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK) GROUP BY cs.csr_id
      ) coaching_completed_week ON u.id = coaching_completed_week.csr_id
      LEFT JOIN (
        SELECT cs.csr_id, COUNT(cs.id) as coachingScheduled_month
        FROM coaching_sessions cs WHERE cs.status = 'SCHEDULED'
        AND cs.session_date >= DATE_FORMAT(NOW(), '%Y-%m-01') GROUP BY cs.csr_id
      ) coaching_scheduled_month ON u.id = coaching_scheduled_month.csr_id
      LEFT JOIN (
        SELECT cs.csr_id, COUNT(cs.id) as coachingCompleted_month
        FROM coaching_sessions cs WHERE cs.status = 'COMPLETED'
        AND cs.session_date >= DATE_FORMAT(NOW(), '%Y-%m-01') GROUP BY cs.csr_id
      ) coaching_completed_month ON u.id = coaching_completed_month.csr_id
      WHERE r.role_name = 'CSR'
      AND u.is_active = 1
      ORDER BY u.username
    `;

    const formattedCSRActivity: CSRActivityData[] = csrActivity.map(row => ({
      id: Number(row.id),
      name: row.name as string,
      department: (row.department as string) || 'No Department',
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
    serviceLogger.error('admin', 'getCSRActivity', error as Error, req.user?.user_id);
    res.status(500).json({ message: 'Failed to fetch CSR activity data' });
  }
};

/**
 * Get completed form submissions for admin with filtering
 * @route GET /api/admin/completed-forms
 */
export const getCompletedForms = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit as string) || 1000));
    const offset = (page - 1) * limit;

    const formIdParam = req.query.form_id as string;
    const form_id = formIdParam ? parseInt(formIdParam) : null;

    if (formIdParam && (isNaN(form_id!) || form_id! <= 0)) {
      res.status(400).json({ message: 'Invalid form_id parameter' });
      return;
    }

    const dateStart = req.query.date_start as string;
    const dateEnd = req.query.date_end as string;
    const status = req.query.status as string;
    const search = req.query.search as string;

    if (search && search.length > 100) {
      res.status(400).json({ message: 'Search query too long (max 100 characters)' });
      return;
    }

    const conditions: Prisma.Sql[] = [
      Prisma.sql`(s.status = 'FINALIZED' OR s.status = 'DISPUTED' OR s.status = 'SUBMITTED')`
    ];

    if (form_id) conditions.push(Prisma.sql`s.form_id = ${form_id}`);
    if (dateStart) conditions.push(Prisma.sql`s.submitted_at >= ${`${dateStart} 00:00:00`}`);
    if (dateEnd) conditions.push(Prisma.sql`s.submitted_at <= ${`${dateEnd} 23:59:59`}`);
    if (status && (status === 'FINALIZED' || status === 'DISPUTED' || status === 'SUBMITTED')) {
      conditions.push(Prisma.sql`s.status = ${status}`);
    }
    if (search) {
      const searchParam = `%${search}%`;
      conditions.push(Prisma.sql`(f.form_name LIKE ${searchParam} OR auditor.username LIKE ${searchParam} OR csr.username LIKE ${searchParam})`);
    }

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        s.id,
        s.form_id,
        f.form_name,
        auditor.username AS auditor_name,
        COALESCE(csr.username, 'No CSR assigned') AS csr_name,
        s.submitted_at,
        s.total_score,
        s.status,
        (SELECT COUNT(*) FROM disputes d WHERE d.submission_id = s.id) as dispute_count
      FROM submissions s
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
      LIMIT ${Number(limit)} OFFSET ${Number(offset)}
    `;

    const formattedSubmissions = rows.map(row => ({
      id: row.id,
      form_id: row.form_id,
      form_name: row.form_name,
      auditor_name: row.auditor_name,
      csr_name: row.csr_name,
      submitted_at: row.submitted_at,
      total_score: row.total_score,
      status: row.status,
      dispute_count: Number(row.dispute_count)
    }));

    res.status(200).json(formattedSubmissions);
  } catch (error) {
    serviceLogger.error('admin', 'getCompletedForms', error as Error, req.user?.user_id);
    res.status(500).json({ message: 'Failed to fetch completed forms' });
  }
};

/**
 * Get detailed information for a specific completed form submission
 * @route GET /api/admin/completed-forms/:id
 */
export const getCompletedFormDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    const submission_id = parseInt(req.params.id);

    if (isNaN(submission_id) || submission_id <= 0) {
      res.status(400).json({ message: 'Invalid submission ID' });
      return;
    }

    const [submissionDetails, metadata, answers, disputes] = await Promise.all([
      prisma.$queryRaw<any[]>`
        SELECT
          s.id, s.form_id, s.submitted_by, s.submitted_at, s.total_score, s.status,
          f.form_name, f.version, f.interaction_type,
          auditor.username as auditor_name, auditor.email as auditor_email
        FROM submissions s
        JOIN forms f ON s.form_id = f.id
        JOIN users auditor ON s.submitted_by = auditor.id
        WHERE s.id = ${submission_id}
      `,
      prisma.$queryRaw<any[]>`
        SELECT fmf.field_name, fmf.field_type, sm.value
        FROM submission_metadata sm
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        WHERE sm.submission_id = ${submission_id}
        ORDER BY fmf.sort_order
      `,
      prisma.$queryRaw<any[]>`
        SELECT sa.question_id, fq.question_text, fc.category_name, sa.answer, sa.score, sa.notes
        FROM submission_answers sa
        JOIN form_questions fq ON sa.question_id = fq.id
        JOIN form_categories fc ON fq.category_id = fc.id
        WHERE sa.submission_id = ${submission_id}
        ORDER BY fc.sort_order, fq.sort_order
      `,
      prisma.$queryRaw<any[]>`
        SELECT
          d.id, d.dispute_text, d.status as dispute_status, d.created_at, d.resolved_at,
          d.resolution_notes, d.attachment_url, resolver.username as resolved_by
        FROM disputes d
        LEFT JOIN users resolver ON d.resolved_by = resolver.id
        WHERE d.submission_id = ${submission_id}
        ORDER BY d.created_at DESC
      `
    ]);

    if (submissionDetails.length === 0) {
      res.status(404).json({ message: 'Submission not found' });
      return;
    }

    const submission = submissionDetails[0];

    const result = {
      submission: {
        ...submission,
        metadata: metadata.reduce((acc: any, row: any) => {
          acc[row.field_name] = row.value;
          return acc;
        }, {}),
        answers,
        disputes
      }
    };

    res.status(200).json(result);
  } catch (error) {
    serviceLogger.error('admin', 'getCompletedFormDetails', error as Error, req.user?.user_id);
    res.status(500).json({ message: 'Failed to fetch submission details' });
  }
};

/**
 * Export a completed form submission as CSV
 * @route GET /api/admin/completed-forms/:id/export
 */
export const exportCompletedForm = async (req: Request, res: Response): Promise<void> => {
  try {
    const submission_id = parseInt(req.params.id);

    if (isNaN(submission_id) || submission_id <= 0) {
      res.status(400).json({ message: 'Invalid submission ID' });
      return;
    }

    const [submissionData, metadata, answers] = await Promise.all([
      prisma.$queryRaw<any[]>`
        SELECT s.id, f.form_name, f.version, auditor.username as auditor_name,
               s.submitted_at, s.total_score, s.status
        FROM submissions s
        JOIN forms f ON s.form_id = f.id
        JOIN users auditor ON s.submitted_by = auditor.id
        WHERE s.id = ${submission_id}
      `,
      prisma.$queryRaw<any[]>`
        SELECT fmf.field_name, sm.value
        FROM submission_metadata sm
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        WHERE sm.submission_id = ${submission_id}
        ORDER BY fmf.sort_order
      `,
      prisma.$queryRaw<any[]>`
        SELECT fc.category_name, fq.question_text, sa.answer, sa.score, sa.notes
        FROM submission_answers sa
        JOIN form_questions fq ON sa.question_id = fq.id
        JOIN form_categories fc ON fq.category_id = fc.id
        WHERE sa.submission_id = ${submission_id}
        ORDER BY fc.sort_order, fq.sort_order
      `
    ]);

    if (submissionData.length === 0) {
      res.status(404).json({ message: 'Submission not found' });
      return;
    }

    const submission = submissionData[0];

    const csvRows: string[] = [];

    csvRows.push('Submission Export');
    csvRows.push(`Form Name,${submission.form_name}`);
    csvRows.push(`Version,${submission.version}`);
    csvRows.push(`Auditor,${submission.auditor_name}`);
    csvRows.push(`Submitted At,${submission.submitted_at}`);
    csvRows.push(`Total Score,${submission.total_score}`);
    csvRows.push(`Status,${submission.status}`);
    csvRows.push('');

    if (metadata.length > 0) {
      csvRows.push('Metadata');
      csvRows.push('Field,Value');
      metadata.forEach((row: any) => {
        csvRows.push(`${row.field_name},"${row.value}"`);
      });
      csvRows.push('');
    }

    csvRows.push('Form Responses');
    csvRows.push('Category,Question,Answer,Score,Notes');
    answers.forEach((row: any) => {
      const notes = row.notes ? `"${row.notes.replace(/"/g, '""')}"` : '';
      const question = `"${row.question_text.replace(/"/g, '""')}"`;
      const answer = `"${row.answer.replace(/"/g, '""')}"`;
      csvRows.push(`${row.category_name},${question},${answer},${row.score},${notes}`);
    });

    const csvContent = csvRows.join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="submission-${submission_id}.csv"`);
    res.send(csvContent);
  } catch (error) {
    serviceLogger.error('admin', 'exportCompletedForm', error as Error, req.user?.user_id);
    res.status(500).json({ message: 'Failed to export submission' });
  }
};

/**
 * Create new coaching session
 * @route POST /api/admin/coaching-sessions
 */
export const createAdminCoachingSession = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const adminId = req.user?.user_id;
    let { csr_id, session_date, topic_ids, coaching_type, notes, status } = req.body;
    const attachment = req.file as Express.Multer.File | undefined;

    if (topic_ids !== undefined) {
      if (typeof topic_ids === 'string') {
        topic_ids = topic_ids.split(',').map((id: string) => id.trim()).filter((id: string) => id !== '');
      }
      if (!Array.isArray(topic_ids)) {
        topic_ids = [topic_ids];
      }
      topic_ids = (topic_ids as any[]).map((id: any) => parseInt(String(id))).filter((id: number) => !isNaN(id) && id > 0);
    }

    if (!adminId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (!csr_id || !session_date || !coaching_type || !status) {
      res.status(400).json({
        success: false,
        message: 'Missing required fields: csr_id, session_date, coaching_type, status'
      });
      return;
    }

    if (!topic_ids || !Array.isArray(topic_ids) || topic_ids.length === 0) {
      res.status(400).json({ success: false, message: 'At least one topic is required' });
      return;
    }

    if (!['SCHEDULED', 'COMPLETED'].includes(status)) {
      res.status(400).json({ success: false, message: 'Invalid status. Must be SCHEDULED or COMPLETED' });
      return;
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      res.status(500).json({ success: false, message: 'CSR role not found' });
      return;
    }

    const csrUser = await prisma.user.findFirst({
      where: { id: parseInt(csr_id), role_id: csrRoleId, is_active: true, department: { is_active: true } },
      select: { id: true, username: true, department: { select: { department_name: true } } }
    });

    if (!csrUser) {
      res.status(403).json({ success: false, message: 'CSR not found or inactive' });
      return;
    }

    if (notes && notes.length > 2000) {
      res.status(400).json({ success: false, message: 'Notes cannot exceed 2000 characters' });
      return;
    }

    const validTopicIds = topic_ids.filter((id: number) => Number.isInteger(Number(id)) && Number(id) > 0);
    if (validTopicIds.length !== topic_ids.length) {
      res.status(400).json({ success: false, message: 'All topic IDs must be valid positive integers' });
      return;
    }

    const validTopics = await prisma.topic.findMany({
      where: { id: { in: topic_ids }, is_active: true },
      select: { id: true }
    });

    if (validTopics.length !== topic_ids.length) {
      res.status(400).json({ success: false, message: 'One or more topic IDs are invalid or inactive' });
      return;
    }

    const validCoachingTypes = ['Classroom', 'Side-by-Side', 'Team Session', '1-on-1', 'PIP', 'Verbal Warning', 'Written Warning'];
    if (!validCoachingTypes.includes(coaching_type)) {
      res.status(400).json({ success: false, message: 'Invalid coaching type' });
      return;
    }

    let attachmentData: any = { filename: null, path: null, size: null, mime_type: null };

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
        res.status(500).json({ success: false, message: 'Failed to save attachment' });
        return;
      }
    }

    const newSession = await prisma.$transaction(async (tx) => {
      const session = await tx.coachingSession.create({
        data: {
          csr_id: parseInt(csr_id),
          session_date: new Date(session_date),
          coaching_type,
          notes: notes || null,
          status,
          attachment_filename: attachmentData.filename,
          attachment_path: attachmentData.path,
          attachment_size: attachmentData.size,
          attachment_mime_type: attachmentData.mime_type,
          created_by: adminId
        }
      });

      await tx.coachingSessionTopic.createMany({
        data: topic_ids.map((topic_id: number) => ({
          coaching_session_id: session.id,
          topic_id: topic_id
        }))
      });

      await tx.auditLog.create({
        data: {
          user_id: adminId,
          action: 'CREATE',
          target_id: session.id,
          target_type: 'coaching_session',
          details: JSON.stringify({ csr_id, topic_ids, coaching_type, status, has_attachment: !!attachment })
        }
      });

      return session;
    });

    const createdSession = await prisma.$queryRaw<any[]>`
      SELECT
        cs.id, cs.csr_id, u.username as csr_name, cs.session_date, cs.coaching_type, cs.notes, cs.status,
        cs.attachment_filename, cs.attachment_path, cs.attachment_size, cs.attachment_mime_type,
        cs.created_at, creator.username as created_by_name,
        GROUP_CONCAT(t.topic_name ORDER BY t.topic_name SEPARATOR ', ') as topics,
        GROUP_CONCAT(t.id ORDER BY t.id SEPARATOR ',') as topic_ids
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      LEFT JOIN users creator ON cs.created_by = creator.id
      LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
      LEFT JOIN topics t ON cst.topic_id = t.id
      WHERE cs.id = ${newSession.id}
      GROUP BY cs.id
    `;

    const sessionData = createdSession[0];
    const responseData = {
      ...sessionData,
      topics: sessionData.topics ? sessionData.topics.split(', ') : [],
      topic_ids: sessionData.topic_ids ? sessionData.topic_ids.split(',').map((id: string) => parseInt(id)) : []
    };

    res.status(201).json({ success: true, data: responseData, message: 'Coaching session created successfully' });
  } catch (error) {
    console.error('Error creating coaching session:', error);
    serviceLogger.error('admin', 'createAdminCoachingSession', error as Error, req.user?.user_id);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Get coaching sessions with pagination and filters (admin can see all sessions)
 * @route GET /api/admin/coaching-sessions
 */
export const getAdminCoachingSessions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user_id = req.user?.user_id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const searchTerm = req.query.search as string || '';
    const csr_id = req.query.csr_id as string || '';
    const status = req.query.status as string || '';
    const coaching_type = req.query.coaching_type as string || '';
    const start_date = req.query.start_date as string || '';
    const end_date = req.query.end_date as string || '';

    if (!user_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (isNaN(limit) || isNaN(offset) || limit < 1 || limit > 100 || offset < 0) {
      res.status(400).json({ success: false, message: 'Invalid pagination parameters' });
      return;
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      res.status(500).json({ success: false, message: 'CSR role not found' });
      return;
    }

    const conditions: Prisma.Sql[] = [
      Prisma.sql`u.role_id = ${csrRoleId}`,
      Prisma.sql`u.is_active = 1`,
      Prisma.sql`d.is_active = 1`
    ];

    if (searchTerm) {
      conditions.push(Prisma.sql`(
        u.username LIKE ${`%${searchTerm}%`}
        OR EXISTS (
          SELECT 1 FROM coaching_session_topics cst
          JOIN topics t ON cst.topic_id = t.id
          WHERE cst.coaching_session_id = cs.id
          AND t.topic_name LIKE ${`%${searchTerm}%`}
        )
      )`);
    }

    if (csr_id) conditions.push(Prisma.sql`cs.csr_id = ${parseInt(csr_id)}`);
    if (status) conditions.push(Prisma.sql`cs.status = ${status}`);
    if (coaching_type) conditions.push(Prisma.sql`cs.coaching_type = ${coaching_type}`);
    if (start_date) conditions.push(Prisma.sql`DATE(cs.session_date) >= ${start_date}`);
    if (end_date) conditions.push(Prisma.sql`DATE(cs.session_date) <= ${end_date}`);

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const [countResult, sessions] = await Promise.all([
      prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*) as total
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        JOIN departments d ON u.department_id = d.id
        ${whereClause}
      `,
      prisma.$queryRaw<any[]>`
        SELECT
          cs.id, cs.csr_id, u.username as csr_name, cs.session_date, cs.coaching_type, cs.notes, cs.status,
          cs.attachment_filename, cs.attachment_path, cs.attachment_size, cs.attachment_mime_type,
          cs.created_at, creator.username as created_by_name,
          GROUP_CONCAT(DISTINCT t.topic_name ORDER BY t.topic_name SEPARATOR ', ') as topics,
          GROUP_CONCAT(DISTINCT t.id ORDER BY t.id SEPARATOR ',') as topic_ids
        FROM coaching_sessions cs
        JOIN users u ON cs.csr_id = u.id
        JOIN departments d ON u.department_id = d.id
        LEFT JOIN users creator ON cs.created_by = creator.id
        LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
        LEFT JOIN topics t ON cst.topic_id = t.id
        ${whereClause}
        GROUP BY cs.id
        ORDER BY cs.session_date DESC
        LIMIT ${Number(limit)} OFFSET ${Number(offset)}
      `
    ]);

    const totalCount = Number(countResult[0]?.total || 0);

    const transformedSessions = (sessions || []).map((session: any) => ({
      ...session,
      topics: session.topics ? session.topics.split(', ') : [],
      topic_ids: session.topic_ids ? session.topic_ids.split(',').map((id: string) => parseInt(id)) : []
    }));

    res.json({ success: true, data: { sessions: transformedSessions, totalCount, page, limit } });
  } catch (error) {
    console.error('Error fetching coaching sessions:', error);
    serviceLogger.error('admin', 'getAdminCoachingSessions', error as Error, req.user?.user_id);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Export coaching sessions with current filters (admin can see all sessions)
 * @route GET /api/admin/coaching-sessions/export
 */
export const exportAdminCoachingSessions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user_id = req.user?.user_id;
    const searchTerm = req.query.search as string || '';
    const csr_id = req.query.csr_id as string || '';
    const status = req.query.status as string || '';
    const coaching_type = req.query.coaching_type as string || '';
    const start_date = req.query.start_date as string || '';
    const end_date = req.query.end_date as string || '';

    if (!user_id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      res.status(500).json({ success: false, message: 'CSR role not found' });
      return;
    }

    const conditions: Prisma.Sql[] = [
      Prisma.sql`u.role_id = ${csrRoleId}`,
      Prisma.sql`u.is_active = 1`,
      Prisma.sql`d.is_active = 1`
    ];

    if (searchTerm) {
      conditions.push(Prisma.sql`(
        u.username LIKE ${`%${searchTerm}%`}
        OR EXISTS (
          SELECT 1 FROM coaching_session_topics cst
          JOIN topics t ON cst.topic_id = t.id
          WHERE cst.coaching_session_id = cs.id
          AND t.topic_name LIKE ${`%${searchTerm}%`}
        )
      )`);
    }

    if (csr_id) conditions.push(Prisma.sql`cs.csr_id = ${parseInt(csr_id)}`);
    if (status) conditions.push(Prisma.sql`cs.status = ${status}`);
    if (coaching_type) conditions.push(Prisma.sql`cs.coaching_type = ${coaching_type}`);
    if (start_date) conditions.push(Prisma.sql`DATE(cs.session_date) >= ${start_date}`);
    if (end_date) conditions.push(Prisma.sql`DATE(cs.session_date) <= ${end_date}`);

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const sessions = await prisma.$queryRaw<any[]>`
      SELECT
        cs.id, cs.session_date, cs.coaching_type, cs.notes, cs.status, cs.attachment_filename,
        cs.created_at, u.username as csr_name, creator.username as created_by_name,
        GROUP_CONCAT(DISTINCT t.topic_name ORDER BY t.topic_name SEPARATOR ', ') as topics
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      JOIN departments d ON u.department_id = d.id
      LEFT JOIN users creator ON cs.created_by = creator.id
      LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
      LEFT JOIN topics t ON cst.topic_id = t.id
      ${whereClause}
      GROUP BY cs.id
      ORDER BY cs.session_date DESC
    `;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Coaching Sessions');

    worksheet.columns = [
      { header: 'Session ID', key: 'id', width: 14 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Coaching Type', key: 'coaching_type', width: 20 },
      { header: 'CSR Name', key: 'csr_name', width: 24 },
      { header: 'Topics', key: 'topics', width: 36 },
      { header: 'Manager/Trainer', key: 'created_by_name', width: 24 },
      { header: 'Session Date', key: 'session_date', width: 16 },
      { header: 'Created At', key: 'created_at', width: 16 },
      { header: 'Notes', key: 'notes', width: 48 },
      { header: 'Attachment', key: 'attachment_filename', width: 28 }
    ];

    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00AEEF' } };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(1).height = 22;

    (sessions || []).forEach((session: any) => {
      worksheet.addRow({
        id: `#${session.id}`,
        status: session.status ? session.status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c: string) => c.toUpperCase()) : '',
        coaching_type: session.coaching_type || '',
        csr_name: session.csr_name || '',
        topics: session.topics || '',
        created_by_name: session.created_by_name || 'Unknown',
        session_date: session.session_date ? new Date(session.session_date).toLocaleDateString('en-US') : '',
        created_at: session.created_at ? new Date(session.created_at).toLocaleDateString('en-US') : '',
        notes: session.notes || '',
        attachment_filename: session.attachment_filename || ''
      });
    });

    worksheet.eachRow((row, rowNumber) => {
      row.alignment = { vertical: 'top', horizontal: rowNumber === 1 ? 'center' : 'left', wrapText: true };
    });

    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: worksheet.columns.length } };

    const buffer = await workbook.xlsx.writeBuffer();
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
    const fileName = `QTIP_CoachingSessions_${dateStr}_${timeStr}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; ${escapeFilename(fileName)}`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Error exporting coaching sessions:', error);
    serviceLogger.error('admin', 'exportAdminCoachingSessions', error as Error, req.user?.user_id);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Get coaching session details by ID (admin can see any session)
 * @route GET /api/admin/coaching-sessions/:sessionId
 */
export const getAdminCoachingSessionDetails = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user_id = req.user?.user_id;
    const sessionId = parseInt(req.params.sessionId);

    if (!user_id) {
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

    const sessionRows = await prisma.$queryRaw<any[]>`
      SELECT
        cs.id, cs.csr_id, u.username as csr_name, u.email as csr_email,
        d.department_name as csr_department, cs.session_date, cs.coaching_type, cs.notes, cs.status,
        cs.attachment_filename, cs.attachment_path, cs.attachment_size, cs.attachment_mime_type,
        cs.created_at, creator.username as created_by_name,
        GROUP_CONCAT(t.topic_name ORDER BY t.topic_name SEPARATOR ', ') as topics,
        GROUP_CONCAT(t.id ORDER BY t.id SEPARATOR ',') as topic_ids
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      JOIN departments d ON u.department_id = d.id
      LEFT JOIN users creator ON cs.created_by = creator.id
      LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
      LEFT JOIN topics t ON cst.topic_id = t.id
      WHERE cs.id = ${sessionId}
      AND u.role_id = ${csrRoleId}
      AND u.is_active = 1
      AND d.is_active = 1
      GROUP BY cs.id
    `;

    if (!sessionRows || sessionRows.length === 0) {
      res.status(404).json({ success: false, message: 'Coaching session not found' });
      return;
    }

    const sessionData = sessionRows[0];
    const responseData = {
      ...sessionData,
      topics: sessionData.topics ? sessionData.topics.split(', ') : [],
      topic_ids: sessionData.topic_ids ? sessionData.topic_ids.split(',').map((id: string) => parseInt(id)) : []
    };

    res.json({ success: true, data: responseData });
  } catch (error) {
    console.error('Error fetching coaching session details:', error);
    serviceLogger.error('admin', 'getAdminCoachingSessionDetails', error as Error, req.user?.user_id);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Update coaching session (admin can update any session)
 * @route PUT /api/admin/coaching-sessions/:sessionId
 */
export const updateAdminCoachingSession = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const adminId = req.user?.user_id;
    const sessionId = parseInt(req.params.sessionId);
    let { csr_id, session_date, topic_ids, coaching_type, notes, status } = req.body;
    const attachment = req.file as Express.Multer.File | undefined;

    if (topic_ids !== undefined) {
      if (typeof topic_ids === 'string') {
        topic_ids = topic_ids.split(',').map((id: string) => id.trim()).filter((id: string) => id !== '');
      }
      if (!Array.isArray(topic_ids)) {
        topic_ids = [topic_ids];
      }
      topic_ids = (topic_ids as any[]).map((id: any) => parseInt(String(id))).filter((id: number) => !isNaN(id) && id > 0);
    }

    if (!adminId) {
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

    const sessionRows = await prisma.$queryRaw<{ id: number; current_status: string; csr_name: string }[]>`
      SELECT cs.id, cs.status as current_status, u.username as csr_name
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      JOIN departments d ON u.department_id = d.id
      WHERE cs.id = ${sessionId}
      AND u.role_id = ${csrRoleId}
      AND u.is_active = 1
      AND d.is_active = 1
    `;

    if (!sessionRows || sessionRows.length === 0) {
      res.status(404).json({ success: false, message: 'Coaching session not found' });
      return;
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
        res.status(400).json({
          success: false,
          message: 'Cannot edit completed coaching sessions (except to reopen them by changing status to SCHEDULED)'
        });
        return;
      }

      if (!hasOtherFieldUpdates && status !== undefined && status !== 'SCHEDULED') {
        res.status(400).json({
          success: false,
          message: 'Cannot edit completed coaching sessions (except to reopen them by changing status to SCHEDULED)'
        });
        return;
      }
    }

    if (status && !['SCHEDULED', 'COMPLETED'].includes(status)) {
      res.status(400).json({ success: false, message: 'Invalid status. Must be SCHEDULED or COMPLETED' });
      return;
    }

    if (topic_ids !== undefined) {
      if (!Array.isArray(topic_ids) || topic_ids.length === 0) {
        res.status(400).json({ success: false, message: 'At least one topic is required' });
        return;
      }

      const validTopicIds = topic_ids.filter((id: number) => Number.isInteger(id) && id > 0);
      if (validTopicIds.length === 0) {
        res.status(400).json({ success: false, message: 'All topic IDs must be valid positive integers' });
        return;
      }

      const activeTopicRows = await prisma.topic.findMany({
        where: { id: { in: validTopicIds }, is_active: true },
        select: { id: true }
      });
      const activeTopicIds = activeTopicRows.map((r) => r.id);

      if (activeTopicIds.length === 0) {
        res.status(400).json({
          success: false,
          message: 'All selected topics are invalid or inactive. Please select at least one active topic.'
        });
        return;
      }
      topic_ids = activeTopicIds;
    }

    if (notes && notes.length > 2000) {
      res.status(400).json({ success: false, message: 'Notes cannot exceed 2000 characters' });
      return;
    }

    if (coaching_type) {
      const validCoachingTypes = ['Classroom', 'Side-by-Side', 'Team Session', '1-on-1', 'PIP', 'Verbal Warning', 'Written Warning'];
      if (!validCoachingTypes.includes(coaching_type)) {
        res.status(400).json({ success: false, message: 'Invalid coaching type' });
        return;
      }
    }

    if (csr_id) {
      const csrUser = await prisma.user.findFirst({
        where: { id: parseInt(csr_id), role_id: csrRoleId, is_active: true, department: { is_active: true } },
        select: { id: true }
      });

      if (!csrUser) {
        res.status(403).json({ success: false, message: 'CSR not found or inactive' });
        return;
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
        res.status(500).json({ success: false, message: 'Failed to save attachment' });
        return;
      }
    }

    const data: Record<string, any> = {};

    if (csr_id !== undefined) data.csr_id = parseInt(csr_id);
    if (session_date !== undefined) data.session_date = new Date(session_date);
    if (coaching_type !== undefined) data.coaching_type = coaching_type;
    if (notes !== undefined) data.notes = notes || null;
    if (status !== undefined) data.status = status;

    if (attachment && Object.keys(attachmentData).length > 0) {
      data.attachment_filename = attachmentData.attachment_filename;
      data.attachment_path = attachmentData.attachment_path;
      data.attachment_size = attachmentData.attachment_size;
      data.attachment_mime_type = attachmentData.attachment_mime_type;
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ success: false, message: 'No fields to update' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.coachingSession.update({ where: { id: sessionId }, data });
      }

      if (topic_ids !== undefined) {
        await tx.coachingSessionTopic.deleteMany({ where: { coaching_session_id: sessionId } });
        await tx.coachingSessionTopic.createMany({
          data: topic_ids.map((topic_id: number) => ({ coaching_session_id: sessionId, topic_id: topic_id }))
        });
      }

      await tx.auditLog.create({
        data: {
          user_id: adminId,
          action: 'UPDATE',
          target_id: sessionId,
          target_type: 'coaching_session',
          details: JSON.stringify(req.body)
        }
      });
    });

    const updatedSession = await prisma.$queryRaw<any[]>`
      SELECT
        cs.id, cs.csr_id, u.username as csr_name, cs.session_date, cs.coaching_type, cs.notes, cs.status,
        cs.attachment_filename, cs.attachment_path, cs.attachment_size, cs.attachment_mime_type,
        cs.created_at, creator.username as created_by_name,
        GROUP_CONCAT(t.topic_name ORDER BY t.topic_name SEPARATOR ', ') as topics,
        GROUP_CONCAT(t.id ORDER BY t.id SEPARATOR ',') as topic_ids
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      LEFT JOIN users creator ON cs.created_by = creator.id
      LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
      LEFT JOIN topics t ON cst.topic_id = t.id
      WHERE cs.id = ${sessionId}
      GROUP BY cs.id
    `;

    const sessionData = updatedSession[0];
    const responseData = {
      ...sessionData,
      topics: sessionData.topics ? sessionData.topics.split(', ') : [],
      topic_ids: sessionData.topic_ids ? sessionData.topic_ids.split(',').map((id: string) => parseInt(id)) : []
    };

    res.json({ success: true, data: responseData, message: 'Coaching session updated successfully' });
  } catch (error) {
    console.error('Error updating coaching session:', error);
    serviceLogger.error('admin', 'updateAdminCoachingSession', error as Error, req.user?.user_id);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Mark coaching session as completed (admin can complete any session)
 * @route PATCH /api/admin/coaching-sessions/:sessionId/complete
 */
export const completeAdminCoachingSession = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const adminId = req.user?.user_id;
    const sessionId = parseInt(req.params.sessionId);

    if (!adminId) {
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

    const sessionRows = await prisma.$queryRaw<{ id: number; current_status: string; csr_name: string }[]>`
      SELECT cs.id, cs.status as current_status, u.username as csr_name
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      JOIN departments d ON u.department_id = d.id
      WHERE cs.id = ${sessionId}
      AND u.role_id = ${csrRoleId}
      AND u.is_active = 1
      AND d.is_active = 1
    `;

    if (!sessionRows || sessionRows.length === 0) {
      res.status(404).json({ success: false, message: 'Coaching session not found' });
      return;
    }

    const currentSession = sessionRows[0];

    if (currentSession.current_status === 'COMPLETED') {
      res.status(400).json({ success: false, message: 'Coaching session is already completed' });
      return;
    }

    await prisma.coachingSession.update({ where: { id: sessionId }, data: { status: 'COMPLETED' } });

    await prisma.auditLog.create({
      data: {
        user_id: adminId,
        action: 'COMPLETE',
        target_id: sessionId,
        target_type: 'coaching_session',
        details: JSON.stringify({ csr_name: currentSession.csr_name })
      }
    });

    const updatedSession = await prisma.$queryRaw<any[]>`
      SELECT
        cs.id, cs.csr_id, u.username as csr_name, cs.session_date, cs.coaching_type, cs.notes, cs.status,
        cs.attachment_filename, cs.attachment_path, cs.attachment_size, cs.attachment_mime_type,
        cs.created_at, creator.username as created_by_name,
        GROUP_CONCAT(t.topic_name ORDER BY t.topic_name SEPARATOR ', ') as topics,
        GROUP_CONCAT(t.id ORDER BY t.id SEPARATOR ',') as topic_ids
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      LEFT JOIN users creator ON cs.created_by = creator.id
      LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
      LEFT JOIN topics t ON cst.topic_id = t.id
      WHERE cs.id = ${sessionId}
      GROUP BY cs.id
    `;

    const sessionData = updatedSession[0];
    const responseData = {
      ...sessionData,
      topics: sessionData.topics ? sessionData.topics.split(', ') : [],
      topic_ids: sessionData.topic_ids ? sessionData.topic_ids.split(',').map((id: string) => parseInt(id)) : []
    };

    res.json({ success: true, data: responseData, message: 'Coaching session marked as completed successfully' });
  } catch (error) {
    console.error('Error completing coaching session:', error);
    serviceLogger.error('admin', 'completeAdminCoachingSession', error as Error, req.user?.user_id);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Re-open a completed coaching session (admin can reopen any session)
 * @route PATCH /api/admin/coaching-sessions/:sessionId/reopen
 */
export const reopenAdminCoachingSession = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const adminId = req.user?.user_id;
    const sessionId = parseInt(req.params.sessionId);

    if (!adminId) {
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

    const sessionRows = await prisma.$queryRaw<{ id: number; current_status: string; csr_name: string }[]>`
      SELECT cs.id, cs.status as current_status, u.username as csr_name
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      JOIN departments d ON u.department_id = d.id
      WHERE cs.id = ${sessionId}
      AND u.role_id = ${csrRoleId}
      AND u.is_active = 1
      AND d.is_active = 1
    `;

    if (!sessionRows || sessionRows.length === 0) {
      res.status(404).json({ success: false, message: 'Coaching session not found' });
      return;
    }

    const currentSession = sessionRows[0];

    if (currentSession.current_status !== 'COMPLETED') {
      res.status(400).json({ success: false, message: 'Can only reopen completed coaching sessions' });
      return;
    }

    await prisma.coachingSession.update({ where: { id: sessionId }, data: { status: 'SCHEDULED' } });

    await prisma.auditLog.create({
      data: {
        user_id: adminId,
        action: 'REOPEN',
        target_id: sessionId,
        target_type: 'coaching_session',
        details: JSON.stringify({ csr_name: currentSession.csr_name })
      }
    });

    const updatedSession = await prisma.$queryRaw<any[]>`
      SELECT
        cs.id, cs.csr_id, u.username as csr_name, cs.session_date, cs.coaching_type, cs.notes, cs.status,
        cs.attachment_filename, cs.attachment_path, cs.attachment_size, cs.attachment_mime_type,
        cs.created_at, creator.username as created_by_name,
        GROUP_CONCAT(t.topic_name ORDER BY t.topic_name SEPARATOR ', ') as topics,
        GROUP_CONCAT(t.id ORDER BY t.id SEPARATOR ',') as topic_ids
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      LEFT JOIN users creator ON cs.created_by = creator.id
      LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
      LEFT JOIN topics t ON cst.topic_id = t.id
      WHERE cs.id = ${sessionId}
      GROUP BY cs.id
    `;

    const sessionData = updatedSession[0];
    const responseData = {
      ...sessionData,
      topics: sessionData.topics ? sessionData.topics.split(', ') : [],
      topic_ids: sessionData.topic_ids ? sessionData.topic_ids.split(',').map((id: string) => parseInt(id)) : []
    };

    res.json({ success: true, data: responseData, message: 'Coaching session reopened successfully' });
  } catch (error) {
    console.error('Error reopening coaching session:', error);
    serviceLogger.error('admin', 'reopenAdminCoachingSession', error as Error, req.user?.user_id);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Download coaching session attachment (admin can download any attachment)
 * @route GET /api/admin/coaching-sessions/:sessionId/attachment
 */
export const downloadAdminCoachingSessionAttachment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const adminId = req.user?.user_id;
    const sessionId = parseInt(req.params.sessionId);

    if (!adminId) {
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

    const sessionRows = await prisma.$queryRaw<any[]>`
      SELECT cs.id, cs.attachment_filename, cs.attachment_path, cs.attachment_mime_type, u.username as csr_name
      FROM coaching_sessions cs
      JOIN users u ON cs.csr_id = u.id
      JOIN departments d ON u.department_id = d.id
      WHERE cs.id = ${sessionId}
      AND u.role_id = ${csrRoleId}
      AND u.is_active = 1
      AND d.is_active = 1
      AND cs.attachment_path IS NOT NULL
    `;

    if (!sessionRows || sessionRows.length === 0) {
      res.status(404).json({ success: false, message: 'Coaching session not found or no attachment' });
      return;
    }

    const session = sessionRows[0];
    const filePath = path.join(process.cwd(), session.attachment_path);

    try {
      await fs.access(filePath);
    } catch {
      res.status(404).json({ success: false, message: 'Attachment file not found on server' });
      return;
    }

    const stats = await fs.stat(filePath);

    res.setHeader('Content-Type', session.attachment_mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; ${escapeFilename(session.attachment_filename)}`);

    const fileStream = createReadStream(filePath);

    fileStream.on('error', (streamError: Error) => {
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Error reading file' });
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
    serviceLogger.error('admin', 'downloadAdminCoachingSessionAttachment', error as Error, req.user?.user_id);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Get all CSRs (admin can see all CSRs in the system)
 * @route GET /api/admin/csrs
 */
export const getAdminCSRs = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const adminId = req.user?.user_id;

    if (!adminId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const csrRoleId = await getRoleId('CSR');
    if (!csrRoleId) {
      res.status(500).json({ success: false, message: 'CSR role not found' });
      return;
    }

    const csrs = await prisma.$queryRaw<{ id: number; username: string; email: string; department_name: string }[]>`
      SELECT u.id, u.username, u.email, d.department_name
      FROM users u
      JOIN departments d ON u.department_id = d.id
      WHERE u.role_id = ${csrRoleId}
      AND u.is_active = 1
      AND d.is_active = 1
      ORDER BY u.username ASC
    `;

    res.json({ success: true, data: csrs || [], total: csrs?.length || 0 });
  } catch (error) {
    console.error('Error fetching CSRs:', error);
    serviceLogger.error('admin', 'getAdminCSRs', error as Error, req.user?.user_id);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
