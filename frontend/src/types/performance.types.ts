export type GoalType = 'QA_SCORE' | 'AUDIT_RATE' | 'DISPUTE_RATE';
export type GoalScope = 'GLOBAL' | 'DEPARTMENT';

export interface Department {
  id: number;
  department_name: string;
  is_active: boolean;
}

export interface PerformanceGoal {
  id: number;
  goal_type: 'QA_SCORE' | 'AUDIT_RATE' | 'DISPUTE_RATE';
  target_value: number;
  scope: 'GLOBAL' | 'DEPARTMENT';
  department_id?: number;
  description?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PerformanceGoalFilter {
  goal_type?: GoalType;
  department_id?: number;
  is_active?: boolean;
}

export interface PerformanceGoalFormData {
  goal_type: GoalType;
  target_value: number;
  scope: GoalScope;
  department_id: number | null;
  description: string | null;
}

// NOTE: ManagerReportFilters/ManagerReportData/QAScoreData/TrainingCompletionData/
// DisputeTrendData/FilterOptions used to live here for managerReportsService.ts +
// teamReportsService.ts + mocks/managerReportsMock.ts. All three were unused
// orphans (mock-only services with zero call sites), so they were removed during
// the pre-production review (item #20). The On Demand Reports stack uses its own
// `OnDemandFilterOptions` type defined in `services/onDemandReportsService.ts`,
// and the QC dashboards have their own `FilterOptions` in `insightsQCService.ts`.

export interface PaginatedResponse<T> {
  items: T[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
} 