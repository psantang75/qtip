import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import cacheService from './CacheService';
import { handleDatabaseError, createNotFoundError, createValidationError } from '../utils/errorHandler';
import { dbPerformanceTracker } from '../middleware/performance';
import logger from '../config/logger';

export interface CSRAudit {
  id: number;
  form_id: number;
  formName: string;
  submittedDate: string;
  score: number;
  status: string;
}

export interface CSRAuditDetail {
  id: number;
  form_id: number;
  submittedDate: string;
  score: number;
  status: string;
  form: {
    id: number;
    form_name: string;
    version: string;
    interaction_type: string;
    categories: any[];
  };
  metadata: Array<{
    field_name: string;
    value: string;
  }>;
  calls: any[];
  answers: any[];
  dispute: any;
}

export interface CSRAuditFilters {
  formName?: string;
  form_id_search?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  searchTerm?: string;
}

export class CSRService {
  /**
   * Get audits for a specific CSR with filtering and pagination
   */
  static async getCSRAudits(
    csrId: number,
    page: number = 1,
    limit: number = 10,
    filters: CSRAuditFilters = {}
  ): Promise<{
    audits: CSRAudit[];
    totalCount: number;
  }> {
    const startTime = Date.now();
    
    try {
      const filtersHash = cacheService.generateFiltersHash(filters);
      const cached = cacheService.getCSRAudits(csrId, page, limit, filtersHash);
      if (cached) {
        logger.debug('CSR audits served from cache', { 
          csrId, 
          page, 
          limit, 
          duration: Date.now() - startTime 
        });
        return cached;
      }

      const offset = (page - 1) * limit;
      
      const sqlConditions: Prisma.Sql[] = [
        Prisma.sql`fmf.field_name = 'CSR'`,
        Prisma.sql`sm.value = ${csrId.toString()}`
      ];
      
      if (filters.formName) {
        sqlConditions.push(Prisma.sql`f.form_name LIKE ${'%' + filters.formName + '%'}`);
      }
      
      if (filters.form_id_search) {
        sqlConditions.push(Prisma.sql`s.form_id = ${parseInt(filters.form_id_search)}`);
      }
      
      if (filters.startDate) {
        sqlConditions.push(Prisma.sql`DATE(s.submitted_at) >= ${filters.startDate}`);
      }
      
      if (filters.endDate) {
        sqlConditions.push(Prisma.sql`DATE(s.submitted_at) <= ${filters.endDate}`);
      }
      
      if (filters.status) {
        sqlConditions.push(Prisma.sql`s.status = ${filters.status}`);
      }
      
      if (filters.searchTerm) {
        sqlConditions.push(
          Prisma.sql`(f.form_name LIKE ${'%' + filters.searchTerm + '%'} OR s.id LIKE ${'%' + filters.searchTerm + '%'})`
        );
      }
      
      const whereClause = Prisma.sql`WHERE ${Prisma.join(sqlConditions, ' AND ')}`;
      
      const [countResult, auditRows] = await Promise.all([
        prisma.$queryRaw<{total: bigint}[]>(
          Prisma.sql`
            SELECT COUNT(*) as total
            FROM submissions s
            JOIN forms f ON s.form_id = f.id
            JOIN submission_metadata sm ON sm.submission_id = s.id
            JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
            ${whereClause}
          `
        ),
        prisma.$queryRaw<any[]>(
          Prisma.sql`
            SELECT 
              s.id,
              s.form_id,
              f.form_name as formName,
              s.submitted_at as submittedDate,
              s.total_score as score,
              s.status
            FROM submissions s
            JOIN forms f ON s.form_id = f.id
            JOIN submission_metadata sm ON sm.submission_id = s.id
            JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
            ${whereClause}
            ORDER BY s.submitted_at DESC
            LIMIT ${limit} OFFSET ${offset}
          `
        )
      ]);
      
      const totalCount = Number(countResult[0]?.total ?? 0);
      
      const result = {
        audits: auditRows.map(audit => ({
          id: audit.id,
          form_id: audit.form_id,
          formName: audit.formName,
          submittedDate: audit.submittedDate,
          score: audit.score || 0,
          status: audit.status
        })),
        totalCount
      };

      cacheService.setCSRAudits(csrId, page, limit, filtersHash, result);

      dbPerformanceTracker.recordQuery(
        'CSR audits query', 
        Date.now() - startTime, 
        true
      );
      
      logger.info('CSR audits retrieved from database', { 
        csrId, 
        page, 
        limit,
        totalCount,
        resultCount: result.audits.length,
        duration: Date.now() - startTime,
        cacheSet: true
      });

      return result;
    } catch (error: any) {
      dbPerformanceTracker.recordQuery(
        'CSR audits query', 
        Date.now() - startTime, 
        false
      );
      
      logger.error('Error fetching CSR audits', { 
        csrId, 
        page, 
        limit,
        filters,
        error: error.message,
        duration: Date.now() - startTime 
      });
      
      throw handleDatabaseError(error, { 
        csrId, 
        page, 
        limit, 
        filters, 
        operation: 'getCSRAudits' 
      });
    }
  }

  /**
   * Get detailed audit information
   */
  static async getAuditDetails(auditId: number, csrId: number): Promise<CSRAuditDetail | null> {
    const startTime = Date.now();
    
    try {
      const auditCheck = await prisma.$queryRaw<{id: number}[]>(
        Prisma.sql`
          SELECT 1 as id FROM submissions s
          JOIN submission_metadata sm ON sm.submission_id = s.id
          JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          WHERE s.id = ${auditId} AND fmf.field_name = 'CSR' AND sm.value = ${csrId.toString()}
        `
      );
      
      if (auditCheck.length === 0) {
        throw createNotFoundError('Audit not found or access denied', { 
          auditId, 
          csrId 
        });
      }
      
      const [auditDetails, metadata, categories, questions, answers, calls, disputes] = await Promise.all([
        prisma.$queryRaw<any[]>(
          Prisma.sql`
            SELECT 
              s.id,
              s.form_id,
              f.form_name,
              f.version,
              f.interaction_type,
              s.submitted_at as submittedDate,
              s.total_score as score,
              s.status
            FROM submissions s
            JOIN forms f ON s.form_id = f.id
            WHERE s.id = ${auditId}
          `
        ),
        prisma.$queryRaw<any[]>(
          Prisma.sql`
            SELECT fmf.field_name, sm.value
            FROM submission_metadata sm
            JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
            WHERE sm.submission_id = ${auditId}
          `
        ),
        prisma.$queryRaw<any[]>(
          Prisma.sql`
            SELECT 
              fc.id,
              fc.category_name as name,
              fc.weight,
              fc.sort_order
            FROM form_categories fc
            JOIN submissions s ON fc.form_id = s.form_id
            WHERE s.id = ${auditId}
            ORDER BY fc.sort_order ASC
          `
        ),
        prisma.$queryRaw<any[]>(
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
            FROM form_questions fq
            JOIN form_categories fc ON fq.category_id = fc.id
            JOIN submissions s ON fc.form_id = s.form_id
            WHERE s.id = ${auditId}
            ORDER BY fc.sort_order ASC, fq.sort_order ASC
          `
        ),
        prisma.$queryRaw<any[]>(
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
            FROM submission_answers sa
            JOIN form_questions fq ON sa.question_id = fq.id
            WHERE sa.submission_id = ${auditId}
            ORDER BY fq.category_id, fq.sort_order
          `
        ),
        prisma.$queryRaw<any[]>(
          Prisma.sql`
            SELECT 
              c.call_id,
              c.customer_id,
              c.call_date,
              c.duration,
              c.recording_url,
              c.transcript
            FROM submission_calls sc
            JOIN calls c ON sc.call_id = c.id
            WHERE sc.submission_id = ${auditId}
            ORDER BY sc.sort_order ASC
          `
        ),
        prisma.$queryRaw<any[]>(
          Prisma.sql`
            SELECT 
              d.id,
              d.reason,
              d.status,
              d.resolution_notes,
              d.attachment_url,
              d.created_at,
              d.resolved_at
            FROM disputes d
            WHERE d.submission_id = ${auditId}
            ORDER BY d.created_at DESC
            LIMIT 1
          `
        )
      ]);
      
      if (auditDetails.length === 0) {
        throw createNotFoundError('Audit details not found', { auditId });
      }
      
      const metadataArray = metadata.map(meta => ({
        field_name: meta.field_name,
        value: meta.value
      }));
      
      const categoriesWithQuestions = categories.map(category => {
        const categoryQuestions = questions.filter(q => q.category_id === category.id);
        return {
          ...category,
          questions: categoryQuestions
        };
      });
      
      const audit = auditDetails[0];
      
      console.log(`\n=== CSR SERVICE DEBUG FOR AUDIT ${auditId} ===`);
      console.log(`[CSR SERVICE] Dispute rows found:`, disputes.length);
      console.log(`[CSR SERVICE] Dispute data:`, JSON.stringify(disputes, null, 2));
      console.log(`=== END CSR SERVICE DEBUG ===\n`);
      
      const result = {
        id: audit.id,
        form_id: audit.form_id,
        submittedDate: audit.submittedDate,
        score: audit.score || 0,
        status: audit.status,
        form: {
          id: audit.form_id,
          form_name: audit.form_name,
          version: audit.version || '1.0',
          interaction_type: audit.interaction_type || 'call',
          categories: categoriesWithQuestions
        },
        metadata: metadataArray,
        calls: calls,
        answers: answers,
        dispute: disputes.length > 0 ? disputes[0] : null
      };

      dbPerformanceTracker.recordQuery(
        'CSR audit details query', 
        Date.now() - startTime, 
        true
      );
      
      logger.debug('CSR audit details retrieved', { 
        auditId, 
        csrId,
        duration: Date.now() - startTime
      });

      return result;
    } catch (error: any) {
      dbPerformanceTracker.recordQuery(
        'CSR audit details query', 
        Date.now() - startTime, 
        false
      );
      
      logger.error('Error fetching audit details', { 
        auditId, 
        csrId,
        error: error.message,
        duration: Date.now() - startTime 
      });
      
      throw handleDatabaseError(error, { 
        auditId, 
        csrId, 
        operation: 'getAuditDetails' 
      });
    }
  }

  /**
   * Check if an audit is disputable
   */
  static async isAuditDisputable(auditId: number, csrId: number): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      const result = await prisma.$queryRaw<{status: string, submitted_at: Date}[]>(
        Prisma.sql`
          SELECT s.status, s.submitted_at
          FROM submissions s
          JOIN submission_metadata sm ON sm.submission_id = s.id
          JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          WHERE s.id = ${auditId} AND fmf.field_name = 'CSR' AND sm.value = ${csrId.toString()}
        `
      );
      
      if (result.length === 0) {
        throw createNotFoundError('Audit not found', { auditId, csrId });
      }
      
      const audit = result[0];
      
      if (audit.status !== 'FINALIZED') {
        return false;
      }
      
      const submittedDate = new Date(audit.submitted_at);
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const isDisputable = submittedDate > sevenDaysAgo;

      dbPerformanceTracker.recordQuery(
        'CSR audit disputable check', 
        Date.now() - startTime, 
        true
      );
      
      logger.debug('CSR audit disputability checked', { 
        auditId, 
        csrId,
        isDisputable,
        duration: Date.now() - startTime
      });

      return isDisputable;
    } catch (error: any) {
      dbPerformanceTracker.recordQuery(
        'CSR audit disputable check', 
        Date.now() - startTime, 
        false
      );
      
      logger.error('Error checking audit disputability', { 
        auditId, 
        csrId,
        error: error.message,
        duration: Date.now() - startTime 
      });
      
      throw handleDatabaseError(error, { 
        auditId, 
        csrId, 
        operation: 'isAuditDisputable' 
      });
    }
  }

  /**
   * Finalize a submission (CSR accepts the audit)
   */
  static async finalizeSubmission(submissionId: number, csrId: number): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      console.log('[CSR SERVICE] Debug finalizeSubmission:', {
        submissionId,
        csrId,
        timestamp: new Date().toISOString()
      });
      
      const metadataDebug = await prisma.$queryRaw<{field_name: string, value: string}[]>(
        Prisma.sql`
          SELECT fmf.field_name, sm.value
          FROM submissions s
          LEFT JOIN submission_metadata sm ON sm.submission_id = s.id
          LEFT JOIN form_metadata_fields fmf ON sm.field_id = fmf.id
          WHERE s.id = ${submissionId}
        `
      );
      
      console.log('[CSR SERVICE] Submission metadata:', metadataDebug);
      
      const submission = await prisma.submission.findFirst({
        where: {
          id: submissionId,
          submission_metadata: {
            some: {
              field: { field_name: 'CSR' },
              value: csrId.toString()
            }
          }
        },
        select: { status: true }
      });
      
      console.log('[CSR SERVICE] Submission query result:', submission ? [submission] : []);
      
      if (!submission) {
        console.log('[CSR SERVICE] No submission found with CSR metadata');
        throw createNotFoundError('Submission not found', { submissionId, csrId });
      }
      
      if (submission.status !== 'SUBMITTED') {
        throw createValidationError('Submission cannot be finalized', { 
          submissionId, 
          currentStatus: submission.status,
          expectedStatus: 'SUBMITTED'
        });
      }
      
      await prisma.submission.update({
        where: { id: submissionId },
        data: { status: 'FINALIZED' }
      });
      
      CSRService.invalidateCaches(csrId);

      dbPerformanceTracker.recordQuery(
        'CSR finalize submission', 
        Date.now() - startTime, 
        true
      );
      
      logger.info('Submission finalized by CSR', { 
        submissionId, 
        csrId,
        duration: Date.now() - startTime
      });
      
      return true;
    } catch (error: any) {
      dbPerformanceTracker.recordQuery(
        'CSR finalize submission', 
        Date.now() - startTime, 
        false
      );
      
      logger.error('Error finalizing submission', { 
        submissionId, 
        csrId,
        error: error.message,
        duration: Date.now() - startTime 
      });
      
      throw handleDatabaseError(error, { 
        submissionId, 
        csrId, 
        operation: 'finalizeSubmission' 
      });
    }
  }

  /**
   * Invalidate caches related to CSR
   */
  private static invalidateCaches(csrId: number): void {
    cacheService.invalidateCSRCache(csrId);
  }
}
