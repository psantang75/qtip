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

// Manager Performance Report types based on manager_performance_reports.md

// Manager Performance Report types
export interface ManagerReportFilters {
  dateRange: {
    startDate: string;
    endDate: string;
  };
  departmentIds: number[];
  managerIds: number[];
  metrics: ('QA_SCORES' | 'TRAINING_COMPLETION' | 'DISPUTE_TRENDS')[];
}

export interface QAScoreData {
  id: number;
  name: string;
  averageScore: number;
  totalSubmissions: number;
  type: 'department' | 'manager';
}

export interface TrainingCompletionData {
  id: number;
  name: string;
  completionRate: number;
  completedCourses: number;
  totalCourses: number;
  type: 'department' | 'manager';
}

export interface DisputeTrendData {
  id: number;
  name: string;
  date: string;
  disputeCount: number;
  type: 'department' | 'manager';
}

export interface ManagerReportData {
  qaScores: QAScoreData[];
  trainingCompletion: TrainingCompletionData[];
  disputeTrends: DisputeTrendData[];
  summaryTable: {
    id: number;
    name: string;
    type: 'department' | 'manager';
    qaScore: number;
    completionRate: number;
    disputeCount: number;
  }[];
}

export interface FilterOptions {
  departments: { id: number; name: string }[];
  managers: { id: number; name: string; department?: string }[];
}

export interface PaginatedResponse<T> {
  items: T[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
} 