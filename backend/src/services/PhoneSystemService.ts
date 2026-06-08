import { executeQuery } from '../utils/databaseUtils';
import logger from '../config/logger';

/**
 * Row shape returned from `tblConversationRecording` in the PhoneSystem DB.
 * One conversation can have multiple rows here — Genesys writes one
 * recording per communication leg (IVR / queue / agent / transfer), so
 * multi-segment calls produce N audio files.
 */
export interface ConversationRecordingRow {
  ConversationRecordingID: string;
  ConversationID: string;
  RecordingID: string;
  RecordingPath: string;
  OriginalFileName: string | null;
  CreatedOn: Date | string | null;
  Status: string | null;
}

/**
 * Interface for tblConversationTranscript table structure
 */
export interface tblConversationTranscript {
  ConversationID: string;
  Transcript: string;
}

/**
 * One playable recording surfaced to the API / UI. `audio_url` is the
 * internal streaming endpoint (`/api/phone-system/audio/<RecordingID>`)
 * — never the raw UNC `RecordingPath`, which can't be opened by a browser.
 */
export interface CallRecordingResponse {
  conversation_id: string;
  recording_id: string;
  audio_url: string;
  original_filename?: string | null;
  created_on?: string | null;
}

/**
 * Interface for PhoneSystem conversation detail response
 */
export interface ConversationDetailResponse {
  conversation_id: string;
  transcript: string;
}

/**
 * Lightweight metadata pulled from PhoneSystem's tblConversations.
 * Used to populate the real call_date and duration on the virtual call
 * record returned by /api/calls/search and /api/calls/:id.
 */
export interface ConversationMeta {
  conversation_id: string;
  start_et: Date | null;     // ConversationStart_ET
  end_et: Date | null;       // ConversationEnd_ET
  duration_seconds: number;  // 0 when either timestamp is null
}

/**
 * PhoneSystem Service for handling call recording operations.
 * Uses the 'phone' database pool (PHONE_DB_* env block) — a read-only
 * consumer of the external phone system DB. Q-Tip never writes here.
 */
/**
 * Build the relative URL the frontend uses to stream a recording. The
 * actual file lives on a Windows share (`RecordingPath` in the DB); a
 * backend proxy endpoint reads it from disk and pipes it back to the
 * browser with HTTP Range support.
 */
const buildAudioUrl = (recordingId: string): string =>
  `/api/phone-system/audio/${encodeURIComponent(recordingId)}`;

const toIsoOrNull = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isFinite(dt.getTime()) ? dt.toISOString() : null;
};

const toResponse = (row: ConversationRecordingRow): CallRecordingResponse => ({
  conversation_id: row.ConversationID,
  recording_id: row.RecordingID,
  audio_url: buildAudioUrl(row.RecordingID),
  original_filename: row.OriginalFileName,
  created_on: toIsoOrNull(row.CreatedOn),
});

class PhoneSystemService {
  /**
   * Look up the most recent completed audio recording for a conversation.
   * Returns null when nothing playable is available yet.
   * Multi-leg calls (IVR / queue / agent / transfer) can have several
   * recordings — use `getRecordingsForConversation` to get them all.
   */
  async getAudioUrlByConversationId(conversationId: string): Promise<CallRecordingResponse | null> {
    try {
      logger.info(`[PHONE SYSTEM SERVICE] Fetching audio URL for conversation ID: ${conversationId}`);

      const query = `
        SELECT
          ConversationRecordingID,
          ConversationID,
          RecordingID,
          RecordingPath,
          OriginalFileName,
          CreatedOn,
          Status
        FROM tblConversationRecording
        WHERE ConversationID = ?
          AND RecordingID IS NOT NULL
          AND RecordingPath IS NOT NULL
          AND RecordingPath <> ''
        ORDER BY CreatedOn DESC
        LIMIT 1
      `;

      const results = await executeQuery<ConversationRecordingRow>(query, [conversationId], 'phone');

      if (results.length === 0) {
        logger.info(`[PHONE SYSTEM SERVICE] No recording found for conversation ID: ${conversationId}`);
        return null;
      }

      const response = toResponse(results[0]);
      logger.info('[PHONE SYSTEM SERVICE] Found recording:', response);
      return response;
    } catch (error) {
      logger.error(`[PHONE SYSTEM SERVICE] Error fetching audio URL for conversation ID ${conversationId}:`, error);
      throw new Error(`Failed to retrieve audio URL for conversation ID: ${conversationId}`);
    }
  }

  /**
   * Return every completed recording for a conversation, newest first.
   * Used so the UI can show one audio player per communication leg.
   */
  async getRecordingsForConversation(conversationId: string): Promise<CallRecordingResponse[]> {
    try {
      const query = `
        SELECT
          ConversationRecordingID,
          ConversationID,
          RecordingID,
          RecordingPath,
          OriginalFileName,
          CreatedOn,
          Status
        FROM tblConversationRecording
        WHERE ConversationID = ?
          AND RecordingID IS NOT NULL
          AND RecordingPath IS NOT NULL
          AND RecordingPath <> ''
        ORDER BY CreatedOn DESC
      `;

      const results = await executeQuery<ConversationRecordingRow>(query, [conversationId], 'phone');
      return results.map(toResponse);
    } catch (error) {
      logger.error(`[PHONE SYSTEM SERVICE] Error fetching recordings for conversation ID ${conversationId}:`, error);
      throw new Error(`Failed to retrieve recordings for conversation ID: ${conversationId}`);
    }
  }

  /**
   * Look up the on-disk path for a recording by its `RecordingID`. The
   * streaming endpoint uses this to read the file from the share.
   */
  async getRecordingPathById(recordingId: string): Promise<{ path: string; originalFilename: string | null } | null> {
    try {
      const query = `
        SELECT RecordingPath, OriginalFileName
        FROM tblConversationRecording
        WHERE RecordingID = ?
          AND RecordingPath IS NOT NULL
          AND RecordingPath <> ''
        ORDER BY CreatedOn DESC
        LIMIT 1
      `;

      const results = await executeQuery<{ RecordingPath: string; OriginalFileName: string | null }>(
        query,
        [recordingId],
        'phone',
      );

      if (results.length === 0) return null;
      return { path: results[0].RecordingPath, originalFilename: results[0].OriginalFileName };
    } catch (error) {
      logger.error(`[PHONE SYSTEM SERVICE] Error fetching recording path for ID ${recordingId}:`, error);
      throw new Error(`Failed to retrieve recording path for ID: ${recordingId}`);
    }
  }

  /**
   * Get the most recent recording for each of several conversation IDs.
   */
  async getAudioUrlsByConversationIds(conversationIds: string[]): Promise<CallRecordingResponse[]> {
    try {
      if (conversationIds.length === 0) return [];

      logger.info(`[PHONE SYSTEM SERVICE] Fetching audio URLs for ${conversationIds.length} conversation IDs`);

      const placeholders = conversationIds.map(() => '?').join(',');
      const query = `
        SELECT t.ConversationRecordingID, t.ConversationID, t.RecordingID, t.RecordingPath, t.OriginalFileName, t.CreatedOn, t.Status
        FROM tblConversationRecording t
        INNER JOIN (
          SELECT ConversationID, MAX(CreatedOn) AS MaxCreatedOn
          FROM tblConversationRecording
          WHERE ConversationID IN (${placeholders})
            AND RecordingID IS NOT NULL
            AND RecordingPath IS NOT NULL
            AND RecordingPath <> ''
          GROUP BY ConversationID
        ) latest ON latest.ConversationID = t.ConversationID AND latest.MaxCreatedOn = t.CreatedOn
      `;

      const results = await executeQuery<ConversationRecordingRow>(query, conversationIds, 'phone');
      logger.info(`[PHONE SYSTEM SERVICE] Found ${results.length} recordings`);
      return results.map(toResponse);
    } catch (error) {
      logger.error('[PHONE SYSTEM SERVICE] Error fetching audio URLs for conversation IDs:', error);
      throw new Error('Failed to retrieve audio URLs for conversation IDs');
    }
  }

  /**
   * Get a slice of the most recent recordings across all conversations.
   * Used by the debug/health endpoints.
   */
  async getAllRecordings(limit: number = 100): Promise<CallRecordingResponse[]> {
    try {
      logger.info(`[PHONE SYSTEM SERVICE] Getting all recordings (limit: ${limit})`);

      const safeLimit = Number.isFinite(limit) && limit > 0 && limit <= 1000 ? Math.floor(limit) : 100;
      const query = `
        SELECT ConversationRecordingID, ConversationID, RecordingID, RecordingPath, OriginalFileName, CreatedOn, Status
        FROM tblConversationRecording
        WHERE RecordingID IS NOT NULL
          AND RecordingPath IS NOT NULL
          AND RecordingPath <> ''
        ORDER BY CreatedOn DESC
        LIMIT ?
      `;

      const results = await executeQuery<ConversationRecordingRow>(query, [safeLimit], 'phone');
      logger.info(`[PHONE SYSTEM SERVICE] Found ${results.length} recordings`);
      return results.map(toResponse);
    } catch (error) {
      logger.error('[PHONE SYSTEM SERVICE] Error getting all recordings:', error);
      throw new Error('Failed to get recordings');
    }
  }

  /**
   * Test PhoneSystem database connection
   * @returns Promise with connection status
   */
  async testConnection(): Promise<boolean> {
    try {
      logger.info('[PHONE SYSTEM SERVICE] Testing PhoneSystem database connection');
      
      const query = 'SELECT 1 as test';
      await executeQuery(query, [], 'phone');
      
      logger.info('[PHONE SYSTEM SERVICE] PhoneSystem database connection successful');
      return true;
    } catch (error) {
      logger.error('[PHONE SYSTEM SERVICE] PhoneSystem database connection failed:', error);
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
      logger.info('[PHONE SYSTEM SERVICE] Getting database statistics');
      
      const statsQuery = `
        SELECT
          COUNT(*) AS total_recordings,
          MAX(CreatedOn) AS latest_recording,
          MIN(CreatedOn) AS oldest_recording
        FROM tblConversationRecording
        WHERE RecordingID IS NOT NULL
          AND RecordingPath IS NOT NULL
          AND RecordingPath <> ''
      `;

      const results = await executeQuery<{
        total_recordings: number;
        latest_recording: Date | string | null;
        oldest_recording: Date | string | null;
      }>(statsQuery, [], 'phone');

      if (results.length === 0) {
        return { totalRecordings: 0, latestRecording: null, oldestRecording: null };
      }

      const stats = results[0];
      return {
        totalRecordings: Number(stats.total_recordings) || 0,
        latestRecording: toIsoOrNull(stats.latest_recording),
        oldestRecording: toIsoOrNull(stats.oldest_recording),
      };
    } catch (error) {
      logger.error('[PHONE SYSTEM SERVICE] Error getting database statistics:', error);
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
      logger.info(`[PHONE SYSTEM SERVICE] Fetching transcript for conversation ID: ${conversationId}`);
      
      const query = `
        SELECT 
          ConversationID,
          Transcript
        FROM tblConversationTranscript 
        WHERE ConversationID = ? 
          AND Transcript IS NOT NULL 
          AND Transcript != ''
      `;
      
      const results = await executeQuery<tblConversationTranscript>(query, [conversationId], 'phone');
      
      if (results.length === 0) {
        logger.info(`[PHONE SYSTEM SERVICE] No transcript found for conversation ID: ${conversationId}`);
        return [];
      }
      
      logger.info(`[PHONE SYSTEM SERVICE] Found ${results.length} transcripts for conversation ID: ${conversationId}`);
      
      return results.map(conversationDetail => ({
        conversation_id: conversationDetail.ConversationID,
        transcript: conversationDetail.Transcript || ''
      }));
    } catch (error) {
      logger.error(`[PHONE SYSTEM SERVICE] Error fetching transcript for conversation ID ${conversationId}:`, error);
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
      
      logger.info(`[PHONE SYSTEM SERVICE] Fetching transcripts for ${conversationIds.length} conversation IDs`);
      
      const placeholders = conversationIds.map(() => '?').join(',');
      const query = `
        SELECT 
          ConversationID,
          Transcript
        FROM tblConversationTranscript 
        WHERE ConversationID IN (${placeholders})
      `;
      
      const results = await executeQuery<tblConversationTranscript>(query, conversationIds, 'phone');
      
      logger.info(`[PHONE SYSTEM SERVICE] Found ${results.length} transcripts`);
      
      return results.map(conversationDetail => ({
        conversation_id: conversationDetail.ConversationID,
        transcript: conversationDetail.Transcript || ''
      }));
    } catch (error) {
      logger.error(`[PHONE SYSTEM SERVICE] Error fetching transcripts for conversation IDs:`, error);
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
    recordings: CallRecordingResponse[];
    transcript: ConversationDetailResponse[] | null;
  }> {
    try {
      logger.info(`[PHONE SYSTEM SERVICE] Fetching audio and transcript for conversation ID: ${conversationId}`);

      const [recordingsResult, transcriptResult] = await Promise.allSettled([
        this.getRecordingsForConversation(conversationId),
        this.getTranscriptByConversationId(conversationId)
      ]);

      const recordings = recordingsResult.status === 'fulfilled' ? recordingsResult.value : [];
      const audio = recordings.length > 0 ? recordings[0] : null;
      const transcript = transcriptResult.status === 'fulfilled' ? transcriptResult.value : null;

      logger.info(`[PHONE SYSTEM SERVICE] Results for conversation ID ${conversationId}:`, {
        recordingsFound: recordings.length,
        transcriptFound: transcript ? transcript.length : 0
      });

      return { audio, recordings, transcript };
    } catch (error) {
      logger.error(`[PHONE SYSTEM SERVICE] Error fetching audio and transcript for conversation ID ${conversationId}:`, error);
      throw new Error(`Failed to retrieve audio and transcript for conversation ID: ${conversationId}`);
    }
  }

  /**
   * Fetch start/end timestamps and duration for a conversation. Returns null
   * when no matching row exists in tblConversations (e.g. transcript present
   * but no conversation header yet — rare but possible during ingestion).
   */
  async getConversationMetaByConversationId(conversationId: string): Promise<ConversationMeta | null> {
    try {
      logger.info(`[PHONE SYSTEM SERVICE] Fetching conversation meta for: ${conversationId}`);

      const query = `
        SELECT
          ConversationId,
          ConversationStart_ET,
          ConversationEnd_ET,
          TIMESTAMPDIFF(SECOND, ConversationStart_ET, ConversationEnd_ET) AS duration_seconds
        FROM tblConversations
        WHERE ConversationId = ?
        LIMIT 1
      `;

      const rows = await executeQuery<{
        ConversationId: string;
        ConversationStart_ET: Date | null;
        ConversationEnd_ET: Date | null;
        duration_seconds: number | null;
      }>(query, [conversationId], 'phone');

      if (rows.length === 0) {
        logger.info(`[PHONE SYSTEM SERVICE] No conversation meta found for: ${conversationId}`);
        return null;
      }

      const row = rows[0];
      return {
        conversation_id: row.ConversationId,
        start_et: row.ConversationStart_ET,
        end_et: row.ConversationEnd_ET,
        duration_seconds: row.duration_seconds && row.duration_seconds > 0 ? row.duration_seconds : 0,
      };
    } catch (error) {
      logger.error(`[PHONE SYSTEM SERVICE] Error fetching conversation meta for ${conversationId}:`, error);
      return null;
    }
  }
}

// Export singleton instance
export const phoneSystemService = new PhoneSystemService();
export default phoneSystemService; 