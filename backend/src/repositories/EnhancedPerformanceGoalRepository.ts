import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import {
  EnhancedPerformanceGoal,
  PerformanceGoalUser,
  PerformanceGoalDepartment,
  CreatePerformanceGoalData,
  UpdatePerformanceGoalData,
  PerformanceGoalFilters,
  PaginatedPerformanceGoalResponse,
  PerformanceGoalServiceError,
  FormOption,
  CategoryOption,
  QuestionOption
} from '../types/performanceGoal.types';
import logger from '../config/logger';

/**
 * Enhanced MySQL Performance Goal Repository
 * Handles all database operations for enhanced performance goals with individual targeting
 */
export class EnhancedPerformanceGoalRepository {

  /**
   * Create performance goal with enhanced targeting support
   */
  async create(goalData: CreatePerformanceGoalData, created_by: number): Promise<EnhancedPerformanceGoal> {
    try {
      logger.info('[ENHANCED PERF GOAL REPO] Creating goal with data:', {
        ...goalData,
        user_ids: goalData.user_ids || [],
        department_ids: goalData.department_ids || []
      });

      const goal_id = await prisma.$transaction(async (tx) => {
        const goal = await tx.performanceGoal.create({
          data: {
            goal_type: goalData.goal_type,
            target_value: goalData.target_value,
            scope: goalData.scope,
            start_date: goalData.start_date,
            end_date: goalData.end_date,
            target_scope: goalData.target_scope,
            target_form_id: goalData.target_form_id,
            target_category_id: goalData.target_category_id,
            target_question_id: goalData.target_question_id,
            description: goalData.description,
            created_by: created_by,
            is_active: true
          },
          select: { id: true }
        });

        logger.info('[ENHANCED PERF GOAL REPO] Created goal with ID:', goal.id);

        if (goalData.user_ids && goalData.user_ids.length > 0) {
          logger.info('[ENHANCED PERF GOAL REPO] Creating user assignments for:', goalData.user_ids);
          await tx.performanceGoalUser.createMany({
            data: goalData.user_ids.map(user_id => ({
              goal_id: goal.id,
              user_id: user_id,
              assigned_by: created_by
            }))
          });
          logger.info('[ENHANCED PERF GOAL REPO] User assignments created');
        }

        if (goalData.department_ids && goalData.department_ids.length > 0) {
          logger.info('[ENHANCED PERF GOAL REPO] Creating department assignments for:', goalData.department_ids);
          await tx.performanceGoalDepartment.createMany({
            data: goalData.department_ids.map(deptId => ({
              goal_id: goal.id,
              department_id: deptId,
              assigned_by: created_by
            }))
          });
          logger.info('[ENHANCED PERF GOAL REPO] Department assignments created');
        }

        return goal.id;
      });

      logger.info('[ENHANCED PERF GOAL REPO] Transaction committed successfully');

      const createdGoal = await this.findById(goal_id);
      if (!createdGoal) {
        throw new PerformanceGoalServiceError('Failed to retrieve created goal', 'CREATE_ERROR', 500);
      }

      logger.info('[ENHANCED PERF GOAL REPO] Retrieved created goal:', {
        id: createdGoal.id,
        assigned_users: createdGoal.assigned_users?.length || 0,
        assigned_departments: createdGoal.assigned_departments?.length || 0
      });

      return createdGoal;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Find goal by ID with all related data
   */
  async findById(id: number): Promise<EnhancedPerformanceGoal | null> {
    logger.info('[ENHANCED PERF GOAL REPO] Finding goal by ID:', id);

    const goalRows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT 
        pg.*,
        f.form_name as target_form_name,
        fc.category_name as target_category_name,
        fq.question_text as target_question_text
      FROM performance_goals pg
      LEFT JOIN forms f ON pg.target_form_id = f.id
      LEFT JOIN form_categories fc ON pg.target_category_id = fc.id
      LEFT JOIN form_questions fq ON pg.target_question_id = fq.id
      WHERE pg.id = ${id}
    `);

    if (goalRows.length === 0) {
      logger.info('[ENHANCED PERF GOAL REPO] Goal not found:', id);
      return null;
    }

    const goal = goalRows[0] as EnhancedPerformanceGoal;
    logger.info('[ENHANCED PERF GOAL REPO] Found goal:', { id: goal.id, scope: goal.scope });

    const userRows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT pgu.*, u.username as user_name, u.email as user_email
      FROM performance_goal_users pgu
      JOIN users u ON pgu.user_id = u.id
      WHERE pgu.goal_id = ${id} AND pgu.is_active = 1
    `);
    goal.assigned_users = userRows as PerformanceGoalUser[];
    logger.info('[ENHANCED PERF GOAL REPO] Found assigned users:', userRows.length);

    const deptRows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT pgd.*, d.department_name
      FROM performance_goal_departments pgd
      JOIN departments d ON pgd.department_id = d.id
      WHERE pgd.goal_id = ${id} AND pgd.is_active = 1
    `);
    goal.assigned_departments = deptRows as PerformanceGoalDepartment[];
    logger.info('[ENHANCED PERF GOAL REPO] Found assigned departments:', deptRows.length);

    return goal;
  }

  /**
   * Get all performance goals with pagination and filtering
   * Using the same proven pattern as UserRepository
   */
  async findAll(
    page: number = 1,
    pageSize: number = 10,
    filters?: PerformanceGoalFilters
  ): Promise<PaginatedPerformanceGoalResponse> {
    try {
      logger.info('[ENHANCED PERF GOAL REPO] Finding goals with filters:', filters);

      const offset = (page - 1) * pageSize;
      const conditions: Prisma.Sql[] = [];

      if (filters?.goal_type !== undefined) {
        conditions.push(Prisma.sql`pg.goal_type = ${filters.goal_type}`);
      }

      if (filters?.scope !== undefined) {
        conditions.push(Prisma.sql`pg.scope = ${filters.scope}`);
      }

      if (filters?.target_scope !== undefined) {
        conditions.push(Prisma.sql`pg.target_scope = ${filters.target_scope}`);
      }

      if (filters?.is_active !== undefined) {
        conditions.push(Prisma.sql`pg.is_active = ${filters.is_active ? 1 : 0}`);
      }

      if (filters?.search) {
        const searchTerm = `%${filters.search}%`;
        conditions.push(
          Prisma.sql`(pg.description LIKE ${searchTerm} OR CAST(pg.target_value AS CHAR) LIKE ${searchTerm})`
        );
      }

      const whereClause = conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
        : Prisma.sql``;

      logger.info('[ENHANCED PERF GOAL REPO] Built WHERE conditions:', conditions.length);

      const countResult = await prisma.$queryRaw<[{ total: bigint }]>(Prisma.sql`
        SELECT COUNT(*) as total
        FROM performance_goals pg
        LEFT JOIN forms f ON pg.target_form_id = f.id
        LEFT JOIN form_categories fc ON pg.target_category_id = fc.id
        LEFT JOIN form_questions fq ON pg.target_question_id = fq.id
        ${whereClause}
      `);
      const total = Number(countResult[0].total);

      const goalRows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT 
          pg.id,
          pg.goal_type,
          pg.target_value,
          pg.scope,
          pg.department_id,
          pg.description,
          pg.created_at,
          pg.is_active,
          pg.created_by,
          pg.updated_by,
          pg.updated_at,
          pg.start_date,
          pg.end_date,
          pg.target_form_id,
          pg.target_category_id,
          pg.target_question_id,
          pg.target_scope,
          f.form_name as target_form_name,
          fc.category_name as target_category_name,
          fq.question_text as target_question_text
        FROM performance_goals pg
        LEFT JOIN forms f ON pg.target_form_id = f.id
        LEFT JOIN form_categories fc ON pg.target_category_id = fc.id
        LEFT JOIN form_questions fq ON pg.target_question_id = fq.id
        ${whereClause}
        ORDER BY pg.created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `);

      logger.info(`[ENHANCED PERF GOAL REPO] Found ${goalRows.length} goals out of ${total} total`);

      const enhancedGoals: EnhancedPerformanceGoal[] = goalRows.map((row: any) => ({
        id: row.id,
        goal_type: row.goal_type,
        target_value: row.target_value,
        scope: row.scope,
        department_id: row.department_id,
        start_date: row.start_date,
        end_date: row.end_date,
        target_scope: row.target_scope,
        target_form_id: row.target_form_id,
        target_category_id: row.target_category_id,
        target_question_id: row.target_question_id,
        target_form_name: row.target_form_name,
        target_category_name: row.target_category_name,
        target_question_text: row.target_question_text,
        description: row.description,
        is_active: !!row.is_active,
        created_at: row.created_at,
        created_by: row.created_by,
        updated_by: row.updated_by,
        updated_at: row.updated_at,
        assigned_users: [],
        assigned_departments: []
      } as EnhancedPerformanceGoal));

      return {
        data: enhancedGoals,
        total,
        pages: Math.ceil(total / pageSize),
        currentPage: page,
        pageSize
      };
    } catch (error) {
      logger.error('[ENHANCED PERF GOAL REPO] Error in findAll:', error);
      throw new PerformanceGoalServiceError('Database error while fetching performance goals', 'DATABASE_ERROR', 500);
    }
  }

  /**
   * Update performance goal with enhanced features
   */
  async update(id: number, updates: UpdatePerformanceGoalData, updatedBy: number): Promise<EnhancedPerformanceGoal | null> {
    try {
      await prisma.$transaction(async (tx) => {
        const setClauses: Prisma.Sql[] = [];

        if (updates.goal_type !== undefined) setClauses.push(Prisma.sql`goal_type = ${updates.goal_type}`);
        if (updates.target_value !== undefined) setClauses.push(Prisma.sql`target_value = ${updates.target_value}`);
        if (updates.scope !== undefined) setClauses.push(Prisma.sql`scope = ${updates.scope}`);
        if (updates.start_date !== undefined) setClauses.push(Prisma.sql`start_date = ${updates.start_date}`);
        if (updates.end_date !== undefined) setClauses.push(Prisma.sql`end_date = ${updates.end_date}`);
        if (updates.target_scope !== undefined) setClauses.push(Prisma.sql`target_scope = ${updates.target_scope}`);
        if (updates.target_form_id !== undefined) setClauses.push(Prisma.sql`target_form_id = ${updates.target_form_id}`);
        if (updates.target_category_id !== undefined) setClauses.push(Prisma.sql`target_category_id = ${updates.target_category_id}`);
        if (updates.target_question_id !== undefined) setClauses.push(Prisma.sql`target_question_id = ${updates.target_question_id}`);
        if (updates.description !== undefined) setClauses.push(Prisma.sql`description = ${updates.description}`);
        if (updates.is_active !== undefined) setClauses.push(Prisma.sql`is_active = ${updates.is_active ? 1 : 0}`);

        if (setClauses.length > 0) {
          setClauses.push(Prisma.sql`updated_by = ${updatedBy}`, Prisma.sql`updated_at = NOW()`);
          await tx.$executeRaw(
            Prisma.sql`UPDATE performance_goals SET ${Prisma.join(setClauses, ', ')} WHERE id = ${id}`
          );
        }

        if (updates.user_ids !== undefined) {
          await tx.$executeRaw(
            Prisma.sql`UPDATE performance_goal_users SET is_active = 0 WHERE goal_id = ${id}`
          );

          if (updates.user_ids.length > 0) {
            const userValues = Prisma.join(
              updates.user_ids.map(user_id => Prisma.sql`(${id}, ${user_id}, ${updatedBy})`),
              ', '
            );
            await tx.$executeRaw(Prisma.sql`
              INSERT INTO performance_goal_users (goal_id, user_id, assigned_by)
              VALUES ${userValues}
              ON DUPLICATE KEY UPDATE is_active = 1, assigned_by = VALUES(assigned_by), assigned_at = NOW()
            `);
          }
        }

        if (updates.department_ids !== undefined) {
          await tx.$executeRaw(
            Prisma.sql`UPDATE performance_goal_departments SET is_active = 0 WHERE goal_id = ${id}`
          );

          if (updates.department_ids.length > 0) {
            const deptValues = Prisma.join(
              updates.department_ids.map(deptId => Prisma.sql`(${id}, ${deptId}, ${updatedBy})`),
              ', '
            );
            await tx.$executeRaw(Prisma.sql`
              INSERT INTO performance_goal_departments (goal_id, department_id, assigned_by)
              VALUES ${deptValues}
              ON DUPLICATE KEY UPDATE is_active = 1, assigned_by = VALUES(assigned_by), assigned_at = NOW()
            `);
          }
        }
      });

      return await this.findById(id);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Delete (deactivate) performance goal
   */
  async delete(id: number, deletedBy: number): Promise<boolean> {
    const result = await prisma.$executeRaw(Prisma.sql`
      UPDATE performance_goals
      SET is_active = 0, updated_by = ${deletedBy}, updated_at = NOW()
      WHERE id = ${id}
    `);
    return result > 0;
  }

  /**
   * Activate performance goal
   */
  async activate(id: number, activatedBy: number): Promise<boolean> {
    const result = await prisma.$executeRaw(Prisma.sql`
      UPDATE performance_goals
      SET is_active = 1, updated_by = ${activatedBy}, updated_at = NOW()
      WHERE id = ${id}
    `);
    return result > 0;
  }

  /**
   * Get forms with categories and questions for targeting
   */
  async getFormOptions(): Promise<FormOption[]> {
    const formRows = await prisma.$queryRaw<Array<{ id: number; form_name: string }>>(Prisma.sql`
      SELECT id, form_name
      FROM forms
      WHERE is_active = 1
      ORDER BY form_name
    `);

    const forms: FormOption[] = [];

    for (const form of formRows) {
      const categoryRows = await prisma.$queryRaw<Array<{ id: number; category_name: string }>>(Prisma.sql`
        SELECT id, category_name
        FROM form_categories
        WHERE form_id = ${form.id} AND weight > 0
        ORDER BY sort_order, category_name
      `);

      const categories: CategoryOption[] = [];

      for (const category of categoryRows) {
        const questionRows = await prisma.$queryRaw<Array<{ id: number; question_text: string }>>(Prisma.sql`
          SELECT id, question_text
          FROM form_questions
          WHERE category_id = ${category.id}
          ORDER BY sort_order, question_text
        `);

        const questions: QuestionOption[] = questionRows.map(q => ({
          id: q.id,
          question_text: q.question_text,
          category_id: category.id
        }));

        categories.push({
          id: category.id,
          category_name: category.category_name,
          form_id: form.id,
          questions
        });
      }

      forms.push({
        id: form.id,
        form_name: form.form_name,
        categories
      });
    }

    return forms;
  }

  /**
   * Get active goals for a specific user within date range
   */
  async getActiveGoalsForUser(user_id: number, asOfDate: string = new Date().toISOString().split('T')[0]): Promise<EnhancedPerformanceGoal[]> {
    const filters: PerformanceGoalFilters = {
      is_active: true,
      user_id: user_id,
      start_date: asOfDate,
      end_date: asOfDate
    };

    const result = await this.findAll(1, 1000, filters);
    return result.data;
  }

  /**
   * Calculate performance for enhanced goals
   */
  async calculatePerformance(
    goal: EnhancedPerformanceGoal,
    dateRange: { start: string; end: string },
    user_id?: number
  ): Promise<number> {
    // Add user filtering if specific user provided
    if (user_id && goal.scope !== 'GLOBAL') {
      // This would need to be enhanced based on how submissions link to users
      // For now, we'll use a placeholder implementation
    }

    switch (goal.target_scope) {
      case 'ALL_QA': {
        const rows = await prisma.$queryRaw<[{ avg_score: number | null }]>(Prisma.sql`
          SELECT AVG(s.total_score) as avg_score
          FROM submissions s
          WHERE s.status = 'SUBMITTED'
            AND s.total_score IS NOT NULL
            AND DATE(s.submitted_at) BETWEEN ${dateRange.start} AND ${dateRange.end}
        `);
        return rows[0]?.avg_score || 0;
      }

      case 'FORM': {
        const rows = await prisma.$queryRaw<[{ avg_score: number | null }]>(Prisma.sql`
          SELECT AVG(s.total_score) as avg_score
          FROM submissions s
          WHERE s.form_id = ${goal.target_form_id}
            AND s.status = 'SUBMITTED'
            AND s.total_score IS NOT NULL
            AND DATE(s.submitted_at) BETWEEN ${dateRange.start} AND ${dateRange.end}
        `);
        return rows[0]?.avg_score || 0;
      }

      case 'CATEGORY': {
        // Category-specific performance calculation would require complex aggregation
        // This is a simplified version - actual implementation would need weighted scores
        const rows = await prisma.$queryRaw<[{ avg_score: number | null }]>(Prisma.sql`
          SELECT AVG(s.total_score) as avg_score
          FROM submissions s
          JOIN forms f ON s.form_id = f.id
          JOIN form_categories fc ON f.id = fc.form_id
          WHERE fc.id = ${goal.target_category_id}
            AND s.status = 'SUBMITTED'
            AND s.total_score IS NOT NULL
            AND DATE(s.submitted_at) BETWEEN ${dateRange.start} AND ${dateRange.end}
        `);
        return rows[0]?.avg_score || 0;
      }

      case 'QUESTION': {
        // Question-specific performance calculation
        const rows = await prisma.$queryRaw<[{ avg_score: number | null }]>(Prisma.sql`
          SELECT AVG(
            CASE
              WHEN sa.answer = 'yes' THEN fq.yes_value
              WHEN sa.answer = 'no' THEN fq.no_value
              WHEN sa.answer = 'n/a' THEN fq.na_value
              ELSE 0
            END
          ) as avg_score
          FROM submission_answers sa
          JOIN form_questions fq ON sa.question_id = fq.id
          JOIN submissions s ON sa.submission_id = s.id
          WHERE fq.id = ${goal.target_question_id}
            AND s.status = 'SUBMITTED'
            AND DATE(s.submitted_at) BETWEEN ${dateRange.start} AND ${dateRange.end}
        `);
        return rows[0]?.avg_score || 0;
      }

      default:
        return 0;
    }
  }

  /**
   * Validate form/category/question references
   */
  async validateTargetReferences(
    target_form_id?: number | null,
    target_category_id?: number | null,
    target_question_id?: number | null
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (target_form_id) {
      const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT id FROM forms WHERE id = ${target_form_id} AND is_active = 1
      `);
      if (rows.length === 0) {
        errors.push('Invalid form ID or form is not active');
      }
    }

    if (target_category_id) {
      if (target_form_id) {
        const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT id FROM form_categories WHERE id = ${target_category_id} AND form_id = ${target_form_id}
        `);
        if (rows.length === 0) {
          errors.push('Invalid category ID or category does not belong to specified form');
        }
      } else {
        const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT id FROM form_categories WHERE id = ${target_category_id}
        `);
        if (rows.length === 0) {
          errors.push('Invalid category ID or category does not belong to specified form');
        }
      }
    }

    if (target_question_id) {
      if (target_category_id) {
        const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT id FROM form_questions WHERE id = ${target_question_id} AND category_id = ${target_category_id}
        `);
        if (rows.length === 0) {
          errors.push('Invalid question ID or question does not belong to specified category');
        }
      } else {
        const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT id FROM form_questions WHERE id = ${target_question_id}
        `);
        if (rows.length === 0) {
          errors.push('Invalid question ID or question does not belong to specified category');
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
