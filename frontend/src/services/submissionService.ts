import { api } from './authService';
import { logError, logWarn } from '../utils/errorHandling';

/**
 * The reopen endpoints answer 409 as a guard, not a failure: the review was
 * never reopened, or its unlock was already closed by an earlier re-submit.
 * The UI turns those into an explanatory panel, so logging them at error
 * level buries genuine faults under stack traces the reader has to triage.
 */
function logGuardedRequestError(operation: string, error: unknown): void {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 409) {
    logWarn('submissionService', `${operation}: rejected by the reopen guard (409)`);
    return;
  }
  logError('submissionService', `${operation} failed:`, error);
}

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

/**
 * A DRAFT's saved state, shaped to match `AiDraftDetail` so AuditFormPage's
 * prefill hydration works for both AI drafts and reopened human reviews.
 */
export interface DraftForEdit {
  submission_id: number;
  form_id: number;
  form_name: string | null;
  submitted_at: string;
  submitted_by: number;
  /**
   * True when an admin reopened a previously-scored review into DRAFT (the
   * draft carries an OPEN unlock). False for a plain saved draft being
   * finished. Drives whether the editor shows the "correction" banner.
   */
  reopened?: boolean;
  /**
   * Never sent for a human draft — declared only so this stays assignable
   * wherever `AiDraftDetail` is, letting AuditFormPage share one prefill
   * code path across AI drafts and reopened human reviews.
   */
  ai_overall_confidence?: number | null;
  ai_extras?: null;
  /**
   * The agent this review is about. Sent because the audit form's agent picker
   * lists only active CSRs, so a review of someone who has left would show an
   * empty Agent field without it.
   */
  agent?: { id: number; username: string } | null;
  answers: Array<{ question_id: number; answer: string; notes: string }>;
  metadata: Array<{ field_id: number; value: string }>;
  ticket_tasks: Array<{ kind: 'TICKET' | 'TASK'; external_id: number }>;
  calls: Array<{
    id: number;
    call_id: string;
    csr_id: number;
    customer_id: string | null;
    call_date: string;
    duration: number;
    recording_url: string | null;
    transcript: string | null;
  }>;
}

// Helper function to get the shared axios instance (already has auth headers via interceptor)
const getAuthorizedAxios = () => {
  // Return the shared api instance that has the 401 interceptor
  return api;
};

const submissionService = {
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

  /**
   * Load a DRAFT's saved answers back into the audit form. Used by the
   * `?resumeDraft=` mode after an admin reopens a review. Response shape
   * matches AiDraftDetail so AuditFormPage hydrates it with one code path.
   */
  getDraftForEdit: async (submissionId: number): Promise<DraftForEdit> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.get<DraftForEdit>(`/submissions/${submissionId}/draft`);
      return response.data;
    } catch (error) {
      logGuardedRequestError('Loading draft for edit', error);
      throw error;
    }
  },

  /**
   * Re-submit a reopened review in place. Updates the existing row (keeping
   * its original review date) and closes the unlock event.
   */
  resubmitUnlocked: async (
    submissionId: number,
    payload: { answers: SubmissionAnswerPayload[]; metadata?: SubmissionMetadataPayload[] },
  ): Promise<SubmissionResult & { total_score: number }> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.post(`/submissions/${submissionId}/resubmit`, payload);
      return response.data;
    } catch (error) {
      logGuardedRequestError('Re-submitting reopened review', error);
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