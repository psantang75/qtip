import apiClient from './apiClient';
import type { 
  CSRCoachingSession, 
  CSRCoachingFilters, 
  PaginatedCSRCoaching 
} from '../types/csr.types';

/**
 * Service for handling CSR coaching session API calls
 * Provides methods for fetching coaching sessions, session details, and downloading attachments
 * All methods include proper error handling and input validation
 */

/**
 * Fetch coaching sessions for CSR with pagination and filters
 * @param page - Page number (1-based)
 * @param pageSize - Number of items per page (1-100)
 * @param filters - Filter criteria for sessions
 * @returns Promise resolving to paginated coaching session data
 * @throws Error if API request fails or returns invalid data
 */
export const getCSRCoachingSessions = async (
  page: number = 1,
  pageSize: number = 10,
  filters: CSRCoachingFilters = { status: 'all', coaching_type: 'all', startDate: '', endDate: '', search: '' }
): Promise<PaginatedCSRCoaching> => {
  try {
    const params = {
      page,
      pageSize,
      ...filters
    };
    
    // Debug logging only in development
    if (process.env.NODE_ENV === 'development') {
      console.log('CSR Coaching Service - API params:', params);
    }
    
    const response = await apiClient.get('/csr/coaching-sessions', { params });
    
    // Handle new structured response format
    const responseData = response.data.success ? response.data.data : response.data;
    
    // Transform the response to match our interface
    return {
      sessions: responseData.sessions || [],
      totalCount: responseData.totalCount || 0,
      page: responseData.currentPage || page,
      limit: responseData.pageSize || pageSize
    };
  } catch (error) {
    console.error('Error fetching CSR coaching sessions:', error);
    throw error;
  }
};

/**
 * Get coaching session details by ID
 * @param sessionId - The ID of the coaching session to fetch
 * @returns Promise resolving to detailed coaching session data
 * @throws Error if session ID is invalid or API request fails
 */
export const getCSRCoachingSessionDetails = async (sessionId: number): Promise<CSRCoachingSession> => {
  try {
    // Validate session ID
    if (!sessionId || sessionId <= 0) {
      throw new Error('Invalid session ID');
    }
    
    const response = await apiClient.get(`/csr/coaching-sessions/${sessionId}`);
    
    // Handle new structured response format
    const sessionData = response.data.success ? response.data.data : response.data;
    
    return sessionData;
  } catch (error) {
    console.error('Error fetching CSR coaching session details:', error);
    throw error;
  }
};

/**
 * Download coaching session attachment
 * @param sessionId - The ID of the coaching session containing the attachment
 * @returns Promise resolving to a Blob containing the file data
 * @throws Error if session ID is invalid or download fails
 */
export const downloadCSRCoachingAttachment = async (sessionId: number): Promise<Blob> => {
  try {
    const response = await apiClient.get(`/csr/coaching-sessions/${sessionId}/attachment`, {
      responseType: 'blob'
    });
    return response.data;
  } catch (error) {
    console.error('Error downloading coaching attachment:', error);
    throw error;
  }
};

 