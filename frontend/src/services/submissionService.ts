import { api } from './authService'; // Use shared axios instance with interceptors
import authService from './authService';

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
      const response = await api.get(`/api/submissions/assigned?page=${page}&limit=${limit}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching assigned audits:', error);
      throw error;
    }
  },

  // Get call details with form for QA review
  getCallWithForm: async (callId: number, formId: number): Promise<AuditDetailsResponse> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.get(`/api/submissions/review/${callId}?formId=${formId}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching call details for callId ${callId}:`, error);
      throw error;
    }
  },

  // Submit completed audit
  submitAudit: async (submissionData: any): Promise<any> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.post('/submissions', submissionData);
      return response.data;
    } catch (error: any) {
      console.error('Error submitting audit:', error);
      
      // Pass through the full error response for better error handling
      if (error.response) {
        // The server responded with a status code outside the 2xx range
        console.error('Server response:', error.response.data);
        throw error;
      } else if (error.request) {
        // The request was made but no response was received
        console.error('No response received');
        throw error;
      } else {
        // Something happened in setting up the request
        console.error('Request setup error:', error.message);
        throw error;
      }
    }
  },

  // Save audit draft
  saveDraft: async (submissionData: any): Promise<any> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.post('/submissions/draft', submissionData);
      return response.data;
    } catch (error) {
      console.error('Error saving draft:', error);
      throw error;
    }
  },

  // Update existing submission (for managers)
  updateSubmission: async (submissionId: number, updateData: any): Promise<any> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.put(`/api/submissions/${submissionId}`, updateData);
      return response.data;
    } catch (error) {
      console.error('Error updating submission:', error);
      throw error;
    }
  },

  // Create a snapshot of scores
  createScoreSnapshot: async (submissionId: number, snapshotData: any): Promise<any> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.post(`/api/submissions/${submissionId}/snapshots`, snapshotData);
      return response.data;
    } catch (error) {
      console.error('Error creating score snapshot:', error);
      throw error;
    }
  },

  // Finalize a submission after dispute resolution
  finalizeSubmission: async (submissionId: number, finalData: any): Promise<any> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.put(`/api/submissions/${submissionId}/finalize`, finalData);
      return response.data;
    } catch (error) {
      console.error('Error finalizing submission:', error);
      throw error;
    }
  },

  // Flag a submission for review
  flagSubmission: async (submissionId: number, reason: string): Promise<any> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.post(`/api/submissions/${submissionId}/flag`, { reason });
      return response.data;
    } catch (error) {
      console.error('Error flagging submission:', error);
      throw error;
    }
  }
};

export default submissionService; 