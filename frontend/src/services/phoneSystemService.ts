import apiClient from './apiClient';
import type { AxiosError } from 'axios';

export interface CallRecordingResponse {
  conversation_id: string;
  audio_url: string;
}

export interface ConversationDetailResponse {
  conversation_id: string;
  transcript: string;
}

export interface AudioAndTranscriptResponse {
  audio: CallRecordingResponse | null;
  transcript: ConversationDetailResponse | null;
}

export interface PhoneSystemApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}

export interface PhoneSystemStats {
  totalRecordings: number;
  latestRecording: string | null;
  oldestRecording: string | null;
}

class PhoneSystemService {
  async getAudioUrlByConversationId(conversationId: string): Promise<CallRecordingResponse | null> {
    try {
      const response = await apiClient.get<PhoneSystemApiResponse<CallRecordingResponse>>(
        `/phone-system/recording/${encodeURIComponent(conversationId)}`
      );
      return response.data.success ? response.data.data : null;
    } catch (error: unknown) {
      if ((error as AxiosError)?.response?.status === 404) return null;
      throw new Error(`Failed to retrieve audio URL for conversation ID: ${conversationId}`);
    }
  }

  async getAudioUrlsByConversationIds(conversationIds: string[]): Promise<CallRecordingResponse[]> {
    if (conversationIds.length === 0) return [];
    const response = await apiClient.post<PhoneSystemApiResponse<CallRecordingResponse[]>>(
      '/phone-system/recordings/batch',
      { conversationIds }
    );
    return response.data.success ? response.data.data : [];
  }

  async getAllRecordings(limit = 100): Promise<CallRecordingResponse[]> {
    const response = await apiClient.get<PhoneSystemApiResponse<CallRecordingResponse[]>>(
      '/phone-system/recordings',
      { params: { limit } }
    );
    return response.data.success ? response.data.data : [];
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await apiClient.get<PhoneSystemApiResponse<{ status: string }>>(
        '/phone-system/health'
      );
      return response.data.success && response.data.data.status === 'connected';
    } catch {
      return false;
    }
  }

  async getDatabaseStats(): Promise<PhoneSystemStats | null> {
    const response = await apiClient.get<PhoneSystemApiResponse<PhoneSystemStats>>(
      '/phone-system/stats'
    );
    return response.data.success ? response.data.data : null;
  }

  async getTranscriptByConversationId(conversationId: string): Promise<ConversationDetailResponse | null> {
    try {
      const response = await apiClient.get<PhoneSystemApiResponse<ConversationDetailResponse>>(
        `/phone-system/transcript/${encodeURIComponent(conversationId)}`
      );
      return response.data.success ? response.data.data : null;
    } catch (error: unknown) {
      if ((error as AxiosError)?.response?.status === 404) return null;
      throw new Error(`Failed to retrieve transcript for conversation ID: ${conversationId}`);
    }
  }

  async getAudioAndTranscriptByConversationId(conversationId: string): Promise<AudioAndTranscriptResponse> {
    try {
      const response = await apiClient.get<PhoneSystemApiResponse<AudioAndTranscriptResponse>>(
        `/phone-system/audio-transcript/${encodeURIComponent(conversationId)}`
      );
      return response.data.success ? response.data.data : { audio: null, transcript: null };
    } catch (error: unknown) {
      if ((error as AxiosError)?.response?.status === 404) return { audio: null, transcript: null };
      throw new Error(`Failed to retrieve audio and transcript for conversation ID: ${conversationId}`);
    }
  }

  formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  formatDate(dateString: string): string {
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    };
    return new Date(dateString).toLocaleDateString(undefined, options);
  }
}

export const phoneSystemService = new PhoneSystemService();
export default phoneSystemService;
