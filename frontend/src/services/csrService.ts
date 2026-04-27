import apiClient, { apiGet, apiPost, apiPut } from './apiClient';
import type { CSRDashboardData, CSRAudit, CSRAuditDetail, CSRDispute } from '../types/csr.types';
import { logError } from '../utils/errorHandling';

// apiClient already sets `baseURL: '/api'`, so all paths here start with `/...`
// (pre-production review item #80 — removed the one hard-coded `/api/...` call).

// Types for the new dashboard endpoints (similar to manager dashboard)
export interface CSRDashboardStats {
  reviewsCompleted: {
    thisWeek: number;
    thisMonth: number;
  };
  disputes: {
    thisWeek: number;
    thisMonth: number;
  };
  coachingSessions: {
    thisWeek: number;
    thisMonth: number;
  };
}

export interface CSRActivityData {
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

const SCOPE = 'csrService';

// Fetch CSR dashboard data
export const fetchCSRDashboardData = (): Promise<CSRDashboardData> =>
  apiGet<CSRDashboardData>(SCOPE, '/csr/stats');

// Fetch CSR dashboard stats (new manager-style format)
export const fetchCSRDashboardStats = (): Promise<CSRDashboardStats> =>
  apiGet<CSRDashboardStats>(SCOPE, '/csr/dashboard-stats');

// Fetch CSR activity data (shows only logged-in CSR's data)
export const fetchCSRActivity = (): Promise<CSRActivityData[]> =>
  apiGet<CSRActivityData[]>(SCOPE, '/csr/csr-activity');

// Fetch audits for CSR
export const fetchCSRAudits = (
  page = 1,
  limit = 10,
  filters?: {
    formName?: string,
    form_id_search?: string,
    startDate?: string,
    endDate?: string,
    status?: string,
    searchTerm?: string
  }
): Promise<{
  audits: CSRAudit[];
  totalCount: number;
}> =>
  apiGet<{ audits: CSRAudit[]; totalCount: number }>(SCOPE, '/csr/audits', {
    params: { page, limit, ...filters },
  });

// Fetch specific audit details
export const fetchAuditDetails = (id: number): Promise<CSRAuditDetail> =>
  apiGet<CSRAuditDetail>(SCOPE, `/csr/audits/${id}`);

// Submit a dispute for an audit. FormData requires multipart — the request
// interceptor strips the JSON Content-Type so axios can set the boundary.
export const submitDispute = async (_submissionId: number, disputeData: FormData): Promise<any> => {
  try {
    const response = await apiClient.post('/csr/disputes', disputeData);
    return response.data;
  } catch (error) {
    logError(SCOPE, 'Error submitting dispute:', error);
    throw error;
  }
};

// Finalize an audit (CSR accepts the review)
export const finalizeAudit = (submissionId: number, finalData: any): Promise<any> =>
  apiPut(SCOPE, `/csr/audits/${submissionId}/finalize`, finalData);

// Finalize a submission (QA/Manager/Admin accepts the review).
// apiClient already sets baseURL to '/api', so the path must NOT include the
// prefix (pre-production review item #80 — this was the one site that did).
export const finalizeSubmission = (submissionId: number, finalData: any): Promise<any> =>
  apiPut(SCOPE, `/submissions/${submissionId}/finalize`, finalData);

// Check if an audit is disputable
export const isAuditDisputable = async (submissionId: number): Promise<boolean> => {
  const res = await apiGet<{ disputable: boolean }>(
    SCOPE,
    `/csr/audits/${submissionId}/disputable`,
  );
  return res.disputable;
};

// Fetch dispute history for CSR
export const fetchDisputeHistory = (
  page = 1,
  perPage = 10,
  filters?: {
    formName?: string,
    startDate?: string,
    endDate?: string,
    status?: string,
    searchTerm?: string
  }
): Promise<{
  data: CSRDispute[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}> =>
  apiGet<{
    data: CSRDispute[];
    total: number;
    page: number;
    perPage: number;
    totalPages: number;
  }>(SCOPE, '/disputes/history', {
    params: { page, perPage, ...filters },
  });

// Get dispute details by ID
export const getDisputeDetails = (disputeId: number): Promise<CSRDispute> =>
  apiGet<CSRDispute>(SCOPE, `/disputes/${disputeId}`);

// Update a dispute (reason and/or attachment). FormData triggers multipart.
export const updateDispute = async (disputeId: number, disputeData: FormData): Promise<any> => {
  try {
    const response = await apiClient.put(`/disputes/${disputeId}`, disputeData);
    return response.data;
  } catch (error) {
    logError(SCOPE, 'Error updating dispute:', error);
    throw error;
  }
};
