import apiClient from './apiClient';
import type { 
  ManagerStats, 
  TeamAudit, 
  ManagerDashboardData,
  PaginatedAudits,
  ManagerTeamAudit,
  ManagerTeamAuditDetails,
  PaginatedTeamAudits,
  TeamAuditFilters,
  CSROption,
  FormOption,
  DisputeFilters,
  PaginatedDisputes,
  DisputeDetails,
  ResolutionForm,
  CoachingSession,
  CoachingSessionDetails,
  CoachingSessionForm,
  CoachingSessionFilters,
  PaginatedCoachingSessions
} from '../types/manager.types';

// Additional types for new dashboard functionality
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

/**
 * Service for handling manager-related API calls
 */
class ManagerService {
  /**
   * Fetch manager dashboard summary statistics
   * @returns Promise with manager stats
   */
  async getManagerStats(): Promise<ManagerStats> {
    const response = await apiClient.get('/manager/stats');
    return response.data.data;
  }

  /**
   * Fetch recent team audits with pagination
   * @param page Current page number
   * @param pageSize Number of items per page
   * @returns Promise with team audits and pagination info
   */
  async getTeamAudits(page = 1, pageSize = 5): Promise<PaginatedAudits> {
    const response = await apiClient.get('/manager/audits', {
      params: { page, limit: pageSize }
    });
    return response.data;
  }

  /**
   * Fetch all manager dashboard data at once
   * @returns Promise with complete dashboard data
   */
  async getDashboardData(): Promise<ManagerDashboardData> {
    const response = await apiClient.get('/manager/dashboard');
    return response.data;
  }

  /**
   * Get team audits with filtering and pagination
   * @param page Current page number
   * @param limit Number of items per page
   * @param searchTerm Search term for CSR name or audit ID
   * @param filters Filter options (flexible like CSR service)
   * @returns Promise with team audits and pagination info
   */
  async getManagerTeamAudits(
    page = 1, 
    limit = 20, 
    searchTerm = '', 
    filters?: { 
      formName?: string,
      form_id_search?: string,
      startDate?: string, 
      endDate?: string, 
      status?: string, 
      searchTerm?: string 
    }
  ): Promise<PaginatedTeamAudits> {
    const params = {
      page,
      limit,
      search: searchTerm,
      ...filters
    };

    const response = await apiClient.get('/manager/team-audits', { params });
    return response.data;
  }

  /**
   * Fetch detailed information for a specific team audit
   * @param auditId The audit submission ID
   * @returns Promise with detailed audit information
   */
  async getTeamAuditDetails(auditId: number): Promise<ManagerTeamAuditDetails> {
    const response = await apiClient.get(`/manager/team-audits/${auditId}`);
    return response.data;
  }

  /**
   * Fetch CSRs in the manager's team for filter dropdown
   * @returns Promise with CSR options
   */
  async getTeamCSRs(): Promise<{ data: CSROption[] }> {
    const response = await apiClient.get('/manager/team-csrs');
    return response.data;
  }

  /**
   * Fetch available forms for filter dropdown
   * @returns Promise with form options
   */
  async getForms(): Promise<FormOption[]> {
    const response = await apiClient.get('/manager/forms');
    return response.data.data;
  }

  /**
   * Fetch team disputes with filtering and pagination
   * @param params Query parameters including filters and pagination
   * @returns Promise with disputes and pagination info
   */
  async getTeamDisputes(params: any): Promise<PaginatedDisputes> {
    const response = await apiClient.get('/manager/disputes', { params });
    
    // Transform the response to match the expected interface
    return {
      disputes: (response.data.disputes || []).map((dispute: any) => ({
        id: dispute.dispute_id,
        submission_id: dispute.submission_id,
        csr_id: dispute.csr_id,
        csr_name: dispute.csr_name,
        form_id: dispute.form_id,
        form_name: dispute.form_name,
        reason: dispute.reason,
        status: dispute.status,
        created_at: dispute.created_at,
        resolved_at: dispute.resolved_at,
        resolution_notes: dispute.resolution_notes,
        total_score: dispute.total_score,
        previous_score: dispute.previous_score,
        adjusted_score: dispute.adjusted_score,
        qa_analyst_name: dispute.qa_analyst_name
      })),
      total: response.data.total || 0,
      page: response.data.page || 1,
      pageSize: response.data.limit || 10,
      totalPages: response.data.totalPages || Math.ceil((response.data.total || 0) / (response.data.limit || 10))
    };
  }

  /**
   * Export team disputes with the current filters applied
   * @param params Query parameters including active filters
   * @returns Promise with exported Excel blob
   */
  async exportTeamDisputes(params: any): Promise<Blob> {
    const response = await apiClient.get('/manager/disputes/export', {
      params,
      responseType: 'blob'
    });

    return response.data;
  }

  /**
   * Fetch detailed information for a specific dispute
   * @param disputeId The dispute ID
   * @returns Promise with detailed dispute information
   */
  async getDisputeDetails(disputeId: number): Promise<DisputeDetails> {
    const response = await apiClient.get(`/manager/disputes/${disputeId}`);
    
    // Transform the response to match the expected interface
    const data = response.data;
    return {
      id: data.dispute_id,
      submission_id: data.submission_id,
      csr_id: data.csr_id || 0, // Backend might not include this
      csr_name: data.csr_name,
      form_id: data.form_id || 0, // Backend might not include this
      form_name: data.form_name,
      reason: data.reason,
      status: data.status,
      created_at: data.created_at,
      resolved_at: data.resolved_at,
      resolution_notes: data.resolution_notes,
      total_score: data.total_score,
      previous_score: data.previous_score,
      adjusted_score: data.adjusted_score,
      qa_analyst_name: data.qa_analyst_name || '',
      audit_details: {
        metadata: [], // Backend provides this differently
        answers: (data.answers || []).map((answer: any) => ({
          question_id: answer.question_id,
          question_text: answer.question_text,
          answer: answer.answer,
          notes: answer.notes,
          category_name: answer.category_name || ''
        })),
        calls: data.call ? [{
          call_id: '', // Backend doesn't provide this structure
          call_date: '',
          duration: 0,
          transcript: data.call.transcript,
          recording_url: data.call.audio_url
        }] : []
      },
      attachments: [] // Backend might not provide this
    };
  }

  /**
   * Resolve a dispute
   * @param disputeId The dispute ID
   * @param resolutionData The resolution form data
   * @returns Promise with resolution result
   */
  async resolveDispute(disputeId: number, resolutionData: ResolutionForm): Promise<any> {
    const response = await apiClient.post(`/manager/disputes/${disputeId}/resolve`, resolutionData);
    return response.data;
  }

  /**
   * Fetch available courses for training assignment
   * @returns Promise with course options
   */
  async getCourses(): Promise<{ data: any[] }> {
    const response = await apiClient.get('/manager/courses');
    return response.data;
  }

  // Coaching Session Methods

  /**
   * Fetch coaching sessions with pagination and filters
   * @param page Current page number
   * @param limit Number of items per page
   * @param searchTerm Search term for CSR name or topic
   * @param filters Filter options
   * @returns Promise with coaching sessions and pagination info
   */
  async getCoachingSessions(
    page = 1, 
    limit = 10, 
    searchTerm = '', 
    filters: CoachingSessionFilters
  ): Promise<PaginatedCoachingSessions> {
    const { search, ...otherFilters } = filters;
    const response = await apiClient.get('/manager/coaching-sessions', {
      params: { 
        page, 
        limit, 
        search: searchTerm || search,
        ...otherFilters
      }
    });
    return response.data.data;
  }

  /**
   * Export coaching sessions with current filters
   * @param params Current coaching session filters
   * @returns Promise with Excel blob
   */
  async exportCoachingSessions(params: Record<string, any>): Promise<Blob> {
    const response = await apiClient.get('/manager/coaching-sessions/export', {
      params,
      responseType: 'blob'
    });
    return response.data;
  }

  /**
   * Get coaching session details by ID
   * @param sessionId Session ID
   * @returns Promise with session details
   */
  async getCoachingSessionDetails(sessionId: number): Promise<CoachingSessionDetails> {
    const response = await apiClient.get(`/manager/coaching-sessions/${sessionId}`);
    return response.data.data;
  }

  /**
   * Create new coaching session
   * @param sessionData Session form data (FormData or CoachingSessionForm)
   * @returns Promise with created session
   */
  async createCoachingSession(sessionData: FormData | CoachingSessionForm): Promise<CoachingSession> {
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
      // Handle topic_ids array
      if (sessionData.topic_ids && Array.isArray(sessionData.topic_ids) && sessionData.topic_ids.length > 0) {
        sessionData.topic_ids.forEach((topicId) => {
          formData.append('topic_ids', topicId.toString());
        });
      }
      // Legacy support for backward compatibility
      if (sessionData.topic) {
        formData.append('topic', sessionData.topic);
      }
      if (sessionData.topic_id) {
        formData.append('topic_id', sessionData.topic_id.toString());
      }
      formData.append('coaching_type', sessionData.coaching_type);
      formData.append('notes', sessionData.notes);
      formData.append('status', sessionData.status);
      
      // Append file if present
      if (sessionData.attachment) {
        formData.append('attachment', sessionData.attachment);
      }
    }
    
    // Don't set Content-Type header - axios will automatically set it with the correct boundary for FormData
    const response = await apiClient.post('/manager/coaching-sessions', formData);
    return response.data.data;
  }

  /**
   * Update coaching session
   * @param sessionId Session ID
   * @param sessionData Updated session data (FormData or CoachingSessionForm)
   * @returns Promise with updated session
   */
  async updateCoachingSession(sessionId: number, sessionData: FormData | Partial<CoachingSessionForm>): Promise<CoachingSession> {
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
      // Handle topic_ids array
      if (sessionData.topic_ids && Array.isArray(sessionData.topic_ids) && sessionData.topic_ids.length > 0) {
        sessionData.topic_ids.forEach((topicId) => {
          formData.append('topic_ids', topicId.toString());
        });
      }
      // Legacy support for backward compatibility
      if (sessionData.topic) {
        formData.append('topic', sessionData.topic);
      }
      if (sessionData.topic_id !== undefined) {
        formData.append('topic_id', sessionData.topic_id?.toString() || '');
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
    
    // Don't set Content-Type header - axios will automatically set it with the correct boundary for FormData
    const response = await apiClient.put(`/manager/coaching-sessions/${sessionId}`, formData);
    return response.data.data;
  }

  /**
   * Mark coaching session as completed
   * @param sessionId Session ID
   * @returns Promise with updated session
   */
  async completeCoachingSession(sessionId: number): Promise<CoachingSession> {
    const response = await apiClient.patch(`/manager/coaching-sessions/${sessionId}/complete`);
    return response.data.data;
  }

  /**
   * Re-open a completed coaching session (change status from COMPLETED back to SCHEDULED)
   * @param sessionId Session ID
   * @returns Promise with updated session
   */
  async reopenCoachingSession(sessionId: number): Promise<CoachingSession> {
    // Use the dedicated reopen endpoint
    const response = await apiClient.patch(`/manager/coaching-sessions/${sessionId}/reopen`);
    return response.data.data;
  }

  /**
   * Download coaching session attachment
   * @param sessionId Session ID
   * @returns Promise with file blob
   */
  async downloadCoachingSessionAttachment(sessionId: number): Promise<Blob> {
    const response = await apiClient.get(`/manager/coaching-sessions/${sessionId}/attachment`, {
      responseType: 'blob'
    });
    return response.data;
  }

  // New dashboard statistics methods

  /**
   * Get dashboard statistics (filtered to manager's department)
   * @returns Promise with new dashboard statistics
   */
  async getDashboardStats(): Promise<NewDashboardStats> {
    try {
      const response = await apiClient.get('/manager/dashboard-stats');
      return response.data;
    } catch (error) {
      console.error('Error fetching manager dashboard stats:', error);
      throw error;
    }
  }

  /**
   * Get CSR activity data (filtered to manager's department)
   * @returns Promise with CSR activity data
   */
  async getCSRActivity(): Promise<CSRActivityData[]> {
    try {
      const response = await apiClient.get('/manager/csr-activity');
      return response.data;
    } catch (error) {
      console.error('Error fetching manager CSR activity data:', error);
      throw error;
    }
  }
}

export default new ManagerService(); 