import apiClient from './apiClient';
import authService from './authService';

// Types for Call Management
export interface Call {
  id: number;
  call_id: string;
  csr_id: number;
  customer_id: string | null;
  call_date: string;
  duration: number;
  recording_url: string | null;
  transcript: string | null;
  csr_name?: string;
  department_name?: string;
}

export interface CallSearchParams {
  csr_id?: number;
  customer_id?: string;
  date_start?: string;
  date_end?: string;
  search?: string;
  external_id?: string; // Add this property
}

export interface PaginatedCallResponse {
  items: Call[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
}

// Call management service functions
const callService = {
  // Search calls with filters
  searchCalls: async (params: CallSearchParams): Promise<Call[]> => {
    try {
      console.log('[CALL SERVICE] Searching calls with params:', params);
      
      const response = await apiClient.get('/calls/search', { params });
      
      console.log('[CALL SERVICE] Search results:', response.data);
      
      // Handle different response formats
      if (Array.isArray(response.data)) {
        return response.data;
      } else if (response.data && Array.isArray(response.data.items)) {
        return response.data.items;
      } else {
        console.warn('[CALL SERVICE] Unexpected search response format:', response.data);
        return [];
      }
    } catch (error) {
      console.error('[CALL SERVICE] Error searching calls:', error);
      throw new Error('Failed to search calls. Please try again.');
    }
  },

  // Get a single call by ID
  getCallById: async (callId: string): Promise<Call> => {
    try {
      console.log('[CALL SERVICE] Fetching call by ID:', callId);
      
      const response = await apiClient.get(`/calls/${callId}`);
      
      console.log('[CALL SERVICE] Call details:', response.data);
      
      return response.data;
    } catch (error) {
      console.error(`[CALL SERVICE] Error fetching call ${callId}:`, error);
      throw new Error('Call not found or invalid Call ID.');
    }
  },

  // Get calls for a specific CSR
  getCallsForCSR: async (csrId: number, page: number = 1, limit: number = 20): Promise<PaginatedCallResponse> => {
    try {
      console.log('[CALL SERVICE] Fetching calls for CSR:', csrId);
      
      const response = await apiClient.get('/calls/search', {
        params: { 
          csr_id: csrId, 
          page, 
          limit 
        }
      });
      
      console.log('[CALL SERVICE] CSR calls response:', response.data);
      
      // Handle paginated response
      if (response.data && typeof response.data === 'object' && 'items' in response.data) {
        return response.data;
      }
      
      // Handle direct array response (convert to paginated format)
      if (Array.isArray(response.data)) {
        return {
          items: response.data,
          totalItems: response.data.length,
          totalPages: 1,
          currentPage: 1
        };
      }
      
      console.warn('[CALL SERVICE] Unexpected CSR calls response format:', response.data);
      return {
        items: [],
        totalItems: 0,
        totalPages: 0,
        currentPage: page
      };
    } catch (error) {
      console.error(`[CALL SERVICE] Error fetching calls for CSR ${csrId}:`, error);
      throw new Error('Failed to load calls for CSR. Please try again.');
    }
  },

  // Get calls within a date range
  getCallsByDateRange: async (
    startDate: string, 
    endDate: string, 
    page: number = 1, 
    limit: number = 20
  ): Promise<PaginatedCallResponse> => {
    try {
      console.log('[CALL SERVICE] Fetching calls by date range:', { startDate, endDate });
      
      const response = await apiClient.get('/calls/search', {
        params: { 
          date_start: startDate, 
          date_end: endDate, 
          page, 
          limit 
        }
      });
      
      console.log('[CALL SERVICE] Date range calls response:', response.data);
      
      // Handle paginated response
      if (response.data && typeof response.data === 'object' && 'items' in response.data) {
        return response.data;
      }
      
      // Handle direct array response (convert to paginated format)
      if (Array.isArray(response.data)) {
        return {
          items: response.data,
          totalItems: response.data.length,
          totalPages: 1,
          currentPage: 1
        };
      }
      
      console.warn('[CALL SERVICE] Unexpected date range calls response format:', response.data);
      return {
        items: [],
        totalItems: 0,
        totalPages: 0,
        currentPage: page
      };
    } catch (error) {
      console.error(`[CALL SERVICE] Error fetching calls by date range:`, error);
      throw new Error('Failed to load calls for the specified date range. Please try again.');
    }
  },

  // Get recent calls (for dashboard widgets, etc.)
  getRecentCalls: async (limit: number = 10): Promise<Call[]> => {
    try {
      console.log('[CALL SERVICE] Fetching recent calls, limit:', limit);
      
      const response = await apiClient.get('/calls/recent', {
        params: { limit }
      });
      
      console.log('[CALL SERVICE] Recent calls response:', response.data);
      
      // Handle different response formats
      if (Array.isArray(response.data)) {
        return response.data;
      } else if (response.data && Array.isArray(response.data.items)) {
        return response.data.items;
      } else {
        console.warn('[CALL SERVICE] Unexpected recent calls response format:', response.data);
        return [];
      }
    } catch (error) {
      console.error('[CALL SERVICE] Error fetching recent calls:', error);
      
      // Return empty array instead of throwing for non-critical operations
      console.warn('[CALL SERVICE] Returning empty array due to API error');
      return [];
    }
  },

  // Get call statistics for a CSR
  getCSRCallStats: async (csrId: number, startDate?: string, endDate?: string): Promise<{
    totalCalls: number;
    avgDuration: number;
    totalDuration: number;
  }> => {
    try {
      console.log('[CALL SERVICE] Fetching call stats for CSR:', csrId);
      
      const params: any = { csr_id: csrId };
      if (startDate) params.date_start = startDate;
      if (endDate) params.date_end = endDate;
      
      const response = await apiClient.get('/calls/stats', { params });
      
      console.log('[CALL SERVICE] Call stats response:', response.data);
      
      return response.data;
    } catch (error) {
      console.error(`[CALL SERVICE] Error fetching call stats for CSR ${csrId}:`, error);
      
      // Return default stats instead of throwing
      console.warn('[CALL SERVICE] Returning default stats due to API error');
      return {
        totalCalls: 0,
        avgDuration: 0,
        totalDuration: 0
      };
    }
  },

  // Format call duration for display
  formatDuration: (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  },

  // Format call date for display
  formatDate: (dateString: string): string => {
    const options: Intl.DateTimeFormatOptions = { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    };
    return new Date(dateString).toLocaleDateString(undefined, options);
  },

  // Check if current user can access call
  canAccessCall: (call: Call): boolean => {
    const currentUser = authService.getCurrentUser();
    if (!currentUser) return false;
    
    // Note: This is a basic implementation. In practice, you'd need to
    // check the user's role name from a role mapping or additional API call
    // since the User interface only contains role_id, not role name
    
    // For now, we allow access based on user ID matching CSR ID
    // or if they have admin/qa role_id (would need role mapping)
    
    // CSRs can only access their own calls
    if (call.csr_id === currentUser.id) {
      return true;
    }
    
    // TODO: Implement proper role-based access control
    // This would require either:
    // 1. Adding role name to User interface
    // 2. Creating a role mapping service
    // 3. Making an API call to check permissions
    
    return false;
  },

  // Check if call exists in database by conversation ID
  checkCallExists: async (conversationId: string): Promise<boolean> => {
    try {
      console.log('[CALL SERVICE] Checking if call exists:', conversationId);
      
      const response = await apiClient.get('/calls/search', {
        params: { 
          external_id: conversationId,
          limit: 1
        }
      });
      
      console.log('[CALL SERVICE] Check exists response:', response.data);
      
      // Check if any calls were found
      const calls = Array.isArray(response.data) ? response.data : 
                   (response.data && Array.isArray(response.data.items)) ? response.data.items : [];
      
      const exists = calls.length > 0;
      console.log(`[CALL SERVICE] Call ${conversationId} exists: ${exists}`);
      
      return exists;
    } catch (error) {
      console.error('[CALL SERVICE] Error checking if call exists:', error);
      throw new Error('Failed to check if call exists. Please try again.');
    }
  },

  // Check if conversation ID is already used in any submission
  checkConversationIdInSubmissions: async (conversationId: string): Promise<{ exists: boolean; submissions: any[] }> => {
    try {
      console.log('[CALL SERVICE] Checking if conversation ID is used in submissions:', conversationId);
      
      const response = await apiClient.get(`/calls/check-submission/${conversationId}`);
      
      console.log('[CALL SERVICE] Check submission response:', response.data);
      
      return response.data;
    } catch (error) {
      console.error('[CALL SERVICE] Error checking conversation ID in submissions:', error);
      throw new Error('Failed to check if conversation ID is used in submissions. Please try again.');
    }
  }
};

export default callService; 