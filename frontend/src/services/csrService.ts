import apiClient from './apiClient';
import type { CSRDashboardData, CSRAudit, CSRTrainingCourse, CSRAuditDetail, CSRDispute } from '../types/csr.types';

// Base URL for all CSR endpoints - apiClient already adds /api prefix
const BASE_URL = '';

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

// Fetch CSR dashboard data
export const fetchCSRDashboardData = async (): Promise<CSRDashboardData> => {
  try {
    const response = await apiClient.get(`${BASE_URL}/csr/stats`);
    return response.data;
  } catch (error) {
    console.error('Error fetching CSR dashboard data:', error);
    throw error;
  }
};

// Fetch CSR dashboard stats (new manager-style format)
export const fetchCSRDashboardStats = async (): Promise<CSRDashboardStats> => {
  try {
    const response = await apiClient.get(`${BASE_URL}/csr/dashboard-stats`);
    return response.data;
  } catch (error) {
    console.error('Error fetching CSR dashboard stats:', error);
    throw error;
  }
};

// Fetch CSR activity data (shows only logged-in CSR's data)
export const fetchCSRActivity = async (): Promise<CSRActivityData[]> => {
  try {
    const response = await apiClient.get(`${BASE_URL}/csr/csr-activity`);
    return response.data;
  } catch (error) {
    console.error('Error fetching CSR activity data:', error);
    throw error;
  }
};

// Fetch audits for CSR
export const fetchCSRAudits = async (
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
}> => {
  try {
    // Make real API call with filters
    const params = {
      page,
      limit,
      ...filters
    };
    
    const response = await apiClient.get(`${BASE_URL}/csr/audits`, { params });
    return response.data;
  } catch (error) {
    console.error('Error fetching CSR audits:', error);
    throw error;
  }
};

// Fetch specific audit details
export const fetchAuditDetails = async (id: number): Promise<CSRAuditDetail> => {
  try {
    const response = await apiClient.get(`${BASE_URL}/csr/audits/${id}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching audit details:', error);
    throw error;
  }
};

// Submit a dispute for an audit
export const submitDispute = async (submissionId: number, disputeData: FormData): Promise<any> => {
  try {
    const response = await apiClient.post(`${BASE_URL}/csr/disputes`, disputeData);
    return response.data;
  } catch (error) {
    console.error('Error submitting dispute:', error);
    throw error;
  }
};

// Finalize an audit (CSR accepts the review)
export const finalizeAudit = async (submissionId: number, finalData: any): Promise<any> => {
  try {
    const response = await apiClient.put(`${BASE_URL}/csr/audits/${submissionId}/finalize`, finalData);
    return response.data;
  } catch (error) {
    console.error('Error finalizing audit:', error);
    throw error;
  }
};

// Finalize a submission (QA/Manager/Admin accepts the review)
export const finalizeSubmission = async (submissionId: number, finalData: any): Promise<any> => {
  try {
    const url = `/api/submissions/${submissionId}/finalize`;
    console.log('Finalize Submission Request:', {
      url,
      submissionId,
      finalData,
      method: 'PUT'
    });
    
    const response = await apiClient.put(url, finalData);
    console.log('Finalize Submission Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error finalizing submission:', error);
    throw error;
  }
};

// Check if an audit is disputable
export const isAuditDisputable = async (submissionId: number): Promise<boolean> => {
  try {
    const response = await apiClient.get(`${BASE_URL}/csr/audits/${submissionId}/disputable`);
    return response.data.disputable;
  } catch (error) {
    console.error('Error checking if audit is disputable:', error);
    throw error;
  }
};

// Fetch training courses for CSR
export const fetchCSRTraining = async (): Promise<{
  courses: CSRTrainingCourse[];
}> => {
  try {
    const response = await apiClient.get(`${BASE_URL}/csr/enrollments`);
    return response.data;
  } catch (error) {
    console.error('Error fetching CSR training courses:', error);
    throw error;
  }
};

// Fetch dispute history for CSR
export const fetchDisputeHistory = async (
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
}> => {
  try {
    const params = {
      page,
      perPage,
      ...filters
    };
    
    // Use the correct endpoint path for disputes history
    // The backend has routes at both /api/disputes/history and /api/csr/disputes/history
    const response = await apiClient.get(`${BASE_URL}/disputes/history`, { params });
    
    console.log('Dispute history response:', response.data);
    
    return response.data;
  } catch (error) {
    console.error('Error fetching dispute history:', error);
    throw error;
  }
};

// Get dispute details by ID
export const getDisputeDetails = async (disputeId: number): Promise<CSRDispute> => {
  try {
    // Use the correct endpoint path for dispute details
    // The backend has this route at /api/disputes/:disputeId
    const response = await apiClient.get(`${BASE_URL}/disputes/${disputeId}`);
    
    console.log('Dispute details response:', response.data);
    
    return response.data;
  } catch (error) {
    console.error('Error fetching dispute details:', error);
    throw error;
  }
};

// Update a dispute (reason and/or attachment)
export const updateDispute = async (disputeId: number, disputeData: FormData): Promise<any> => {
  try {
    // Don't set Content-Type header - axios will automatically set it with the correct boundary for FormData
    const response = await apiClient.put(`${BASE_URL}/disputes/${disputeId}`, disputeData);
    return response.data;
  } catch (error) {
    console.error('Error updating dispute:', error);
    throw error;
  }
}; 