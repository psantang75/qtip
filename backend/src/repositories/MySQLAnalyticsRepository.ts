import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import { IAnalyticsRepository } from '../interfaces/IAnalyticsRepository';
import { ReportFilters, ComprehensiveReportFilters } from '../types/analytics.types';

export class MySQLAnalyticsRepository implements IAnalyticsRepository {

  /**
   * Get filter options for analytics interface
   */
  async getFilterOptions(user_id: number, userRole?: string): Promise<{
    departments: any[];
    forms: any[];
    csrs: any[];
    datePresets: any[];
    categories?: any[];
    questions?: any[];
  }> {
    try {
      if (!userRole) {
        const userRows = await prisma.$queryRaw<{ role_name: string }[]>(
          Prisma.sql`SELECT r.role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ${user_id}`
        );
        userRole = userRows[0]?.role_name;
      }

      const departmentsPromise = userRole === 'Manager'
        ? prisma.$queryRaw<any[]>(Prisma.sql`
            SELECT DISTINCT d.id, d.department_name 
            FROM departments d
            INNER JOIN department_managers dm ON d.id = dm.department_id 
            WHERE dm.manager_id = ${user_id} AND dm.is_active = 1
            ORDER BY d.department_name
          `)
        : prisma.$queryRaw<any[]>(Prisma.sql`
            SELECT id, department_name 
            FROM departments 
            ORDER BY department_name
          `);

      const formsPromise = prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT DISTINCT id, form_name, user_version, user_version_date, is_active, version
        FROM forms 
        ORDER BY form_name, version DESC
      `);

      const csrsPromise = userRole === 'Manager'
        ? prisma.$queryRaw<any[]>(Prisma.sql`
            SELECT u.id, u.username, u.department_id 
            FROM users u
            JOIN roles r ON u.role_id = r.id
            WHERE r.role_name = 'CSR' AND u.is_active = 1
            AND u.department_id IN (
              SELECT DISTINCT dm.department_id 
              FROM department_managers dm 
              WHERE dm.manager_id = ${user_id} AND dm.is_active = 1
            )
            ORDER BY u.username
          `)
        : prisma.$queryRaw<any[]>(Prisma.sql`
            SELECT u.id, u.username, u.department_id 
            FROM users u
            JOIN roles r ON u.role_id = r.id
            WHERE r.role_name = 'CSR' AND u.is_active = 1
            ORDER BY u.username
          `);

      const categoriesPromise = prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT DISTINCT 
          fc.id, 
          fc.category_name as name, 
          fc.form_id,
          COALESCE(SUM(
            CASE 
              WHEN fq.question_type = 'yes_no' AND fq.yes_value > 0 THEN fq.yes_value
              WHEN fq.question_type = 'scale' AND fq.scale_max > 0 THEN fq.scale_max
              WHEN fq.question_type = 'radio' THEN COALESCE((
                SELECT MAX(ro.score) 
                FROM radio_options ro 
                WHERE ro.question_id = fq.id AND ro.score > 0
              ), 0)
              ELSE 0
            END
          ), 0) AS possible_points
        FROM form_categories fc
        INNER JOIN forms f ON fc.form_id = f.id
        LEFT JOIN form_questions fq ON fc.id = fq.category_id
        WHERE fc.weight > 0
          AND fq.question_type != 'SUB_CATEGORY'
          AND fq.question_type != 'TEXT'
          AND NOT (fq.question_type = 'YES_NO' AND fq.yes_value = 0)
          AND NOT (
            fq.question_type = 'RADIO' 
            AND NOT EXISTS (
              SELECT 1 FROM radio_options ro 
              WHERE ro.question_id = fq.id AND ro.score > 0
            )
          )
        GROUP BY fc.id, fc.category_name, fc.form_id
        HAVING possible_points > 0
        ORDER BY fc.category_name
      `);

      const questionsPromise = prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT fq.id, fq.question_text as name, fc.form_id, f.form_name, 
               fq.category_id, fc.category_name, fq.question_type, fq.yes_value
        FROM form_questions fq
        INNER JOIN form_categories fc ON fq.category_id = fc.id
        INNER JOIN forms f ON fc.form_id = f.id
        INNER JOIN (
          SELECT fc.id as category_id
          FROM form_categories fc
          LEFT JOIN form_questions fq ON fc.id = fq.category_id
          WHERE fc.weight > 0
            AND fq.question_type != 'SUB_CATEGORY'
            AND fq.question_type != 'TEXT'
            AND NOT (fq.question_type = 'YES_NO' AND fq.yes_value = 0)
            AND NOT (
              fq.question_type = 'RADIO' 
              AND NOT EXISTS (
                SELECT 1 FROM radio_options ro 
                WHERE ro.question_id = fq.id AND ro.score > 0
              )
            )
          GROUP BY fc.id
          HAVING COALESCE(SUM(
            CASE 
              WHEN fq.question_type = 'yes_no' AND fq.yes_value > 0 THEN fq.yes_value
              WHEN fq.question_type = 'scale' AND fq.scale_max > 0 THEN fq.scale_max
              WHEN fq.question_type = 'radio' THEN COALESCE((
                SELECT MAX(ro.score) 
                FROM radio_options ro 
                WHERE ro.question_id = fq.id AND ro.score > 0
              ), 0)
              ELSE 0
            END
          ), 0) > 0
        ) valid_categories ON fc.id = valid_categories.category_id
        WHERE fc.weight > 0
          AND NOT (
            fq.question_type = 'RADIO' 
            AND NOT EXISTS (
              SELECT 1 FROM radio_options ro 
              WHERE ro.question_id = fq.id AND ro.score > 0
            )
          )
        ORDER BY f.form_name, fc.category_name, fq.question_text
      `);

      const datePresets = [
        { id: 'last7days', name: 'Last 7 Days' },
        { id: 'last30days', name: 'Last 30 Days' },
        { id: 'last90days', name: 'Last 90 Days' },
        { id: 'thisMonth', name: 'This Month' },
        { id: 'lastMonth', name: 'Last Month' },
        { id: 'thisQuarter', name: 'This Quarter' },
        { id: 'thisYear', name: 'This Year' }
      ];

      const [departments, forms, csrs, categories, questions] = await Promise.all([
        departmentsPromise,
        formsPromise,
        csrsPromise,
        categoriesPromise,
        questionsPromise
      ]);

      return { departments, forms, csrs, datePresets, categories, questions };
    } catch (error) {
      console.error('Error fetching filter options:', error);
      throw new Error('Failed to fetch filter options');
    }
  }

  /**
   * Get QA score data for analytics
   */
  async getQAScoreData(filters: ReportFilters | ComprehensiveReportFilters, user_id: number, userRole?: string): Promise<any[]> {
    try {
      if (!userRole) {
        const userRows = await prisma.$queryRaw<{ role_name: string }[]>(
          Prisma.sql`SELECT r.role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ${user_id}`
        );
        userRole = userRows[0]?.role_name;
      }

      const useCategoryScore = 'category_id' in filters && filters.category_id;
      const useQuestionScore = 'question_id' in filters && filters.question_id;

      console.log('[ANALYTICS REPOSITORY - getQAScoreData] Filters received:', {
        category_id: filters.category_id,
        question_id: filters.question_id,
        useCategoryScore,
        useQuestionScore
      });

      if (useCategoryScore) {
        console.log('[ANALYTICS REPOSITORY - getQAScoreData] Filtering by category_id:', filters.category_id, '(using overall form scores)');
      } else if (useQuestionScore) {
        console.log('[ANALYTICS REPOSITORY - getQAScoreData] Filtering by question_id:', filters.question_id, '(using overall form scores)');
      } else {
        console.log('[ANALYTICS REPOSITORY - getQAScoreData] Using overall form scores');
      }

      const endDateWithTime = `${filters.end_date} 23:59:59`;
      const scoreFilter = (useCategoryScore || useQuestionScore) ? Prisma.sql`` : Prisma.sql`AND s.total_score IS NOT NULL`;

      const extraConditions: Prisma.Sql[] = [];

      if ('departmentIds' in filters && filters.departmentIds && filters.departmentIds.length > 0) {
        extraConditions.push(Prisma.sql`AND u.department_id IN (${Prisma.join(filters.departmentIds)})`);
      } else if ('department_id' in filters && filters.department_id) {
        extraConditions.push(Prisma.sql`AND u.department_id = ${filters.department_id}`);
      } else if (userRole === 'Manager') {
        extraConditions.push(Prisma.sql`AND u.department_id IN (SELECT DISTINCT dm.department_id FROM department_managers dm WHERE dm.manager_id = ${user_id} AND dm.is_active = 1)`);
      }

      if ('formIds' in filters && filters.formIds && filters.formIds.length > 0) {
        if (filters.formIds.length === 1) {
          extraConditions.push(Prisma.sql`AND s.form_id = ${filters.formIds[0]}`);
        } else {
          extraConditions.push(Prisma.sql`AND s.form_id IN (${Prisma.join(filters.formIds)})`);
        }
      } else if ('form_id' in filters && filters.form_id) {
        extraConditions.push(Prisma.sql`AND s.form_id = ${filters.form_id}`);
      }

      if ('csrIds' in filters && filters.csrIds && filters.csrIds.length > 0) {
        extraConditions.push(Prisma.sql`AND CAST(sm.value AS UNSIGNED) IN (${Prisma.join(filters.csrIds)})`);
      }

      if ('categoryIds' in filters && Array.isArray(filters.categoryIds) && filters.categoryIds.length > 0) {
        extraConditions.push(Prisma.sql`AND EXISTS (
          SELECT 1 FROM submission_answers sa
          INNER JOIN form_questions fq ON sa.question_id = fq.id
          WHERE sa.submission_id = s.id AND fq.category_id IN (${Prisma.join(filters.categoryIds)})
        )`);
      } else if ('category_id' in filters && filters.category_id) {
        extraConditions.push(Prisma.sql`AND EXISTS (
          SELECT 1 FROM submission_answers sa
          INNER JOIN form_questions fq ON sa.question_id = fq.id
          WHERE sa.submission_id = s.id AND fq.category_id = ${filters.category_id}
        )`);
      }

      if ('questionIds' in filters && Array.isArray(filters.questionIds) && filters.questionIds.length > 0) {
        extraConditions.push(Prisma.sql`AND EXISTS (
          SELECT 1 FROM submission_answers sa
          WHERE sa.submission_id = s.id AND sa.question_id IN (${Prisma.join(filters.questionIds)})
        )`);
      } else if ('question_id' in filters && filters.question_id) {
        extraConditions.push(Prisma.sql`AND EXISTS (
          SELECT 1 FROM submission_answers sa
          WHERE sa.submission_id = s.id AND sa.question_id = ${filters.question_id}
        )`);
      }

      const extraWhere = extraConditions.length > 0 ? Prisma.join(extraConditions, ' ') : Prisma.sql``;

      const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT 
          DATE(s.submitted_at) AS date,
          s.total_score AS total_score,
          s.id AS submission_id,
          s.submitted_at,
          s.status,
          CAST(sm.value AS UNSIGNED) AS csr_user_id,
          u.username AS csr_username,
          f.form_name,
          d.department_name,
          CAST(sm.value AS UNSIGNED) AS csr_id,
          u.username AS csr_name,
          d.id AS department_id,
          d.department_name AS department_name,
          f.id AS form_id,
          f.form_name AS form_name,
          f.id AS group_id,
          f.form_name AS group_name
        FROM 
          submissions s
          INNER JOIN forms f ON s.form_id = f.id
          INNER JOIN submission_metadata sm ON s.id = sm.submission_id
          INNER JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
          INNER JOIN users u ON CAST(sm.value AS UNSIGNED) = u.id
          LEFT JOIN departments d ON u.department_id = d.id
        WHERE 
          s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}
          AND s.status IN ('SUBMITTED', 'FINALIZED')
          AND s.form_id IN (
            SELECT DISTINCT fc.form_id 
            FROM form_categories fc 
            WHERE fc.weight > 0
          )
          ${scoreFilter}
          ${extraWhere}
        ORDER BY s.submitted_at DESC
      `);

      console.log(`[ANALYTICS REPOSITORY] QA Score Data Query executed. Found ${rows.length} records.`);
      console.log(`[ANALYTICS REPOSITORY] Sample row:`, rows[0]);

      return rows.map(row => ({
        date: row.date,
        total_score: parseFloat(row.total_score) || 0,
        submission_id: row.submission_id,
        submitted_at: row.submitted_at,
        status: row.status,
        csr_user_id: row.csr_user_id,
        csr_username: row.csr_username,
        form_name: row.form_name,
        department_name: row.department_name,
        group_id: row.group_id,
        group_name: row.group_name,
        csr_name: row.csr_name,
        department_id: row.department_id,
        form_id: row.form_id
      }));
    } catch (error) {
      console.error('Error fetching QA score data:', error);
      throw new Error('Failed to fetch QA score data');
    }
  }

  /**
   * Get detailed QA score data for exports
   */
  async getDetailedQAScoreData(filters: ReportFilters | ComprehensiveReportFilters, user_id: number, userRole?: string): Promise<any[]> {
    try {
      if (!userRole) {
        const userRows = await prisma.$queryRaw<{ role_name: string }[]>(
          Prisma.sql`SELECT r.role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ${user_id}`
        );
        userRole = userRows[0]?.role_name;
      }

      const endDateWithTime = `${filters.end_date} 23:59:59`;

      const extraConditions: Prisma.Sql[] = [];

      if ('departmentIds' in filters && filters.departmentIds && filters.departmentIds.length > 0) {
        extraConditions.push(Prisma.sql`AND (u.department_id IN (${Prisma.join(filters.departmentIds)}) OR u.department_id IS NULL)`);
      } else if ('department_id' in filters && filters.department_id) {
        extraConditions.push(Prisma.sql`AND (u.department_id = ${filters.department_id} OR u.department_id IS NULL)`);
      } else if (userRole === 'Manager') {
        extraConditions.push(Prisma.sql`AND (u.department_id IN (SELECT DISTINCT dm.department_id FROM department_managers dm WHERE dm.manager_id = ${user_id} AND dm.is_active = 1) OR u.department_id IS NULL)`);
      }

      if (filters.form_id) {
        extraConditions.push(Prisma.sql`AND s.form_id = ${filters.form_id}`);
      }

      if ('csrIds' in filters && filters.csrIds && filters.csrIds.length > 0) {
        extraConditions.push(Prisma.sql`AND (CAST(sm.value AS UNSIGNED) IN (${Prisma.join(filters.csrIds)}) OR sm.value IS NULL)`);
      }

      if ('category_id' in filters && filters.category_id) {
        extraConditions.push(Prisma.sql`AND EXISTS (
          SELECT 1 FROM submission_answers sa
          INNER JOIN form_questions fq ON sa.question_id = fq.id
          WHERE sa.submission_id = s.id AND fq.category_id = ${filters.category_id}
        )`);
      }

      if ('question_id' in filters && filters.question_id) {
        extraConditions.push(Prisma.sql`AND EXISTS (
          SELECT 1 FROM submission_answers sa
          WHERE sa.submission_id = s.id AND sa.question_id = ${filters.question_id}
        )`);
      }

      const extraWhere = extraConditions.length > 0 ? Prisma.join(extraConditions, ' ') : Prisma.sql``;

      let rows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT 
          s.id AS submission_id,
          s.total_score AS total_score,
          s.submitted_at,
          s.status,
          f.form_name,
          f.id AS form_id,
          COALESCE(u.username, 'Unknown CSR') AS csr_username,
          COALESCE(CAST(sm.value AS UNSIGNED), 0) AS csr_id,
          COALESCE(d.department_name, 'Unknown Department') AS department_name,
          COALESCE(d.id, 0) AS department_id,
          qa.username AS qa_name,
          qa.id AS qa_id
        FROM 
          submissions s
          INNER JOIN forms f ON s.form_id = f.id
          INNER JOIN users qa ON s.submitted_by = qa.id
          LEFT JOIN submission_metadata sm ON s.id = sm.submission_id
          LEFT JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
          LEFT JOIN users u ON CAST(sm.value AS UNSIGNED) = u.id
          LEFT JOIN departments d ON u.department_id = d.id
        WHERE 
          s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}
          AND s.status IN ('SUBMITTED', 'FINALIZED')
          ${extraWhere}
        ORDER BY s.submitted_at DESC
      `);

      console.log(`[ANALYTICS REPOSITORY] Detailed QA Score Data Query executed. Found ${rows.length} records.`);
      console.log(`[ANALYTICS REPOSITORY] Sample row:`, rows[0]);

      if (rows.length === 0) {
        console.log(`[ANALYTICS REPOSITORY] No results with metadata, trying fallback query...`);

        const testRows = await prisma.$queryRaw<any[]>(
          Prisma.sql`SELECT COUNT(*) as count FROM submissions WHERE submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime} AND status IN ('SUBMITTED', 'FINALIZED')`
        );
        console.log(`[ANALYTICS REPOSITORY] Test query - Total submissions in date range:`, testRows[0]?.count);

        const fallbackConditions: Prisma.Sql[] = [];

        if (filters.form_id) {
          fallbackConditions.push(Prisma.sql`AND s.form_id = ${filters.form_id}`);
        }

        if ('category_id' in filters && filters.category_id) {
          fallbackConditions.push(Prisma.sql`AND EXISTS (
            SELECT 1 FROM submission_answers sa
            INNER JOIN form_questions fq ON sa.question_id = fq.id
            WHERE sa.submission_id = s.id AND fq.category_id = ${filters.category_id}
          )`);
        }

        if ('question_id' in filters && filters.question_id) {
          fallbackConditions.push(Prisma.sql`AND EXISTS (
            SELECT 1 FROM submission_answers sa
            WHERE sa.submission_id = s.id AND sa.question_id = ${filters.question_id}
          )`);
        }

        const fallbackExtraWhere = fallbackConditions.length > 0 ? Prisma.join(fallbackConditions, ' ') : Prisma.sql``;

        rows = await prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT 
            s.id AS submission_id,
            s.total_score AS total_score,
            s.submitted_at,
            s.status,
            f.form_name,
            f.id AS form_id,
            'Unknown CSR' AS csr_username,
            0 AS csr_id,
            'Unknown Department' AS department_name,
            0 AS department_id,
            qa.username AS qa_name,
            qa.id AS qa_id
          FROM 
            submissions s
            INNER JOIN forms f ON s.form_id = f.id
            INNER JOIN users qa ON s.submitted_by = qa.id
          WHERE 
            s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}
            AND s.status IN ('SUBMITTED', 'FINALIZED')
            ${fallbackExtraWhere}
          ORDER BY s.submitted_at DESC
        `);

        console.log(`[ANALYTICS REPOSITORY] Fallback query executed. Found ${rows.length} records.`);
        console.log(`[ANALYTICS REPOSITORY] Fallback sample row:`, rows[0]);
      }

      return rows;
    } catch (error) {
      console.error('Error fetching detailed QA score data:', error);
      throw new Error('Failed to fetch detailed QA score data');
    }
  }

  /**
   * Get active performance goals
   */
  async getActiveGoals(user_id: number, userRole?: string, department_id?: number): Promise<any[]> {
    try {
      if (!userRole) {
        const userRows = await prisma.$queryRaw<{ role_name: string }[]>(
          Prisma.sql`SELECT r.role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ${user_id}`
        );
        userRole = userRows[0]?.role_name;
      }

      const conditions: Prisma.Sql[] = [Prisma.sql`pg.is_active = 1`];

      if (department_id) {
        conditions.push(Prisma.sql`(pg.scope = 'GLOBAL' OR (pg.scope = 'DEPARTMENT' AND pg.department_id = ${department_id}))`);
      } else if (userRole === 'Manager') {
        conditions.push(Prisma.sql`(pg.scope = 'GLOBAL' OR (pg.scope = 'DEPARTMENT' AND pg.department_id IN (
          SELECT DISTINCT dm.department_id FROM department_managers dm WHERE dm.manager_id = ${user_id} AND dm.is_active = 1
        )))`);
      }

      const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

      const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT 
          pg.id,
          pg.goal_type,
          pg.target_value,
          pg.scope,
          pg.department_id
        FROM 
          performance_goals pg
        ${whereClause}
      `);

      return rows;
    } catch (error) {
      console.error('Error fetching active goals:', error);
      throw new Error('Failed to fetch active goals');
    }
  }

  /**
   * Calculate average QA score for performance goals
   */
  async getAverageQAScore(
    filters: ReportFilters,
    user_id: number,
    userRole: string | undefined,
    goal: any
  ): Promise<{ averageScore: number }> {
    try {
      const endDateWithTime = `${filters.end_date} 23:59:59`;
      const extraConditions: Prisma.Sql[] = [];

      if (goal.scope === 'DEPARTMENT' && goal.department_id) {
        extraConditions.push(Prisma.sql`AND u.department_id = ${goal.department_id}`);
      } else if (userRole === 'Manager') {
        extraConditions.push(Prisma.sql`AND u.department_id IN (SELECT DISTINCT dm.department_id FROM department_managers dm WHERE dm.manager_id = ${user_id} AND dm.is_active = 1)`);
      }

      const extraWhere = extraConditions.length > 0 ? Prisma.join(extraConditions, ' ') : Prisma.sql``;

      const rows = await prisma.$queryRaw<{ avg_score: number | null }[]>(Prisma.sql`
        SELECT 
          AVG(s.total_score) AS avg_score
        FROM 
          submissions s
          INNER JOIN users u ON s.submitted_by = u.id
        WHERE 
          s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}
          AND s.status IN ('SUBMITTED', 'FINALIZED')
          AND s.total_score IS NOT NULL
          ${extraWhere}
      `);

      return { averageScore: Number(rows[0]?.avg_score) || 0 };
    } catch (error) {
      console.error('Error calculating average QA score:', error);
      throw new Error('Failed to calculate average QA score');
    }
  }

  /**
   * Calculate audit rate for performance goals
   */
  async getAuditRateData(
    filters: ReportFilters,
    user_id: number,
    userRole: string | undefined,
    goal: any
  ): Promise<{ auditRate: number }> {
    try {
      const endDateWithTime = `${filters.end_date} 23:59:59`;
      const extraConditions: Prisma.Sql[] = [];

      if (goal.scope === 'DEPARTMENT' && goal.department_id) {
        extraConditions.push(Prisma.sql`AND u.department_id = ${goal.department_id}`);
      } else if (userRole === 'Manager') {
        extraConditions.push(Prisma.sql`AND u.department_id IN (SELECT DISTINCT dm.department_id FROM department_managers dm WHERE dm.manager_id = ${user_id} AND dm.is_active = 1)`);
      }

      const extraWhere = extraConditions.length > 0 ? Prisma.join(extraConditions, ' ') : Prisma.sql``;

      const rows = await prisma.$queryRaw<{ audit_count: bigint; qa_count: bigint }[]>(Prisma.sql`
        SELECT 
          COUNT(DISTINCT s.id) AS audit_count,
          COUNT(DISTINCT s.submitted_by) AS qa_count
        FROM 
          submissions s
          INNER JOIN users u ON s.submitted_by = u.id
        WHERE 
          s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}
          AND s.status IN ('SUBMITTED', 'FINALIZED')
          ${extraWhere}
      `);

      const auditCount = Number(rows[0]?.audit_count) || 0;
      const qaCount = Number(rows[0]?.qa_count) || 1;

      return { auditRate: auditCount / qaCount };
    } catch (error) {
      console.error('Error calculating audit rate:', error);
      throw new Error('Failed to calculate audit rate');
    }
  }

  /**
   * Calculate dispute rate for performance goals
   */
  async getDisputeRateData(
    filters: ReportFilters,
    user_id: number,
    userRole: string | undefined,
    goal: any
  ): Promise<{ disputeRate: number }> {
    try {
      const endDateWithTime = `${filters.end_date} 23:59:59`;
      const extraConditions: Prisma.Sql[] = [];

      if (goal.scope === 'DEPARTMENT' && goal.department_id) {
        extraConditions.push(Prisma.sql`AND u.department_id = ${goal.department_id}`);
      } else if (userRole === 'Manager') {
        extraConditions.push(Prisma.sql`AND u.department_id IN (SELECT DISTINCT dm.department_id FROM department_managers dm WHERE dm.manager_id = ${user_id} AND dm.is_active = 1)`);
      }

      const extraWhere = extraConditions.length > 0 ? Prisma.join(extraConditions, ' ') : Prisma.sql``;

      const rows = await prisma.$queryRaw<{ audit_count: bigint; dispute_count: bigint }[]>(Prisma.sql`
        SELECT 
          COUNT(DISTINCT s.id) AS audit_count,
          COUNT(DISTINCT d.id) AS dispute_count
        FROM 
          submissions s
          INNER JOIN users u ON s.submitted_by = u.id
          LEFT JOIN disputes d ON s.id = d.submission_id
        WHERE 
          s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}
          AND s.status IN ('SUBMITTED', 'FINALIZED', 'DISPUTED')
          ${extraWhere}
      `);

      const auditCount = Number(rows[0]?.audit_count) || 0;
      const disputeCount = Number(rows[0]?.dispute_count) || 0;
      const disputeRate = auditCount > 0 ? (disputeCount / auditCount) * 100 : 0;

      return { disputeRate };
    } catch (error) {
      console.error('Error calculating dispute rate:', error);
      throw new Error('Failed to calculate dispute rate');
    }
  }

  /**
   * Get detailed submission data for comprehensive reporting
   */
  async getDetailedSubmissionData(filters: any, user_id: number, userRole?: string): Promise<any[]> {
    try {
      if (!userRole) {
        const userRows = await prisma.$queryRaw<{ role_name: string }[]>(
          Prisma.sql`SELECT r.role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ${user_id}`
        );
        userRole = userRows[0]?.role_name;
      }

      const isQuestionLevel = (('question_id' in filters && filters.question_id) ||
                              ('questionIds' in filters && filters.questionIds && filters.questionIds.length > 0));

      const isCategoryLevel = (('category_id' in filters && filters.category_id) ||
                               ('categoryIds' in filters && filters.categoryIds && filters.categoryIds.length > 0)) &&
                              !('question_id' in filters && filters.question_id) &&
                              !('questionIds' in filters && filters.questionIds && filters.questionIds.length > 0);

      const isFormLevelOnly = (('form_id' in filters && filters.form_id) ||
                               ('formIds' in filters && filters.formIds && filters.formIds.length > 0)) &&
                              !('category_id' in filters && filters.category_id) &&
                              !('categoryIds' in filters && filters.categoryIds && filters.categoryIds.length > 0) &&
                              !('question_id' in filters && filters.question_id) &&
                              !('questionIds' in filters && filters.questionIds && filters.questionIds.length > 0);

      const useCategoryScore = 'category_id' in filters && filters.category_id;
      const useQuestionScore = 'question_id' in filters && filters.question_id;

      const endDateWithTime = `${filters.end_date} 23:59:59`;
      const scoreFilter = (useCategoryScore || useQuestionScore) ? Prisma.sql`` : Prisma.sql`AND s.total_score IS NOT NULL`;

      const extraConditions: Prisma.Sql[] = [];

      if ('departmentIds' in filters && filters.departmentIds && filters.departmentIds.length > 0) {
        extraConditions.push(Prisma.sql`AND (csr_user.department_id IN (${Prisma.join(filters.departmentIds)}) OR csr_user.department_id IS NULL)`);
      } else if ('department_id' in filters && filters.department_id) {
        extraConditions.push(Prisma.sql`AND (csr_user.department_id = ${filters.department_id} OR csr_user.department_id IS NULL)`);
      } else if (userRole === 'Manager') {
        extraConditions.push(Prisma.sql`AND (csr_user.department_id IN (SELECT DISTINCT dm.department_id FROM department_managers dm WHERE dm.manager_id = ${user_id} AND dm.is_active = 1) OR csr_user.department_id IS NULL)`);
      }

      if ('formIds' in filters && filters.formIds && filters.formIds.length > 0) {
        if (filters.formIds.length === 1) {
          extraConditions.push(Prisma.sql`AND s.form_id = ${filters.formIds[0]}`);
        } else {
          extraConditions.push(Prisma.sql`AND s.form_id IN (${Prisma.join(filters.formIds)})`);
        }
      } else if ('form_id' in filters && filters.form_id) {
        extraConditions.push(Prisma.sql`AND s.form_id = ${filters.form_id}`);
      }

      if ('csrIds' in filters && filters.csrIds && filters.csrIds.length > 0) {
        extraConditions.push(Prisma.sql`AND (CAST(sm.value AS UNSIGNED) IN (${Prisma.join(filters.csrIds)}) OR sm.value IS NULL)`);
      }

      if ('categoryIds' in filters && Array.isArray(filters.categoryIds) && filters.categoryIds.length > 0) {
        if (isCategoryLevel || ('includeQuestionBreakdown' in filters && filters.includeQuestionBreakdown)) {
          extraConditions.push(Prisma.sql`AND fc.id IN (${Prisma.join(filters.categoryIds)})`);
        } else {
          extraConditions.push(Prisma.sql`AND EXISTS (
            SELECT 1 FROM submission_answers sa
            INNER JOIN form_questions fq ON sa.question_id = fq.id
            WHERE sa.submission_id = s.id AND fq.category_id IN (${Prisma.join(filters.categoryIds)})
          )`);
        }
      } else if ('category_id' in filters && filters.category_id) {
        if (isCategoryLevel || ('includeQuestionBreakdown' in filters && filters.includeQuestionBreakdown)) {
          extraConditions.push(Prisma.sql`AND fc.id = ${filters.category_id}`);
        } else {
          extraConditions.push(Prisma.sql`AND EXISTS (
            SELECT 1 FROM submission_answers sa
            INNER JOIN form_questions fq ON sa.question_id = fq.id
            WHERE sa.submission_id = s.id AND fq.category_id = ${filters.category_id}
          )`);
        }
      }

      if ('questionIds' in filters && Array.isArray(filters.questionIds) && filters.questionIds.length > 0) {
        if (isQuestionLevel) {
          extraConditions.push(Prisma.sql`AND fq.id IN (${Prisma.join(filters.questionIds)})`);
        } else {
          extraConditions.push(Prisma.sql`AND EXISTS (
            SELECT 1 FROM submission_answers sa
            WHERE sa.submission_id = s.id AND sa.question_id IN (${Prisma.join(filters.questionIds)})
          )`);
        }
      } else if ('question_id' in filters && filters.question_id) {
        if (isQuestionLevel) {
          extraConditions.push(Prisma.sql`AND fq.id = ${filters.question_id}`);
        } else {
          extraConditions.push(Prisma.sql`AND EXISTS (
            SELECT 1 FROM submission_answers sa
            WHERE sa.submission_id = s.id AND sa.question_id = ${filters.question_id}
          )`);
        }
      }

      const extraWhere = extraConditions.length > 0 ? Prisma.join(extraConditions, ' ') : Prisma.sql``;

      let rows: any[];

      if (isQuestionLevel) {
        rows = await prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT 
            s.id AS submission_id,
            DATE(s.submitted_at) AS submission_date,
            COALESCE(csr_user.username, 'Unknown CSR') AS csr_name,
            f.form_name,
            s.total_score AS total_score,
            fc.category_name,
            fc.id AS category_id,
            fq.id AS question_id,
            fq.question_text,
            fq.question_type,
            fq.yes_value,
            fq.no_value,
            fq.na_value,
            fq.scale_max,
            sa.answer AS question_answer,
            1 AS responses,
            ROUND(
              CASE 
                WHEN fq.question_type = 'yes_no' THEN
                  CASE sa.answer
                    WHEN 'Yes' THEN COALESCE(fq.yes_value, 0)
                    WHEN 'No' THEN COALESCE(fq.no_value, 0)
                    WHEN 'N/A' THEN COALESCE(fq.na_value, 0)
                    ELSE 0
                  END
                WHEN fq.question_type = 'scale' AND fq.scale_max IS NOT NULL AND fq.scale_max > 0 THEN
                  (CAST(sa.answer AS DECIMAL(10,2)) / fq.scale_max) * 100
                WHEN fq.question_type = 'text' THEN 100
                ELSE 0
              END
            , 2) AS question_average_score
          FROM 
            submissions s
            INNER JOIN forms f ON s.form_id = f.id
            INNER JOIN submission_answers sa ON s.id = sa.submission_id
            INNER JOIN form_questions fq ON sa.question_id = fq.id
            INNER JOIN form_categories fc ON fq.category_id = fc.id
            LEFT JOIN (
              SELECT sm.submission_id, sm.value
              FROM submission_metadata sm
              INNER JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
            ) sm ON s.id = sm.submission_id
            LEFT JOIN users csr_user ON sm.value IS NOT NULL AND CAST(sm.value AS UNSIGNED) = csr_user.id
          WHERE 
            s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}
            AND s.status IN ('SUBMITTED', 'FINALIZED')
            AND fc.weight > 0
            ${scoreFilter}
            ${extraWhere}
          ORDER BY s.id ASC, fc.category_name ASC, fq.question_text ASC
        `);
      } else if ('includeQuestionBreakdown' in filters && filters.includeQuestionBreakdown && !filters.question_id) {
        rows = await prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT 
            s.id AS submission_id,
            DATE(s.submitted_at) AS submission_date,
            COALESCE(csr_user.username, 'Unknown CSR') AS csr_name,
            f.form_name,
            s.total_score AS total_score,
            fc.category_name,
            fc.id AS category_id,
            fq.question_text,
            sa.answer AS question_answer,
            CASE 
              WHEN fq.question_type = 'yes_no' THEN
                CASE sa.answer
                  WHEN 'Yes' THEN COALESCE(fq.yes_value, 0)
                  WHEN 'No' THEN COALESCE(fq.no_value, 0)
                  WHEN 'N/A' THEN COALESCE(fq.na_value, 0)
                  ELSE 0
                END
              WHEN fq.question_type = 'scale' AND fq.scale_max IS NOT NULL AND fq.scale_max > 0 THEN
                (CAST(sa.answer AS DECIMAL(10,2)) / fq.scale_max) * 100
              WHEN fq.question_type = 'text' THEN 100
              WHEN fq.question_type = 'radio' THEN
                COALESCE((SELECT ro.score FROM radio_options ro WHERE ro.question_id = fq.id AND ro.option_text = sa.answer LIMIT 1), 0)
              ELSE 0
            END AS question_answer_value,
            fq.id AS question_id
          FROM 
            submissions s
            INNER JOIN forms f ON s.form_id = f.id
            INNER JOIN submission_answers sa ON s.id = sa.submission_id
            INNER JOIN form_questions fq ON sa.question_id = fq.id
            INNER JOIN form_categories fc ON fq.category_id = fc.id
            LEFT JOIN (
              SELECT sm.submission_id, sm.value
              FROM submission_metadata sm
              INNER JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
            ) sm ON s.id = sm.submission_id
            LEFT JOIN users csr_user ON sm.value IS NOT NULL AND CAST(sm.value AS UNSIGNED) = csr_user.id
          WHERE 
            s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}
            AND s.status IN ('SUBMITTED', 'FINALIZED')
            AND fc.weight > 0
            AND fq.question_type != 'SUB_CATEGORY'
            AND fq.question_type != 'TEXT'
            AND NOT (fq.question_type = 'YES_NO' AND fq.yes_value = 0)
            AND NOT (
              fq.question_type = 'RADIO' 
              AND NOT EXISTS (
                SELECT 1 FROM radio_options ro 
                WHERE ro.question_id = fq.id AND ro.score > 0
              )
            )
            ${scoreFilter}
            ${extraWhere}
          ORDER BY s.id ASC, fc.category_name ASC
        `);
      } else if (isCategoryLevel) {
        rows = await prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT 
            s.id AS submission_id,
            DATE(s.submitted_at) AS submission_date,
            COALESCE(csr_user.username, 'Unknown CSR') AS csr_name,
            f.form_name,
            s.total_score AS total_score,
            fc.category_name,
            fc.id AS category_id,
            COALESCE(cat_stats.responses, 0) AS responses,
            CASE 
              WHEN COALESCE(possible_points.category_possible_points, 0) = 0 THEN NULL
              ELSE COALESCE(possible_points.category_raw_score, 0)
            END AS average_score,
            CASE 
              WHEN COALESCE(possible_points.category_possible_points, 0) = 0 THEN NULL
              ELSE COALESCE(possible_points.category_raw_score, 0)
            END AS category_score,
            COALESCE(possible_points.category_possible_points, 0) AS category_possible_points,
            COALESCE(possible_points.category_earned_points, 0) AS category_earned_points
          FROM 
            submissions s
            INNER JOIN forms f ON s.form_id = f.id
            INNER JOIN form_categories fc ON f.id = fc.form_id
            LEFT JOIN (
              SELECT sm.submission_id, sm.value
              FROM submission_metadata sm
              INNER JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
            ) sm ON s.id = sm.submission_id
            LEFT JOIN users csr_user ON sm.value IS NOT NULL AND CAST(sm.value AS UNSIGNED) = csr_user.id
            LEFT JOIN (
              SELECT 
                sa.submission_id,
                fq.category_id,
                COUNT(DISTINCT sa.question_id) AS responses,
                ROUND(AVG(
                  CASE 
                    WHEN fq.question_type = 'yes_no' THEN
                      CASE sa.answer
                        WHEN 'Yes' THEN COALESCE(fq.yes_value, 0)
                        WHEN 'No' THEN COALESCE(fq.no_value, 0)
                        WHEN 'N/A' THEN COALESCE(fq.na_value, 0)
                        ELSE 0
                      END
                    WHEN fq.question_type = 'scale' AND fq.scale_max IS NOT NULL AND fq.scale_max > 0 THEN
                      (CAST(sa.answer AS DECIMAL(10,2)) / fq.scale_max) * 100
                    WHEN fq.question_type = 'text' THEN 100
                    ELSE 0
                  END
                ), 2) AS average_score
              FROM submission_answers sa
              INNER JOIN form_questions fq ON sa.question_id = fq.id
              GROUP BY sa.submission_id, fq.category_id
            ) cat_stats ON s.id = cat_stats.submission_id AND fc.id = cat_stats.category_id
            LEFT JOIN (
              SELECT 
                ss.submission_id,
                ss_cat.category_id,
                ss_cat.possible_points AS category_possible_points,
                ss_cat.earned_points AS category_earned_points,
                ss_cat.raw_score AS category_raw_score
              FROM score_snapshots ss
              CROSS JOIN JSON_TABLE(
                ss.snapshot_data,
                '$[*]' COLUMNS(
                  category_id INT PATH '$.category_id',
                  possible_points DECIMAL(10,2) PATH '$.possible_points',
                  earned_points DECIMAL(10,2) PATH '$.earned_points',
                  raw_score DECIMAL(10,2) PATH '$.raw_score'
                )
              ) AS ss_cat
            ) possible_points ON s.id = possible_points.submission_id AND fc.id = possible_points.category_id
          WHERE 
            s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}
            AND s.status IN ('SUBMITTED', 'FINALIZED')
            AND fc.weight > 0
            ${scoreFilter}
            ${extraWhere}
          ORDER BY s.id ASC, fc.category_name ASC
        `);
      } else if (isFormLevelOnly && 'includeCategoryBreakdown' in filters && filters.includeCategoryBreakdown) {
        rows = await prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT 
            s.id AS submission_id,
            DATE(s.submitted_at) AS submission_date,
            COALESCE(csr_user.username, 'Unknown CSR') AS csr_name,
            f.form_name,
            s.total_score AS total_score,
            fc.category_name,
            fc.id AS category_id,
            COALESCE(cat_stats.responses, 0) AS responses,
            CASE 
              WHEN COALESCE(possible_points.category_possible_points, 0) = 0 THEN NULL
              ELSE COALESCE(possible_points.category_raw_score, 0)
            END AS average_score,
            CASE 
              WHEN COALESCE(possible_points.category_possible_points, 0) = 0 THEN NULL
              ELSE COALESCE(possible_points.category_raw_score, 0)
            END AS category_score,
            COALESCE(possible_points.category_possible_points, 0) AS category_possible_points,
            COALESCE(possible_points.category_earned_points, 0) AS category_earned_points
          FROM 
            submissions s
            INNER JOIN forms f ON s.form_id = f.id
            INNER JOIN form_categories fc ON f.id = fc.form_id
            LEFT JOIN (
              SELECT sm.submission_id, sm.value
              FROM submission_metadata sm
              INNER JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
            ) sm ON s.id = sm.submission_id
            LEFT JOIN users csr_user ON sm.value IS NOT NULL AND CAST(sm.value AS UNSIGNED) = csr_user.id
            LEFT JOIN (
              SELECT 
                sa.submission_id,
                fq.category_id,
                COUNT(DISTINCT sa.question_id) AS responses,
                ROUND(AVG(
                  CASE 
                    WHEN fq.question_type = 'yes_no' THEN
                      CASE sa.answer
                        WHEN 'Yes' THEN COALESCE(fq.yes_value, 0)
                        WHEN 'No' THEN COALESCE(fq.no_value, 0)
                        WHEN 'N/A' THEN COALESCE(fq.na_value, 0)
                        ELSE 0
                      END
                    WHEN fq.question_type = 'scale' AND fq.scale_max IS NOT NULL AND fq.scale_max > 0 THEN
                      (CAST(sa.answer AS DECIMAL(10,2)) / fq.scale_max) * 100
                    WHEN fq.question_type = 'text' THEN 100
                    ELSE 0
                  END
                ), 2) AS average_score
              FROM submission_answers sa
              INNER JOIN form_questions fq ON sa.question_id = fq.id
              GROUP BY sa.submission_id, fq.category_id
            ) cat_stats ON s.id = cat_stats.submission_id AND fc.id = cat_stats.category_id
            LEFT JOIN (
              SELECT 
                ss.submission_id,
                ss_cat.category_id,
                ss_cat.possible_points AS category_possible_points,
                ss_cat.earned_points AS category_earned_points,
                ss_cat.raw_score AS category_raw_score
              FROM score_snapshots ss
              CROSS JOIN JSON_TABLE(
                ss.snapshot_data,
                '$[*]' COLUMNS(
                  category_id INT PATH '$.category_id',
                  possible_points DECIMAL(10,2) PATH '$.possible_points',
                  earned_points DECIMAL(10,2) PATH '$.earned_points',
                  raw_score DECIMAL(10,2) PATH '$.raw_score'
                )
              ) AS ss_cat
            ) possible_points ON s.id = possible_points.submission_id AND fc.id = possible_points.category_id
          WHERE 
            s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}
            AND s.status IN ('SUBMITTED', 'FINALIZED')
            AND fc.weight > 0
            ${scoreFilter}
            ${extraWhere}
          ORDER BY s.id ASC
        `);
      } else if (isFormLevelOnly) {
        rows = await prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT 
            s.id AS submission_id,
            DATE(s.submitted_at) AS submission_date,
            COALESCE(csr_user.username, 'Unknown CSR') AS csr_name,
            f.form_name,
            s.total_score AS total_score
          FROM 
            submissions s
            INNER JOIN forms f ON s.form_id = f.id
            LEFT JOIN (
              SELECT sm.submission_id, sm.value
              FROM submission_metadata sm
              INNER JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
            ) sm ON s.id = sm.submission_id
            LEFT JOIN users csr_user ON sm.value IS NOT NULL AND CAST(sm.value AS UNSIGNED) = csr_user.id
          WHERE 
            s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}
            AND s.status IN ('SUBMITTED', 'FINALIZED')
            AND s.form_id IN (
              SELECT DISTINCT fc.form_id 
              FROM form_categories fc 
              WHERE fc.weight > 0
            )
            ${scoreFilter}
            ${extraWhere}
          ORDER BY s.id ASC
        `);
      } else {
        rows = await prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT 
            s.id AS submission_id,
            DATE(s.submitted_at) AS submission_date,
            s.total_score AS total_score,
            s.status,
            s.submitted_at,
            f.id AS form_id,
            f.form_name,
            COALESCE(CAST(sm.value AS UNSIGNED), 0) AS csr_id,
            COALESCE(csr_user.username, 'Unknown CSR') AS csr_name,
            COALESCE(csr_user.department_id, 0) AS department_id,
            COALESCE(d.department_name, 'Unknown Department') AS department_name,
            qa.id AS qa_id,
            qa.username AS qa_name
          FROM 
            submissions s
            INNER JOIN forms f ON s.form_id = f.id
            INNER JOIN users qa ON s.submitted_by = qa.id
            LEFT JOIN (
              SELECT sm.submission_id, sm.value
              FROM submission_metadata sm
              INNER JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
            ) sm ON s.id = sm.submission_id
            LEFT JOIN users csr_user ON sm.value IS NOT NULL AND CAST(sm.value AS UNSIGNED) = csr_user.id
            LEFT JOIN departments d ON csr_user.department_id = d.id
          WHERE 
            s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}
            AND s.status IN ('SUBMITTED', 'FINALIZED')
            AND s.form_id IN (
              SELECT DISTINCT fc.form_id 
              FROM form_categories fc 
              WHERE fc.weight > 0
            )
            ${scoreFilter}
            ${extraWhere}
          ORDER BY s.id ASC
        `);
      }

      if (isQuestionLevel) {
        const questionIds = [...new Set(rows.map((r: any) => r.question_id))] as number[];
        let radioOptions: any[] = [];
        if (questionIds.length > 0) {
          radioOptions = await prisma.$queryRaw<any[]>(Prisma.sql`
            SELECT question_id, option_value, option_text, score
            FROM radio_options
            WHERE question_id IN (${Prisma.join(questionIds)})
          `);
        }

        const radioOptionsMap: Record<number, any[]> = {};
        radioOptions.forEach((option: any) => {
          if (!radioOptionsMap[option.question_id]) {
            radioOptionsMap[option.question_id] = [];
          }
          radioOptionsMap[option.question_id].push(option);
        });

        const resultsWithQuestionData = await Promise.all(
          rows.map(async (row: any) => {
            const questionAnswerValue = this.calculateQuestionScore(
              row,
              row.question_answer,
              radioOptionsMap[row.question_id] || []
            );
            const categoryScore = await this.calculateCategoryScore(row.submission_id, row.category_id);

            return {
              submission_id: row.submission_id,
              submission_date: row.submission_date,
              csr_name: row.csr_name,
              form_name: row.form_name,
              total_score: parseFloat(row.total_score) || 0,
              category_name: row.category_name,
              category_id: row.category_id,
              category_score: categoryScore,
              question_text: row.question_text,
              question: row.question_text,
              question_answer: row.question_answer || 'N/A',
              question_answer_value: questionAnswerValue !== null ? questionAnswerValue : 0,
              responses: row.responses || 0,
              question_average_score: parseFloat(row.question_average_score) || 0
            };
          })
        );
        return resultsWithQuestionData;
      }

      if ('includeQuestionBreakdown' in filters && filters.includeQuestionBreakdown && !filters.question_id) {
        const resultsWithQuestionData = await Promise.all(
          rows.map(async (row: any) => {
            const categoryScore = await this.calculateCategoryScore(row.submission_id, row.category_id);
            return {
              submission_id: row.submission_id,
              submission_date: row.submission_date,
              csr_name: row.csr_name,
              form_name: row.form_name,
              total_score: parseFloat(row.total_score) || 0,
              category_name: row.category_name,
              category_id: row.category_id,
              category_score: categoryScore,
              question_text: row.question_text,
              question: row.question_text,
              question_answer: row.question_answer || 'N/A',
              question_answer_value: row.question_answer_value !== null ? parseFloat(row.question_answer_value) : 0
            };
          })
        );
        return resultsWithQuestionData;
      }

      if (isCategoryLevel) {
        return rows.map((row: any) => ({
          submission_id: row.submission_id,
          submission_date: row.submission_date,
          csr_name: row.csr_name,
          form_name: row.form_name,
          total_score: parseFloat(row.total_score) || 0,
          category_name: row.category_name,
          category_id: row.category_id,
          category_score: row.category_score !== null && row.category_score !== undefined ? parseFloat(row.category_score) : null,
          responses: row.responses || 0,
          average_score: row.average_score !== null && row.average_score !== undefined ? parseFloat(row.average_score) : null,
          category_possible_points: parseFloat(row.category_possible_points) || 0,
          category_earned_points: parseFloat(row.category_earned_points) || 0
        }));
      }

      if (isFormLevelOnly && 'includeCategoryBreakdown' in filters && filters.includeCategoryBreakdown) {
        return rows.map((row: any) => ({
          submission_id: row.submission_id,
          submission_date: row.submission_date,
          csr_name: row.csr_name,
          form_name: row.form_name,
          total_score: parseFloat(row.total_score) || 0,
          category_name: row.category_name,
          category_id: row.category_id,
          category_score: row.category_score !== null && row.category_score !== undefined ? parseFloat(row.category_score) : null,
          responses: row.responses || 0,
          average_score: row.average_score !== null && row.average_score !== undefined ? parseFloat(row.average_score) : null,
          category_possible_points: parseFloat(row.category_possible_points) || 0,
          category_earned_points: parseFloat(row.category_earned_points) || 0
        }));
      }

      if (isFormLevelOnly) {
        return rows.map((row: any) => ({
          submission_id: row.submission_id,
          submission_date: row.submission_date,
          csr_name: row.csr_name,
          form_name: row.form_name,
          total_score: parseFloat(row.total_score) || 0
        }));
      }

      return rows.map((row: any) => ({
        submission_id: row.submission_id,
        submission_date: row.submission_date,
        total_score: parseFloat(row.total_score) || 0,
        status: row.status,
        submitted_at: row.submitted_at,
        form_id: row.form_id,
        form_name: row.form_name,
        csr_id: row.csr_id,
        csr_name: row.csr_name,
        department_id: row.department_id,
        department_name: row.department_name,
        qa_id: row.qa_id,
        qa_name: row.qa_name
      }));
    } catch (error) {
      console.error('Error fetching detailed submission data:', error);
      throw new Error('Failed to fetch detailed submission data');
    }
  }

  /**
   * Calculate category score for a specific submission and category
   */
  private async calculateCategoryScore(submission_id: number, category_id: number): Promise<number> {
    try {
      const questions = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT fq.id, fq.question_type, fq.yes_value, fq.no_value, fq.na_value, fq.scale_max
        FROM form_questions fq
        WHERE fq.category_id = ${category_id}
      `);

      if (questions.length === 0) {
        return 0;
      }

      const questionIds = questions.map((q: any) => q.id) as number[];

      const radioOptions = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT question_id, option_value, option_text, score
        FROM radio_options
        WHERE question_id IN (${Prisma.join(questionIds)})
      `);

      const radioOptionsMap: Record<number, any[]> = {};
      radioOptions.forEach((option: any) => {
        if (!radioOptionsMap[option.question_id]) {
          radioOptionsMap[option.question_id] = [];
        }
        radioOptionsMap[option.question_id].push(option);
      });

      const answers = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT question_id, answer
        FROM submission_answers
        WHERE submission_id = ${submission_id} AND question_id IN (${Prisma.join(questionIds)})
      `);

      let total_score = 0;
      let maxPossibleScore = 0;

      answers.forEach((answer: any) => {
        const question = questions.find((q: any) => q.id === answer.question_id);
        if (!question) return;

        const score = this.calculateQuestionScore(question, answer.answer, radioOptionsMap[answer.question_id] || []);
        const maxScore = this.getMaxPossibleScore(question, radioOptionsMap[answer.question_id] || []);

        if (score !== null) {
          total_score += score;
          maxPossibleScore += maxScore;
        }
      });

      if (maxPossibleScore === 0) {
        return 0;
      }

      return Math.round((total_score / maxPossibleScore) * 100 * 100) / 100;
    } catch (error) {
      console.error(`Error calculating category score for submission ${submission_id}, category ${category_id}:`, error);
      return 0;
    }
  }

  /**
   * Get question-level analytics
   */
  async getQuestionLevelAnalytics(filters: any): Promise<any> {
    try {
      const questionConditions: Prisma.Sql[] = [
        Prisma.sql`fc.weight > 0`,
        Prisma.sql`fq.question_type != 'SUB_CATEGORY'`,
        Prisma.sql`fq.question_type != 'TEXT'`,
        Prisma.sql`NOT (fq.question_type = 'YES_NO' AND fq.yes_value = 0)`,
        Prisma.sql`NOT (
          fq.question_type = 'RADIO' 
          AND NOT EXISTS (
            SELECT 1 FROM radio_options ro 
            WHERE ro.question_id = fq.id AND ro.score > 0
          )
        )`
      ];

      if ('formIds' in filters && filters.formIds && filters.formIds.length > 0) {
        if (filters.formIds.length === 1) {
          questionConditions.push(Prisma.sql`fc.form_id = ${filters.formIds[0]}`);
        } else {
          questionConditions.push(Prisma.sql`fc.form_id IN (${Prisma.join(filters.formIds)})`);
        }
      } else if ('form_id' in filters && filters.form_id) {
        questionConditions.push(Prisma.sql`fc.form_id = ${filters.form_id}`);
      }

      if (filters.categoryIds && filters.categoryIds.length > 0) {
        questionConditions.push(Prisma.sql`fq.category_id IN (${Prisma.join(filters.categoryIds)})`);
      } else if (filters.category_id) {
        questionConditions.push(Prisma.sql`fq.category_id = ${filters.category_id}`);
      }

      if (filters.questionIds && filters.questionIds.length > 0) {
        questionConditions.push(Prisma.sql`fq.id IN (${Prisma.join(filters.questionIds)})`);
      } else if (filters.question_id) {
        questionConditions.push(Prisma.sql`fq.id = ${filters.question_id}`);
      }

      const questionWhere = Prisma.sql`WHERE ${Prisma.join(questionConditions, ' AND ')}`;

      const questionRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT 
          fq.id AS question_id,
          fq.question_text,
          fq.category_id,
          fc.category_name,
          fc.form_id,
          fq.weight,
          fq.question_type,
          fq.yes_value,
          fq.no_value,
          fq.na_value,
          fq.scale_max,
          fq.sort_order
        FROM 
          form_questions fq
          INNER JOIN form_categories fc ON fq.category_id = fc.id
        ${questionWhere}
        ORDER BY fc.category_name, fq.sort_order
      `);

      if (questionRows.length === 0) {
        return {
          questions: [],
          summary: {
            totalQuestions: 0,
            averageScore: null,
            highestPerformingQuestion: null,
            lowestPerformingQuestion: null,
            note: "No questions found for the specified filters."
          }
        };
      }

      const questionIds = questionRows.map((q: any) => q.question_id) as number[];

      const radioRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT id, question_id, option_text, option_value, score, sort_order 
        FROM radio_options 
        WHERE question_id IN (${Prisma.join(questionIds)}) 
        ORDER BY question_id, sort_order
      `);

      const radioOptionsMap: Record<number, any[]> = {};
      radioRows.forEach((option: any) => {
        if (!radioOptionsMap[option.question_id]) {
          radioOptionsMap[option.question_id] = [];
        }
        radioOptionsMap[option.question_id].push(option);
      });

      const endDateWithTime = `${filters.end_date} 23:59:59`;

      const answerConditions: Prisma.Sql[] = [];

      if ('csrIds' in filters && Array.isArray(filters.csrIds) && filters.csrIds.length > 0) {
        answerConditions.push(Prisma.sql`AND (CAST(sm.value AS UNSIGNED) IN (${Prisma.join(filters.csrIds)}) OR sm.value IS NULL)`);
      }

      if ('departmentIds' in filters && filters.departmentIds && filters.departmentIds.length > 0) {
        answerConditions.push(Prisma.sql`AND (csr_user.department_id IN (${Prisma.join(filters.departmentIds)}) OR csr_user.department_id IS NULL)`);
      } else if ('department_id' in filters && filters.department_id) {
        answerConditions.push(Prisma.sql`AND (csr_user.department_id = ${filters.department_id} OR csr_user.department_id IS NULL)`);
      }

      if ('formIds' in filters && Array.isArray(filters.formIds) && filters.formIds.length > 0) {
        answerConditions.push(Prisma.sql`AND s.form_id IN (${Prisma.join(filters.formIds)})`);
      } else if ('form_id' in filters && filters.form_id) {
        answerConditions.push(Prisma.sql`AND s.form_id = ${filters.form_id}`);
      }

      const answerExtraWhere = answerConditions.length > 0 ? Prisma.join(answerConditions, ' ') : Prisma.sql``;

      const answerRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT 
          sa.question_id,
          sa.answer,
          s.submitted_at,
          s.form_id,
          s.id AS submission_id
        FROM 
          submission_answers sa
          INNER JOIN submissions s ON sa.submission_id = s.id
          LEFT JOIN (
            SELECT sm.submission_id, sm.value
            FROM submission_metadata sm
            INNER JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
          ) sm ON s.id = sm.submission_id
          LEFT JOIN users csr_user ON sm.value IS NOT NULL AND CAST(sm.value AS UNSIGNED) = csr_user.id
        WHERE 
          s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}
          AND s.status IN ('SUBMITTED', 'FINALIZED')
          AND sa.question_id IN (${Prisma.join(questionIds)})
          ${answerExtraWhere}
      `);

      const questionsByKey: Record<string, any> = {};
      questionRows.forEach((row: any) => {
        const key = `${row.question_text}||${row.category_name}`;
        if (!questionsByKey[key]) {
          questionsByKey[key] = {
            question_ids: [row.question_id],
            question_text: row.question_text,
            category_id: row.category_id,
            category_name: row.category_name,
            weight: row.weight,
            question_type: row.question_type,
            yes_value: row.yes_value,
            no_value: row.no_value,
            na_value: row.na_value,
            scale_max: row.scale_max,
            radioOptions: []
          };
        } else {
          if (!questionsByKey[key].question_ids.includes(row.question_id)) {
            questionsByKey[key].question_ids.push(row.question_id);
          }
        }

        const options = radioOptionsMap[row.question_id] || [];
        questionsByKey[key].radioOptions.push(...options);
      });

      const processedQuestions = Object.values(questionsByKey).map((questionGroup: any) => {
        const questionAnswers = answerRows.filter((a: any) =>
          questionGroup.question_ids.includes(a.question_id)
        );

        const scoresWithMax = questionAnswers.map((answer: any) => {
          const specificQuestion = questionRows.find((q: any) =>
            q.question_id === answer.question_id && q.form_id === answer.form_id
          );

          if (!specificQuestion) {
            console.warn(`[ANALYTICS REPOSITORY] Could not find question ${answer.question_id} for form ${answer.form_id}, using grouped definition`);
          } else {
            console.log(`[ANALYTICS REPOSITORY] Found specific question for answer:`, {
              question_id: specificQuestion.question_id,
              form_id: specificQuestion.form_id,
              question_text: specificQuestion.question_text,
              question_type: specificQuestion.question_type,
              yes_value: specificQuestion.yes_value,
              no_value: specificQuestion.no_value,
              answer: answer.answer
            });
          }

          const answerQuestionOptions = radioOptionsMap[answer.question_id] || [];
          console.log(`[ANALYTICS REPOSITORY] Radio options for question ${answer.question_id}:`, answerQuestionOptions);

          const questionToUse = specificQuestion || questionGroup;
          const score = this.calculateQuestionScore(questionToUse, answer.answer, answerQuestionOptions);
          const maxScore = this.getMaxPossibleScore(questionToUse, answerQuestionOptions);

          console.log(`[ANALYTICS REPOSITORY] Calculated score for answer "${answer.answer}": ${score}, max: ${maxScore}`);

          return { score, maxScore };
        }).filter((item: any) => item.score !== null);

        const totalResponses = questionAnswers.length;
        const validScores = scoresWithMax.filter((s: any) => s.score !== undefined && s.score !== null);

        if (validScores.length === 0) {
          return {
            question_text: questionGroup.question_text,
            category_name: questionGroup.category_name,
            weight: questionGroup.weight,
            question_type: questionGroup.question_type,
            total_responses: totalResponses,
            average_score: null,
            perfect_scores: 0,
            min_score: null,
            max_score: null,
            score_std_dev: null
          };
        }

        const percentages = validScores.map((item: any) =>
          item.maxScore > 0 && item.score !== null ? (item.score / item.maxScore) * 100 : 0
        );

        const averagePercent = percentages.reduce((sum: number, p: number) => sum + p, 0) / percentages.length;
        const minPercent = Math.min(...percentages);
        const maxPercent = Math.max(...percentages);

        const variance = percentages.reduce((sum: number, p: number) => sum + Math.pow(p - averagePercent, 2), 0) / percentages.length;
        const stdDevPercent = Math.sqrt(variance);

        const perfectScores = percentages.filter((p: number) => p === 100).length;

        return {
          question_ids: questionGroup.question_ids,
          question_id: questionGroup.question_ids[0],
          question_text: questionGroup.question_text,
          category_name: questionGroup.category_name,
          weight: questionGroup.weight,
          question_type: questionGroup.question_type,
          total_responses: totalResponses,
          average_score: Math.round(averagePercent * 100) / 100,
          perfect_scores: perfectScores,
          min_score: Math.round(minPercent * 100) / 100,
          max_score: Math.round(maxPercent * 100) / 100,
          score_std_dev: Math.round(stdDevPercent * 100) / 100
        };
      });

      const validQuestions = processedQuestions.filter((q: any) => q.average_score !== null);
      const overallAverage = validQuestions.length > 0
        ? validQuestions.reduce((sum: number, q: any) => sum + q.average_score, 0) / validQuestions.length
        : null;

      const highestPerformingQuestion = validQuestions.length > 0
        ? validQuestions.reduce((max: any, q: any) => q.average_score > max.average_score ? q : max)
        : null;

      const lowestPerformingQuestion = validQuestions.length > 0
        ? validQuestions.reduce((min: any, q: any) => q.average_score < min.average_score ? q : min)
        : null;

      return {
        questions: processedQuestions,
        summary: {
          totalQuestions: processedQuestions.length,
          averageScore: overallAverage ? Math.round(overallAverage * 100) / 100 : null,
          highestPerformingQuestion,
          lowestPerformingQuestion,
          note: "Question-level scores calculated from individual submission answers. Questions with the same text from different forms are aggregated."
        }
      };
    } catch (error) {
      console.error('Error fetching question-level analytics:', error);
      throw new Error('Failed to fetch question-level analytics');
    }
  }

  /**
   * Calculate score for a single question answer
   */
  private calculateQuestionScore(question: any, answer: string, radioOptions: any[]): number | null {
    if (!answer) return 0;

    const questionType = question.question_type.toLowerCase();
    const answerLower = answer.toLowerCase();

    switch (questionType) {
      case 'yes_no':
        if (answerLower === 'yes' || answer === 'true') {
          return question.yes_value !== undefined ? Number(question.yes_value) : 0;
        } else if (answerLower === 'no' || answer === 'false') {
          return question.no_value !== undefined ? Number(question.no_value) : 0;
        } else if (answerLower === 'n/a' || answerLower === 'na') {
          return question.na_value !== undefined ? Number(question.na_value) : 0;
        }
        return 0;

      case 'scale': {
        const numericAnswer = parseInt(answer, 10);
        return !isNaN(numericAnswer) ? numericAnswer : 0;
      }

      case 'radio':
        if (radioOptions.length > 0) {
          const selectedOption = radioOptions.find((opt: any) =>
            opt.option_value === answer || opt.option_text === answer
          );
          return selectedOption?.score || 0;
        }
        return 0;

      case 'text':
      case 'info_block':
      case 'sub_category':
        return null;

      default:
        return 0;
    }
  }

  /**
   * Get maximum possible score for a question
   */
  private getMaxPossibleScore(question: any, radioOptions: any[]): number {
    const questionType = question.question_type.toLowerCase();

    switch (questionType) {
      case 'yes_no':
        return question.yes_value !== undefined ? Number(question.yes_value) : 0;

      case 'scale':
        return question.scale_max || 5;

      case 'radio':
        if (radioOptions.length > 0) {
          return Math.max(...radioOptions.map((opt: any) => opt.score || 0));
        }
        return 0;

      default:
        return 0;
    }
  }

  /**
   * Get category-level analytics
   */
  async getCategoryLevelAnalytics(filters: any): Promise<any> {
    try {
      console.log('[ANALYTICS REPOSITORY] getCategoryLevelAnalytics called with filters:', filters);

      const categoryConditions: Prisma.Sql[] = [
        Prisma.sql`fc.weight > 0`,
        Prisma.sql`fq.question_type != 'SUB_CATEGORY'`,
        Prisma.sql`fq.question_type != 'TEXT'`,
        Prisma.sql`NOT (fq.question_type = 'YES_NO' AND fq.yes_value = 0)`,
        Prisma.sql`NOT (
          fq.question_type = 'RADIO' 
          AND NOT EXISTS (
            SELECT 1 FROM radio_options ro 
            WHERE ro.question_id = fq.id AND ro.score > 0
          )
        )`
      ];

      if ('formIds' in filters && filters.formIds && filters.formIds.length > 0) {
        if (filters.formIds.length === 1) {
          categoryConditions.push(Prisma.sql`fc.form_id = ${filters.formIds[0]}`);
        } else {
          categoryConditions.push(Prisma.sql`fc.form_id IN (${Prisma.join(filters.formIds)})`);
        }
      } else if ('form_id' in filters && filters.form_id) {
        categoryConditions.push(Prisma.sql`fc.form_id = ${filters.form_id}`);
      }

      if (filters.categoryIds && filters.categoryIds.length > 0) {
        categoryConditions.push(Prisma.sql`fc.id IN (${Prisma.join(filters.categoryIds)})`);
      } else if (filters.category_id) {
        categoryConditions.push(Prisma.sql`fc.id = ${filters.category_id}`);
      }

      const categoryWhere = Prisma.sql`WHERE ${Prisma.join(categoryConditions, ' AND ')}`;

      const categoryRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT 
          fc.id AS category_id,
          fc.category_name,
          fc.weight AS category_weight,
          fc.form_id,
          fq.id AS question_id,
          fq.question_text,
          fq.question_type,
          fq.weight AS question_weight,
          fq.yes_value,
          fq.no_value,
          fq.na_value,
          fq.scale_max
        FROM 
          form_categories fc
          INNER JOIN form_questions fq ON fc.id = fq.category_id
        ${categoryWhere}
        ORDER BY fc.category_name, fq.sort_order
      `);

      console.log(`[ANALYTICS REPOSITORY] Found ${categoryRows.length} category-question combinations`);

      if (categoryRows.length === 0) {
        return {
          categories: [],
          summary: {
            totalCategories: 0,
            averageScore: null,
            highestPerformingCategory: null,
            lowestPerformingCategory: null,
            note: "No valid questions found for the selected categories after filtering."
          }
        };
      }

      const questionIds = categoryRows.map((q: any) => q.question_id) as number[];

      const radioRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT id, question_id, option_text, option_value, score, sort_order 
        FROM radio_options 
        WHERE question_id IN (${Prisma.join(questionIds)}) 
        ORDER BY question_id, sort_order
      `);

      const radioOptionsMap: Record<number, any[]> = {};
      radioRows.forEach((option: any) => {
        if (!radioOptionsMap[option.question_id]) {
          radioOptionsMap[option.question_id] = [];
        }
        radioOptionsMap[option.question_id].push(option);
      });

      const endDateWithTime = `${filters.end_date} 23:59:59`;

      const answerConditions: Prisma.Sql[] = [];

      if ('csrIds' in filters && Array.isArray(filters.csrIds) && filters.csrIds.length > 0) {
        answerConditions.push(Prisma.sql`AND (CAST(sm.value AS UNSIGNED) IN (${Prisma.join(filters.csrIds)}) OR sm.value IS NULL)`);
      }

      if ('departmentIds' in filters && filters.departmentIds && filters.departmentIds.length > 0) {
        answerConditions.push(Prisma.sql`AND (csr_user.department_id IN (${Prisma.join(filters.departmentIds)}) OR csr_user.department_id IS NULL)`);
      } else if ('department_id' in filters && filters.department_id) {
        answerConditions.push(Prisma.sql`AND (csr_user.department_id = ${filters.department_id} OR csr_user.department_id IS NULL)`);
      }

      if ('formIds' in filters && Array.isArray(filters.formIds) && filters.formIds.length > 0) {
        answerConditions.push(Prisma.sql`AND s.form_id IN (${Prisma.join(filters.formIds)})`);
      } else if ('form_id' in filters && filters.form_id) {
        answerConditions.push(Prisma.sql`AND s.form_id = ${filters.form_id}`);
      }

      const answerExtraWhere = answerConditions.length > 0 ? Prisma.join(answerConditions, ' ') : Prisma.sql``;

      let answerRows: any[] = [];
      if (questionIds.length > 0) {
        answerRows = await prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT 
            sa.question_id,
            sa.answer,
            s.submitted_at,
            s.id AS submission_id
          FROM 
            submission_answers sa
            INNER JOIN submissions s ON sa.submission_id = s.id
            LEFT JOIN (
              SELECT sm.submission_id, sm.value
              FROM submission_metadata sm
              INNER JOIN form_metadata_fields fmf ON sm.field_id = fmf.id AND fmf.field_name = 'CSR'
            ) sm ON s.id = sm.submission_id
            LEFT JOIN users csr_user ON sm.value IS NOT NULL AND CAST(sm.value AS UNSIGNED) = csr_user.id
          WHERE 
            s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}
            AND s.status IN ('SUBMITTED', 'FINALIZED')
            AND sa.question_id IN (${Prisma.join(questionIds)})
            ${answerExtraWhere}
        `);
      }

      console.log(`[ANALYTICS REPOSITORY] Found ${answerRows.length} submission answers`);

      const categoriesByName: Record<string, any> = {};
      categoryRows.forEach((row: any) => {
        if (!categoriesByName[row.category_name]) {
          categoriesByName[row.category_name] = {
            category_ids: [row.category_id],
            category_name: row.category_name,
            category_weight: row.category_weight,
            form_ids: [row.form_id],
            questions: []
          };
        } else {
          if (!categoriesByName[row.category_name].category_ids.includes(row.category_id)) {
            categoriesByName[row.category_name].category_ids.push(row.category_id);
          }
          if (!categoriesByName[row.category_name].form_ids.includes(row.form_id)) {
            categoriesByName[row.category_name].form_ids.push(row.form_id);
          }
        }

        const questionExists = categoriesByName[row.category_name].questions.some(
          (q: any) => q.question_text === row.question_text
        );

        if (!questionExists) {
          categoriesByName[row.category_name].questions.push({
            question_id: row.question_id,
            question_text: row.question_text,
            question_type: row.question_type,
            question_weight: row.question_weight,
            yes_value: row.yes_value,
            no_value: row.no_value,
            na_value: row.na_value,
            scale_max: row.scale_max
          });
        }
      });

      const processedCategories = Object.values(categoriesByName).map((category: any) => {
        const categoryAnswers = answerRows.filter((a: any) =>
          category.questions.some((q: any) => {
            const originalQuestion = categoryRows.find((cr: any) =>
              cr.question_id === a.question_id &&
              category.category_ids.includes(cr.category_id)
            );
            return originalQuestion && q.question_text === originalQuestion.question_text;
          })
        );

        const submissionMap: Record<number, any[]> = {};
        categoryAnswers.forEach((answer: any) => {
          if (!submissionMap[answer.submission_id]) {
            submissionMap[answer.submission_id] = [];
          }
          submissionMap[answer.submission_id].push(answer);
        });

        const submissionCategoryScores: number[] = [];
        let totalResponses = 0;

        Object.entries(submissionMap).forEach(([, answers]) => {
          let submissionPoints = 0;
          let submissionMaxPoints = 0;

          answers.forEach((answer) => {
            const question = categoryRows.find((cr: any) =>
              cr.question_id === answer.question_id &&
              category.category_ids.includes(cr.category_id)
            );
            if (!question) return;

            const score = this.calculateQuestionScore(question, answer.answer, radioOptionsMap[answer.question_id] || []);
            if (score !== null) {
              submissionPoints += score;
              const maxScore = this.getMaxPossibleScore(question, radioOptionsMap[answer.question_id] || []);
              submissionMaxPoints += maxScore;
              totalResponses++;
            }
          });

          if (submissionMaxPoints > 0) {
            const categoryPercentage = (submissionPoints / submissionMaxPoints) * 100;
            submissionCategoryScores.push(categoryPercentage);
          } else if (answers.length > 0) {
            submissionCategoryScores.push(0);
          }
        });

        if (submissionCategoryScores.length === 0) {
          return {
            category_ids: category.category_ids,
            category_name: category.category_name,
            category_weight: category.category_weight,
            total_questions: category.questions.length,
            total_responses: totalResponses,
            total_submissions: 0,
            average_score: null,
            min_score: null,
            max_score: null,
            median_score: null,
            category_percentage: null
          };
        }

        const sortedScores = submissionCategoryScores.sort((a, b) => a - b);
        const averageScore = submissionCategoryScores.reduce((sum, score) => sum + score, 0) / submissionCategoryScores.length;
        const minScore = sortedScores[0];
        const maxScore = sortedScores[sortedScores.length - 1];

        let medianScore: number;
        if (sortedScores.length % 2 === 0) {
          medianScore = (sortedScores[sortedScores.length / 2 - 1] + sortedScores[sortedScores.length / 2]) / 2;
        } else {
          medianScore = sortedScores[Math.floor(sortedScores.length / 2)];
        }

        return {
          category_ids: category.category_ids,
          category_name: category.category_name,
          category_weight: category.category_weight,
          total_questions: category.questions.length,
          total_responses: totalResponses,
          total_submissions: submissionCategoryScores.length,
          average_score: Math.round(averageScore * 100) / 100,
          min_score: Math.round(minScore * 100) / 100,
          max_score: Math.round(maxScore * 100) / 100,
          median_score: Math.round(medianScore * 100) / 100,
          category_percentage: Math.round(averageScore * 100) / 100
        };
      });

      const validCategories = processedCategories.filter((c: any) => c.average_score !== null);
      const overallAverage = validCategories.length > 0
        ? validCategories.reduce((sum: number, c: any) => sum + c.average_score, 0) / validCategories.length
        : null;

      const highestPerformingCategory = validCategories.length > 0
        ? validCategories.reduce((max: any, c: any) => c.average_score > max.average_score ? c : max)
        : null;

      const lowestPerformingCategory = validCategories.length > 0
        ? validCategories.reduce((min: any, c: any) => c.average_score < min.average_score ? c : min)
        : null;

      const result = {
        categories: processedCategories,
        summary: {
          totalCategories: processedCategories.length,
          averageScore: overallAverage ? Math.round(overallAverage * 100) / 100 : null,
          highestPerformingCategory,
          lowestPerformingCategory,
          note: "Category-level scores calculated from per-submission category scores. Categories with the same name from different forms are aggregated."
        }
      };

      console.log('[ANALYTICS REPOSITORY] Category level analytics result:', result);
      return result;
    } catch (error) {
      console.error('Error fetching category-level analytics:', error);
      throw new Error('Failed to fetch category-level analytics');
    }
  }
}
