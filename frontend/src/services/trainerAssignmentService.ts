import axios from 'axios';
import apiClient from './apiClient';
import type {
  Course,
  TrainingPath,
  User,
  Department,
  Enrollment,
  CreateEnrollmentRequest,
  CancelEnrollmentRequest
} from '../types/trainer-assignment';

/**
 * Service for handling trainer assignment API calls
 */
class TrainerAssignmentService {
  /**
   * Fetch published courses
   * @returns Promise with published courses
   */
  async getPublishedCourses(): Promise<Course[]> {
    const response = await apiClient.get('/trainer/courses');
    return response.data;
  }

  /**
   * Fetch training paths
   * @returns Promise with training paths
   */
  async getTrainingPaths(): Promise<TrainingPath[]> {
    const response = await apiClient.get('/trainer/paths');
    return response.data;
  }

  /**
   * Fetch CSRs and departments for assignment targets
   * @returns Promise with users and departments
   */
  async getAssignmentTargets(): Promise<{
    users: User[];
    departments: Department[];
  }> {
    const response = await apiClient.get('/trainer/targets');
    
    // Handle both direct response and wrapped response formats
    const data = response.data.data || response.data;
    
    return {
      users: data.users || [],
      departments: data.departments || []
    };
  }

  /**
   * Create new training assignments
   * @param assignmentData Assignment data to create
   * @returns Promise with creation result
   */
  async createAssignments(assignmentData: CreateEnrollmentRequest): Promise<{
    success: boolean;
    message: string;
    created_count: number;
  }> {
    const response = await apiClient.post('/enrollments/batch', assignmentData);
    
    // The backend returns: { message: string, results: Array }
    // We need to transform it to match our expected format
    const { message, results } = response.data;
    
    // Count successful assignments
    const created_count = results.filter((result: any) => result.success).length;
    
    return {
      success: true,
      message: message || 'Assignments processed successfully',
      created_count
    };
  }

  /**
   * Fetch existing enrollments with pagination
   * @param page Current page number
   * @param pageSize Number of items per page
   * @param search Optional search term
   * @returns Promise with enrollments and pagination info
   */
  async getEnrollments(
    page = 1,
    pageSize = 10,
    search = ''
  ): Promise<{
    data: Enrollment[];
    total: number;
    page: number;
    perPage: number;
    totalPages: number;
  }> {
    const response = await apiClient.get('/enrollments', {
      params: { page, pageSize, search }
    });
    return response.data;
  }

  /**
   * Cancel an existing assignment
   * @param enrollmentId ID of the enrollment to cancel
   * @returns Promise with cancellation result
   */
  async cancelAssignment(enrollmentId: number): Promise<{
    success: boolean;
    message: string;
  }> {
    const response = await apiClient.delete(`/enrollments/${enrollmentId}`);
    return response.data;
  }
}

export default new TrainerAssignmentService(); 