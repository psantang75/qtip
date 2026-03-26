import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import { Parser } from 'json2csv';
import { serviceLogger, dbLogger } from '../config/logger';
import { qaCacheService } from '../services/QACacheService';
import { qaFeatureFlags, getQAPagination } from '../config/qa.config';

/**
 * Get completed QA submissions
 * @route GET /api/qa/completed
 */
export const getCompletedSubmissions = async (req: Request, res: Response): Promise<void> => {
  const user_id = req.user?.user_id;
  
  try {
    serviceLogger.operation('QA', 'getCompletedSubmissions', user_id);

    const paginationConfig = getQAPagination();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      paginationConfig.maxLimit, 
      Math.max(1, parseInt(req.query.limit as string) || paginationConfig.defaultLimit)
    );
    const offset = (page - 1) * limit;
    
    const form_id = req.query.form_id ? parseInt(req.query.form_id as string) : null;
    const dateStart = req.query.date_start as string;
    const dateEnd = req.query.date_end as string;
    const status = req.query.status as string;
    const search = req.query.search as string;
    
    const sqlConditions: Prisma.Sql[] = [
      Prisma.sql`(s.status = 'FINALIZED' OR s.status = 'DISPUTED' OR s.status = 'SUBMITTED')`
    ];
    
    if (form_id) {
      sqlConditions.push(Prisma.sql`s.form_id = ${form_id}`);
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
      const searchParam = `%${search}%`;
      sqlConditions.push(
        Prisma.sql`(f.form_name LIKE ${searchParam} OR auditor.username LIKE ${searchParam} OR csr.username LIKE ${searchParam} OR c.customer_id LIKE ${searchParam})`
      );
    }
    
    const whereClause = Prisma.sql`WHERE ${Prisma.join(sqlConditions, ' AND ')}`;
    
    const rows = await prisma.$queryRaw<{id: number, form_id: number, form_name: string, auditor_name: string, csr_name: string, submitted_at: Date, total_score: number, status: string}[]>(
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
          LEFT JOIN calls c ON s.call_id = c.id
        ${whereClause}
        ORDER BY s.submitted_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `
    );
    
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
          LEFT JOIN calls c ON s.call_id = c.id
        ${whereClause}
      `
    );
    
    const total = Number(countResult[0]?.total ?? 0);
    const totalPages = Math.ceil(total / limit);
    
    res.status(200).json({
      data: rows,
      pagination: {
        total,
        page,
        limit,
        totalPages
      }
    });
  } catch (error) {
    serviceLogger.error('QA', 'getCompletedSubmissions', error as Error, user_id);
    
    res.status(500).json({ 
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to retrieve completed submissions',
      code: 'QA_SUBMISSIONS_FETCH_ERROR'
    });
  }
};

/**
 * Get submission details
 * @route GET /api/qa/completed/:id
 */
export const getSubmissionDetails = async (req: Request, res: Response): Promise<void> => {
  const user_id = req.user?.user_id;
  const submission_id = parseInt(req.params.id);
  const includeFullForm = req.query.includeFullForm === 'true';
  
  try {
    serviceLogger.operation('QA', 'getSubmissionDetails', user_id, { 
      submission_id, 
      includeFullForm 
    });
    
    if (isNaN(submission_id)) {
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
            s.id = ${submission_id} AND (s.status = 'FINALIZED' OR s.status = 'DISPUTED' OR s.status = 'SUBMITTED')
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
      serviceLogger.operation('QA', 'getSubmissionDetails', user_id, { 
        submission_id, 
        form_id: submission.form_id,
        status: 'submission_found'
      });
      
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
            sm.submission_id = ${submission_id}
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
            sc.submission_id = ${submission_id}
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
            sa.notes
          FROM 
            submission_answers sa
            JOIN form_questions fq ON sa.question_id = fq.id
          WHERE 
            sa.submission_id = ${submission_id}
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
            d.submission_id = ${submission_id}
          ORDER BY dsh_adj.created_at DESC
          LIMIT 1
        `
      );
      
      let scoreBreakdown = null;
      try {
        const { getScoreBreakdown } = await import('../utils/scoringUtil');
        const breakdown = await getScoreBreakdown(null, submission_id);
        scoreBreakdown = breakdown;
      } catch (error) {
        console.error('Error getting score breakdown:', error);
      }

      let response: any = {
        id: submission.id,
        form_id: submission.form_id,
        status: submission.status,
        total_score: submission.total_score,
        submitted_at: submission.submitted_at,
        reviewer_name: submission.reviewer_name ?? null,
        csr_name: submission.csr_name ?? null,
        form: {
          id: submission.form_id,
          form_name: submission.form_name,
          version: submission.version,
          user_version: submission.user_version,
          user_version_date: submission.user_version_date,
          interaction_type: submission.interaction_type
        },
        metadata: metadataRows,
        calls: callsRows,
        answers: answersRows,
        dispute: disputeRows.length > 0 ? disputeRows[0] : null,
        scoreBreakdown: scoreBreakdown
      };
      
      if (includeFullForm) {
        try {
          serviceLogger.operation('QA', 'getSubmissionDetails', user_id, { 
            submission_id, 
            form_id: submission.form_id,
            status: 'fetching_form_structure'
          });
          
          const categoriesRows = await prisma.$queryRaw<any[]>(
            Prisma.sql`
              SELECT 
                fc.id,
                fc.name,
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
            serviceLogger.operation('QA', 'getSubmissionDetails', user_id, { 
              submission_id, 
              form_id: submission.form_id,
              status: 'no_categories_found'
            });
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
                fq.na_value,
                fq.sort_order
              FROM 
                form_questions fq
                JOIN form_categories fc ON fq.category_id = fc.id
              WHERE 
                fc.form_id = ${submission.form_id}
              ORDER BY 
                fc.sort_order ASC, fq.sort_order ASC
            `
          );
          
          serviceLogger.operation('QA', 'getSubmissionDetails', user_id, { 
            submission_id, 
            form_id: submission.form_id,
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
          serviceLogger.error('QA', 'getSubmissionDetails', formError as Error, user_id, { 
            submission_id, 
            form_id: submission.form_id,
            context: 'form_structure_fetch_error'
          });
        }
      }
      
      res.status(200).json(response);
    } catch (dbError) {
      dbLogger.error(dbError as Error, undefined, undefined, user_id);
      res.status(500).json({ 
        error: 'DATABASE_ERROR',
        message: 'Database error processing submission details',
        code: 'QA_SUBMISSION_DB_ERROR'
      });
    }
  } catch (error) {
    serviceLogger.error('QA', 'getSubmissionDetails', error as Error, user_id, { submission_id });
    res.status(500).json({ 
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to retrieve submission details',
      code: 'QA_SUBMISSION_FETCH_ERROR'
    });
  }
};

/**
 * Export submission as CSV
 * @route GET /api/qa/completed/:id/export
 */
export const exportSubmission = async (req: Request, res: Response): Promise<void> => {
  const user_id = req.user?.user_id;
  const submission_id = parseInt(req.params.id);
  
  try {
    serviceLogger.operation('QA', 'exportSubmission', user_id, { submission_id });
    
    if (isNaN(submission_id)) {
      res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'Invalid submission ID',
        code: 'INVALID_SUBMISSION_ID'
      });
      return;
    }
    
    const submissionRows = await prisma.$queryRaw<{id: number}[]>(
      Prisma.sql`
        SELECT id FROM submissions WHERE id = ${submission_id} AND (status = 'FINALIZED' OR status = 'DISPUTED' OR status = 'SUBMITTED')
      `
    );
    
    if (submissionRows.length === 0) {
      res.status(404).json({ 
        error: 'NOT_FOUND',
        message: 'Submission not found or not a finalized/disputed/submitted submission',
        code: 'SUBMISSION_NOT_FOUND'
      });
      return;
    }
    
    const rows = await prisma.$queryRaw<any[]>(
      Prisma.sql`
        SELECT 
          s.id AS submission_id,
          f.form_name,
          f.interaction_type,
          f.version AS form_version,
          auditor.username AS auditor_name,
          s.submitted_at,
          s.total_score,
          s.status,
          c.call_id,
          c.customer_id,
          c.call_date,
          csr.username AS csr_name,
          fq.question_text,
          sa.answer,
          sa.notes
        FROM 
          submissions s
          JOIN forms f ON s.form_id = f.id
          JOIN users auditor ON s.submitted_by = auditor.id
          LEFT JOIN submission_calls sc ON s.id = sc.submission_id
          LEFT JOIN calls c ON sc.call_id = c.id
          LEFT JOIN users csr ON c.csr_id = csr.id
          JOIN submission_answers sa ON s.id = sa.submission_id
          JOIN form_questions fq ON sa.question_id = fq.id
        WHERE 
          s.id = ${submission_id}
      `
    );
    
    if (rows.length === 0) {
      res.status(404).json({ 
        error: 'NOT_FOUND',
        message: 'No answers found for this submission',
        code: 'NO_ANSWERS_FOUND'
      });
      return;
    }
    
    const fields = [
      'submission_id', 'form_name', 'interaction_type', 'form_version',
      'auditor_name', 'submitted_at', 'total_score', 'status',
      'call_id', 'customer_id', 'call_date', 'csr_name',
      'question_text', 'answer', 'notes'
    ];
    
    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(rows);
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="submission-${submission_id}.csv"`);
    res.status(200).send(csv);
    
    serviceLogger.operation('QA', 'exportSubmission', user_id, { 
      submission_id, 
      status: 'success',
      recordCount: rows.length
    });
  } catch (error) {
    serviceLogger.error('QA', 'exportSubmission', error as Error, user_id, { submission_id });
    res.status(500).json({ 
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to export submission',
      code: 'QA_EXPORT_ERROR'
    });
  }
};

/**
 * Finalize a submission
 * @route PUT /api/qa/submissions/:id/finalize
 */
export const finalizeSubmission = async (req: Request, res: Response): Promise<void> => {
  const user_id = req.user?.user_id;
  const submission_id = parseInt(req.params.id);
  
  try {
    serviceLogger.operation('QA', 'finalizeSubmission', user_id, { submission_id });
    
    if (!submission_id || isNaN(submission_id)) {
      res.status(400).json({ 
        error: 'BAD_REQUEST',
        message: 'Valid submission ID is required',
        code: 'INVALID_SUBMISSION_ID'
      });
      return;
    }
    
    const submissionRows = await prisma.$queryRaw<{id: number, status: string}[]>(
      Prisma.sql`SELECT id, status FROM submissions WHERE id = ${submission_id} AND status IN ('SUBMITTED', 'DRAFT')`
    );
    
    if (submissionRows.length === 0) {
      res.status(404).json({ 
        error: 'NOT_FOUND',
        message: 'Submission not found or cannot be finalized',
        code: 'SUBMISSION_NOT_FOUND'
      });
      return;
    }
    
    const submission = submissionRows[0];
    
    if (submission.status === 'FINALIZED') {
      res.status(400).json({ 
        error: 'BAD_REQUEST',
        message: 'Submission is already finalized',
        code: 'ALREADY_FINALIZED'
      });
      return;
    }
    
    if (submission.status === 'DISPUTED') {
      res.status(400).json({ 
        error: 'BAD_REQUEST',
        message: 'Cannot finalize a disputed submission',
        code: 'DISPUTED_SUBMISSION'
      });
      return;
    }
    
    await prisma.submission.update({
      where: { id: submission_id },
      data: { status: 'FINALIZED' }
    });
    
    await prisma.auditLog.create({
      data: {
        user_id: user_id!,
        action: 'FINALIZED_SUBMISSION',
        target_id: submission_id,
        target_type: 'SUBMISSION',
        details: JSON.stringify({ 
          submission_id: submission_id,
          previous_status: submission.status,
          new_status: 'FINALIZED',
          action_type: 'ADMIN_FINALIZED'
        })
      }
    });
    
    res.status(200).json({ 
      message: 'Submission finalized successfully',
      submission_id: submission_id,
      status: 'FINALIZED'
    });
    
    serviceLogger.operation('QA', 'finalizeSubmission', user_id, { 
      submission_id, 
      status: 'success'
    });
  } catch (error) {
    serviceLogger.error('QA', 'finalizeSubmission', error as Error, user_id, { submission_id });
    res.status(500).json({ 
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to finalize submission',
      code: 'QA_FINALIZE_ERROR'
    });
  }
};

/**
 * Get QA dashboard statistics (filtered to logged in QA user)
 * @route GET /api/qa/stats
 */
export const getQAStats = async (req: Request, res: Response): Promise<void> => {
  const qaUserId = req.user?.user_id;
  
  if (!qaUserId) {
    res.status(401).json({ 
      error: 'UNAUTHORIZED',
      message: 'User ID not found',
      code: 'MISSING_USER_ID'
    });
    return;
  }
  
  try {
    serviceLogger.operation('QA', 'getQAStats', qaUserId);
    
    if (qaFeatureFlags.isCacheEnabled()) {
      const cacheKey = qaCacheService.getStatsKey(qaUserId);
      const cachedStats = qaCacheService.get(cacheKey);
      
      if (cachedStats) {
        serviceLogger.operation('QA', 'getQAStats', qaUserId, { source: 'cache' });
        res.status(200).json(cachedStats);
        return;
      }
    }
    
    const reviewsCompleted = await prisma.$queryRaw<{thisWeek: bigint, thisMonth: bigint}[]>(
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
        AND s.submitted_by = ${qaUserId}
      `
    );

    const disputes = await prisma.$queryRaw<{thisWeek: bigint, thisMonth: bigint}[]>(
      Prisma.sql`
        SELECT 
          COUNT(CASE WHEN d.created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) as thisWeek,
          COUNT(CASE WHEN d.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 END) as thisMonth
        FROM disputes d
        JOIN submissions s ON d.submission_id = s.id
        WHERE s.submitted_by = ${qaUserId}
      `
    );

    const stats = {
      reviewsCompleted: {
        thisWeek: Number(reviewsCompleted[0]?.thisWeek ?? 0),
        thisMonth: Number(reviewsCompleted[0]?.thisMonth ?? 0)
      },
      disputes: {
        thisWeek: Number(disputes[0]?.thisWeek ?? 0),
        thisMonth: Number(disputes[0]?.thisMonth ?? 0)
      }
    };

    if (qaFeatureFlags.isCacheEnabled()) {
      const cacheKey = qaCacheService.getStatsKey(qaUserId);
      qaCacheService.set(cacheKey, stats);
    }
    
    serviceLogger.operation('QA', 'getQAStats', qaUserId, { source: 'database' });
    res.status(200).json(stats);
  } catch (error) {
    serviceLogger.error('QA', 'getQAStats', error as Error, qaUserId);
    res.status(500).json({ 
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to fetch QA dashboard statistics',
      code: 'QA_STATS_ERROR'
    });
  }
};

/**
 * Get CSR activity data for QA dashboard (filtered to logged in QA user)
 * @route GET /api/qa/csr-activity
 */
export const getQACSRActivity = async (req: Request, res: Response): Promise<void> => {
  const qaUserId = req.user?.user_id;
  
  try {
    serviceLogger.operation('QA', 'getQACSRActivity', qaUserId);
    
    const activeCSRs = await prisma.$queryRaw<{id: number, name: string, department: string}[]>(
      Prisma.sql`
        SELECT 
          u.id,
          u.username as name,
          COALESCE(d.department_name, 'No Department') as department
        FROM users u
        JOIN roles r ON u.role_id = r.id
        LEFT JOIN departments d ON u.department_id = d.id
        WHERE r.role_name = 'CSR' 
        AND u.is_active = 1
        ORDER BY u.username
      `
    );

    if (activeCSRs.length === 0) {
      res.status(200).json([]);
      return;
    }

    const auditCounts = await prisma.$queryRaw<{csr_id: bigint, total_audits: bigint, week_audits: bigint, month_audits: bigint}[]>(
      Prisma.sql`
        SELECT 
          CAST(sm.value AS UNSIGNED) as csr_id,
          COUNT(s.id) as total_audits,
          COUNT(CASE WHEN s.submitted_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) as week_audits,
          COUNT(CASE WHEN s.submitted_at >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 END) as month_audits
        FROM submissions s
        JOIN submission_metadata sm ON s.id = sm.submission_id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        WHERE s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
        AND fmf.field_name = 'CSR'
        AND s.submitted_by = ${qaUserId}
        GROUP BY sm.value
      `
    );

    const disputeCounts = await prisma.$queryRaw<{csr_id: bigint, total_disputes: bigint, week_disputes: bigint, month_disputes: bigint}[]>(
      Prisma.sql`
        SELECT 
          CAST(sm.value AS UNSIGNED) as csr_id,
          COUNT(d.id) as total_disputes,
          COUNT(CASE WHEN d.created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK) THEN 1 END) as week_disputes,
          COUNT(CASE WHEN d.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 END) as month_disputes
        FROM disputes d
        JOIN submissions s ON d.submission_id = s.id
        JOIN submission_metadata sm ON s.id = sm.submission_id
        JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
        WHERE fmf.field_name = 'CSR'
        AND s.submitted_by = ${qaUserId}
        GROUP BY sm.value
      `
    );

    const auditMap = new Map(auditCounts.map(row => [Number(row.csr_id), {
      total_audits: Number(row.total_audits),
      week_audits: Number(row.week_audits),
      month_audits: Number(row.month_audits)
    }]));
    const disputeMap = new Map(disputeCounts.map(row => [Number(row.csr_id), {
      total_disputes: Number(row.total_disputes),
      week_disputes: Number(row.week_disputes),
      month_disputes: Number(row.month_disputes)
    }]));

    const formattedCSRActivity = activeCSRs
      .map((csr) => {
        const audits = auditMap.get(csr.id) || { total_audits: 0, week_audits: 0, month_audits: 0 };
        const disputes = disputeMap.get(csr.id) || { total_disputes: 0, week_disputes: 0, month_disputes: 0 };
        
        return {
          id: csr.id,
          name: csr.name,
          department: csr.department,
          audits: audits.total_audits,
          disputes: disputes.total_disputes,
          audits_week: audits.week_audits,
          disputes_week: disputes.week_disputes,
          audits_month: audits.month_audits,
          disputes_month: disputes.month_disputes
        };
      })
      .filter(csr => 
        csr.audits > 0 || csr.disputes > 0 || 
        csr.audits_week > 0 || csr.disputes_week > 0 ||
        csr.audits_month > 0 || csr.disputes_month > 0
      );

    res.status(200).json(formattedCSRActivity);
    
    serviceLogger.operation('QA', 'getQACSRActivity', qaUserId, { 
      csrCount: formattedCSRActivity.length,
      status: 'success'
    });
  } catch (error) {
    serviceLogger.error('QA', 'getQACSRActivity', error as Error, qaUserId);
    res.status(500).json({ 
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to fetch QA CSR activity data',
      code: 'QA_CSR_ACTIVITY_ERROR'
    });
  }
};
