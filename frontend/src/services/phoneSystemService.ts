import apiClient from './apiClient';

/**
 * Interface for PhoneSystem call recording response
 */
export interface CallRecordingResponse {
  conversation_id: string;
  audio_url: string;
}

/**
 * Interface for PhoneSystem conversation detail response
 */
export interface ConversationDetailResponse {
  conversation_id: string;
  transcript: string;
}

/**
 * Interface for combined audio and transcript response
 */
export interface AudioAndTranscriptResponse {
  audio: CallRecordingResponse | null;
  transcript: ConversationDetailResponse | null;
}

/**
 * Interface for PhoneSystem API response
 */
export interface PhoneSystemApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}

/**
 * Interface for PhoneSystem database statistics
 */
export interface PhoneSystemStats {
  totalRecordings: number;
  latestRecording: string | null;
  oldestRecording: string | null;
}

/**
 * PhoneSystem Service for frontend
 * Handles communication with PhoneSystem API endpoints
 */
class PhoneSystemService {
  /**
   * Get audio URL by conversation ID
   * @param conversationId - The conversation ID to search for
   * @returns Promise with call recording details including audio URL
   */
  async getAudioUrlByConversationId(conversationId: string): Promise<CallRecordingResponse | null> {
    try {
      console.log(`[PHONE SYSTEM SERVICE] Fetching audio URL for conversation ID: ${conversationId}`);
      
      const response = await apiClient.get<PhoneSystemApiResponse<CallRecordingResponse>>(
        `/phone-system/recording/${encodeURIComponent(conversationId)}`
      );
      
      if (response.data.success) {
        console.log(`[PHONE SYSTEM SERVICE] Found recording:`, response.data.data);
        return response.data.data;
      } else {
        console.warn(`[PHONE SYSTEM SERVICE] No recording found for conversation ID: ${conversationId}`);
        return null;
      }
    } catch (error: any) {
      if (error.response?.status === 404) {
        console.log(`[PHONE SYSTEM SERVICE] No recording found for conversation ID: ${conversationId}`);
        return null;
      }
      
      console.error(`[PHONE SYSTEM SERVICE] Error fetching audio URL for conversation ID ${conversationId}:`, error);
      throw new Error(`Failed to retrieve audio URL for conversation ID: ${conversationId}`);
    }
  }

  /**
   * Get multiple audio URLs by conversation IDs
   * @param conversationIds - Array of conversation IDs
   * @returns Promise with array of call recording details
   */
  async getAudioUrlsByConversationIds(conversationIds: string[]): Promise<CallRecordingResponse[]> {
    try {
      if (conversationIds.length === 0) {
        return [];
      }
      
      console.log(`[PHONE SYSTEM SERVICE] Fetching audio URLs for ${conversationIds.length} conversation IDs`);
      
      const response = await apiClient.post<PhoneSystemApiResponse<CallRecordingResponse[]>>(
        '/phone-system/recordings/batch',
        { conversationIds }
      );
      
      if (response.data.success) {
        console.log(`[PHONE SYSTEM SERVICE] Found ${response.data.data.length} recordings`);
        return response.data.data;
      } else {
        console.warn(`[PHONE SYSTEM SERVICE] Failed to fetch recordings:`, response.data.message);
        return [];
      }
    } catch (error) {
      console.error(`[PHONE SYSTEM SERVICE] Error fetching audio URLs for conversation IDs:`, error);
      throw new Error('Failed to retrieve audio URLs for conversation IDs');
    }
  }

  /**
   * Get all recordings (since date filtering is not available)
   * @param limit - Maximum number of results to return
   * @returns Promise with array of call recording details
   */
  async getAllRecordings(limit: number = 100): Promise<CallRecordingResponse[]> {
    try {
      console.log(`[PHONE SYSTEM SERVICE] Getting all recordings (limit: ${limit})`);
      
      const response = await apiClient.get<PhoneSystemApiResponse<CallRecordingResponse[]>>(
        '/phone-system/recordings',
        {
          params: {
            limit
          }
        }
      );
      
      if (response.data.success) {
        console.log(`[PHONE SYSTEM SERVICE] Found ${response.data.data.length} recordings`);
        return response.data.data;
      } else {
        console.warn(`[PHONE SYSTEM SERVICE] Failed to get recordings:`, response.data.message);
        return [];
      }
    } catch (error) {
      console.error(`[PHONE SYSTEM SERVICE] Error getting recordings:`, error);
      throw new Error('Failed to get recordings');
    }
  }

  /**
   * Test PhoneSystem database connection
   * @returns Promise with connection status
   */
  async testConnection(): Promise<boolean> {
    try {
      console.log('[PHONE SYSTEM SERVICE] Testing PhoneSystem database connection');
      
      const response = await apiClient.get<PhoneSystemApiResponse<{ status: string }>>(
        '/phone-system/health'
      );
      
      const isConnected = response.data.success && response.data.data.status === 'connected';
      console.log(`[PHONE SYSTEM SERVICE] PhoneSystem database connection: ${isConnected ? 'connected' : 'disconnected'}`);
      
      return isConnected;
    } catch (error) {
      console.error('[PHONE SYSTEM SERVICE] PhoneSystem database connection failed:', error);
      return false;
    }
  }

  /**
   * Get PhoneSystem database statistics
   * @returns Promise with database statistics
   */
  async getDatabaseStats(): Promise<PhoneSystemStats | null> {
    try {
      console.log('[PHONE SYSTEM SERVICE] Getting PhoneSystem database statistics');
      
      const response = await apiClient.get<PhoneSystemApiResponse<PhoneSystemStats>>(
        '/phone-system/stats'
      );
      
      if (response.data.success) {
        console.log('[PHONE SYSTEM SERVICE] Database statistics:', response.data.data);
        return response.data.data;
      } else {
        console.warn(`[PHONE SYSTEM SERVICE] Failed to get statistics:`, response.data.message);
        return null;
      }
    } catch (error) {
      console.error('[PHONE SYSTEM SERVICE] Error getting database statistics:', error);
      throw new Error('Failed to get PhoneSystem database statistics');
    }
  }

  /**
   * Get transcript by conversation ID
   * @param conversationId - The conversation ID to search for
   * @returns Promise with conversation details including transcript
   */
  async getTranscriptByConversationId(conversationId: string): Promise<ConversationDetailResponse | null> {
    try {
      console.log(`[PHONE SYSTEM SERVICE] Fetching transcript for conversation ID: ${conversationId}`);
      
      const response = await apiClient.get<PhoneSystemApiResponse<ConversationDetailResponse>>(
        `/phone-system/transcript/${encodeURIComponent(conversationId)}`
      );
      
      if (response.data.success) {
        console.log(`[PHONE SYSTEM SERVICE] Found transcript:`, response.data.data);
        return response.data.data;
      } else {
        console.warn(`[PHONE SYSTEM SERVICE] No transcript found for conversation ID: ${conversationId}`);
        return null;
      }
    } catch (error: any) {
      if (error.response?.status === 404) {
        console.log(`[PHONE SYSTEM SERVICE] No transcript found for conversation ID: ${conversationId}`);
        return null;
      }
      
      console.error(`[PHONE SYSTEM SERVICE] Error fetching transcript for conversation ID ${conversationId}:`, error);
      throw new Error(`Failed to retrieve transcript for conversation ID: ${conversationId}`);
    }
  }

  /**
   * Get both audio URL and transcript by conversation ID
   * @param conversationId - The conversation ID to search for
   * @returns Promise with both audio and transcript details
   */
  async getAudioAndTranscriptByConversationId(conversationId: string): Promise<AudioAndTranscriptResponse> {
    try {
      console.log(`[PHONE SYSTEM SERVICE] Fetching audio and transcript for conversation ID: ${conversationId}`);
      
      const response = await apiClient.get<PhoneSystemApiResponse<AudioAndTranscriptResponse>>(
        `/phone-system/audio-transcript/${encodeURIComponent(conversationId)}`
      );
      
      if (response.data.success) {
        console.log(`[PHONE SYSTEM SERVICE] Found data:`, {
          audioFound: !!response.data.data.audio,
          transcriptFound: !!response.data.data.transcript
        });
        return response.data.data;
      } else {
        console.warn(`[PHONE SYSTEM SERVICE] No data found for conversation ID: ${conversationId}`);
        return { audio: null, transcript: null };
      }
    } catch (error: any) {
      if (error.response?.status === 404) {
        console.log(`[PHONE SYSTEM SERVICE] No data found for conversation ID: ${conversationId}`);
        return { audio: null, transcript: null };
      }
      
      console.error(`[PHONE SYSTEM SERVICE] Error fetching audio and transcript for conversation ID ${conversationId}:`, error);
      throw new Error(`Failed to retrieve audio and transcript for conversation ID: ${conversationId}`);
    }
  }

  /**
   * Format call duration for display
   * @param seconds - Duration in seconds
   * @returns Formatted duration string (MM:SS)
   */
  formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  /**
   * Format call date for display
   * @param dateString - ISO date string
   * @returns Formatted date string
   */
  formatDate(dateString: string): string {
    const options: Intl.DateTimeFormatOptions = { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    };
    return new Date(dateString).toLocaleDateString(undefined, options);
  }
}

// Export singleton instance
export const phoneSystemService = new PhoneSystemService();
export default phoneSystemService; 