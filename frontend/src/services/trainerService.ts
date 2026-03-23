import axios from 'axios';
import apiClient from './apiClient';
import type { 
  TrainingStats, 
  CourseItem, 
  TraineeProgress 
} from '../types/trainer.types';
import type { 
  CoachingSession,
  CoachingSessionDetails,
  CoachingSessionForm,
  CoachingSessionFilters,
  CSROption,
  PaginatedCoachingSessions
} from '../types/manager.types';

// Interfaces for trainer dashboard
export interface WeeklyMonthlyStats {
  thisWeek: number;
  thisMonth: number;
}

export interface TrainerCSRActivityData {
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

export interface TrainerDashboardStats {
  reviewsCompleted: WeeklyMonthlyStats;
  disputes: WeeklyMonthlyStats;
  coachingSessions: WeeklyMonthlyStats;
  trainingAssignments: WeeklyMonthlyStats;
}

/**
 * Service for handling trainer-related API calls
 */
class TrainerService {
  /**
   * Fetch training summary statistics
   * @returns Promise with training stats
   */
  async getTrainingStats(): Promise<TrainingStats> {
    const response = await apiClient.get('/trainer/stats');
    return response.data;
  }

  /**
   * Fetch active courses with pagination
   * @param page Current page number
   * @param pageSize Number of items per page
   * @returns Promise with courses and pagination info
   */
  async getActiveCourses(page = 1, pageSize = 10): Promise<{
    courses: CourseItem[];
    total: number;
  }> {
    const response = await apiClient.get('/trainer/courses', {
      params: { page, pageSize }
    });
    return response.data;
  }

  /**
   * Fetch trainee progress with pagination
   * @param page Current page number
   * @param pageSize Number of items per page
   * @returns Promise with trainee progress and pagination info
   */
  async getTraineeProgress(page = 1, pageSize = 10): Promise<{
    trainees: TraineeProgress[];
    total: number;
  }> {
    const response = await apiClient.get('/trainer/enrollments', {
      params: { page, pageSize }
    });
    return response.data;
  }

  /**
   * Create a new course
   * @param courseData Course data to create
   * @returns Promise with created course data
   */
  async createCourse(courseData: Partial<CourseItem>): Promise<CourseItem> {
    const response = await apiClient.post('/trainer/courses', courseData);
    return response.data;
  }

  /**
   * Update an existing course
   * @param courseId ID of the course to update
   * @param courseData Updated course data
   * @returns Promise with updated course data
   */
  async updateCourse(courseId: number, courseData: Partial<CourseItem>): Promise<CourseItem> {
    const response = await apiClient.put(`/trainer/courses/${courseId}`, courseData);
    return response.data;
  }

  /**
   * Assign training to a user or group of users
   * @param assignmentData Training assignment data
   * @returns Promise with assignment result
   */
  async assignTraining(assignmentData: { 
    courseId: number; 
    userIds: number[]; 
  }): Promise<{ success: boolean; message: string }> {
    const response = await apiClient.post('/trainer/assign', assignmentData);
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
    const params: any = {
      page: page,
      limit: limit
    };
    
    if (searchTerm) params.search = searchTerm;
    if (filters.csr_id) params.csr_id = filters.csr_id;
    if (filters.status) params.status = filters.status;
    if (filters.coaching_type) params.coaching_type = filters.coaching_type;
    if (filters.startDate) params.startDate = filters.startDate;
    if (filters.endDate) params.endDate = filters.endDate;

    const response = await apiClient.get('/trainer/coaching-sessions', { params });
    return response.data.data; // Backend returns { success: true, data: { sessions, totalCount, page, limit } }
  }

  /**
   * Get coaching session details by ID
   * @param sessionId Session ID
   * @returns Promise with session details
   */
  async getCoachingSessionDetails(sessionId: number): Promise<CoachingSessionDetails> {
    const response = await apiClient.get(`/trainer/coaching-sessions/${sessionId}`);
    return response.data.data; // Backend returns { success: true, data: sessionDetails }
  }

  /**
   * Create new coaching session
   * @param sessionData Session form data
   * @returns Promise with created session
   */
  async createCoachingSession(sessionData: FormData): Promise<CoachingSession> {
    // Don't set Content-Type header - axios will automatically set it with the correct boundary for FormData
    const response = await apiClient.post('/trainer/coaching-sessions', sessionData);
    return response.data.data; // Backend returns { success: true, data: createdSession }
  }

  /**
   * Update coaching session
   * @param sessionId Session ID
   * @param sessionData Updated session data
   * @returns Promise with updated session
   */
  async updateCoachingSession(sessionId: number, sessionData: FormData): Promise<CoachingSession> {
    // Don't set Content-Type header - axios will automatically set it with the correct boundary for FormData
    const response = await apiClient.put(`/trainer/coaching-sessions/${sessionId}`, sessionData);
    return response.data.data; // Backend returns { success: true, data: updatedSession }
  }

  /**
   * Mark coaching session as completed
   * @param sessionId Session ID
   * @returns Promise with updated session
   */
  async completeCoachingSession(sessionId: number): Promise<CoachingSession> {
    const response = await apiClient.patch(`/trainer/coaching-sessions/${sessionId}/complete`);
    return response.data.data; // Backend returns { success: true, data: updatedSession }
  }

  /**
   * Re-open a completed coaching session (change status from COMPLETED back to SCHEDULED)
   * @param sessionId Session ID
   * @returns Promise with updated session
   */
  async reopenCoachingSession(sessionId: number): Promise<CoachingSession> {
    // Use the same working update endpoint that edit uses
    const formData = new FormData();
    formData.append('status', 'SCHEDULED');
    
    // Don't set Content-Type header - axios will automatically set it with the correct boundary for FormData
    const response = await apiClient.put(`/trainer/coaching-sessions/${sessionId}`, formData);
    return response.data.data; // Backend returns { success: true, data: updatedSession }
  }

  /**
   * Download coaching session attachment
   * @param sessionId Session ID
   * @returns Promise with file blob
   */
  async downloadCoachingSessionAttachment(sessionId: number): Promise<Blob> {
    const response = await apiClient.get(`/trainer/coaching-sessions/${sessionId}/attachment`, {
      responseType: 'blob',
    });
    return response.data;
  }

  /**
   * Fetch CSRs in the trainer's scope for filter dropdown
   * @returns Promise with CSR options
   */
  async getTeamCSRs(): Promise<{ data: CSROption[] }> {
    const response = await apiClient.get('/trainer/team-csrs');
    
    // Backend returns: { success: true, data: [{ id, name, email, department }] }
    const csrData = response.data.data || [];
    
    // Transform to CSR options format
    const csrOptions: CSROption[] = csrData.map((csr: any) => ({
      id: csr.id,
      username: csr.name || `User ${csr.id}` // Backend returns 'name', map to 'username'
    }));
    
    return { data: csrOptions };
  }

  // Get trainer dashboard statistics
  async getDashboardStats(): Promise<TrainerDashboardStats> {
    try {
      const response = await apiClient.get('/trainer/dashboard-stats');
      return response.data;
    } catch (error) {
      console.error('Error fetching trainer dashboard stats:', error);
      throw error;
    }
  }
  
  // Get CSR activity data for trainer dashboard
  async getCSRActivity(): Promise<TrainerCSRActivityData[]> {
    try {
      const response = await apiClient.get('/trainer/csr-activity');
      return response.data;
    } catch (error) {
      console.error('Error fetching trainer CSR activity data:', error);
      throw error;
    }
  }
}

export default new TrainerService(); 