import { ReportFilters } from '../types/analytics.types';

export interface IAnalyticsRepository {
  // Filter options
  getFilterOptions(user_id: number, userRole?: string): Promise<{
    departments: any[];
    forms: any[];
    csrs: any[];
    datePresets: any[];
    categories?: any[];
    questions?: any[];
  }>;

  // QA Score data access
  getQAScoreData(filters: ReportFilters, user_id: number, userRole?: string): Promise<any[]>;
  getDetailedQAScoreData(filters: ReportFilters, user_id: number, userRole?: string): Promise<any[]>;
  
  // Comprehensive reporting methods
  getDetailedSubmissionData(filters: any, user_id: number, userRole?: string): Promise<any[]>;
  getQuestionLevelAnalytics(filters: any): Promise<any>;
  getCategoryLevelAnalytics(filters: any): Promise<any>;

  // Performance goals
  getActiveGoals(user_id: number, userRole?: string, department_id?: number): Promise<any[]>;
  getAverageQAScore(filters: ReportFilters, user_id: number, userRole: string | undefined, goal: any): Promise<{ averageScore: number }>;
  getAuditRateData(filters: ReportFilters, user_id: number, userRole: string | undefined, goal: any): Promise<{ auditRate: number }>;
  getDisputeRateData(filters: ReportFilters, user_id: number, userRole: string | undefined, goal: any): Promise<{ disputeRate: number }>;
} 