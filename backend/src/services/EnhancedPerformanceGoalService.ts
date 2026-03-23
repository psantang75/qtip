import {
  CreatePerformanceGoalData,
  UpdatePerformanceGoalData,
  PerformanceGoalFilters,
  EnhancedPerformanceGoal,
  PaginatedPerformanceGoalResponse,
  PerformanceGoalReport,
  PerformanceGoalServiceError,
  FormOption,
  GoalScope,
  target_scope
} from '../types/performanceGoal.types';
import { EnhancedPerformanceGoalRepository } from '../repositories/EnhancedPerformanceGoalRepository';
import prisma from '../config/prisma';
import { Prisma } from '../generated/prisma/client';

/**
 * Enhanced Performance Goal Service
 * Implements business logic for enhanced performance goals with individual targeting
 */
export class EnhancedPerformanceGoalService {
  private repository: EnhancedPerformanceGoalRepository;

  constructor() {
    this.repository = new EnhancedPerformanceGoalRepository();
  }

  /**
   * Create performance goal with enhanced validation
   */
  async createPerformanceGoal(
    goalData: CreatePerformanceGoalData,
    created_by: number
  ): Promise<EnhancedPerformanceGoal> {

    console.log('[ENHANCED PERF GOAL SERVICE] Creating goal with data:', {
      ...goalData,
      user_ids: goalData.user_ids || [],
      department_ids: goalData.department_ids || [],
      created_by
    });

    // Comprehensive validation
    await this.validateGoalData(goalData);
    await this.validateTargetReferences(goalData);
    await this.validateAssignments(goalData);

    // Business logic validation
    this.validateScopeRequirements(goalData);

    console.log('[ENHANCED PERF GOAL SERVICE] Validation passed, proceeding with creation');

    try {
      const createdGoal = await this.repository.create(goalData, created_by);

      console.log('[ENHANCED PERF GOAL SERVICE] Goal created successfully:', {
        id: createdGoal.id,
        scope: createdGoal.scope,
        assigned_users: createdGoal.assigned_users?.length || 0,
        assigned_departments: createdGoal.assigned_departments?.length || 0
      });

      // Log audit event
      await this.logAuditEvent({
        user_id: created_by,
        action: 'CREATE_ENHANCED_PERFORMANCE_GOAL',
        target_id: createdGoal.id,
        target_type: 'PERFORMANCE_GOAL',
        details: {
          goal_type: goalData.goal_type,
          scope: goalData.scope,
          target_scope: goalData.target_scope,
          user_count: goalData.user_ids?.length || 0,
          department_count: goalData.department_ids?.length || 0,
          start_date: goalData.start_date,
          end_date: goalData.end_date
        }
      });

      return createdGoal;
    } catch (error) {
      console.error('[ENHANCED PERF GOAL SERVICE] Error creating goal:', error);
      throw new PerformanceGoalServiceError('Failed to create performance goal', 'CREATE_ERROR', 500);
    }
  }

  /**
   * Get paginated list of performance goals with enhanced filtering
   */
  async getPerformanceGoals(
    page: number = 1,
    pageSize: number = 10,
    filters?: PerformanceGoalFilters
  ): Promise<PaginatedPerformanceGoalResponse> {

    // Validate pagination parameters
    if (page < 1) {
      throw new PerformanceGoalServiceError('Page must be greater than 0', 'INVALID_PAGE', 400);
    }

    if (pageSize < 1 || pageSize > 100) {
      throw new PerformanceGoalServiceError('Page size must be between 1 and 100', 'INVALID_PAGE_SIZE', 400);
    }

    try {
      return await this.repository.findAll(page, pageSize, filters);
    } catch (error) {
      console.error('[ENHANCED PERF GOAL SERVICE] Error getting goals:', error);
      throw new PerformanceGoalServiceError('Failed to retrieve performance goals', 'GET_GOALS_ERROR', 500);
    }
  }

  /**
   * Get performance goal by ID
   */
  async getPerformanceGoalById(id: number): Promise<EnhancedPerformanceGoal> {
    try {
      const goal = await this.repository.findById(id);

      if (!goal) {
        throw new PerformanceGoalServiceError('Performance goal not found', 'GOAL_NOT_FOUND', 404);
      }

      return goal;
    } catch (error) {
      if (error instanceof PerformanceGoalServiceError) {
        throw error;
      }

      console.error('[ENHANCED PERF GOAL SERVICE] Error getting goal by ID:', error);
      throw new PerformanceGoalServiceError('Failed to retrieve performance goal', 'GET_GOAL_ERROR', 500);
    }
  }

  /**
   * Update performance goal
   */
  async updatePerformanceGoal(
    id: number,
    updates: UpdatePerformanceGoalData,
    updatedBy: number
  ): Promise<EnhancedPerformanceGoal> {

    // Check if goal exists
    const existingGoal = await this.getPerformanceGoalById(id);

    // Validate updates
    await this.validateGoalUpdates(updates);

    try {
      const updatedGoal = await this.repository.update(id, updates, updatedBy);

      if (!updatedGoal) {
        throw new PerformanceGoalServiceError('Failed to update performance goal', 'UPDATE_ERROR', 500);
      }

      // Log audit event
      await this.logAuditEvent({
        user_id: updatedBy,
        action: 'UPDATE_ENHANCED_PERFORMANCE_GOAL',
        target_id: id,
        target_type: 'PERFORMANCE_GOAL',
        details: {
          changes: updates,
          previous_scope: existingGoal.scope,
          new_scope: updates.scope || existingGoal.scope
        }
      });

      return updatedGoal;
    } catch (error) {
      if (error instanceof PerformanceGoalServiceError) {
        throw error;
      }

      console.error('[ENHANCED PERF GOAL SERVICE] Error updating goal:', error);
      throw new PerformanceGoalServiceError('Failed to update performance goal', 'UPDATE_ERROR', 500);
    }
  }

  /**
   * Delete (deactivate) performance goal
   */
  async deletePerformanceGoal(id: number, deletedBy: number): Promise<void> {
    // Check if goal exists
    await this.getPerformanceGoalById(id);

    try {
      const success = await this.repository.delete(id, deletedBy);

      if (!success) {
        throw new PerformanceGoalServiceError('Failed to delete performance goal', 'DELETE_ERROR', 500);
      }

      // Log audit event
      await this.logAuditEvent({
        user_id: deletedBy,
        action: 'DELETE_ENHANCED_PERFORMANCE_GOAL',
        target_id: id,
        target_type: 'PERFORMANCE_GOAL',
        details: { deleted_by: deletedBy }
      });

    } catch (error) {
      if (error instanceof PerformanceGoalServiceError) {
        throw error;
      }

      console.error('[ENHANCED PERF GOAL SERVICE] Error deleting goal:', error);
      throw new PerformanceGoalServiceError('Failed to delete performance goal', 'DELETE_ERROR', 500);
    }
  }

  /**
   * Activate performance goal
   */
  async activatePerformanceGoal(id: number, activatedBy: number): Promise<void> {
    // Check if goal exists
    await this.getPerformanceGoalById(id);

    try {
      const success = await this.repository.activate(id, activatedBy);

      if (!success) {
        throw new PerformanceGoalServiceError('Failed to activate performance goal', 'ACTIVATE_ERROR', 500);
      }

      // Log audit event
      await this.logAuditEvent({
        user_id: activatedBy,
        action: 'ACTIVATE_ENHANCED_PERFORMANCE_GOAL',
        target_id: id,
        target_type: 'PERFORMANCE_GOAL',
        details: { activated_by: activatedBy }
      });

    } catch (error) {
      if (error instanceof PerformanceGoalServiceError) {
        throw error;
      }

      console.error('[ENHANCED PERF GOAL SERVICE] Error activating goal:', error);
      throw new PerformanceGoalServiceError('Failed to activate performance goal', 'ACTIVATE_ERROR', 500);
    }
  }

  /**
   * Get active goals for user with date filtering
   */
  async getActiveGoalsForUser(
    user_id: number,
    asOfDate: string = new Date().toISOString().split('T')[0]
  ): Promise<EnhancedPerformanceGoal[]> {

    try {
      return await this.repository.getActiveGoalsForUser(user_id, asOfDate);
    } catch (error) {
      console.error('[ENHANCED PERF GOAL SERVICE] Error getting user goals:', error);
      throw new PerformanceGoalServiceError('Failed to retrieve user goals', 'GET_USER_GOALS_ERROR', 500);
    }
  }

  /**
   * Get form options for targeting
   */
  async getFormOptions(): Promise<FormOption[]> {
    try {
      return await this.repository.getFormOptions();
    } catch (error) {
      console.error('[ENHANCED PERF GOAL SERVICE] Error getting form options:', error);
      throw new PerformanceGoalServiceError('Failed to retrieve form options', 'GET_FORM_OPTIONS_ERROR', 500);
    }
  }

  /**
   * Calculate performance against enhanced goals
   */
  async calculatePerformanceReport(
    filters: {
      user_id?: number;
      department_id?: number;
      start_date: string;
      end_date: string;
    }
  ): Promise<PerformanceGoalReport[]> {

    try {
      // Get applicable goals
      const goalFilters: PerformanceGoalFilters = {
        is_active: true,
        start_date: filters.start_date,
        end_date: filters.end_date
      };

      if (filters.user_id) goalFilters.user_id = filters.user_id;
      if (filters.department_id) goalFilters.department_id = filters.department_id;

      const goalsResult = await this.repository.findAll(1, 1000, goalFilters);
      const goals = goalsResult.data;

      const reports: PerformanceGoalReport[] = [];

      for (const goal of goals) {
        const actualValue = await this.repository.calculatePerformance(goal, {
          start: filters.start_date,
          end: filters.end_date
        }, filters.user_id);

        const percentComplete = goal.target_value > 0 ? (actualValue / goal.target_value) * 100 : 0;

        reports.push({
          goal,
          actualValue,
          target_value: goal.target_value,
          percentComplete,
          isOnTrack: actualValue >= goal.target_value,
          dateRange: {
            start: filters.start_date,
            end: filters.end_date
          }
        });
      }

      return reports;
    } catch (error) {
      console.error('[ENHANCED PERF GOAL SERVICE] Error calculating performance report:', error);
      throw new PerformanceGoalServiceError('Failed to calculate performance report', 'CALCULATE_REPORT_ERROR', 500);
    }
  }

  /**
   * Validate goal data
   */
  private async validateGoalData(goalData: CreatePerformanceGoalData): Promise<void> {
    // Date validation
    if (goalData.end_date && goalData.start_date >= goalData.end_date) {
      throw new PerformanceGoalServiceError('End date must be after start date', 'INVALID_DATE_RANGE', 400);
    }

    // Target value validation
    if (goalData.target_value <= 0) {
      throw new PerformanceGoalServiceError('Target value must be greater than 0', 'INVALID_TARGET_VALUE', 400);
    }

    if (goalData.goal_type === 'QA_SCORE' && goalData.target_value > 100) {
      throw new PerformanceGoalServiceError('QA Score target value cannot exceed 100', 'INVALID_QA_TARGET', 400);
    }
  }

  /**
   * Validate goal updates
   */
  private async validateGoalUpdates(updates: UpdatePerformanceGoalData): Promise<void> {
    // Date validation
    if (updates.end_date && updates.start_date && updates.start_date >= updates.end_date) {
      throw new PerformanceGoalServiceError('End date must be after start date', 'INVALID_DATE_RANGE', 400);
    }

    // Target value validation
    if (updates.target_value !== undefined && updates.target_value <= 0) {
      throw new PerformanceGoalServiceError('Target value must be greater than 0', 'INVALID_TARGET_VALUE', 400);
    }

    if (updates.goal_type === 'QA_SCORE' && updates.target_value && updates.target_value > 100) {
      throw new PerformanceGoalServiceError('QA Score target value cannot exceed 100', 'INVALID_QA_TARGET', 400);
    }
  }

  /**
   * Validate target references
   */
  private async validateTargetReferences(goalData: CreatePerformanceGoalData): Promise<void> {
    const validation = await this.repository.validateTargetReferences(
      goalData.target_form_id,
      goalData.target_category_id,
      goalData.target_question_id
    );

    if (!validation.valid) {
      throw new PerformanceGoalServiceError(
        `Invalid target references: ${validation.errors.join(', ')}`,
        'INVALID_TARGET_REFERENCES',
        400
      );
    }
  }

  /**
   * Validate assignments (users/departments exist)
   */
  private async validateAssignments(goalData: CreatePerformanceGoalData): Promise<void> {
    // Validate user IDs exist
    if (goalData.user_ids && goalData.user_ids.length > 0) {
      const userRows = await prisma.$queryRaw<{ id: number }[]>(
        Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(goalData.user_ids)}) AND is_active = 1`
      );

      if (userRows.length !== goalData.user_ids.length) {
        throw new PerformanceGoalServiceError('One or more user IDs are invalid or inactive', 'INVALID_USER_IDS', 400);
      }
    }

    // Validate department IDs exist
    if (goalData.department_ids && goalData.department_ids.length > 0) {
      const deptRows = await prisma.$queryRaw<{ id: number }[]>(
        Prisma.sql`SELECT id FROM departments WHERE id IN (${Prisma.join(goalData.department_ids)}) AND is_active = 1`
      );

      if (deptRows.length !== goalData.department_ids.length) {
        throw new PerformanceGoalServiceError('One or more department IDs are invalid or inactive', 'INVALID_DEPARTMENT_IDS', 400);
      }
    }
  }

  /**
   * Validate scope requirements
   */
  private validateScopeRequirements(goalData: CreatePerformanceGoalData): void {
    const scope = goalData.scope;

    if (scope.includes('USER') && (!goalData.user_ids || goalData.user_ids.length === 0)) {
      throw new PerformanceGoalServiceError('User IDs required for user-scoped goals', 'MISSING_USERS', 400);
    }

    if (scope.includes('DEPARTMENT') && (!goalData.department_ids || goalData.department_ids.length === 0)) {
      throw new PerformanceGoalServiceError('Department IDs required for department-scoped goals', 'MISSING_DEPARTMENTS', 400);
    }

    // Target scope validation
    if (goalData.target_scope !== 'ALL_QA') {
      if (goalData.target_scope === 'FORM' && !goalData.target_form_id) {
        throw new PerformanceGoalServiceError('Form ID required for FORM target scope', 'MISSING_FORM_ID', 400);
      }
      if (goalData.target_scope === 'CATEGORY' && !goalData.target_category_id) {
        throw new PerformanceGoalServiceError('Category ID required for CATEGORY target scope', 'MISSING_CATEGORY_ID', 400);
      }
      if (goalData.target_scope === 'QUESTION' && !goalData.target_question_id) {
        throw new PerformanceGoalServiceError('Question ID required for QUESTION target scope', 'MISSING_QUESTION_ID', 400);
      }
    }
  }

  /**
   * Log audit events
   */
  private async logAuditEvent(event: {
    user_id: number;
    action: string;
    target_id: number;
    target_type: string;
    details: any;
  }): Promise<void> {
    try {
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO audit_logs (user_id, action, target_id, target_type, details, created_at)
        VALUES (${event.user_id}, ${event.action}, ${event.target_id}, ${event.target_type}, ${JSON.stringify(event.details)}, NOW())
      `);
    } catch (error) {
      console.error('[ENHANCED PERF GOAL SERVICE] Error logging audit event:', error);
      // Don't throw error for audit logging failures
    }
  }

  /**
   * Get users for assignment (filtered by department if needed)
   */
  async getUsersForAssignment(department_id?: number): Promise<{ id: number; username: string; email: string; department_name?: string }[]> {
    try {
      const departmentFilter = department_id
        ? Prisma.sql`AND u.department_id = ${department_id}`
        : Prisma.sql``;

      const rows = await prisma.$queryRaw<{ id: number; username: string; email: string; department_name?: string }[]>(Prisma.sql`
        SELECT u.id, u.username, u.email, d.department_name
        FROM users u
        LEFT JOIN departments d ON u.department_id = d.id
        WHERE u.is_active = 1 AND u.role_id = 3
        ${departmentFilter}
        ORDER BY u.username
      `);

      return rows;
    } catch (error) {
      console.error('[ENHANCED PERF GOAL SERVICE] Error getting users for assignment:', error);
      throw new PerformanceGoalServiceError('Failed to retrieve users', 'GET_USERS_ERROR', 500);
    }
  }

  /**
   * Get departments for assignment
   */
  async getDepartmentsForAssignment(): Promise<{ id: number; department_name: string }[]> {
    try {
      const rows = await prisma.$queryRaw<{ id: number; department_name: string }[]>(Prisma.sql`
        SELECT id, department_name
        FROM departments
        WHERE is_active = 1
        ORDER BY department_name
      `);

      return rows;
    } catch (error) {
      console.error('[ENHANCED PERF GOAL SERVICE] Error getting departments for assignment:', error);
      throw new PerformanceGoalServiceError('Failed to retrieve departments', 'GET_DEPARTMENTS_ERROR', 500);
    }
  }
}
