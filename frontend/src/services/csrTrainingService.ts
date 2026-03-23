import apiClient from './apiClient';
import type { 
  TrainingSummary, 
  EnrollmentDetail, 
  PaginatedEnrollments, 
  CourseContent, 
  QuizSubmission, 
  CourseProgress,
  Certificate,
  PaginatedCertificates,
  TrainingFilters
} from '../types/csr.types';

/**
 * Service for handling CSR training dashboard API calls
 */

/**
 * Fetch training summary statistics for CSR
 */
export const getTrainingSummary = async (): Promise<TrainingSummary> => {
  try {
    const response = await apiClient.get('/csr/training/summary');
    return response.data;
  } catch (error) {
    console.error('Error fetching training summary:', error);
    throw error;
  }
};

/**
 * Fetch paginated enrollments for CSR with filters
 */
export const getEnrollments = async (
  page = 1, 
  pageSize = 10, 
  filters: TrainingFilters = {}
): Promise<PaginatedEnrollments> => {
  try {
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('pageSize', pageSize.toString());
    
    if (filters.status && filters.status !== 'all') {
      params.append('status', filters.status);
    }
    
    if (filters.dueDateOrder) {
      params.append('dueDateOrder', filters.dueDateOrder);
    }
    
    const response = await apiClient.get(`/csr/enrollments?${params.toString()}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching enrollments:', error);
    throw error;
  }
};

/**
 * Fetch course content and enrollment details
 */
export const getCourseContent = async (courseId: number): Promise<CourseContent> => {
  try {
    const response = await apiClient.get(`/csr/courses/${courseId}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching course ${courseId}:`, error);
    throw error;
  }
};

/**
 * Submit quiz answers
 */
export const submitQuiz = async (submission: QuizSubmission): Promise<{
  score: number;
  passed: boolean;
  correctAnswers: number[];
}> => {
  try {
    const response = await apiClient.post(`/csr/quizzes/${submission.quizId}/submit`, {
      answers: submission.answers
    });
    return response.data;
  } catch (error) {
    console.error(`Error submitting quiz ${submission.quizId}:`, error);
    throw error;
  }
};

/**
 * Update course progress (mark page as completed)
 */
export const updateCourseProgress = async (progress: CourseProgress): Promise<void> => {
  try {
    await apiClient.put(`/csr/enrollments/${progress.enrollmentId}/progress`, {
      pageId: progress.pageId,
      quizId: progress.quizId,
      completed: progress.completed
    });
  } catch (error) {
    console.error('Error updating course progress:', error);
    throw error;
  }
};

/**
 * Mark course as completed
 */
export const completeCourse = async (enrollmentId: number): Promise<Certificate> => {
  try {
    const response = await apiClient.put(`/csr/enrollments/${enrollmentId}/complete`);
    return response.data;
  } catch (error) {
    console.error('Error completing course:', error);
    throw error;
  }
};

/**
 * Get certificate for completed course
 */
export const getCertificate = async (certificateId: number): Promise<Certificate> => {
  try {
    const response = await apiClient.get(`/csr/certificates/${certificateId}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching certificate ${certificateId}:`, error);
    throw error;
  }
};

/**
 * Get all certificates for CSR with pagination
 */
export const getCertificates = async (
  page = 1, 
  limit = 10, 
  filters: {
    status?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
  } = {}
): Promise<PaginatedCertificates> => {
  try {
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    
    if (filters.status && filters.status !== 'all') {
      params.append('status', filters.status);
    }
    
    if (filters.search && filters.search.trim()) {
      params.append('search', filters.search.trim());
    }
    
    if (filters.startDate) {
      params.append('startDate', filters.startDate);
    }
    
    if (filters.endDate) {
      params.append('endDate', filters.endDate);
    }
    
    const response = await apiClient.get(`/csr/certificates?${params.toString()}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching certificates:', error);
    throw error;
  }
};

/**
 * Fetch course content by enrollment ID
 */
export const getCourseContentByEnrollment = async (enrollmentId: number): Promise<CourseContent> => {
  try {
    const response = await apiClient.get(`/csr/enrollments/${enrollmentId}/course`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching course content for enrollment ${enrollmentId}:`, error);
    throw error;
  }
};

/**
 * Update last viewed position
 */
export const updateLastViewedPosition = async (position: {
  enrollmentId: number;
  pageId: number;
  pageIndex: number;
}): Promise<void> => {
  try {
    await apiClient.put(`/csr/enrollments/${position.enrollmentId}/position`, {
      pageId: position.pageId,
      pageIndex: position.pageIndex
    });
  } catch (error) {
    console.error('Error updating last viewed position:', error);
    throw error;
  }
};

/**
 * Get last viewed position
 */
export const getLastViewedPosition = async (enrollmentId: number): Promise<{
  pageIndex: number;
  pageId: number | null;
  timestamp?: string;
}> => {
  try {
    const response = await apiClient.get(`/csr/enrollments/${enrollmentId}/position`);
    return response.data;
  } catch (error) {
    console.error('Error getting last viewed position:', error);
    throw error;
  }
}; 