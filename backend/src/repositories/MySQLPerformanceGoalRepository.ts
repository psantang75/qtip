/**
 * MySQLPerformanceGoalRepository - Data access layer for performance goals using Prisma
 */

import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import { 
  PerformanceGoal, 
  PerformanceGoalWithDetails,
  goal_type, 
  GoalScope 
} from '../types/performanceGoal.types';
import { 
  PerformanceGoalFilters,
  PaginatedPerformanceGoalResponse,
  PerformanceGoalCreateRequest,
  PerformanceGoalUpdateRequest,
  PerformanceCalculationFilters
} from '../services/PerformanceGoalService';

export class MySQLPerformanceGoalRepository {

  /**
   * Find all performance goals with pagination and filtering
   */
  async findAll(page: number, pageSize: number, filters?: PerformanceGoalFilters): Promise<PaginatedPerformanceGoalResponse> {
    try {
      const conditions: Prisma.Sql[] = [];

      if (filters?.goal_type) {
        conditions.push(Prisma.sql`pg.goal_type = ${filters.goal_type}`);
      }

      if (filters?.department_id) {
        conditions.push(Prisma.sql`pg.department_id = ${Number(filters.department_id)}`);
      }

      if (filters?.is_active !== undefined) {
        const isActiveValue = filters.is_active ? 1 : 0;
        console.log('[NEW PERF] Repository: Adding is_active filter:', filters.is_active, '->', isActiveValue);
        conditions.push(Prisma.sql`pg.is_active = ${isActiveValue}`);
      }

      if (filters?.scope) {
        conditions.push(Prisma.sql`pg.scope = ${filters.scope}`);
      }

      const whereClause = conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
        : Prisma.sql`WHERE 1=1`;

      console.log('[NEW PERF] Repository: Executing count query');
      const countResult = await prisma.$queryRaw<[{ total: bigint }]>(
        Prisma.sql`SELECT COUNT(*) as total FROM performance_goals pg ${whereClause}`
      );
      const total = Number(countResult[0]?.total || 0);
      console.log('[NEW PERF] Repository: Count query result:', total);

      const offset = (page - 1) * pageSize;
      console.log('[NEW PERF] Repository: Executing data query');
      const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT 
          pg.id,
          pg.goal_type,
          pg.target_value,
          pg.scope,
          pg.department_id,
          pg.description,
          pg.created_at,
          pg.is_active,
          pg.start_date,
          pg.end_date,
          pg.target_scope,
          pg.target_form_id,
          pg.target_category_id,
          pg.target_question_id
        FROM performance_goals pg
        ${whereClause}
        ORDER BY pg.created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `);

      const departmentIds = [
        ...new Set(rows.map((row: any) => row.department_id).filter((id: any) => id !== null))
      ] as number[];
      let departmentMap: { [key: number]: string } = {};

      if (departmentIds.length > 0) {
        const deptRows = await prisma.$queryRaw<Array<{ id: number; department_name: string }>>(
          Prisma.sql`SELECT id, department_name FROM departments WHERE id IN (${Prisma.join(departmentIds)})`
        );
        departmentMap = deptRows.reduce((acc, dept) => {
          acc[dept.id] = dept.department_name;
          return acc;
        }, {} as { [key: number]: string });
      }

      const data = rows.map((row: any) => ({
        id: row.id,
        goal_type: row.goal_type,
        target_value: row.target_value,
        scope: row.scope,
        department_id: row.department_id,
        department_name: row.department_id ? (departmentMap[row.department_id] || '') : '',
        description: row.description || null,
        is_active: row.is_active,
        created_by: null,
        created_by_username: null,
        updated_by: null,
        updated_by_username: null,
        created_at: row.created_at,
        updated_at: null,
        start_date: row.start_date,
        end_date: row.end_date,
        target_scope: row.target_scope,
        target_form_id: row.target_form_id,
        target_category_id: row.target_category_id,
        target_question_id: row.target_question_id
      })) as PerformanceGoalWithDetails[];

      console.log('[NEW PERF] Repository: Query successful, returning', data.length, 'records');
      return { data, total, page, pageSize };
    } catch (error) {
      console.error('[NEW PERF] Repository: Error in findAll:', error);
      throw new Error('Failed to fetch performance goals');
    }
  }

  /**
   * Find performance goal by ID with details
   */
  async findById(id: number): Promise<PerformanceGoalWithDetails | null> {
    try {
      const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
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
          pg.target_scope,
          pg.target_form_id,
          pg.target_category_id,
          pg.target_question_id,
          d.department_name,
          cu.username as created_by_username,
          uu.username as updated_by_username
        FROM performance_goals pg
        LEFT JOIN departments d ON pg.department_id = d.id
        LEFT JOIN users cu ON pg.created_by = cu.id
        LEFT JOIN users uu ON pg.updated_by = uu.id
        WHERE pg.id = ${id}
      `);

      if (rows.length === 0) return null;

      const row = rows[0];
      return {
        id: row.id,
        goal_type: row.goal_type,
        target_value: row.target_value,
        scope: row.scope,
        department_id: row.department_id,
        department_name: row.department_name || '',
        description: row.description || null,
        is_active: row.is_active,
        created_by: row.created_by || null,
        created_by_username: row.created_by_username || null,
        updated_by: row.updated_by || null,
        updated_by_username: row.updated_by_username || null,
        created_at: row.created_at,
        updated_at: row.updated_at || null,
        start_date: row.start_date,
        end_date: row.end_date,
        target_scope: row.target_scope,
        target_form_id: row.target_form_id,
        target_category_id: row.target_category_id,
        target_question_id: row.target_question_id
      } as PerformanceGoalWithDetails;
    } catch (error) {
      console.error('Error fetching performance goal by ID:', error);
      throw new Error('Failed to fetch performance goal');
    }
  }

  /**
   * Find active performance goals
   */
  async findActiveGoals(department_id?: number): Promise<PerformanceGoal[]> {
    try {
      const conditions: Prisma.Sql[] = [Prisma.sql`is_active = 1`];

      if (department_id) {
        conditions.push(
          Prisma.sql`(scope = 'GLOBAL' OR (scope = 'DEPARTMENT' AND department_id = ${department_id}))`
        );
      }

      const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

      const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT 
          id, goal_type, target_value, scope, department_id,
          description, created_at, is_active, created_by, updated_by, updated_at
        FROM performance_goals
        ${whereClause}
        ORDER BY created_at DESC
      `);

      return rows.map((row: any) => ({
        id: row.id,
        goal_type: row.goal_type,
        target_value: row.target_value,
        scope: row.scope,
        department_id: row.department_id,
        description: row.description || null,
        is_active: row.is_active,
        created_by: row.created_by || null,
        updated_by: row.updated_by || null,
        created_at: row.created_at,
        updated_at: row.updated_at || null
      })) as PerformanceGoal[];
    } catch (error) {
      console.error('Error fetching active goals:', error);
      throw new Error('Failed to fetch active goals');
    }
  }

  /**
   * Find conflicting goal (same type and scope)
   */
  async findConflictingGoal(
    goal_type: goal_type,
    scope: GoalScope,
    department_id?: number | null,
    excludeId?: number
  ): Promise<PerformanceGoal | null> {
    try {
      const conditions: Prisma.Sql[] = [
        Prisma.sql`goal_type = ${goal_type}`,
        Prisma.sql`scope = ${scope}`,
        Prisma.sql`is_active = 1`
      ];

      if (scope === 'DEPARTMENT' && department_id) {
        conditions.push(Prisma.sql`department_id = ${department_id}`);
      }

      if (excludeId) {
        conditions.push(Prisma.sql`id != ${excludeId}`);
      }

      const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

      const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT 
          id, goal_type, target_value, scope, department_id,
          description, created_at, is_active, created_by, updated_by, updated_at
        FROM performance_goals
        ${whereClause}
      `);

      if (rows.length === 0) return null;

      const row = rows[0];
      return {
        id: row.id,
        goal_type: row.goal_type,
        target_value: row.target_value,
        scope: row.scope,
        department_id: row.department_id,
        description: row.description || null,
        is_active: row.is_active,
        created_by: row.created_by || null,
        updated_by: row.updated_by || null,
        created_at: row.created_at,
        updated_at: row.updated_at || null
      } as PerformanceGoal;
    } catch (error) {
      console.error('Error checking for conflicting goal:', error);
      throw new Error('Failed to check for conflicting goal');
    }
  }

  /**
   * Create new performance goal
   */
  async create(goalData: PerformanceGoalCreateRequest, created_by: number): Promise<PerformanceGoalWithDetails> {
    try {
      const newId = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO performance_goals (
            goal_type, target_value, scope, department_id, description,
            is_active, created_by, created_at
          ) VALUES (
            ${goalData.goal_type},
            ${goalData.target_value},
            ${goalData.scope},
            ${goalData.department_id || null},
            ${goalData.description || null},
            ${goalData.is_active !== undefined ? (goalData.is_active ? 1 : 0) : 1},
            ${created_by},
            NOW()
          )
        `);
        const [{ id }] = await tx.$queryRaw<[{ id: number }]>(Prisma.sql`SELECT LAST_INSERT_ID() as id`);
        return id;
      });

      const newGoal = await this.findById(newId);
      if (!newGoal) throw new Error('Failed to retrieve created goal');
      return newGoal;
    } catch (error) {
      console.error('Error creating performance goal:', error);
      throw new Error('Failed to create performance goal');
    }
  }

  /**
   * Update performance goal
   */
  async update(id: number, goalData: PerformanceGoalUpdateRequest, updatedBy: number): Promise<PerformanceGoalWithDetails> {
    try {
      const setClauses: Prisma.Sql[] = [];

      if (goalData.goal_type !== undefined) setClauses.push(Prisma.sql`goal_type = ${goalData.goal_type}`);
      if (goalData.target_value !== undefined) setClauses.push(Prisma.sql`target_value = ${goalData.target_value}`);
      if (goalData.scope !== undefined) setClauses.push(Prisma.sql`scope = ${goalData.scope}`);
      if (goalData.department_id !== undefined) setClauses.push(Prisma.sql`department_id = ${goalData.department_id}`);
      if (goalData.description !== undefined) setClauses.push(Prisma.sql`description = ${goalData.description}`);
      if (goalData.is_active !== undefined) setClauses.push(Prisma.sql`is_active = ${goalData.is_active ? 1 : 0}`);

      setClauses.push(Prisma.sql`updated_by = ${updatedBy}`, Prisma.sql`updated_at = NOW()`);

      await prisma.$executeRaw(
        Prisma.sql`UPDATE performance_goals SET ${Prisma.join(setClauses, ', ')} WHERE id = ${id}`
      );

      const updatedGoal = await this.findById(id);
      if (!updatedGoal) throw new Error('Failed to retrieve updated goal');
      return updatedGoal;
    } catch (error) {
      console.error('Error updating performance goal:', error);
      throw new Error('Failed to update performance goal');
    }
  }

  /**
   * Delete performance goal (soft delete)
   */
  async delete(id: number, deletedBy: number): Promise<void> {
    try {
      await prisma.$executeRaw(Prisma.sql`
        UPDATE performance_goals
        SET is_active = 0, updated_by = ${deletedBy}, updated_at = NOW()
        WHERE id = ${id}
      `);
    } catch (error) {
      console.error('Error deleting performance goal:', error);
      throw new Error('Failed to delete performance goal');
    }
  }

  /**
   * Activate performance goal
   */
  async activate(id: number, activatedBy: number): Promise<void> {
    try {
      await prisma.$executeRaw(Prisma.sql`
        UPDATE performance_goals
        SET is_active = 1, updated_by = ${activatedBy}, updated_at = NOW()
        WHERE id = ${id}
      `);
    } catch (error) {
      console.error('Error activating performance goal:', error);
      throw new Error('Failed to activate performance goal');
    }
  }

  /**
   * Calculate QA Score for performance goal evaluation
   */
  async calculateQAScore(filters: PerformanceCalculationFilters, goalScope: GoalScope, department_id?: number): Promise<number> {
    try {
      const endDateWithTime = `${filters.end_date} 23:59:59`;
      const conditions: Prisma.Sql[] = [
        Prisma.sql`s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}`,
        Prisma.sql`s.status IN (${Prisma.join(['SUBMITTED', 'FINALIZED'])})`
      ];

      if (goalScope === 'DEPARTMENT' && department_id) {
        conditions.push(Prisma.sql`u.department_id = ${department_id}`);
      }

      if (filters.csrIds && filters.csrIds.length > 0) {
        conditions.push(Prisma.sql`c.csr_id IN (${Prisma.join(filters.csrIds)})`);
      }

      const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

      const rows = await prisma.$queryRaw<[{ avg_score: number | null }]>(Prisma.sql`
        SELECT AVG(s.total_score) AS avg_score
        FROM submissions s
        INNER JOIN calls c ON s.call_id = c.id
        INNER JOIN users u ON c.csr_id = u.id
        ${whereClause}
      `);
      return rows[0]?.avg_score || 0;
    } catch (error) {
      console.error('Error calculating QA score:', error);
      return 0;
    }
  }

  /**
   * Calculate Audit Rate for performance goal evaluation
   */
  async calculateAuditRate(filters: PerformanceCalculationFilters, goalScope: GoalScope, department_id?: number): Promise<number> {
    try {
      const endDateWithTime = `${filters.end_date} 23:59:59`;
      const conditions: Prisma.Sql[] = [
        Prisma.sql`s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}`,
        Prisma.sql`s.status IN (${Prisma.join(['SUBMITTED', 'FINALIZED'])})`
      ];

      if (goalScope === 'DEPARTMENT' && department_id) {
        conditions.push(Prisma.sql`u.department_id = ${department_id}`);
      }

      if (filters.csrIds && filters.csrIds.length > 0) {
        conditions.push(Prisma.sql`c.csr_id IN (${Prisma.join(filters.csrIds)})`);
      }

      const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

      const rows = await prisma.$queryRaw<[{ audit_count: bigint; csr_count: bigint }]>(Prisma.sql`
        SELECT
          COUNT(DISTINCT s.id) AS audit_count,
          COUNT(DISTINCT c.csr_id) AS csr_count
        FROM submissions s
        INNER JOIN calls c ON s.call_id = c.id
        INNER JOIN users u ON c.csr_id = u.id
        ${whereClause}
      `);
      const auditCount = Number(rows[0]?.audit_count || 0);
      const csrCount = Number(rows[0]?.csr_count || 1);
      return auditCount / csrCount;
    } catch (error) {
      console.error('Error calculating audit rate:', error);
      return 0;
    }
  }

  /**
   * Calculate Dispute Rate for performance goal evaluation
   */
  async calculateDisputeRate(filters: PerformanceCalculationFilters, goalScope: GoalScope, department_id?: number): Promise<number> {
    try {
      const endDateWithTime = `${filters.end_date} 23:59:59`;
      const conditions: Prisma.Sql[] = [
        Prisma.sql`s.submitted_at BETWEEN ${filters.start_date} AND ${endDateWithTime}`,
        Prisma.sql`s.status IN (${Prisma.join(['SUBMITTED', 'FINALIZED', 'DISPUTED'])})`
      ];

      if (goalScope === 'DEPARTMENT' && department_id) {
        conditions.push(Prisma.sql`u.department_id = ${department_id}`);
      }

      if (filters.csrIds && filters.csrIds.length > 0) {
        conditions.push(Prisma.sql`c.csr_id IN (${Prisma.join(filters.csrIds)})`);
      }

      const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

      const rows = await prisma.$queryRaw<[{ audit_count: bigint; dispute_count: bigint }]>(Prisma.sql`
        SELECT
          COUNT(DISTINCT s.id) AS audit_count,
          COUNT(DISTINCT d.id) AS dispute_count
        FROM submissions s
        INNER JOIN calls c ON s.call_id = c.id
        INNER JOIN users u ON c.csr_id = u.id
        LEFT JOIN disputes d ON s.id = d.submission_id
        ${whereClause}
      `);
      const auditCount = Number(rows[0]?.audit_count || 0);
      const disputeCount = Number(rows[0]?.dispute_count || 0);
      return auditCount > 0 ? (disputeCount / auditCount) * 100 : 0;
    } catch (error) {
      console.error('Error calculating dispute rate:', error);
      return 0;
    }
  }

  /**
   * Get historical data for goal progress tracking
   */
  async getHistoricalData(_goalId: number, _days: number): Promise<Array<{ date: Date; value: number }>> {
    try {
      // For now, return empty array as this would require more complex historical tracking
      // This could be implemented based on business requirements
      return [];
    } catch (error) {
      console.error('Error fetching historical data:', error);
      return [];
    }
  }
}
