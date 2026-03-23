
// Date range filter
export interface DateRangeFilter {
  start_date: string;
  end_date: string;
}

// Filter options for reports
export interface ReportFilters extends DateRangeFilter {
  role_id?: number;
  department_id?: number;
  csrIds?: number[];
  form_id?: number;
  course_id?: number;
  category_id?: number;
  question_id?: number;
}

// Comprehensive report filters
export interface ComprehensiveReportFilters {
  reportType: 'raw_scores' | 'summary';
  start_date?: string;
  end_date?: string;
  departmentIds?: number[];
  csrIds?: number[];
  form_id?: number;
  formIds?: number[]; // Add support for multiple form IDs
  category_id?: number;
  categoryIds?: number[]; // Add support for multiple category IDs
  question_id?: number;
  questionIds?: number[]; // Add support for multiple question IDs
  includeQuestionBreakdown?: boolean;
  includeCategoryBreakdown?: boolean;
}

// QA Score record from database
export interface QAScoreRecord {
  submission_id: number;
  submission_date: Date;
  form_id: number;
  form_name: string;
  csr_id: number;
  csr_name: string;
  department_id: number | null;
  department_name: string | null;
  total_score: number;
  status: 'DRAFT' | 'SUBMITTED' | 'DISPUTED' | 'FINALIZED';
}

// Score trend data point
export interface ScoreTrendDataPoint {
  date: string; // YYYY-MM-DD format
  score: number;
  count: number; // Number of audits
}

// Grouped score data
export interface GroupedScoreData {
  id: number;
  name: string;
  data: ScoreTrendDataPoint[];
  averageScore: number;
}

// Response for QA score trends
export interface QAScoreTrendResponse {
  trends: GroupedScoreData[];
  overall: {
    averageScore: number;
    totalAudits: number;
  };
}

// Score distribution
export interface ScoreDistribution {
  range: string; // "90-100", "80-89", etc.
  count: number;
  percentage: number;
}

// Response for score distribution
export interface ScoreDistributionResponse {
  distributions: ScoreDistribution[];
  totalAudits: number;
}

// Performance against goals
export interface PerformanceGoalData {
  goal_type: string;
  target_value: number;
  actualValue: number;
  percentComplete: number;
}

// Response shape with pagination info
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
} 