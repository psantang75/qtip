import { 
  PerformanceGoal, 
  PerformanceGoalWithDetails, 
  GoalProgress, 
  PerformanceGoalMetrics,
  goal_type, 
  GoalScope, 
  PerformanceTrend,
  GoalAchievement,
  GoalComparison
} from '../types/performanceGoal.types';

// Performance Goal service specific interfaces
export interface PerformanceGoalFilters {
  goal_type?: goal_type;
  department_id?: number;
  is_active?: boolean;
  scope?: GoalScope;
}

export interface PaginatedPerformanceGoalResponse {
  data: PerformanceGoalWithDetails[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PerformanceGoalCreateRequest {
  goal_type: goal_type;
  target_value: number;
  scope: GoalScope;
  department_id?: number | null;
  description?: string | null;
  is_active?: boolean;
}

export interface PerformanceGoalUpdateRequest {
  goal_type?: goal_type;
  target_value?: number;
  scope?: GoalScope;
  department_id?: number | null;
  description?: string | null;
  is_active?: boolean;
}

export interface PerformanceCalculationFilters {
  start_date: string;
  end_date: string;
  department_id?: number;
  csrIds?: number[];
}

export interface PerformanceGoalData {
  goal_type: goal_type;
  target_value: number;
  actualValue: number;
  percentComplete: number;
}

// Performance Goal repository interface for dependency injection
interface IPerformanceGoalRepository {
  findAll(page: number, pageSize: number, filters?: PerformanceGoalFilters): Promise<PaginatedPerformanceGoalResponse>;
  findById(id: number): Promise<PerformanceGoalWithDetails | null>;
  findActiveGoals(department_id?: number): Promise<PerformanceGoal[]>;
  findConflictingGoal(goal_type: goal_type, scope: GoalScope, department_id?: number | null, excludeId?: number): Promise<PerformanceGoal | null>;
  create(goalData: PerformanceGoalCreateRequest, created_by: number): Promise<PerformanceGoalWithDetails>;
  update(id: number, goalData: PerformanceGoalUpdateRequest, updatedBy: number): Promise<PerformanceGoalWithDetails>;
  delete(id: number, deletedBy: number): Promise<void>;
  activate(id: number, activatedBy: number): Promise<void>;
  calculateQAScore(filters: PerformanceCalculationFilters, goalScope: GoalScope, department_id?: number): Promise<number>;
  calculateAuditRate(filters: PerformanceCalculationFilters, goalScope: GoalScope, department_id?: number): Promise<number>;
  calculateDisputeRate(filters: PerformanceCalculationFilters, goalScope: GoalScope, department_id?: number): Promise<number>;
  getHistoricalData(goal_id: number, days: number): Promise<Array<{ date: Date; value: number }>>;
}

/**
 * Custom performance goal service errors
 */
export class PerformanceGoalServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'PerformanceGoalServiceError';
  }
}

/**
 * Performance Goal Service with Clean Architecture patterns
 * Implements comprehensive performance goal management with calculation logic
 */
export class PerformanceGoalService {
  private readonly repository: IPerformanceGoalRepository;

  constructor(repository: IPerformanceGoalRepository) {
    this.repository = repository;
  }

  /**
   * Get paginated list of performance goals with filtering
   */
  async getPerformanceGoals(
    page: number = 1, 
    pageSize: number = 10, 
    filters?: PerformanceGoalFilters
  ): Promise<PaginatedPerformanceGoalResponse> {
    console.log(`[NEW PERF] PerformanceGoalService: Getting goals - Page: ${page}, PageSize: ${pageSize}`);
    
    try {
      // Validate pagination parameters
      if (page < 1) {
        throw new PerformanceGoalServiceError('Page must be greater than 0', 'INVALID_PAGE', 400);
      }
      
      if (pageSize < 1 || pageSize > 100) {
        throw new PerformanceGoalServiceError('Page size must be between 1 and 100', 'INVALID_PAGE_SIZE', 400);
      }

      const result = await this.repository.findAll(page, pageSize, filters);
      
      console.log(`[NEW PERF] PerformanceGoalService: Found ${result.data.length} goals`);
      return result;
    } catch (error) {
      if (error instanceof PerformanceGoalServiceError) {
        throw error;
      }
      
      console.error('[NEW PERF] PerformanceGoalService: Error getting goals:', error);
      throw new PerformanceGoalServiceError('Failed to retrieve performance goals', 'GET_GOALS_ERROR', 500);
    }
  }

  /**
   * Get performance goal by ID with detailed information
   */
  async getPerformanceGoalById(id: number): Promise<PerformanceGoalWithDetails> {
    console.log(`[NEW PERF] PerformanceGoalService: Getting goal by ID: ${id}`);
    
    try {
      if (!id || id <= 0) {
        throw new PerformanceGoalServiceError('Invalid goal ID', 'INVALID_GOAL_ID', 400);
      }

      const goal = await this.repository.findById(id);
      
      if (!goal) {
        throw new PerformanceGoalServiceError('Performance goal not found', 'GOAL_NOT_FOUND', 404);
      }

      console.log(`[NEW PERF] PerformanceGoalService: Found goal: ${goal.goal_type} - Target: ${goal.target_value}`);
      return goal;
    } catch (error) {
      if (error instanceof PerformanceGoalServiceError) {
        throw error;
      }
      
      console.error('[NEW PERF] PerformanceGoalService: Error getting goal by ID:', error);
      throw new PerformanceGoalServiceError('Failed to retrieve performance goal', 'GET_GOAL_ERROR', 500);
    }
  }

  /**
   * Create a new performance goal with business logic validation
   */
  async createPerformanceGoal(goalData: PerformanceGoalCreateRequest, created_by: number): Promise<PerformanceGoalWithDetails> {
    console.log(`[NEW PERF] PerformanceGoalService: Creating goal: ${goalData.goal_type} - Target: ${goalData.target_value}`);
    
    try {
      // Validate required fields and business rules
      await this.validateGoalData(goalData, true);

      // Check for existing active goal conflict
      await this.checkGoalConflict(goalData.goal_type, goalData.scope, goalData.department_id);

      const newGoal = await this.repository.create(goalData, created_by);
      
      console.log(`[NEW PERF] PerformanceGoalService: Goal created successfully with ID: ${newGoal.id}`);
      return newGoal;
    } catch (error) {
      if (error instanceof PerformanceGoalServiceError) {
        throw error;
      }
      
      console.error('[NEW PERF] PerformanceGoalService: Error creating goal:', error);
      throw new PerformanceGoalServiceError('Failed to create performance goal', 'CREATE_GOAL_ERROR', 500);
    }
  }

  /**
   * Update an existing performance goal with business logic validation
   */
  async updatePerformanceGoal(
    id: number, 
    goalData: PerformanceGoalUpdateRequest, 
    updatedBy: number
  ): Promise<PerformanceGoalWithDetails> {
    console.log(`[NEW PERF] PerformanceGoalService: Updating goal ID: ${id}`);
    
    try {
      // Validate goal ID
      if (!id || id <= 0) {
        throw new PerformanceGoalServiceError('Invalid goal ID', 'INVALID_GOAL_ID', 400);
      }

      // Check if goal exists
      const existingGoal = await this.repository.findById(id);
      if (!existingGoal) {
        throw new PerformanceGoalServiceError('Performance goal not found', 'GOAL_NOT_FOUND', 404);
      }

      // Validate update data
      await this.validateGoalData(goalData, false);

      // Check for conflicts if key fields are changing
      if (this.isKeyFieldChanging(existingGoal, goalData)) {
        const mergedGoal = { ...existingGoal, ...goalData };
        await this.checkGoalConflict(
          mergedGoal.goal_type, 
          mergedGoal.scope, 
          mergedGoal.department_id, 
          id
        );
      }

      const updatedGoal = await this.repository.update(id, goalData, updatedBy);
      
      console.log(`[NEW PERF] PerformanceGoalService: Goal updated successfully: ${updatedGoal.goal_type}`);
      return updatedGoal;
    } catch (error) {
      if (error instanceof PerformanceGoalServiceError) {
        throw error;
      }
      
      console.error('[NEW PERF] PerformanceGoalService: Error updating goal:', error);
      throw new PerformanceGoalServiceError('Failed to update performance goal', 'UPDATE_GOAL_ERROR', 500);
    }
  }

  /**
   * Delete a performance goal (soft delete)
   */
  async deletePerformanceGoal(id: number, deletedBy: number): Promise<void> {
    console.log(`[NEW PERF] PerformanceGoalService: Deleting goal ID: ${id}`);
    
    try {
      if (!id || id <= 0) {
        throw new PerformanceGoalServiceError('Invalid goal ID', 'INVALID_GOAL_ID', 400);
      }

      // Check if goal exists
      const existingGoal = await this.repository.findById(id);
      if (!existingGoal) {
        throw new PerformanceGoalServiceError('Performance goal not found', 'GOAL_NOT_FOUND', 404);
      }

      await this.repository.delete(id, deletedBy);
      
      console.log(`[NEW PERF] PerformanceGoalService: Goal deleted successfully: ${existingGoal.goal_type}`);
    } catch (error) {
      if (error instanceof PerformanceGoalServiceError) {
        throw error;
      }
      
      console.error('[NEW PERF] PerformanceGoalService: Error deleting goal:', error);
      throw new PerformanceGoalServiceError('Failed to delete performance goal', 'DELETE_GOAL_ERROR', 500);
    }
  }

  /**
   * Activate a performance goal
   */
  async activatePerformanceGoal(id: number, activatedBy: number): Promise<void> {
    console.log(`[NEW PERF] PerformanceGoalService: Activating goal ID: ${id}`);
    
    try {
      if (!id || id <= 0) {
        throw new PerformanceGoalServiceError('Invalid goal ID', 'INVALID_GOAL_ID', 400);
      }

      // Check if goal exists
      const existingGoal = await this.repository.findById(id);
      if (!existingGoal) {
        throw new PerformanceGoalServiceError('Performance goal not found', 'GOAL_NOT_FOUND', 404);
      }

      // Check for conflicts before activation
      await this.checkGoalConflict(
        existingGoal.goal_type, 
        existingGoal.scope, 
        existingGoal.department_id, 
        id
      );

      await this.repository.activate(id, activatedBy);
      
      console.log(`[NEW PERF] PerformanceGoalService: Goal activated successfully: ${existingGoal.goal_type}`);
    } catch (error) {
      if (error instanceof PerformanceGoalServiceError) {
        throw error;
      }
      
      console.error('[NEW PERF] PerformanceGoalService: Error activating goal:', error);
      throw new PerformanceGoalServiceError('Failed to activate performance goal', 'ACTIVATE_GOAL_ERROR', 500);
    }
  }

  /**
   * Calculate performance goals with actual vs target values
   * This is the core calculation logic extracted from analytics controller
   */
  async calculatePerformanceGoals(
    filters: PerformanceCalculationFilters,
    userRole?: string,
    user_id?: number
  ): Promise<PerformanceGoalData[]> {
    console.log(`[NEW PERF] PerformanceGoalService: Calculating performance goals`);
    
    try {
      // Get active goals based on filters and user permissions
      let department_id = filters.department_id;
      
      // If user is a manager, restrict to their department
      if (userRole === 'Manager' && user_id && !department_id) {
        // This would need to be implemented in the repository
        // For now, we'll pass it through
      }

      const activeGoals = await this.repository.findActiveGoals(department_id);
      
      if (activeGoals.length === 0) {
        console.log('[NEW PERF] PerformanceGoalService: No active goals found');
        return [];
      }

      const performanceData: PerformanceGoalData[] = [];

      // Process each goal and calculate actual values
      for (const goal of activeGoals) {
        let actualValue = 0;

        try {
          // Calculate actual value based on goal type using extracted calculation logic
          if (goal.goal_type === 'QA_SCORE') {
            actualValue = await this.repository.calculateQAScore(
              filters, 
              goal.scope, 
              goal.department_id || undefined
            );
          }

          // Calculate percent complete (with safety checks)
          const percentComplete = goal.target_value > 0 
            ? Math.min(100, Math.round((actualValue / goal.target_value) * 100))
            : 0;

          performanceData.push({
            goal_type: goal.goal_type,
            target_value: goal.target_value,
            actualValue: Math.round(actualValue * 100) / 100, // Round to 2 decimal places
            percentComplete
          });

          console.log(`[NEW PERF] Calculated ${goal.goal_type}: ${actualValue}/${goal.target_value} (${percentComplete}%)`);

        } catch (calcError) {
          console.error(`[NEW PERF] Error calculating ${goal.goal_type}:`, calcError);
          // Include goal with zero values if calculation fails
          performanceData.push({
            goal_type: goal.goal_type,
            target_value: goal.target_value,
            actualValue: 0,
            percentComplete: 0
          });
        }
      }

      console.log(`[NEW PERF] PerformanceGoalService: Calculated ${performanceData.length} performance goals`);
      return performanceData;
    } catch (error) {
      console.error('[NEW PERF] PerformanceGoalService: Error calculating performance goals:', error);
      throw new PerformanceGoalServiceError('Failed to calculate performance goals', 'CALCULATE_GOALS_ERROR', 500);
    }
  }

  /**
   * Get goal progress with trend analysis
   */
  async getGoalProgress(goal_id: number, days: number = 30): Promise<GoalProgress[]> {
    console.log(`[NEW PERF] PerformanceGoalService: Getting goal progress for ID: ${goal_id}`);
    
    try {
      if (!goal_id || goal_id <= 0) {
        throw new PerformanceGoalServiceError('Invalid goal ID', 'INVALID_GOAL_ID', 400);
      }

      const goal = await this.repository.findById(goal_id);
      if (!goal) {
        throw new PerformanceGoalServiceError('Performance goal not found', 'GOAL_NOT_FOUND', 404);
      }

      // Get historical data for trend analysis
      const historicalData = await this.repository.getHistoricalData(goal_id, days);
      
      // Calculate progress and trend
      const progressData: GoalProgress[] = [];
      
      // For now, return basic progress structure
      // This would be expanded with actual progress calculation logic
      console.log(`[NEW PERF] PerformanceGoalService: Retrieved progress data for goal: ${goal.goal_type}`);
      
      return progressData;
    } catch (error) {
      if (error instanceof PerformanceGoalServiceError) {
        throw error;
      }
      
      console.error('[NEW PERF] PerformanceGoalService: Error getting goal progress:', error);
      throw new PerformanceGoalServiceError('Failed to get goal progress', 'GET_PROGRESS_ERROR', 500);
    }
  }

  /**
   * Private method to validate goal data
   */
  private async validateGoalData(goalData: Partial<PerformanceGoalCreateRequest>, isCreate: boolean): Promise<void> {
    if (isCreate) {
      // Required fields for creation
      if (!goalData.goal_type) {
        throw new PerformanceGoalServiceError('Goal type is required', 'MISSING_GOAL_TYPE', 400);
      }
      
      if (!goalData.scope) {
        throw new PerformanceGoalServiceError('Goal scope is required', 'MISSING_SCOPE', 400);
      }
      
      if (goalData.target_value === undefined || goalData.target_value === null) {
        throw new PerformanceGoalServiceError('Target value is required', 'MISSING_TARGET_VALUE', 400);
      }
    }

    // Validate goal type
    if (goalData.goal_type && !['QA_SCORE'].includes(goalData.goal_type)) {
      throw new PerformanceGoalServiceError('Invalid goal type', 'INVALID_GOAL_TYPE', 400);
    }

    // Validate scope
    if (goalData.scope && !['GLOBAL', 'DEPARTMENT'].includes(goalData.scope)) {
      throw new PerformanceGoalServiceError('Invalid goal scope', 'INVALID_SCOPE', 400);
    }

    // Validate target value based on goal type
    if (goalData.target_value !== undefined) {
      if (goalData.goal_type === 'QA_SCORE' && (goalData.target_value < 0 || goalData.target_value > 100)) {
        throw new PerformanceGoalServiceError('QA Score target value must be between 0 and 100', 'INVALID_QA_TARGET', 400);
      } else if (goalData.target_value < 0) {
        throw new PerformanceGoalServiceError(`Target value must be a positive number`, 'INVALID_TARGET_VALUE', 400);
      }
    }

    // Validate department requirement for DEPARTMENT scope
    if (goalData.scope === 'DEPARTMENT' && !goalData.department_id) {
      throw new PerformanceGoalServiceError('Department ID is required when scope is DEPARTMENT', 'MISSING_DEPARTMENT_ID', 400);
    }

    // Validate description length
    if (goalData.description && goalData.description.length > 500) {
      throw new PerformanceGoalServiceError('Description must be less than 500 characters', 'INVALID_DESCRIPTION_LENGTH', 400);
    }
  }

  /**
   * Private method to check for goal conflicts
   */
  private async checkGoalConflict(
    goal_type: goal_type, 
    scope: GoalScope, 
    department_id?: number | null, 
    excludeId?: number
  ): Promise<void> {
    const existingGoal = await this.repository.findConflictingGoal(goal_type, scope, department_id, excludeId);
    
    if (existingGoal) {
      throw new PerformanceGoalServiceError(
        'An active goal with the same type and scope already exists',
        'GOAL_CONFLICT',
        409
      );
    }
  }

  /**
   * Private method to check if key fields are changing
   */
  private isKeyFieldChanging(existingGoal: PerformanceGoal, updates: PerformanceGoalUpdateRequest): boolean {
    return (
      (updates.goal_type && updates.goal_type !== existingGoal.goal_type) ||
      (updates.scope && updates.scope !== existingGoal.scope) ||
      (updates.department_id !== undefined && updates.department_id !== existingGoal.department_id)
    );
  }
}