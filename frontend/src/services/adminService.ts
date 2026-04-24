import apiClient from './apiClient';
import type { 
  CoachingSession,
  CoachingSessionDetails,
  CoachingSessionForm,
  CoachingSessionFilters,
  CSROption,
  PaginatedCoachingSessions
} from '../types/manager.types';
import { logError } from '../utils/errorHandling';

// Types for dashboard
export interface WeeklyMonthlyStats {
  thisWeek: number;
  thisMonth: number;
}

export interface CSRActivityData {
  id: number;
  name: string;
  department: string;
  audits: number;
  disputes: number;
  coachingScheduled: number;
  coachingCompleted: number;
  audits_week: number;
  disputes_week: number;
  audits_month: number;
  disputes_month: number;
  coachingScheduled_week: number;
  coachingCompleted_week: number;
  coachingScheduled_month: number;
  coachingCompleted_month: number;
}

export interface NewDashboardStats {
  reviewsCompleted: WeeklyMonthlyStats;
  disputes: WeeklyMonthlyStats;
  coachingSessions: WeeklyMonthlyStats;
}

// Legacy interface for backward compatibility
export interface DashboardStats {
  users: {
    total: number;
    active: number;
    byRole: {
      [key: string]: number;
    };
  };
  audits: {
    pending: number;
    completed: number;
    averageScore: number;
  };
  training: {
    activeCourses: number;
    completionRate: number;
  };
  disputes: {
    open: number;
    resolved: number;
  };
}

export interface ActivityItem {
  id: number;
  type: string;
  description: string;
  timestamp: string;
  user: {
    name: string;
    role: string;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
}

// Admin service functions
const adminService = {
  // Get dashboard statistics
  getDashboardStats: async (): Promise<NewDashboardStats> => {
    try {
      const response = await apiClient.get('/admin/stats');
      return response.data;
    } catch (error) {
      logError('adminService', 'Error fetching admin dashboard stats:', error);
      throw error;
    }
  },
  
  // Get CSR activity data
  getCSRActivity: async (): Promise<CSRActivityData[]> => {
    try {
      const response = await apiClient.get('/admin/csr-activity');
      return response.data;
    } catch (error) {
      logError('adminService', 'Error fetching CSR activity data:', error);
      throw error;
    }
  },
  
  // Coaching Session Methods

  /**
   * Fetch coaching sessions with pagination and filters
   * @param page Current page number
   * @param limit Number of items per page
   * @param searchTerm Search term for CSR name or topic
   * @param filters Filter options
   * @returns Promise with coaching sessions and pagination info
   */
  getCoachingSessions: async (
    page = 1, 
    limit = 10, 
    searchTerm = '', 
    filters: CoachingSessionFilters
  ): Promise<PaginatedCoachingSessions> => {
    const { search, ...otherFilters } = filters;
    const response = await apiClient.get('/admin/coaching-sessions', {
      params: { 
        page, 
        limit, 
        search: searchTerm || search,
        ...otherFilters
      }
    });
    return response.data.data;
  },

  /**
   * Export coaching sessions with current filters
   * @param params Current coaching session filters
   * @returns Promise with Excel blob
   */
  exportCoachingSessions: async (params: Record<string, any>): Promise<Blob> => {
    const response = await apiClient.get('/admin/coaching-sessions/export', {
      params,
      responseType: 'blob'
    });

    return response.data;
  },

  /**
   * Get coaching session details by ID
   * @param sessionId Session ID
   * @returns Promise with session details
   */
  getCoachingSessionDetails: async (sessionId: number): Promise<CoachingSessionDetails> => {
    const response = await apiClient.get(`/admin/coaching-sessions/${sessionId}`);
    return response.data.data;
  },

  /**
   * Create new coaching session
   * @param sessionData Session form data (FormData or CoachingSessionForm)
   * @returns Promise with created session
   */
  createCoachingSession: async (sessionData: FormData | CoachingSessionForm): Promise<CoachingSession> => {
    let formData: FormData;
    
    if (sessionData instanceof FormData) {
      // If it's already FormData, use it directly
      formData = sessionData;
    } else {
      // Convert CoachingSessionForm to FormData
      formData = new FormData();
      
      // Append all form fields
      formData.append('csr_id', sessionData.csr_id.toString());
      formData.append('session_date', sessionData.session_date);
      formData.append('topic', sessionData.topic);
      formData.append('coaching_type', sessionData.coaching_type);
      formData.append('notes', sessionData.notes);
      formData.append('status', sessionData.status);
      
      // Append file if present
      if (sessionData.attachment) {
        formData.append('attachment', sessionData.attachment);
      }
    }
    
    // Use admin endpoint for creating coaching sessions
    const response = await apiClient.post('/admin/coaching-sessions', formData);
    return response.data.data;
  },

  /**
   * Update coaching session
   * @param sessionId Session ID
   * @param sessionData Updated session data (FormData or CoachingSessionForm)
   * @returns Promise with updated session
   */
  updateCoachingSession: async (sessionId: number, sessionData: FormData | Partial<CoachingSessionForm>): Promise<CoachingSession> => {
    let formData: FormData;
    
    if (sessionData instanceof FormData) {
      // If it's already FormData, use it directly
      formData = sessionData;
    } else {
      // Convert CoachingSessionForm to FormData
      formData = new FormData();
      
      // Append provided form fields
      if (sessionData.csr_id !== undefined) {
        formData.append('csr_id', sessionData.csr_id.toString());
      }
      if (sessionData.session_date) {
        formData.append('session_date', sessionData.session_date);
      }
      if (sessionData.topic) {
        formData.append('topic', sessionData.topic);
      }
      if (sessionData.coaching_type) {
        formData.append('coaching_type', sessionData.coaching_type);
      }
      if (sessionData.notes !== undefined) {
        formData.append('notes', sessionData.notes);
      }
      if (sessionData.status) {
        formData.append('status', sessionData.status);
      }
      
      // Append file if present
      if (sessionData.attachment) {
        formData.append('attachment', sessionData.attachment);
      }
    }
    
    // Use admin endpoint for updating
    const response = await apiClient.put(`/admin/coaching-sessions/${sessionId}`, formData);
    return response.data.data;
  },

  /**
   * Mark coaching session as completed
   * @param sessionId Session ID
   * @returns Promise with updated session
   */
  completeCoachingSession: async (sessionId: number): Promise<CoachingSession> => {
    const response = await apiClient.patch(`/admin/coaching-sessions/${sessionId}/complete`);
    return response.data.data;
  },

  /**
   * Re-open a completed coaching session (change status from COMPLETED back to SCHEDULED)
   * @param sessionId Session ID
   * @returns Promise with updated session
   */
  reopenCoachingSession: async (sessionId: number): Promise<CoachingSession> => {
    const response = await apiClient.patch(`/admin/coaching-sessions/${sessionId}/reopen`);
    return response.data.data;
  },

  /**
   * Download coaching session attachment
   * @param sessionId Session ID
   * @returns Promise with file blob
   */
  downloadCoachingSessionAttachment: async (sessionId: number): Promise<Blob> => {
    const response = await apiClient.get(`/admin/coaching-sessions/${sessionId}/attachment`, {
      responseType: 'blob'
    });
    return response.data;
  },

  /**
   * Get all CSRs (admin can see all CSRs, not just team)
   * @returns Promise with CSR options
   */
  getTeamCSRs: async (): Promise<{ data: CSROption[] }> => {
    const response = await apiClient.get('/admin/csrs');
    return response.data;
  }
};

export default adminService; 