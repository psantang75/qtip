import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import { authenticate } from '../middleware/auth';
import { applyAutoAdvance } from '../utils/coachingAutoAdvance';

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
    const encoded = encodeURIComponent(cleanFilename)
      .replace(/\*/g, '%2A');
    return `filename*=UTF-8''${encoded}`;
  }
  
  return `filename="${cleanFilename.replace(/"/g, '\\"')}"`;
};

// Interface for CSR dashboard stats (similar to manager dashboard)
interface CSRDashboardStats {
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
}

// Interface for CSR activity data (will show only logged-in CSR's data)
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
 * Get CSR dashboard statistics (filtered to logged-in CSR only)
 * @route GET /api/csr/dashboard-stats
 */
export const getCSRDashboardStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const csrId = req.user?.user_id;
    
    if (!csrId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const reviewsCompleted = await prisma.$queryRaw<{thisWeek: bigint, thisMonth: bigint}[]>(
      Prisma.sql`
        SELECT 
          COUNT(CASE WHEN s.submitted_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) as thisWeek,
          COUNT(CASE WHEN s.submitted_at >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 END) as thisMonth
        FROM submissions s
        JOIN submission_metadata sm ON s.id = sm.submission_id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
        AND fmf.field_name = 'CSR'
        AND sm.value = ${csrId.toString()}
      `
    );

    const disputes = await prisma.$queryRaw<{thisWeek: bigint, thisMonth: bigint}[]>(
      Prisma.sql`
        SELECT 
          COUNT(CASE WHEN d.created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK) AND d.status = 'OPEN' THEN 1 END) as thisWeek,
          COUNT(CASE WHEN d.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01') AND d.status = 'OPEN' THEN 1 END) as thisMonth
        FROM disputes d
        JOIN submissions s ON d.submission_id = s.id
        JOIN submission_metadata sm ON s.id = sm.submission_id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        WHERE fmf.field_name = 'CSR'
        AND CAST(sm.value AS UNSIGNED) = ${csrId}
      `
    );

    const coachingSessions = await prisma.$queryRaw<{thisWeek: bigint, thisMonth: bigint}[]>(
      Prisma.sql`
        SELECT 
          COUNT(CASE WHEN cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) as thisWeek,
          COUNT(CASE WHEN cs.session_date >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 END) as thisMonth
        FROM coaching_sessions cs
        WHERE cs.status IN ('SCHEDULED', 'COMPLETED')
        AND cs.csr_id = ${csrId}
      `
    );

    const stats: CSRDashboardStats = {
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
    console.error('Error fetching CSR dashboard stats:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard statistics' });
  }
};

/**
 * Get CSR activity data for CSR dashboard (only logged-in CSR's data)
 * @route GET /api/csr/csr-activity
 */
export const getCSRActivity = async (req: Request, res: Response): Promise<void> => {
  try {
    const csrId = req.user?.user_id;
    
    if (!csrId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

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
          FROM submissions s
          JOIN submission_metadata sm ON s.id = sm.submission_id
          JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED') AND fmf.field_name = 'CSR' AND sm.value = ${csrId.toString()}
          GROUP BY sm.value
        ) audit_counts ON u.id = audit_counts.csr_id
        LEFT JOIN (
          SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(disp.id) as disputes
          FROM submissions s
          JOIN submission_metadata sm ON s.id = sm.submission_id
          JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          JOIN disputes disp ON disp.submission_id = s.id
          WHERE fmf.field_name = 'CSR' AND sm.value = ${csrId.toString()} AND disp.status = 'OPEN'
          GROUP BY sm.value
        ) dispute_counts ON u.id = dispute_counts.csr_id
        LEFT JOIN (
          SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(s.id) as audits_week
          FROM submissions s
          JOIN submission_metadata sm ON s.id = sm.submission_id
          JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED') AND fmf.field_name = 'CSR' AND sm.value = ${csrId.toString()}
          AND s.submitted_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
          GROUP BY sm.value
        ) audit_counts_week ON u.id = audit_counts_week.csr_id
        LEFT JOIN (
          SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(disp.id) as disputes_week
          FROM submissions s
          JOIN submission_metadata sm ON s.id = sm.submission_id
          JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          JOIN disputes disp ON disp.submission_id = s.id
          WHERE fmf.field_name = 'CSR' AND sm.value = ${csrId.toString()}
          AND disp.created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK) AND disp.status = 'OPEN'
          GROUP BY sm.value
        ) dispute_counts_week ON u.id = dispute_counts_week.csr_id
        LEFT JOIN (
          SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(s.id) as audits_month
          FROM submissions s
          JOIN submission_metadata sm ON s.id = sm.submission_id
          JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED') AND fmf.field_name = 'CSR' AND sm.value = ${csrId.toString()}
          AND s.submitted_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
          GROUP BY sm.value
        ) audit_counts_month ON u.id = audit_counts_month.csr_id
        LEFT JOIN (
          SELECT CAST(sm.value AS UNSIGNED) as csr_id, COUNT(disp.id) as disputes_month
          FROM submissions s
          JOIN submission_metadata sm ON s.id = sm.submission_id
          JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          JOIN disputes disp ON disp.submission_id = s.id
          WHERE fmf.field_name = 'CSR' AND sm.value = ${csrId.toString()}
          AND disp.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01') AND disp.status = 'OPEN'
          GROUP BY sm.value
        ) dispute_counts_month ON u.id = dispute_counts_month.csr_id
        LEFT JOIN (
          SELECT cs.csr_id, COUNT(cs.id) as coachingScheduled
          FROM coaching_sessions cs WHERE cs.status = 'SCHEDULED' AND cs.csr_id = ${csrId}
          GROUP BY cs.csr_id
        ) coaching_scheduled ON u.id = coaching_scheduled.csr_id
        LEFT JOIN (
          SELECT cs.csr_id, COUNT(cs.id) as coachingCompleted
          FROM coaching_sessions cs WHERE cs.status = 'COMPLETED' AND cs.csr_id = ${csrId}
          GROUP BY cs.csr_id
        ) coaching_completed ON u.id = coaching_completed.csr_id
        LEFT JOIN (
          SELECT cs.csr_id, COUNT(cs.id) as coachingScheduled_week
          FROM coaching_sessions cs WHERE cs.status = 'SCHEDULED'
          AND cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK) AND cs.csr_id = ${csrId}
          GROUP BY cs.csr_id
        ) coaching_scheduled_week ON u.id = coaching_scheduled_week.csr_id
        LEFT JOIN (
          SELECT cs.csr_id, COUNT(cs.id) as coachingCompleted_week
          FROM coaching_sessions cs WHERE cs.status = 'COMPLETED'
          AND cs.session_date >= DATE_SUB(NOW(), INTERVAL 1 WEEK) AND cs.csr_id = ${csrId}
          GROUP BY cs.csr_id
        ) coaching_completed_week ON u.id = coaching_completed_week.csr_id
        LEFT JOIN (
          SELECT cs.csr_id, COUNT(cs.id) as coachingScheduled_month
          FROM coaching_sessions cs WHERE cs.status = 'SCHEDULED'
          AND cs.session_date >= DATE_FORMAT(NOW(), '%Y-%m-01') AND cs.csr_id = ${csrId}
          GROUP BY cs.csr_id
        ) coaching_scheduled_month ON u.id = coaching_scheduled_month.csr_id
        LEFT JOIN (
          SELECT cs.csr_id, COUNT(cs.id) as coachingCompleted_month
          FROM coaching_sessions cs WHERE cs.status = 'COMPLETED'
          AND cs.session_date >= DATE_FORMAT(NOW(), '%Y-%m-01') AND cs.csr_id = ${csrId}
          GROUP BY cs.csr_id
        ) coaching_completed_month ON u.id = coaching_completed_month.csr_id
        WHERE r.role_name = 'CSR' 
        AND u.is_active = 1
        AND u.id = ${csrId}
        ORDER BY u.username
      `
    );

    const formattedCSRActivity: CSRActivityData[] = csrActivity.map(row => ({
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
    console.error('Error fetching CSR activity data:', error);
    res.status(500).json({ message: 'Failed to fetch CSR activity data' });
  }
};

/**
 * Get CSR dashboard statistics
 */
export const getCSRStats = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;

    const qaScoreResults = await prisma.$queryRaw<{avg_score: number, total_audits: bigint}[]>(
      Prisma.sql`
        SELECT 
          AVG(s.total_score) as avg_score,
          COUNT(*) as total_audits
        FROM submissions s
        JOIN submission_metadata sm ON sm.submission_id = s.id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        WHERE fmf.field_name = 'CSR' AND sm.value = ${userId.toString()} AND s.status = 'FINALIZED'
        AND s.submitted_at > DATE_SUB(NOW(), INTERVAL 90 DAY)
      `
    );

    const trainingResults = await prisma.$queryRaw<{completed: bigint, assigned: bigint}[]>(
      Prisma.sql`
        SELECT 
          COUNT(CASE WHEN ce.status = 'COMPLETED' THEN 1 END) as completed,
          COUNT(*) as assigned
        FROM enrollments ce
        WHERE ce.user_id = ${userId}
      `
    );

    const qaScore = qaScoreResults[0]?.avg_score || 0;
    const totalAudits = Number(qaScoreResults[0]?.total_audits ?? 0);
    
    const completedTraining = Number(trainingResults[0]?.completed ?? 0);
    const assignedTraining = Number(trainingResults[0]?.assigned ?? 0);
    
    const qaScoreTarget = 90;
    const trainingCompletionTarget = 100;

    const auditResults = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          s.id,
          f.form_name,
          s.total_score as score,
          s.submitted_at as submittedDate,
          s.status
        FROM submissions s
        JOIN forms f ON s.form_id = f.id
        JOIN submission_metadata sm ON sm.submission_id = s.id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        WHERE fmf.field_name = 'CSR' AND sm.value = ${userId.toString()}
        ORDER BY s.submitted_at DESC
        LIMIT 10
      `
    );

    const recentAudits = auditResults.map(audit => ({
      id: audit.id,
      formName: audit.form_name,
      score: audit.score || 0,
      submittedDate: audit.submittedDate,
      status: audit.status === 'FINALIZED' ? 'Closed' : 
              audit.status === 'DISPUTED' ? 'Disputed' : 'Disputable'
    }));

    const courseResults = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          c.id,
          c.course_name,
          ce.progress,
          ce.status,
          ce.due_date
        FROM enrollments ce
        JOIN courses c ON ce.course_id = c.id
        WHERE ce.user_id = ${userId}
        ORDER BY ce.due_date ASC
      `
    );

    const formattedCourses = courseResults.map(course => ({
      id: course.id,
      courseName: course.course_name,
      progress: {
        completed: Math.round((course.progress || 0) * 100 / 100),
        total: 100
      },
      dueDate: course.due_date,
      status: course.status === 'COMPLETED' ? 'Completed' : 
              course.status === 'IN_PROGRESS' ? 'In Progress' : 'Not Started'
    }));

    res.json({
      stats: {
        qaScore: {
          score: Math.round(qaScore),
          total: totalAudits
        },
        goalProgress: {
          qaScore: {
            current: Math.round(qaScore),
            target: qaScoreTarget
          },
          trainingCompletion: {
            current: assignedTraining > 0 ? Math.round((completedTraining / assignedTraining) * 100) : 0,
            target: trainingCompletionTarget
          }
        },
        trainingStatus: {
          completed: completedTraining,
          assigned: assignedTraining
        }
      },
      recentAudits,
      trainingCourses: formattedCourses
    });
  } catch (error) {
    console.error('Error fetching CSR dashboard stats:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard statistics' });
  }
};

/**
 * Get audits for a CSR
 */
export const getCSRAudits = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const { page = 1, limit = 10, formName, startDate, endDate, status, searchTerm } = req.query;
    
    const offset = (Number(page) - 1) * Number(limit);
    
    const sqlConditions: Prisma.Sql[] = [
      Prisma.sql`fmf.field_name = 'CSR'`,
      Prisma.sql`sm.value = ${userId.toString()}`
    ];
    
    if (formName) {
      sqlConditions.push(Prisma.sql`f.form_name LIKE ${'%' + formName + '%'}`);
    }
    
    if (status) {
      sqlConditions.push(Prisma.sql`s.status = ${status}`);
    }
    
    if (startDate && status !== 'DRAFT') {
      sqlConditions.push(Prisma.sql`DATE(s.submitted_at) >= ${startDate}`);
    }
    
    if (endDate && status !== 'DRAFT') {
      sqlConditions.push(Prisma.sql`DATE(s.submitted_at) <= ${endDate}`);
    }
    
    if (searchTerm) {
      sqlConditions.push(
        Prisma.sql`(f.form_name LIKE ${'%' + searchTerm + '%'} OR s.id LIKE ${'%' + searchTerm + '%'})`
      );
    }
    
    const whereClause = Prisma.sql`WHERE ${Prisma.join(sqlConditions, ' AND ')}`;

    const countResults = await prisma.$queryRaw<{total: bigint}[]>(
      Prisma.sql`
        SELECT COUNT(*) as total
        FROM submissions s
        JOIN forms f ON s.form_id = f.id
        JOIN submission_metadata sm ON sm.submission_id = s.id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        ${whereClause}
      `
    );
    const totalCount = Number(countResults[0]?.total ?? 0);
    
    const audits = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          s.id,
          s.form_id,
          f.form_name as formName,
          s.submitted_by,
          s.submitted_at as submittedDate,
          s.total_score as score,
          s.status,
          sm.value as csr_id,
          (
            SELECT sm2.value
            FROM submission_metadata sm2
            JOIN form_metadata_fields fmf2 ON sm2.field_id = fmf2.id
            WHERE sm2.submission_id = s.id AND fmf2.field_name IN ('Interaction Date', 'Call Date')
            LIMIT 1
          ) as interaction_date
        FROM submissions s
        JOIN forms f ON s.form_id = f.id
        JOIN submission_metadata sm ON sm.submission_id = s.id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        ${whereClause}
        ORDER BY s.submitted_at DESC
        LIMIT ${Number(limit)} OFFSET ${offset}
      `
    );
    
    const auditIds = audits.map((audit: any) => audit.id);
    
    if (auditIds.length > 0) {
      const disputeResults = await prisma.$queryRaw<{id: number, isDisputable: number}[]>(
        Prisma.sql`
          SELECT 
            s.id,
            CASE WHEN d.id IS NULL AND s.status = 'FINALIZED' 
                 AND s.submitted_at > DATE_SUB(NOW(), INTERVAL 7 DAY) 
                 THEN 1 ELSE 0 END as isDisputable
          FROM submissions s
          LEFT JOIN disputes d ON s.id = d.submission_id
          WHERE s.id IN (${Prisma.join(auditIds)})
        `
      );
      
      const disputeMap = disputeResults.reduce((map: Record<number, boolean>, row) => {
        map[row.id] = !!row.isDisputable;
        return map;
      }, {});
      
      audits.forEach((audit: any) => {
        audit.isDisputable = disputeMap[audit.id] || false;
      });
    }
    
    res.json({
      audits,
      totalCount
    });
  } catch (error) {
    console.error('Error fetching CSR audits:', error);
    res.status(500).json({ message: 'Failed to fetch audits' });
  }
};

/**
 * Get details for a specific audit
 */
export const getAuditDetails = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const auditId = req.params.id;
    
    const auditResults = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          s.id,
          s.form_id,
          f.form_name as formName,
          s.submitted_by,
          s.submitted_at as submittedDate,
          s.total_score as score,
          s.status
        FROM submissions s
        JOIN forms f ON s.form_id = f.id
        JOIN submission_metadata sm ON sm.submission_id = s.id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        WHERE s.id = ${auditId} AND fmf.field_name = 'CSR' AND sm.value = ${userId.toString()}
      `
    );
    
    if (auditResults.length === 0) {
      return res.status(404).json({ message: 'Audit not found' });
    }
    
    const audit = auditResults[0];
    
    const questionResults = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          a.id,
          a.question_id,
          q.question_text,
          a.answer,
          a.notes
        FROM submission_answers a
        JOIN form_questions q ON a.question_id = q.id
        WHERE a.submission_id = ${auditId}
        ORDER BY q.category_id, q.sort_order
      `
    );
    
    const callResults = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          c.id,
          c.call_id,
          c.call_date,
          c.duration,
          c.recording_url,
          c.transcript
        FROM calls c
        JOIN submission_calls sc ON c.id = sc.call_id
        WHERE sc.submission_id = ${auditId}
      `
    );
    
    const metadataResults = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          f.field_name,
          sm.value,
          CASE WHEN f.field_name = 'CSR' THEN true ELSE false END as is_csr_field
        FROM submission_metadata sm
        JOIN form_metadata_fields f ON sm.field_id = f.id
        WHERE sm.submission_id = ${auditId}
      `
    );
    
    let csrId = null;
    for (const meta of metadataResults) {
      if (meta.is_csr_field && meta.value) {
        csrId = meta.value;
        break;
      }
    }
    
    let qaAnalystName = null;
    if (csrId) {
      const csrResults = await prisma.$queryRaw<any[]>(
        Prisma.sql`SELECT username, first_name, last_name FROM users WHERE id = ${csrId}`
      );
      
      if (csrResults.length > 0) {
        const csr = csrResults[0];
        qaAnalystName = csr.first_name && csr.last_name 
          ? `${csr.first_name} ${csr.last_name}` 
          : csr.username;
      }
    }
    
    const disputeResults = await prisma.$queryRaw<{isDisputable: number}[]>(
      Prisma.sql`
        SELECT 
          CASE WHEN d.id IS NULL AND s.status = 'FINALIZED' 
               AND s.submitted_at > DATE_SUB(NOW(), INTERVAL 7 DAY) 
               THEN 1 ELSE 0 END as isDisputable
        FROM submissions s
        LEFT JOIN disputes d ON s.id = d.submission_id
        WHERE s.id = ${auditId}
      `
    );
    
    const auditDetail = {
      ...audit,
      qaAnalystName,
      csrId,
      isDisputable: !!disputeResults[0]?.isDisputable,
      questions: questionResults,
      calls: callResults,
      metadata: metadataResults.map(m => ({
        field_name: m.field_name,
        value: m.value
      }))
    };
    
    res.json(auditDetail);
  } catch (error) {
    console.error('Error fetching audit details:', error);
    res.status(500).json({ message: 'Failed to fetch audit details' });
  }
};

/**
 * Check if an audit is disputable
 */
export const isAuditDisputable = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const submissionId = req.params.id;
    
    const auditResults = await prisma.$queryRaw<{id: number}[]>(
      Prisma.sql`
        SELECT s.id 
        FROM submissions s
        JOIN submission_metadata sm ON sm.submission_id = s.id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        WHERE s.id = ${submissionId} AND fmf.field_name = 'CSR' AND sm.value = ${userId.toString()}
      `
    );
    
    if (auditResults.length === 0) {
      return res.status(404).json({ message: 'Audit not found' });
    }
    
    const disputeResults = await prisma.$queryRaw<{isDisputable: number}[]>(
      Prisma.sql`
        SELECT 
          CASE WHEN d.id IS NULL AND s.status = 'FINALIZED' 
               AND s.submitted_at > DATE_SUB(NOW(), INTERVAL 7 DAY) 
               THEN 1 ELSE 0 END as isDisputable
        FROM submissions s
        LEFT JOIN disputes d ON s.id = d.submission_id
        WHERE s.id = ${submissionId}
      `
    );
    
    res.json({
      disputable: !!disputeResults[0]?.isDisputable
    });
  } catch (error) {
    console.error('Error checking if audit is disputable:', error);
    res.status(500).json({ message: 'Failed to check if audit is disputable' });
  }
};

/**
 * Get training courses for CSR
 */
export const getTrainingCourses = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const { page = 1, pageSize = 10, status, dueDateOrder = 'asc' } = req.query;
    
    const offset = (Number(page) - 1) * Number(pageSize);
    const limit = Number(pageSize);

    const sqlConditions: Prisma.Sql[] = [Prisma.sql`e.user_id = ${userId}`];
    
    if (status && status !== 'all') {
      switch (status) {
        case 'not-started':
          sqlConditions.push(Prisma.sql`e.status = 'IN_PROGRESS' AND e.progress = 0`);
          break;
        case 'in-progress':
          sqlConditions.push(Prisma.sql`e.status = 'IN_PROGRESS' AND e.progress > 0`);
          break;
        case 'completed':
          sqlConditions.push(Prisma.sql`e.status = 'COMPLETED'`);
          break;
        case 'overdue':
          sqlConditions.push(Prisma.sql`e.status != 'COMPLETED' AND e.created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)`);
          break;
      }
    }

    const whereClause = Prisma.sql`WHERE ${Prisma.join(sqlConditions, ' AND ')}`;
    const orderDir = dueDateOrder === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;

    const coursesResults = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          e.id,
          e.course_id as courseId,
          c.course_name as courseName,
          c.description,
          e.progress as completed,
          (SELECT COUNT(*) FROM course_pages cp WHERE cp.course_id = c.id) as total,
          e.created_at as dueDate,
          e.status,
          e.created_at as enrolledDate,
          NULL as completedDate,
          (SELECT cert.id FROM certificates cert 
           WHERE cert.enrollment_id = e.id 
           ORDER BY cert.issue_date DESC LIMIT 1) as certificateId
        FROM enrollments e
        JOIN courses c ON e.course_id = c.id
        ${whereClause}
        ORDER BY e.created_at ${orderDir}
        LIMIT ${limit} OFFSET ${offset}
      `
    );

    const countResults = await prisma.$queryRaw<{total: bigint}[]>(
      Prisma.sql`
        SELECT COUNT(*) as total
        FROM enrollments e
        JOIN courses c ON e.course_id = c.id
        ${whereClause}
      `
    );
    
    const total = Number(countResults[0]?.total ?? 0);
    const totalPages = Math.ceil(total / limit);

    const enrollments = coursesResults.map((course: any) => {
      let enrollmentStatus = 'Not Started';
      
      if (course.status === 'COMPLETED') {
        enrollmentStatus = 'Completed';
      } else if (course.status === 'IN_PROGRESS' && course.completed > 0) {
        enrollmentStatus = 'In Progress';
      } else if (course.status === 'IN_PROGRESS' && course.completed === 0) {
        enrollmentStatus = 'Not Started';
      }

      return {
        id: course.id,
        courseId: course.courseId,
        courseName: course.courseName,
        description: course.description,
        progress: {
          completed: Math.round(course.completed * course.total / 100) || 0,
          total: Number(course.total) || 0
        },
        dueDate: course.dueDate,
        status: enrollmentStatus,
        enrolledDate: course.enrolledDate,
        completedDate: course.completedDate,
        certificateId: course.certificateId
      };
    });
    
    res.json({
      enrollments,
      total,
      page: Number(page),
      pageSize: limit,
      totalPages
    });
  } catch (error) {
    console.error('Error fetching CSR training courses:', error);
    res.status(500).json({ message: 'Failed to fetch training courses' });
  }
};

/**
 * Get detailed audit information for CSR view
 * This implementation mirrors the QA controller's getSubmissionDetails function
 */
export const getCSRAuditDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.user_id;
    const submissionId = parseInt(req.params.id);
    
    console.log(`\nÃ°Å¸Å¡â‚¬ CSR CONTROLLER: getCSRAuditDetails called for submission ${submissionId} by user ${userId}`);
    
    const verifyRows = await prisma.$queryRaw<{id: number}[]>(
      Prisma.sql`
        SELECT s.id
        FROM submissions s
        JOIN submission_metadata sm ON sm.submission_id = s.id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        WHERE s.id = ${submissionId} AND fmf.field_name = 'CSR' AND sm.value = ${userId.toString()}
      `
    );
    
    if (verifyRows.length === 0) {
      res.status(404).json({ message: 'Audit not found or you do not have permission to view it' });
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
            f.user_version,
            f.user_version_date,
            f.interaction_type,
            reviewer.username   AS reviewer_name,
            (
              SELECT u.username
              FROM submission_metadata sm
              JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
              JOIN users u ON CAST(sm.value AS UNSIGNED) = u.id
              WHERE sm.submission_id = s.id AND fmf.field_name = 'CSR'
              LIMIT 1
            ) AS csr_name
          FROM 
            submissions s
            JOIN forms f ON s.form_id = f.id
            LEFT JOIN users reviewer ON reviewer.id = s.submitted_by
          WHERE 
            s.id = ${submissionId}
        `
      );
      
      if (submissionRows.length === 0) {
        res.status(404).json({ message: 'Submission not found' });
        return;
      }
      
      const submission = submissionRows[0];
      
      const metadataRows = await prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT 
            fmf.field_name,
            fmf.field_type,
            fmf.sort_order,
            sm.value
          FROM 
            submission_metadata sm
            JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          WHERE 
            sm.submission_id = ${submissionId}
          ORDER BY fmf.sort_order ASC
        `
      );
      
      const callsRows = await prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT 
            c.call_id,
            c.customer_id,
            c.call_date,
            c.duration,
            c.recording_url,
            c.transcript
          FROM 
            submission_calls sc
            JOIN calls c ON sc.call_id = c.id
          WHERE 
            sc.submission_id = ${submissionId}
          ORDER BY 
            sc.sort_order ASC
        `
      );
      
      const answersRows = await prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT 
            sa.question_id,
            fq.question_text,
            sa.answer,
            sa.notes,
            fq.question_type,
            CASE 
              WHEN fq.question_type = 'YES_NO' AND sa.answer = 'YES' THEN fq.yes_value
              WHEN fq.question_type = 'YES_NO' AND sa.answer = 'NO' THEN fq.no_value
              WHEN fq.question_type = 'SCALE' THEN sa.answer
              ELSE NULL
            END as score
          FROM 
            submission_answers sa
            JOIN form_questions fq ON sa.question_id = fq.id
          WHERE 
            sa.submission_id = ${submissionId}
        `
      );
      
      const disputeRows = await prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT 
            d.id,
            d.reason,
            d.status,
            d.resolution_notes,
            d.attachment_url,
            d.resolved_by,
            d.created_at,
            d.resolved_at,
            dsh_adj.score  AS new_score,
            dsh_prev.score AS previous_score
          FROM 
            disputes d
            LEFT JOIN dispute_score_history dsh_adj  ON dsh_adj.dispute_id  = d.id AND dsh_adj.score_type  = 'ADJUSTED'
            LEFT JOIN dispute_score_history dsh_prev ON dsh_prev.dispute_id = d.id AND dsh_prev.score_type = 'PREVIOUS'
          WHERE 
            d.submission_id = ${submissionId}
          ORDER BY dsh_adj.created_at DESC
          LIMIT 1
        `
      );
      
      const disputableCheck = await prisma.$queryRaw<{is_disputable: number}[]>(
        Prisma.sql`
          SELECT 
            CASE WHEN d.id IS NULL AND s.status = 'FINALIZED' 
                 AND s.submitted_at > DATE_SUB(NOW(), INTERVAL 7 DAY) 
                 THEN 1 ELSE 0 END as is_disputable
          FROM submissions s
          LEFT JOIN disputes d ON s.id = d.submission_id
          WHERE s.id = ${submissionId}
        `
      );
      
      console.log(`\n=== CSR CONTROLLER DEBUG FOR SUBMISSION ${submissionId} ===`);
      console.log(`[CSR CONTROLLER] Dispute rows found:`, disputeRows.length);
      console.log(`[CSR CONTROLLER] Dispute data:`, JSON.stringify(disputeRows, null, 2));
      console.log(`[CSR CONTROLLER] Disputable check:`, JSON.stringify(disputableCheck, null, 2));
      console.log(`=== END CSR CONTROLLER DEBUG ===\n`);
      
      const qaResults = await prisma.$queryRaw<{username: string}[]>(
        Prisma.sql`SELECT username FROM users WHERE id = ${submission.submitted_by}`
      );
      
      const qaAnalystName = qaResults.length > 0 ? qaResults[0].username : null;
      
      let response: any = {
        id: submission.id,
        form_id: submission.form_id,
        submitted_by: submission.submitted_by,
        submittedDate: submission.submitted_at,
        submitted_at: submission.submitted_at,
        score: parseFloat(submission.total_score),
        status: submission.status,
        reviewer_name: submission.reviewer_name ?? qaAnalystName ?? null,
        csr_name: submission.csr_name ?? null,
        form: {
          id: submission.form_id,
          form_name: submission.form_name,
          version: submission.version,
          user_version: submission.user_version,
          user_version_date: submission.user_version_date,
          interaction_type: submission.interaction_type
        },
        qaAnalystName,
        isDisputable: disputableCheck.length > 0 ? !!disputableCheck[0].is_disputable : false,
        metadata: metadataRows,
        calls: callsRows,
        answers: answersRows,
        dispute: disputeRows.length > 0 ? disputeRows[0] : null
      };
      
      console.log(`[CSR CONTROLLER] Response dispute field:`, JSON.stringify(response.dispute, null, 2));
      
      try {
        const categoriesRows = await prisma.$queryRaw<any[]>(
          Prisma.sql`
            SELECT 
              fc.id,
              fc.category_name,
              fc.weight,
              fc.sort_order
            FROM 
              form_categories fc
            WHERE 
              fc.form_id = ${submission.form_id}
            ORDER BY 
              fc.sort_order ASC
          `
        );
        
        if (categoriesRows.length === 0) {
          console.log(`No categories found for form_id: ${submission.form_id}`);
          res.status(200).json(response);
          return;
        }
        
        const questionsRows = await prisma.$queryRaw<any[]>(
          Prisma.sql`
            SELECT 
              fq.id,
              fq.category_id,
              fq.question_text,
              fq.question_type,
              fq.weight,
              fq.is_na_allowed,
              fq.scale_min,
              fq.scale_max,
              fq.yes_value,
              fq.no_value,
              fq.sort_order,
              fq.visible_to_csr
            FROM 
              form_questions fq
              JOIN form_categories fc ON fq.category_id = fc.id
            WHERE 
              fc.form_id = ${submission.form_id}
            ORDER BY 
              fc.sort_order ASC, fq.sort_order ASC
          `
        );
        
        const categoriesWithQuestions = categoriesRows.map(category => {
          const categoryQuestions = questionsRows
            .filter(q => q.category_id === category.id)
            .map(q => ({
              ...q,
              visible_to_csr: q.visible_to_csr === 1 || q.visible_to_csr === true
            }));
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
        console.error('Error fetching form structure:', formError);
      }
      
      res.status(200).json(response);
    } catch (dbError) {
      console.error('Database error in getCSRAuditDetails:', dbError);
      res.status(500).json({ 
        message: 'Database error processing audit details',
        error: String(dbError)
      });
    }
  } catch (error) {
    console.error('Error fetching CSR audit details:', error);
    res.status(500).json({ message: 'Failed to fetch audit details' });
  }
};

/**
 * Get training summary statistics for CSR training dashboard
 */
export const getTrainingSummary = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;

    const summaryResults = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          COUNT(*) as assignedCourses,
          COUNT(CASE WHEN ce.status = 'COMPLETED' THEN 1 END) as completedCourses,
          COUNT(CASE WHEN ce.status != 'COMPLETED' AND ce.created_at < DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as overdueCourses
        FROM enrollments ce
        WHERE ce.user_id = ${userId}
      `
    );

    const summary = summaryResults[0] || {};
    
    res.json({
      assignedCourses: Number(summary.assignedCourses ?? 0),
      completedCourses: Number(summary.completedCourses ?? 0),
      overdueCourses: Number(summary.overdueCourses ?? 0)
    });
  } catch (error) {
    console.error('Error fetching training summary:', error);
    res.status(500).json({ message: 'Failed to fetch training summary' });
  }
};

/**
 * Submit quiz answers for CSR
 */
export const submitQuizAnswers = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const quizId = parseInt(req.params.quizId);
    const { answers } = req.body;

    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({ message: 'Invalid answers format' });
    }

    const quizCheck = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT q.*, c.id as course_id, ce.id as enrollment_id
        FROM quizzes q
        JOIN courses c ON q.course_id = c.id
        JOIN enrollments ce ON ce.course_id = c.id
        WHERE q.id = ${quizId} AND ce.user_id = ${userId}
      `
    );

    if (quizCheck.length === 0) {
      return res.status(404).json({ message: 'Quiz not found or access denied' });
    }

    const quiz = quizCheck[0];

    const questions = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT id, correct_option FROM quiz_questions WHERE quiz_id = ${quizId} ORDER BY id`
    );

    if (questions.length !== answers.length) {
      return res.status(400).json({ message: 'Number of answers does not match number of questions' });
    }

    let correctAnswers = 0;
    const correctAnswerArray: number[] = [];
    
    questions.forEach((question, index) => {
      correctAnswerArray.push(question.correct_option);
      if (answers[index] === question.correct_option) {
        correctAnswers++;
      }
    });

    const score = Math.round((correctAnswers / questions.length) * 100);
    const passed = score >= quiz.pass_score;

    res.json({
      score,
      passed,
      correctAnswers: correctAnswerArray
    });
  } catch (error) {
    console.error('Error submitting quiz:', error);
    res.status(500).json({ message: 'Failed to submit quiz' });
  }
};

/**
 * Update course progress for CSR
 */
export const updateCourseProgress = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const enrollmentId = parseInt(req.params.enrollmentId);
    const { pageId, completed } = req.body;

    const enrollmentCheck = await prisma.$queryRaw<{id: number, course_id: number, progress: number}[]>(
      Prisma.sql`SELECT id, course_id, progress FROM enrollments WHERE id = ${enrollmentId} AND user_id = ${userId}`
    );

    if (enrollmentCheck.length === 0) {
      return res.status(404).json({ message: 'Enrollment not found or access denied' });
    }

    if (pageId && completed) {
      const likePattern = `%"pageId":${pageId}%`;
      const existingCompletion = await prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT * FROM training_logs 
          WHERE user_id = ${userId} AND course_id = ${enrollmentCheck[0].course_id} AND action = 'PAGE_COMPLETED' 
          AND details LIKE ${likePattern}
        `
      );

      if (existingCompletion.length === 0) {
        await prisma.trainingLog.create({
          data: {
            user_id: userId,
            course_id: enrollmentCheck[0].course_id,
            action: 'PAGE_COMPLETED',
            details: JSON.stringify({ enrollmentId, pageId })
          }
        });

        const pageStats = await prisma.$queryRaw<{total_pages: bigint, completed_pages: bigint}[]>(
          Prisma.sql`
            SELECT 
              (SELECT COUNT(*) FROM course_pages WHERE course_id = ${enrollmentCheck[0].course_id}) as total_pages,
              (SELECT COUNT(*) FROM training_logs 
               WHERE user_id = ${userId} AND course_id = ${enrollmentCheck[0].course_id} AND action = 'PAGE_COMPLETED') as completed_pages
          `
        );

        const totalPages = Number(pageStats[0]?.total_pages ?? 1);
        const completedPages = Number(pageStats[0]?.completed_pages ?? 0);
        
        const newProgress = Math.min(1.00, completedPages / totalPages);

        await prisma.enrollment.update({
          where: { id: enrollmentId },
          data: { progress: newProgress, status: 'IN_PROGRESS' }
        });

        res.json({ 
          message: 'Progress updated successfully',
          progress: newProgress,
          completedPages,
          totalPages
        });
      } else {
        res.json({ message: 'Page already completed' });
      }
    } else {
      res.json({ message: 'No update needed' });
    }
  } catch (error) {
    console.error('Error updating course progress:', error);
    res.status(500).json({ message: 'Failed to update course progress' });
  }
};

/**
 * Complete course for CSR
 */
export const completeCourse = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const enrollmentId = parseInt(req.params.enrollmentId);

    const enrollmentCheck = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT ce.*, c.course_name 
        FROM enrollments ce
        JOIN courses c ON ce.course_id = c.id
        WHERE ce.id = ${enrollmentId} AND ce.user_id = ${userId}
      `
    );

    if (enrollmentCheck.length === 0) {
      return res.status(404).json({ message: 'Enrollment not found or access denied' });
    }

    const enrollment = enrollmentCheck[0];

    if (enrollment.status === 'COMPLETED') {
      return res.status(400).json({ 
        message: 'Course is already completed' 
      });
    }

    await prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { status: 'COMPLETED', progress: 1.00 }
    });

    const newCert = await prisma.certificate.create({
      data: {
        user_id: userId,
        course_id: enrollment.course_id,
        enrollment_id: enrollmentId
      }
    });

    res.json({
      id: newCert.id,
      courseId: enrollment.course_id,
      courseName: enrollment.course_name,
      issuedDate: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error completing course:', error);
    res.status(500).json({ message: 'Failed to complete course' });
  }
};

/**
 * Get certificate for CSR
 */
export const getCertificate = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const certificateId = parseInt(req.params.certificateId);

    const certificateResults = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          cert.id,
          cert.user_id as userId,
          cert.course_id as courseId,
          cert.enrollment_id as enrollmentId,
          c.course_name as courseName,
          cert.issue_date as issuedDate,
          cert.expiry_date as expiryDate
        FROM certificates cert
        JOIN courses c ON cert.course_id = c.id
        WHERE cert.id = ${certificateId} AND cert.user_id = ${userId}
      `
    );

    if (certificateResults.length === 0) {
      return res.status(404).json({ message: 'Certificate not found or access denied' });
    }

    const certificate = certificateResults[0];
    
    res.json({
      id: certificate.id,
      userId: certificate.userId,
      courseId: certificate.courseId,
      enrollmentId: certificate.enrollmentId,
      courseName: certificate.courseName,
      issuedDate: certificate.issuedDate,
      expiryDate: certificate.expiryDate
    });
  } catch (error) {
    console.error('Error fetching certificate:', error);
    res.status(500).json({ message: 'Failed to fetch certificate' });
  }
};

/**
 * Get course content with enrollment data for CSR
 */
export const getCourseContentForCSR = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    
    let courseId: number;
    let enrollmentId: number;
    
    if (req.params.courseId) {
      courseId = parseInt(req.params.courseId);
      
      const enrollmentResults = await prisma.$queryRaw<{id: number}[]>(
        Prisma.sql`
          SELECT id FROM enrollments 
          WHERE course_id = ${courseId} AND user_id = ${userId} 
          ORDER BY 
            CASE WHEN status = 'IN_PROGRESS' THEN 0 ELSE 1 END,
            created_at DESC
          LIMIT 1
        `
      );
      
      if (enrollmentResults.length === 0) {
        return res.status(404).json({ message: 'Course not found or not enrolled' });
      }
      
      enrollmentId = enrollmentResults[0].id;
    } else if (req.params.enrollmentId) {
      enrollmentId = parseInt(req.params.enrollmentId);
      
      const enrollmentResults = await prisma.$queryRaw<{course_id: number}[]>(
        Prisma.sql`SELECT course_id FROM enrollments WHERE id = ${enrollmentId} AND user_id = ${userId}`
      );
      
      if (enrollmentResults.length === 0) {
        return res.status(404).json({ message: 'Enrollment not found or access denied' });
      }
      
      courseId = enrollmentResults[0].course_id;
    } else {
      return res.status(400).json({ message: 'Either courseId or enrollmentId must be provided' });
    }

    const courseResults = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          c.id,
          c.course_name as courseName,
          c.description,
          c.created_by,
          u.username as creatorName,
          ce.id as enrollmentId,
          ce.progress,
          ce.status,
          ce.created_at as enrolledDate
        FROM courses c
        LEFT JOIN users u ON c.created_by = u.id
        JOIN enrollments ce ON ce.course_id = c.id
        WHERE c.id = ${courseId} AND ce.id = ${enrollmentId}
      `
    );

    if (courseResults.length === 0) {
      return res.status(404).json({ message: 'Course not found or not enrolled' });
    }

    const course = courseResults[0];

    const pagesResults = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          cp.id,
          cp.page_title as pageTitle,
          cp.content_type as contentType,
          cp.content_text as contentText,
          cp.content_url as contentUrl,
          cp.page_order as pageOrder
        FROM course_pages cp
        WHERE cp.course_id = ${courseId}
        ORDER BY cp.page_order ASC
      `
    );

    const completedPages = await prisma.$queryRaw<{details: string}[]>(
      Prisma.sql`
        SELECT details FROM training_logs 
        WHERE user_id = ${userId} AND course_id = ${courseId} AND action = 'PAGE_COMPLETED'
      `
    );

    const completedPageIds = new Set();
    completedPages.forEach(log => {
      try {
        const details = JSON.parse(log.details);
        if (details.pageId) {
          completedPageIds.add(details.pageId);
        }
      } catch (e) {
        // Ignore invalid JSON
      }
    });

    const quizResults = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          q.id,
          q.quiz_title as quizTitle,
          q.pass_score as passScore
        FROM quizzes q
        WHERE q.course_id = ${courseId}
      `
    );

    let quiz = null;
    if (quizResults.length > 0) {
      const quizData = quizResults[0];
      
      const questionsResults = await prisma.$queryRaw<any[]>(
        Prisma.sql`
          SELECT 
            qq.id,
            qq.question_text as questionText,
            qq.option_a,
            qq.option_b,
            qq.option_c,
            qq.option_d,
            qq.correct_answer as correctAnswer
          FROM quiz_questions qq
          WHERE qq.quiz_id = ${quizData.id}
          ORDER BY qq.id ASC
        `
      );

      const questions = questionsResults.map(q => ({
        id: q.id,
        questionText: q.question_text,
        options: [q.option_a, q.option_b, q.option_c, q.option_d].filter(Boolean),
        correctAnswer: q.correctAnswer
      }));

      quiz = {
        id: quizData.id,
        quizTitle: quizData.quizTitle,
        passScore: quizData.passScore,
        questions,
        userAttempts: []
      };
    }

    const courseContent = {
      id: course.id,
      courseName: course.courseName,
      description: course.description,
      createdBy: course.created_by,
      creatorName: course.creatorName,
      enrollment: {
        id: course.enrollmentId,
        progress: course.progress || 0,
        status: course.status,
        enrolledDate: course.enrolledDate
      },
      pages: pagesResults.map(page => ({
        id: page.id,
        pageTitle: page.pageTitle,
        contentType: page.contentType,
        contentText: page.contentText,
        contentUrl: page.contentUrl,
        pageOrder: page.pageOrder,
        isCompleted: completedPageIds.has(page.id)
      })),
      quiz
    };

    res.json(courseContent);
  } catch (error) {
    console.error('Error fetching course content for CSR:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * Update last viewed page position for CSR
 */
export const updateLastViewedPosition = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const enrollmentId = parseInt(req.params.enrollmentId);
    const { pageId, pageIndex } = req.body;

    const enrollmentCheck = await prisma.$queryRaw<{id: number, course_id: number}[]>(
      Prisma.sql`SELECT id, course_id FROM enrollments WHERE id = ${enrollmentId} AND user_id = ${userId}`
    );

    if (enrollmentCheck.length === 0) {
      return res.status(404).json({ message: 'Enrollment not found or access denied' });
    }

    await prisma.trainingLog.deleteMany({
      where: {
        user_id: userId,
        course_id: enrollmentCheck[0].course_id,
        action: 'LAST_POSITION'
      }
    });

    await prisma.trainingLog.create({
      data: {
        user_id: userId,
        course_id: enrollmentCheck[0].course_id,
        action: 'LAST_POSITION',
        details: JSON.stringify({ enrollmentId, pageId, pageIndex, timestamp: new Date().toISOString() })
      }
    });

    res.json({ message: 'Last position updated successfully' });
  } catch (error) {
    console.error('Error updating last viewed position:', error);
    res.status(500).json({ message: 'Failed to update last position' });
  }
};

/**
 * Get last viewed page position for CSR
 */
export const getLastViewedPosition = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const enrollmentId = parseInt(req.params.enrollmentId);

    const enrollmentCheck = await prisma.$queryRaw<{id: number, course_id: number}[]>(
      Prisma.sql`SELECT id, course_id FROM enrollments WHERE id = ${enrollmentId} AND user_id = ${userId}`
    );

    if (enrollmentCheck.length === 0) {
      return res.status(404).json({ message: 'Enrollment not found or access denied' });
    }

    const positionResults = await prisma.$queryRaw<{details: string}[]>(
      Prisma.sql`
        SELECT details FROM training_logs 
        WHERE user_id = ${userId} AND course_id = ${enrollmentCheck[0].course_id} AND action = 'LAST_POSITION'
        ORDER BY created_at DESC LIMIT 1
      `
    );

    if (positionResults.length === 0) {
      return res.json({ pageIndex: 0, pageId: null });
    }

    try {
      const details = JSON.parse(positionResults[0].details);
      res.json({
        pageIndex: details.pageIndex || 0,
        pageId: details.pageId || null,
        timestamp: details.timestamp
      });
    } catch (parseError) {
      console.error('Error parsing last position details:', parseError);
      res.json({ pageIndex: 0, pageId: null });
    }
  } catch (error) {
    console.error('Error getting last viewed position:', error);
    res.status(500).json({ message: 'Failed to get last position' });
  }
};

/**
 * Get all certificates for CSR
 */
export const getCertificates = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const { 
      page = 1, 
      limit = 10,
      status,
      search,
      startDate,
      endDate
    } = req.query;
    
    const offset = (Number(page) - 1) * Number(limit);

    const whereCerts: Prisma.Sql[] = [Prisma.sql`cert.user_id = ${userId}`];

    if (status && status !== 'all') {
      if (status === 'Valid') {
        whereCerts.push(Prisma.sql`(cert.expiry_date IS NULL OR cert.expiry_date > NOW())`);
      } else if (status === 'Expired') {
        whereCerts.push(Prisma.sql`(cert.expiry_date IS NOT NULL AND cert.expiry_date <= NOW())`);
      }
    }

    if (search && typeof search === 'string' && search.trim()) {
      const searchParam = `%${search.trim()}%`;
      whereCerts.push(Prisma.sql`(c.course_name LIKE ${searchParam} OR CONCAT('CERT-', cert.id) LIKE ${searchParam})`);
    }

    if (startDate && typeof startDate === 'string') {
      whereCerts.push(Prisma.sql`DATE(cert.issue_date) >= ${startDate}`);
    }

    if (endDate && typeof endDate === 'string') {
      whereCerts.push(Prisma.sql`DATE(cert.issue_date) <= ${endDate}`);
    }

    const whereCertClause = Prisma.sql`WHERE ${Prisma.join(whereCerts, ' AND ')}`;

    const certificatesResults = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          cert.id,
          cert.user_id as userId,
          cert.course_id as courseId,
          cert.enrollment_id as enrollmentId,
          c.course_name as courseName,
          cert.issue_date as issuedDate,
          cert.expiry_date as expiryDate,
          CASE 
            WHEN cert.expiry_date IS NULL OR cert.expiry_date > NOW() 
            THEN 'Valid' 
            ELSE 'Expired' 
          END as status
        FROM certificates cert
        JOIN courses c ON cert.course_id = c.id
        ${whereCertClause}
        ORDER BY cert.issue_date DESC
        LIMIT ${Number(limit)} OFFSET ${offset}
      `
    );

    const countResults = await prisma.$queryRaw<{total: bigint}[]>(
      Prisma.sql`
        SELECT COUNT(*) as total 
        FROM certificates cert 
        JOIN courses c ON cert.course_id = c.id
        ${whereCertClause}
      `
    );

    const total = Number(countResults[0]?.total ?? 0);
    const totalPages = Math.ceil(total / Number(limit));

    res.json({
      certificates: certificatesResults,
      total,
      page: Number(page),
      pageSize: Number(limit),
      totalPages
    });
  } catch (error) {
    console.error('Error fetching certificates:', error);
    res.status(500).json({ message: 'Failed to fetch certificates' });
  }
};

/**
 * Finalize a submission (CSR Accept Review)
 * @route PUT /api/csr/audits/:id/finalize
 */
export const finalizeSubmission = async (req: Request, res: Response): Promise<void> => {
  try {
    if (req.user?.role !== 'CSR') {
      res.status(403).json({ message: 'Access denied. CSR role required' });
      return;
    }
    
    const submissionId = parseInt(req.params.id);
    const userId = req.user?.user_id;
    
    if (!submissionId || isNaN(submissionId)) {
      res.status(400).json({ message: 'Valid submission ID is required' });
      return;
    }
    
    const verifyRows = await prisma.$queryRaw<{id: number, status: string}[]>(
      Prisma.sql`
        SELECT s.id, s.status
        FROM submissions s
        JOIN submission_metadata sm ON sm.submission_id = s.id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        WHERE s.id = ${submissionId} AND fmf.field_name = 'CSR' AND sm.value = ${userId!.toString()}
      `
    );
    
    if (verifyRows.length === 0) {
      res.status(404).json({ message: 'Submission not found or you do not have permission to finalize it' });
      return;
    }
    
    const submission = verifyRows[0];
    
    if (submission.status === 'FINALIZED') {
      res.status(400).json({ message: 'Submission is already finalized' });
      return;
    }
    
    if (submission.status === 'DISPUTED') {
      res.status(400).json({ message: 'Cannot finalize a disputed submission' });
      return;
    }
    
    if (submission.status !== 'SUBMITTED') {
      res.status(400).json({ message: 'Only submitted audits can be finalized' });
      return;
    }
    
    await prisma.submission.update({
      where: { id: submissionId },
      data: { status: 'FINALIZED' }
    });
    
    await prisma.auditLog.create({
      data: {
        user_id: userId!,
        action: 'FINALIZED_SUBMISSION',
        target_id: submissionId,
        target_type: 'SUBMISSION',
        details: JSON.stringify({ 
          submission_id: submissionId,
          previous_status: submission.status,
          new_status: 'FINALIZED',
          action_type: 'CSR_ACCEPTED'
        })
      }
    });
    
    res.status(200).json({ 
      message: 'Audit accepted and finalized successfully',
      submission_id: submissionId,
      status: 'FINALIZED'
    });
  } catch (error) {
    console.error('Error finalizing submission:', error);
    res.status(500).json({ message: 'Failed to finalize submission' });
  }
};

/**
 * Get coaching sessions for CSR
 */
export const getCSRCoachingSessions = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const { page = 1, pageSize = 10, status, coaching_purpose, coaching_format, startDate, endDate, search } = req.query;
    
    const pageNum = Number(page);
    const pageSizeNum = Number(pageSize);
    
    if (isNaN(pageNum) || pageNum < 1 || pageNum > 10000) {
      return res.status(400).json({ 
        error: 'INVALID_PAGE',
        message: 'Page must be a number between 1 and 10000' 
      });
    }
    
    if (isNaN(pageSizeNum) || pageSizeNum < 1 || pageSizeNum > 100) {
      return res.status(400).json({ 
        error: 'INVALID_PAGE_SIZE',
        message: 'Page size must be a number between 1 and 100' 
      });
    }
    
    if (search && typeof search === 'string' && search.length > 100) {
      return res.status(400).json({ 
        error: 'SEARCH_TOO_LONG',
        message: 'Search term cannot exceed 100 characters' 
      });
    }
    
    if (startDate && typeof startDate === 'string') {
      const startDateObj = new Date(startDate);
      if (isNaN(startDateObj.getTime())) {
        return res.status(400).json({ 
          error: 'INVALID_START_DATE',
          message: 'Start date must be in valid format (YYYY-MM-DD)' 
        });
      }
    }
    
    if (endDate && typeof endDate === 'string') {
      const endDateObj = new Date(endDate);
      if (isNaN(endDateObj.getTime())) {
        return res.status(400).json({ 
          error: 'INVALID_END_DATE',
          message: 'End date must be in valid format (YYYY-MM-DD)' 
        });
      }
    }
    
    if (status && typeof status === 'string' && !['SCHEDULED', 'COMPLETED'].includes(status)) {
      return res.status(400).json({ 
        error: 'INVALID_STATUS',
        message: 'Status must be either SCHEDULED or COMPLETED' 
      });
    }
    
    const validPurposes = ['WEEKLY', 'PERFORMANCE', 'ONBOARDING'];
    if (coaching_purpose && typeof coaching_purpose === 'string' && !validPurposes.includes(coaching_purpose)) {
      return res.status(400).json({ error: 'INVALID_COACHING_PURPOSE', message: 'Invalid coaching purpose provided' });
    }
    const validFormats = ['ONE_ON_ONE', 'SIDE_BY_SIDE', 'TEAM_SESSION'];
    if (coaching_format && typeof coaching_format === 'string' && !validFormats.includes(coaching_format)) {
      return res.status(400).json({ error: 'INVALID_COACHING_FORMAT', message: 'Invalid coaching format provided' });
    }
    
    const offset = (pageNum - 1) * pageSizeNum;
    const limit = pageSizeNum;

    // CSR sees SCHEDULED sessions as "Upcoming" — coach delivers after the meeting
    const conditions: Prisma.Sql[] = [
      Prisma.sql`cs.csr_id = ${userId}`,
    ];

    if (status && status !== 'all') {
      conditions.push(Prisma.sql`cs.status = ${status}`);
    }

    if (coaching_purpose && coaching_purpose !== 'all') {
      conditions.push(Prisma.sql`cs.coaching_purpose = ${coaching_purpose}`);
    }
    if (coaching_format && coaching_format !== 'all') {
      conditions.push(Prisma.sql`cs.coaching_format = ${coaching_format}`);
    }

    if (startDate) {
      conditions.push(Prisma.sql`DATE(cs.session_date) >= ${startDate}`);
    }

    if (endDate) {
      conditions.push(Prisma.sql`DATE(cs.session_date) <= ${endDate}`);
    }

    if (search && typeof search === 'string' && search.trim() !== '') {
      const sanitizedSearch = search.trim().replace(/[%_]/g, '\\$&');
      const searchTerm = `%${sanitizedSearch}%`;
      conditions.push(
        Prisma.sql`(
          cs.notes LIKE ${searchTerm} 
          OR creator.username LIKE ${searchTerm}
          OR EXISTS (
            SELECT 1 FROM coaching_session_topics cst 
            JOIN topics t ON cst.topic_id = t.id 
            WHERE cst.coaching_session_id = cs.id 
            AND t.topic_name LIKE ${searchTerm}
          )
        )`
      );
    }

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const countResult = await prisma.$queryRaw<{total: bigint}[]>(
      Prisma.sql`
        SELECT COUNT(DISTINCT cs.id) as total
        FROM coaching_sessions cs
        LEFT JOIN users creator ON cs.created_by = creator.id
        LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
        LEFT JOIN topics t ON cst.topic_id = t.id
        ${whereClause}
      `
    );
    const totalCount = Number(countResult[0]?.total ?? 0);
    const totalPages = Math.ceil(totalCount / limit);

    const sessions = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          cs.id,
          cs.session_date,
          cs.coaching_purpose,
          cs.coaching_format,
          cs.notes,
          cs.status,
          cs.attachment_filename,
          cs.attachment_path,
          cs.due_date,
          cs.follow_up_date,
          creator.username as manager_name,
          cs.created_at,
          GROUP_CONCAT(DISTINCT t.topic_name ORDER BY t.topic_name SEPARATOR ', ') as topics,
          GROUP_CONCAT(DISTINCT t.id ORDER BY t.id SEPARATOR ',') as topic_ids,
          (SELECT COUNT(*) FROM coaching_session_quizzes WHERE coaching_session_id = cs.id) as quiz_count,
          (SELECT COUNT(DISTINCT csq2.quiz_id) FROM coaching_session_quizzes csq2
           WHERE csq2.coaching_session_id = cs.id
           AND EXISTS (
             SELECT 1 FROM quiz_attempts qa
             WHERE qa.coaching_session_id = cs.id AND qa.quiz_id = csq2.quiz_id
               AND qa.user_id = ${userId} AND qa.passed = 1
           )) as quiz_passed_count
        FROM coaching_sessions cs
        LEFT JOIN users creator ON cs.created_by = creator.id
        LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
        LEFT JOIN topics t ON cst.topic_id = t.id
        ${whereClause}
        GROUP BY 
          cs.id, cs.session_date, cs.coaching_purpose, cs.coaching_format,
          cs.notes, cs.status, cs.attachment_filename, cs.attachment_path,
          cs.due_date, cs.follow_up_date, creator.username, cs.created_at
        ORDER BY cs.session_date DESC
        LIMIT ${limit} OFFSET ${offset}
      `
    );
    
    const transformedSessions = (sessions || []).map((session: any) => ({
      ...session,
      topics: session.topics ? session.topics.split(', ') : [],
      topic_ids: session.topic_ids ? session.topic_ids.split(',').map((id: string) => parseInt(id)) : [],
      quiz_count: Number(session.quiz_count ?? 0),
      quiz_passed_count: Number(session.quiz_passed_count ?? 0),
    }));
    
    res.json({
      success: true,
      data: {
        sessions: transformedSessions,
        totalCount,
        totalPages,
        currentPage: pageNum,
        pageSize: limit
      }
    });
  } catch (error) {
    console.error('Error fetching CSR coaching sessions:', error);
    
    const errorResponse = {
      success: false,
      error: 'FETCH_SESSIONS_ERROR',
      message: 'Failed to fetch coaching sessions',
      timestamp: new Date().toISOString()
    };
    
    if (process.env.NODE_ENV === 'development') {
      Object.assign(errorResponse, { details: error instanceof Error ? error.message : 'Unknown error' });
    }
    
    res.status(500).json(errorResponse);
  }
};

/**
 * Get coaching session details for CSR
 */
export const getCSRCoachingSessionDetails = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const sessionId = parseInt(req.params.sessionId);

    if (!sessionId || isNaN(sessionId) || sessionId <= 0) {
      return res.status(400).json({ 
        success: false,
        error: 'INVALID_SESSION_ID',
        message: 'Session ID must be a positive number' 
      });
    }
    
    if (!userId) {
      return res.status(401).json({ 
        success: false,
        error: 'UNAUTHORIZED',
        message: 'User not authenticated' 
      });
    }

    const sessionRows = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT cs.id, cs.session_date, cs.coaching_purpose, cs.coaching_format, cs.source_type, cs.status,
          cs.notes, cs.required_action,
          cs.require_action_plan, cs.require_acknowledgment,
          cs.quiz_required, cs.quiz_id,
          cs.kb_resource_id, cs.kb_url,
          cs.csr_action_plan, cs.csr_root_cause, cs.csr_support_needed, cs.csr_acknowledged_at,
          cs.delivered_at, cs.completed_at,
          cs.attachment_filename, cs.attachment_path, cs.attachment_size, cs.attachment_mime_type,
          cs.due_date, cs.follow_up_required, cs.follow_up_date, cs.created_at,
          creator.username as created_by_name,
          GROUP_CONCAT(DISTINCT t.topic_name ORDER BY t.topic_name SEPARATOR ',') as topics,
          GROUP_CONCAT(DISTINCT t.id ORDER BY t.id SEPARATOR ',') as topic_ids
        FROM coaching_sessions cs
        LEFT JOIN users creator ON cs.created_by = creator.id
        LEFT JOIN coaching_session_topics cst ON cs.id = cst.coaching_session_id
        LEFT JOIN topics t ON cst.topic_id = t.id
        WHERE cs.id = ${sessionId} AND cs.csr_id = ${userId}
        GROUP BY cs.id
      `
    );

    if (!sessionRows || sessionRows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'SESSION_NOT_FOUND',
        message: 'Coaching session not found or you do not have permission to view it' 
      });
    }

    const sessionData = sessionRows[0];

    // Load quizzes from junction table (new multi-quiz approach)
    const quizJunctionRows = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT q.id, q.quiz_title, q.pass_score FROM coaching_session_quizzes csq
                 JOIN quizzes q ON csq.quiz_id = q.id
                 WHERE csq.coaching_session_id = ${sessionId}`
    );

    // Load questions for each assigned quiz
    const quizzesWithQuestions = await Promise.all(
      quizJunctionRows.map(async (qr: any) => {
        const questionRows = await prisma.$queryRaw<any[]>(
          Prisma.sql`SELECT id, question_text, options, correct_option FROM quiz_questions WHERE quiz_id = ${qr.id} ORDER BY id`
        );
        return { ...qr, questions: questionRows.map((q: any) => ({ ...q, options: JSON.parse(q.options || '[]') })) };
      })
    );

    // Load all quiz attempts for this session (with quiz_id for multi-quiz support)
    const allAttempts = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT id, quiz_id, attempt_number, score, passed, submitted_at, answers_json
                 FROM quiz_attempts
                 WHERE coaching_session_id = ${sessionId} AND user_id = ${userId}
                 ORDER BY quiz_id, attempt_number`
    );

    // Load KB resources from junction table
    const kbResources = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT r.id, r.title, r.resource_type, r.url, r.file_name, r.description FROM coaching_session_resources csr2
                 JOIN training_resources r ON csr2.resource_id = r.id
                 WHERE csr2.coaching_session_id = ${sessionId}`
    );

    const responseData = {
      ...sessionData,
      topics: sessionData.topics ? sessionData.topics.split(',') : [],
      topic_ids: sessionData.topic_ids ? sessionData.topic_ids.split(',').map((id: string) => parseInt(id)) : [],
      quizzes: quizzesWithQuestions,
      quiz_attempts: allAttempts,
      kb_resources: kbResources,
    };

    res.json({ success: true, data: responseData });
  } catch (error) {
    console.error('Error fetching CSR coaching session details:', error);
    
    const errorResponse = {
      success: false,
      error: 'FETCH_SESSION_DETAILS_ERROR',
      message: 'Failed to fetch coaching session details',
      timestamp: new Date().toISOString()
    };
    
    if (process.env.NODE_ENV === 'development') {
      Object.assign(errorResponse, { details: error instanceof Error ? error.message : 'Unknown error' });
    }
    
    res.status(500).json(errorResponse);
  }
};

/**
 * Download coaching session attachment for CSR
 */
/**
 * Serve a resource file for a CSR — validates the resource is assigned to one of their sessions
 */
export const getCSRResourceFile = async (req: Request, res: Response) => {
  try {
    const userId     = req.user?.user_id;
    const resourceId = parseInt(req.params.resourceId);
    const fs         = require('fs').promises;
    const path       = require('path');

    const rows = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT r.file_path, r.file_mime_type, r.file_name
                 FROM training_resources r
                 WHERE r.id = ${resourceId}
                   AND r.file_path IS NOT NULL
                   AND EXISTS (
                     SELECT 1 FROM coaching_session_resources csr2
                     JOIN coaching_sessions cs ON csr2.coaching_session_id = cs.id
                     WHERE csr2.resource_id = ${resourceId} AND cs.csr_id = ${userId}
                   )`
    );

    if (!rows.length) return res.status(404).json({ success: false, message: 'Resource not found or access denied' });

    const { file_path, file_mime_type, file_name } = rows[0];
    const filePath = path.join(process.cwd(), file_path);

    try { await fs.access(filePath); } catch { return res.status(404).json({ success: false, message: 'File not found on server' }); }

    const stats = await fs.stat(filePath);
    res.setHeader('Content-Type', file_mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `inline; filename="${(file_name || 'file').replace(/"/g, '\\"')}"`);

    const { createReadStream } = require('fs');
    const stream = createReadStream(filePath);
    stream.on('error', () => { if (!res.headersSent) res.status(500).json({ success: false, message: 'Error reading file' }); });
    stream.pipe(res);
  } catch (error) {
    console.error('[CSR] getCSRResourceFile error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const downloadCSRCoachingAttachment = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const sessionId = parseInt(req.params.sessionId);

    if (!sessionId || isNaN(sessionId) || sessionId <= 0) {
      return res.status(400).json({ 
        success: false,
        error: 'INVALID_SESSION_ID',
        message: 'Session ID must be a positive number' 
      });
    }
    
    if (!userId) {
      return res.status(401).json({ 
        success: false,
        error: 'UNAUTHORIZED',
        message: 'User not authenticated' 
      });
    }

    const sessionRows = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          cs.attachment_filename,
          cs.attachment_path,
          cs.attachment_mime_type
        FROM coaching_sessions cs
        WHERE cs.id = ${sessionId} AND cs.csr_id = ${userId} AND cs.attachment_path IS NOT NULL
      `
    );

    if (!sessionRows || sessionRows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'ATTACHMENT_NOT_FOUND',
        message: 'Attachment not found or you do not have permission to access it' 
      });
    }

    const session = sessionRows[0];
    const fs = require('fs').promises;
    const path = require('path');
    
    const sanitizedPath = path.normalize(session.attachment_path).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(process.cwd(), sanitizedPath);
    
    const allowedDir = path.join(process.cwd(), 'uploads');
    if (!filePath.startsWith(allowedDir)) {
      return res.status(403).json({ 
        success: false,
        error: 'ACCESS_DENIED',
        message: 'Access to file denied' 
      });
    }
    
    try {
      const stats = await fs.stat(filePath);
      
      const maxSize = 50 * 1024 * 1024;
      if (stats.size > maxSize) {
        return res.status(413).json({ 
          success: false,
          error: 'FILE_TOO_LARGE',
          message: 'File too large to download' 
        });
      }
      
      const allowedTypes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
        'image/jpeg',
        'image/png',
        'image/gif'
      ];
      
      const mimeType = session.attachment_mime_type || 'application/octet-stream';
      if (!allowedTypes.includes(mimeType)) {
        return res.status(415).json({ 
          success: false,
          error: 'UNSUPPORTED_FILE_TYPE',
          message: 'File type not supported for download' 
        });
      }
      
      res.setHeader('Content-Disposition', `attachment; ${escapeFilename(session.attachment_filename)}`);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', stats.size.toString());
      
      const fileBuffer = await fs.readFile(filePath);
      res.send(fileBuffer);
    } catch (fileError) {
      console.error('File access error:', fileError);
      res.status(404).json({ 
        success: false,
        error: 'FILE_NOT_FOUND',
        message: 'File not found on server' 
      });
    }
  } catch (error) {
    console.error('Error downloading coaching attachment:', error);
    
    const errorResponse = {
      success: false,
      error: 'DOWNLOAD_ATTACHMENT_ERROR',
      message: 'Failed to download attachment',
      timestamp: new Date().toISOString()
    };
    
    if (process.env.NODE_ENV === 'development') {
      Object.assign(errorResponse, { details: error instanceof Error ? error.message : 'Unknown error' });
    }
    
    res.status(500).json(errorResponse);
  }
};

/**
 * CSR submits their response to a delivered coaching session
 */
export const submitCSRResponse = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const sessionId = parseInt(req.params.id);
    const { action_plan, root_cause, support_needed, acknowledged } = req.body;

    if (!sessionId || isNaN(sessionId)) {
      return res.status(400).json({ success: false, message: 'Invalid session ID' });
    }

    const rows = await prisma.$queryRaw<any[]>(
      Prisma.sql`SELECT id, status, require_action_plan, require_acknowledgment, quiz_required FROM coaching_sessions WHERE id = ${sessionId} AND csr_id = ${userId}`
    );

    if (!rows.length) return res.status(404).json({ success: false, message: 'Session not found or access denied' });

    const session = rows[0];
    if (!['IN_PROCESS', 'AWAITING_CSR_ACTION'].includes(session.status)) {
      return res.status(400).json({ success: false, message: 'Session is not awaiting a CSR response' });
    }

    if (session.require_action_plan && (!action_plan || action_plan.length < 50)) {
      return res.status(400).json({ success: false, message: 'Action plan must be at least 50 characters' });
    }

    if (session.require_acknowledgment && acknowledged !== true) {
      return res.status(400).json({ success: false, message: 'Acknowledgment is required' });
    }

    // Save the CSR response (do not touch status yet)
    await prisma.$executeRaw(
      Prisma.sql`UPDATE coaching_sessions SET
        csr_action_plan     = ${action_plan    || null},
        csr_root_cause      = ${root_cause     || null},
        csr_support_needed  = ${support_needed || null},
        csr_acknowledged_at = ${acknowledged === true ? new Date() : null}
        WHERE id = ${sessionId}`
    );

    // Auto-advance: check if ALL CSR requirements are now satisfied
    const advancedTo = await applyAutoAdvance(sessionId, userId);

    res.json({ success: true, message: 'Response submitted', data: { new_status: advancedTo ?? session.status } });
  } catch (error) {
    console.error('[CSR] submitCSRResponse error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
