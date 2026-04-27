/**
 * Performance-goal metric types supported end-to-end (pre-production review
 * item #93).
 *
 * - `QA_SCORE`     — average QA form score (0-100). Has an extra target_value
 *                    ceiling check in `EnhancedPerformanceGoalService`.
 * - `AUDIT_RATE`   — audits completed vs. assigned, as a rate.
 * - `DISPUTE_RATE` — disputed submissions as a rate.
 *
 * All three are implemented in
 * `services/analytics/analytics.performanceGoals.service.ts` and wired
 * through `IAnalyticsRepository.getAuditRateData` /
 * `getDisputeRateData`. The frontend `GoalType` in
 * `frontend/src/types/performance.types.ts` matches this list — keep them
 * in lock-step if a new metric is added.
 */
export type goal_type = 'QA_SCORE' | 'AUDIT_RATE' | 'DISPUTE_RATE';

export type GoalScope = 'GLOBAL' | 'DEPARTMENT' | 'USER' | 'MULTI_USER' | 'MULTI_DEPARTMENT';

export type target_scope = 'ALL_QA' | 'FORM' | 'CATEGORY' | 'QUESTION';

export interface PerformanceGoal {
  id: number;
  goal_type: goal_type;
  target_value: number;
  scope: GoalScope;
  department_id: number | null; // Deprecated - use junction tables
  start_date: string;
  end_date: string | null;
  target_scope: target_scope;
  target_form_id: number | null;
  target_category_id: number | null;
  target_question_id: number | null;
  description: string | null;
  created_at: string;
  is_active: boolean;
  created_by: number | null;
  updated_by: number | null;
  updated_at: string | null;
}

export interface PerformanceGoalUser {
  id: number;
  goal_id: number;
  user_id: number;
  user_name?: string;
  user_email?: string;
  assigned_at: string;
  assigned_by: number;
  is_active: boolean;
}

export interface PerformanceGoalDepartment {
  id: number;
  goal_id: number;
  department_id: number;
  department_name?: string;
  assigned_at: string;
  assigned_by: number;
  is_active: boolean;
}

export interface EnhancedPerformanceGoal extends PerformanceGoal {
  assigned_users?: PerformanceGoalUser[];
  assigned_departments?: PerformanceGoalDepartment[];
  target_form_name?: string;
  target_category_name?: string;
  target_question_text?: string;
}

export interface CreatePerformanceGoalData {
  goal_type: goal_type;
  target_value: number;
  scope: GoalScope;
  start_date: string;
  end_date?: string | null;
  target_scope: target_scope;
  target_form_id?: number | null;
  target_category_id?: number | null;
  target_question_id?: number | null;
  description?: string | null;
  user_ids?: number[]; // For USER/MULTI_USER scope
  department_ids?: number[]; // For DEPARTMENT/MULTI_DEPARTMENT scope
}

export interface UpdatePerformanceGoalData {
  goal_type?: goal_type;
  target_value?: number;
  scope?: GoalScope;
  start_date?: string;
  end_date?: string | null;
  target_scope?: target_scope;
  target_form_id?: number | null;
  target_category_id?: number | null;
  target_question_id?: number | null;
  description?: string | null;
  user_ids?: number[];
  department_ids?: number[];
  is_active?: boolean;
}

export interface PerformanceGoalFilters {
  goal_type?: goal_type;
  scope?: GoalScope;
  target_scope?: target_scope;
  is_active?: boolean;
  start_date?: string;
  end_date?: string;
  user_id?: number;
  department_id?: number;
  form_id?: number;
  search?: string;
}

export interface PaginatedPerformanceGoalResponse {
  data: EnhancedPerformanceGoal[];
  total: number;
  pages: number;
  currentPage: number;
  pageSize: number;
}

export interface PerformanceGoalReport {
  goal: EnhancedPerformanceGoal;
  actualValue: number;
  target_value: number;
  percentComplete: number;
  isOnTrack: boolean;
  dateRange: {
    start: string;
    end: string;
  };
}

// Service Error Classes
export class PerformanceGoalServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'PerformanceGoalServiceError';
  }
}

// Legacy interface for backward compatibility
export interface LegacyPerformanceGoalDTO {
  id?: number;
  goal_type: goal_type;
  target_value: number;
  scope: 'GLOBAL' | 'DEPARTMENT';
  department_id?: number | null;
  description?: string | null;
  is_active?: boolean;
}

// Form-related interfaces for targeting
export interface FormOption {
  id: number;
  form_name: string;
  categories?: CategoryOption[];
}

export interface CategoryOption {
  id: number;
  category_name: string;
  form_id: number;
  questions?: QuestionOption[];
}

export interface QuestionOption {
  id: number;
  question_text: string;
  category_id: number;
}

export interface PerformanceGoalDTO {
  id?: number;
  goal_type: goal_type;
  target_value: number;
  scope: GoalScope;
  department_id: number | null;
  description: string | null;
  is_active?: boolean;
}

export interface PerformanceGoalFilter {
  goal_type?: goal_type;
  department_id?: number;
  is_active?: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PerformanceGoalWithDetails extends PerformanceGoal {
  department_name?: string;
  achieved_value?: number;
  progress_percentage?: number;
}

export interface GoalProgress {
  goal_id: number;
  current_value: number;
  target_value: number;
  percentage: number;
  status: 'BELOW_TARGET' | 'ON_TARGET' | 'ABOVE_TARGET';
}

export interface PerformanceGoalMetrics {
  total_goals: number;
  active_goals: number;
  goals_on_target: number;
  goals_below_target: number;
  average_achievement: number;
}

export interface PerformanceTrend {
  date: string;
  value: number;
  trend: 'UP' | 'DOWN' | 'STABLE';
}

export interface GoalAchievement {
  goal_id: number;
  achieved: boolean;
  achievement_date?: string;
  progress: number;
}

export interface GoalComparison {
  goal_type: goal_type;
  current_period: number;
  previous_period: number;
  change_percentage: number;
  trend: 'IMPROVING' | 'DECLINING' | 'STABLE';
} 