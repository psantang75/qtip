import { api } from './authService';
import { logError } from '../utils/errorHandling';

// ── Submission payload + response types ──────────────────────────────────────
// Mirrors backend `CreateSubmissionDTO` / `CreateSubmissionAnswerDTO` /
// `SubmissionMetadataDTO` in `backend/src/models/Submission.ts`. Kept here as
// a thin frontend mirror so that `submitAudit` / `saveDraft` no longer have
// `any` payloads (pre-production review item #33). Update both sides together.

export interface SubmissionAnswerPayload {
  question_id: number;
  answer: string;
  notes?: string;
}

export interface SubmissionMetadataPayload {
  field_id: number | string;
  value: string;
}

export interface SubmissionCallDataPayload {
  call_id: string;
  department_id?: number | null;
  customer_id?: string | null;
  call_date?: string | Date;
  duration?: number;
  recording_url?: string | null;
  transcript?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface SubmissionTicketTaskPayload {
  kind: 'TICKET' | 'TASK';
  external_id: number;
}

export interface SubmissionPayload {
  form_id: number;
  call_id?: number | null;
  call_ids?: number[];
  call_data?: SubmissionCallDataPayload[];
  /** Linked CRM tickets/tasks; reference-only — body fetched live. */
  ticket_tasks?: SubmissionTicketTaskPayload[];
  csr_id?: number | null;
  submitted_by?: number;
  answers: SubmissionAnswerPayload[];
  status?: 'DRAFT' | 'SUBMITTED' | 'DISPUTED' | 'FINALIZED';
  metadata?: SubmissionMetadataPayload[];
}

export interface SubmissionResult {
  submission_id?: number;
  total_score?: number;
  message?: string;
}

export interface FinalizePayload {
  acknowledged?: boolean;
  notes?: string | null;
  total_score?: number;
}

export interface ScoreSnapshotPayload {
  created_by?: number;
  created_at?: string;
  total_score?: number;
  notes?: string | null;
}

// Types for submissions and audits
export interface AssignedAudit {
  assignment_id: number;
  call_id: number;
  call_external_id: string;
  form_id: number;
  form_name: string;
  call_date: string;
  call_duration: number;
  csr_name: string;
  department_name: string | null;
  submission_id: number;
  status: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface AuditDetailsResponse {
  call: {
    id: number;
    call_external_id: string;
    call_date: string;
    duration: number;
    transcript: string;
    audio_url: string;
    csr_name: string;
    department_name: string;
  };
  form: {
    id: number;
    form_name: string;
    categories: {
      id: number;
      category_name: string;
      weight: number;
      questions: {
        id: number;
        question_text: string;
        question_type: string;
        is_required: boolean;
        is_na_allowed: boolean;
        scale_min?: number;
        scale_max?: number;
        weight: number;
      }[];
    }[];
  };
  submission?: {
    id: number;
    status: string;
    total_score: number;
    answers: {
      question_id: number;
      answer: string;
      notes: string | null;
    }[];
  };
}

// Helper function to get the shared axios instance (already has auth headers via interceptor)
const getAuthorizedAxios = () => {
  // Return the shared api instance that has the 401 interceptor
  return api;
};

const submissionService = {
  // Get assigned audits for QA Analyst with pagination
  getAssignedAudits: async (
    page: number = 1,
    limit: number = 10
  ): Promise<PaginatedResponse<AssignedAudit>> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.get(`/submissions/assigned?page=${page}&limit=${limit}`);
      return response.data;
    } catch (error) {
      logError('submissionService', 'Error fetching assigned audits:', error);
      throw error;
    }
  },

  // Get call details with form for QA review
  getCallWithForm: async (callId: number, formId: number): Promise<AuditDetailsResponse> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.get(`/submissions/review/${callId}?formId=${formId}`);
      return response.data;
    } catch (error) {
      logError('submissionService', `Error fetching call details for callId ${callId}:`, error);
      throw error;
    }
  },

  // Submit completed audit
  submitAudit: async (submissionData: SubmissionPayload): Promise<SubmissionResult> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.post<SubmissionResult>('/submissions', submissionData);
      return response.data;
    } catch (error: any) {
      logError('submissionService', 'Error submitting audit:', error);
      
      // Pass through the full error response for better error handling
      if (error.response) {
        // The server responded with a status code outside the 2xx range
        logError('submissionService', 'Server response:', error.response.data);
        throw error;
      } else if (error.request) {
        // The request was made but no response was received
        logError('submissionService', 'No response received');
        throw error;
      } else {
        // Something happened in setting up the request
        logError('submissionService', 'Request setup error:', error.message);
        throw error;
      }
    }
  },

  // Save audit draft
  saveDraft: async (submissionData: SubmissionPayload): Promise<SubmissionResult> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.post<SubmissionResult>('/submissions/draft', submissionData);
      return response.data;
    } catch (error) {
      logError('submissionService', 'Error saving draft:', error);
      throw error;
    }
  },

  // Update existing submission (for managers)
  updateSubmission: async (
    submissionId: number,
    updateData: Partial<SubmissionPayload> & { updated_by?: number; updated_at?: string },
  ): Promise<SubmissionResult> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.put<SubmissionResult>(`/submissions/${submissionId}`, updateData);
      return response.data;
    } catch (error) {
      logError('submissionService', 'Error updating submission:', error);
      throw error;
    }
  },

  // Create a snapshot of scores
  createScoreSnapshot: async (
    submissionId: number,
    snapshotData: ScoreSnapshotPayload,
  ): Promise<SubmissionResult> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.post<SubmissionResult>(`/submissions/${submissionId}/snapshots`, snapshotData);
      return response.data;
    } catch (error) {
      logError('submissionService', 'Error creating score snapshot:', error);
      throw error;
    }
  },

  // Finalize a submission after dispute resolution
  finalizeSubmission: async (
    submissionId: number,
    finalData: FinalizePayload,
  ): Promise<SubmissionResult> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.put<SubmissionResult>(`/submissions/${submissionId}/finalize`, finalData);
      return response.data;
    } catch (error) {
      logError('submissionService', 'Error finalizing submission:', error);
      throw error;
    }
  },

  // Flag a submission for review
  flagSubmission: async (submissionId: number, reason: string): Promise<{ message?: string }> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.post<{ message?: string }>(`/submissions/${submissionId}/flag`, { reason });
      return response.data;
    } catch (error) {
      logError('submissionService', 'Error flagging submission:', error);
      throw error;
    }
  },
};

export default submissionService; 