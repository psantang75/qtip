import apiClient from './apiClient';

// Types for QA dashboard (same as admin but without coaching sessions)
export interface WeeklyMonthlyStats {
  thisWeek: number;
  thisMonth: number;
}

export interface QADashboardStats {
  reviewsCompleted: WeeklyMonthlyStats;
  disputes: WeeklyMonthlyStats;
}

export interface QACSRActivityData {
  id: number;
  name: string;
  department: string;
  audits: number;
  disputes: number;
  audits_week: number;
  disputes_week: number;
  audits_month: number;
  disputes_month: number;
}

export interface QANewDashboardStats {
  reviewsCompleted: WeeklyMonthlyStats;
  disputes: WeeklyMonthlyStats;
  csrActivity: QACSRActivityData[];
}

// QA service functions
const qaService = {
  // Get QA dashboard statistics
  getDashboardStats: async (): Promise<QADashboardStats> => {
    try {
      const response = await apiClient.get('/qa/stats');
      return response.data;
    } catch (error) {
      // Error will be logged by apiClient interceptor
      throw error;
    }
  },
  
  // Get CSR activity data for QA user
  getCSRActivity: async (): Promise<QACSRActivityData[]> => {
    try {
      const response = await apiClient.get('/qa/csr-activity');
      return response.data;
    } catch (error) {
      // Error will be logged by apiClient interceptor
      throw error;
    }
  }
};

export default qaService; 