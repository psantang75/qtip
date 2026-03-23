import { executeQuery } from '../utils/databaseUtils';

/**
 * Interface for tempRecording table structure
 */
export interface TempRecording {
  ConversationID: string;
  Recordings: string;
}

/**
 * Interface for tblConversationTranscript table structure
 */
export interface tblConversationTranscript {
  ConversationID: string;
  Transcript: string;
}

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
 * PhoneSystem Service for handling call recording operations
 * Uses secondary database connection to access PhoneSystem database
 */
class PhoneSystemService {
  /**
   * Get audio URL by conversation ID from tempRecording table
   * @param conversationId - The conversation ID to search for
   * @returns Promise with call recording details including audio URL
   */
  async getAudioUrlByConversationId(conversationId: string): Promise<CallRecordingResponse | null> {
    // TEMPORARILY COMMENTED OUT - tempRecording data retrieval
    console.log(`[PHONE SYSTEM SERVICE] Audio URL retrieval temporarily disabled for conversation ID: ${conversationId}`);
    return null;
    
    /* COMMENTED OUT - tempRecording data retrieval
    try {
      console.log(`[PHONE SYSTEM SERVICE] Fetching audio URL for conversation ID: ${conversationId}`);
      
      const query = `
        SELECT 
          ConversationID,
          Recordings
        FROM tempRecording 
        WHERE ConversationID = ?
        LIMIT 1
      `;
      
      const results = await executeQuery<TempRecording>(query, [conversationId], 'secondary');
      
      if (results.length === 0) {
        console.log(`[PHONE SYSTEM SERVICE] No recording found for conversation ID: ${conversationId}`);
        return null;
      }
      
      const recording = results[0];
      console.log(`[PHONE SYSTEM SERVICE] Found recording:`, {
        conversation_id: recording.ConversationID,
        audio_url: recording.Recordings
      });
      
      return {
        conversation_id: recording.ConversationID,
        audio_url: recording.Recordings
      };
    } catch (error) {
      console.error(`[PHONE SYSTEM SERVICE] Error fetching audio URL for conversation ID ${conversationId}:`, error);
      throw new Error(`Failed to retrieve audio URL for conversation ID: ${conversationId}`);
    }
    */
  }

  /**
   * Get multiple recordings by conversation IDs
   * @param conversationIds - Array of conversation IDs
   * @returns Promise with array of call recording details
   */
  async getAudioUrlsByConversationIds(conversationIds: string[]): Promise<CallRecordingResponse[]> {
    // TEMPORARILY COMMENTED OUT - tempRecording data retrieval
    console.log(`[PHONE SYSTEM SERVICE] Audio URLs retrieval temporarily disabled for ${conversationIds.length} conversation IDs`);
    return [];
    
    /* COMMENTED OUT - tempRecording data retrieval
    try {
      if (conversationIds.length === 0) {
        return [];
      }
      
      console.log(`[PHONE SYSTEM SERVICE] Fetching audio URLs for ${conversationIds.length} conversation IDs`);
      
      const placeholders = conversationIds.map(() => '?').join(',');
      const query = `
        SELECT 
          ConversationID,
          Recordings
        FROM tempRecording 
        WHERE ConversationID IN (${placeholders})
      `;
      
      const results = await executeQuery<TempRecording>(query, conversationIds, 'secondary');
      
      console.log(`[PHONE SYSTEM SERVICE] Found ${results.length} recordings`);
      
      return results.map(recording => ({
        conversation_id: recording.ConversationID,
        audio_url: recording.Recordings
      }));
    } catch (error) {
      console.error(`[PHONE SYSTEM SERVICE] Error fetching audio URLs for conversation IDs:`, error);
      throw new Error('Failed to retrieve audio URLs for conversation IDs');
    }
    */
  }

  /**
   * Get all recordings (since date filtering is not available)
   * @param limit - Maximum number of results to return
   * @returns Promise with array of call recording details
   */
  async getAllRecordings(limit: number = 100): Promise<CallRecordingResponse[]> {
    // TEMPORARILY COMMENTED OUT - tempRecording data retrieval
    console.log(`[PHONE SYSTEM SERVICE] All recordings retrieval temporarily disabled (limit: ${limit})`);
    return [];
    
    /* COMMENTED OUT - tempRecording data retrieval
    try {
      console.log(`[PHONE SYSTEM SERVICE] Getting all recordings (limit: ${limit})`);
      
      const query = `
        SELECT 
          ConversationID,
          Recordings
        FROM tempRecording 
        LIMIT ?
      `;
      
      const results = await executeQuery<TempRecording>(query, [limit], 'secondary');
      
      console.log(`[PHONE SYSTEM SERVICE] Found ${results.length} recordings`);
      
      return results.map(recording => ({
        conversation_id: recording.ConversationID,
        audio_url: recording.Recordings
      }));
    } catch (error) {
      console.error(`[PHONE SYSTEM SERVICE] Error getting all recordings:`, error);
      throw new Error('Failed to get recordings');
    }
    */
  }

  /**
   * Test PhoneSystem database connection
   * @returns Promise with connection status
   */
  async testConnection(): Promise<boolean> {
    try {
      console.log('[PHONE SYSTEM SERVICE] Testing PhoneSystem database connection');
      
      const query = 'SELECT 1 as test';
      await executeQuery(query, [], 'secondary');
      
      console.log('[PHONE SYSTEM SERVICE] PhoneSystem database connection successful');
      return true;
    } catch (error) {
      console.error('[PHONE SYSTEM SERVICE] PhoneSystem database connection failed:', error);
      return false;
    }
  }

  /**
   * Get PhoneSystem database statistics
   * @returns Promise with database statistics
   */
  async getDatabaseStats(): Promise<{
    totalRecordings: number;
    latestRecording: string | null;
    oldestRecording: string | null;
  }> {
    try {
      console.log('[PHONE SYSTEM SERVICE] Getting database statistics');
      
      const statsQuery = `
        SELECT 
          COUNT(*) as total_recordings
        FROM tempRecording
      `;
      
      const results = await executeQuery<{
        total_recordings: number;
      }>(statsQuery, [], 'secondary');
      
      if (results.length === 0) {
        return {
          totalRecordings: 0,
          latestRecording: null,
          oldestRecording: null
        };
      }
      
      const stats = results[0];
      
      return {
        totalRecordings: stats.total_recordings,
        latestRecording: null, // Not available since call_date column doesn't exist
        oldestRecording: null  // Not available since call_date column doesn't exist
      };
    } catch (error) {
      console.error('[PHONE SYSTEM SERVICE] Error getting database statistics:', error);
      throw new Error('Failed to get PhoneSystem database statistics');
    }
  }

  /**
   * Get transcript by conversation ID from tblConversationTranscript table
   * @param conversationId - The conversation ID to search for
   * @returns Promise with array of conversation details including transcript
   */
  async getTranscriptByConversationId(conversationId: string): Promise<ConversationDetailResponse[]> {
    try {
      console.log(`[PHONE SYSTEM SERVICE] Fetching transcript for conversation ID: ${conversationId}`);
      
      const query = `
        SELECT 
          ConversationID,
          Transcript
        FROM tblConversationTranscript 
        WHERE ConversationID = ? 
          AND Transcript IS NOT NULL 
          AND Transcript != ''
      `;
      
      const results = await executeQuery<tblConversationTranscript>(query, [conversationId], 'secondary');
      
      if (results.length === 0) {
        console.log(`[PHONE SYSTEM SERVICE] No transcript found for conversation ID: ${conversationId}`);
        return [];
      }
      
      console.log(`[PHONE SYSTEM SERVICE] Found ${results.length} transcripts for conversation ID: ${conversationId}`);
      
      return results.map(conversationDetail => ({
        conversation_id: conversationDetail.ConversationID,
        transcript: conversationDetail.Transcript || ''
      }));
    } catch (error) {
      console.error(`[PHONE SYSTEM SERVICE] Error fetching transcript for conversation ID ${conversationId}:`, error);
      throw new Error(`Failed to retrieve transcript for conversation ID: ${conversationId}`);
    }
  }

  /**
   * Get multiple transcripts by conversation IDs
   * @param conversationIds - Array of conversation IDs
   * @returns Promise with array of conversation detail responses
   */
  async getTranscriptsByConversationIds(conversationIds: string[]): Promise<ConversationDetailResponse[]> {
    try {
      if (conversationIds.length === 0) {
        return [];
      }
      
      console.log(`[PHONE SYSTEM SERVICE] Fetching transcripts for ${conversationIds.length} conversation IDs`);
      
      const placeholders = conversationIds.map(() => '?').join(',');
      const query = `
        SELECT 
          ConversationID,
          Transcript
        FROM tblConversationTranscript 
        WHERE ConversationID IN (${placeholders})
      `;
      
      const results = await executeQuery<tblConversationTranscript>(query, conversationIds, 'secondary');
      
      console.log(`[PHONE SYSTEM SERVICE] Found ${results.length} transcripts`);
      
      return results.map(conversationDetail => ({
        conversation_id: conversationDetail.ConversationID,
        transcript: conversationDetail.Transcript || ''
      }));
    } catch (error) {
      console.error(`[PHONE SYSTEM SERVICE] Error fetching transcripts for conversation IDs:`, error);
      throw new Error('Failed to retrieve transcripts for conversation IDs');
    }
  }

  /**
   * Get both audio URL and transcript by conversation ID
   * @param conversationId - The conversation ID to search for
   * @returns Promise with both audio and transcript details
   */
  async getAudioAndTranscriptByConversationId(conversationId: string): Promise<{
    audio: CallRecordingResponse | null;
    transcript: ConversationDetailResponse[] | null;
  }> {
    try {
      console.log(`[PHONE SYSTEM SERVICE] Fetching audio and transcript for conversation ID: ${conversationId}`);
      
      // Fetch both audio and transcript in parallel
      const [audioResult, transcriptResult] = await Promise.allSettled([
        this.getAudioUrlByConversationId(conversationId),
        this.getTranscriptByConversationId(conversationId)
      ]);
      
      const audio = audioResult.status === 'fulfilled' ? audioResult.value : null;
      const transcript = transcriptResult.status === 'fulfilled' ? transcriptResult.value : null;
      
      console.log(`[PHONE SYSTEM SERVICE] Results for conversation ID ${conversationId}:`, {
        audioFound: !!audio,
        transcriptFound: transcript ? transcript.length : 0
      });
      
      return { audio, transcript };
    } catch (error) {
      console.error(`[PHONE SYSTEM SERVICE] Error fetching audio and transcript for conversation ID ${conversationId}:`, error);
      throw new Error(`Failed to retrieve audio and transcript for conversation ID: ${conversationId}`);
    }
  }
}

// Export singleton instance
export const phoneSystemService = new PhoneSystemService();
export default phoneSystemService; 