import apiClient from './apiClient';

// Types for Audit Assignment Management
export interface AuditAssignment {
  id: number;
  form_id: number;
  form_name: string;
  target_id: number;
  target_type: 'USER' | 'DEPARTMENT';
  target_name: string; // User name or Department name
  schedule: string;
  qa_id: number | null;
  qa_name: string | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  created_by: number;
  created_at: string;
}

export interface AuditAssignmentCreateDTO {
  form_id: number;
  target_id: number;
  target_type: 'USER' | 'DEPARTMENT';
  schedule: string;
  qa_id: number | null;
  start_date: string;
  end_date: string | null;
  created_by?: number;
}

export interface PaginatedResponse<T> {
  assignments: T[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
}

const auditAssignmentService = {
  // Get audit assignments with pagination and search
  getAuditAssignments: async (
    page: number = 1,
    limit: number = 10,
    search: string = '',
    additionalParams: Record<string, string> = {}
  ): Promise<PaginatedResponse<AuditAssignment>> => {
    try {
      let url = `/audit-assignments?page=${page}&limit=${limit}`;
      
      if (search) {
        url += `&search=${encodeURIComponent(search)}`;
      }
      
      // Handle special parameters
      console.log('Service fetching with additionalParams:', additionalParams);
      
      // Add additional filter parameters
      Object.entries(additionalParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url += `&${key}=${encodeURIComponent(value)}`;
        }
      });
      
      console.log('Making request to URL:', url);
      
      const response = await apiClient.get(url);
      return response.data;
    } catch (error) {
      console.error('Error fetching audit assignments:', error);
      throw error;
    }
  },
  
  // Create multiple audit assignments in bulk
  createAuditAssignments: async (
    assignments: AuditAssignmentCreateDTO[]
  ): Promise<{ message: string; assignments: AuditAssignment[] }> => {
    try {
      // Send the assignments array in the expected format
      const response = await apiClient.post('/audit-assignments', { assignments });
      return response.data;
    } catch (error) {
      console.error('Error creating audit assignments:', error);
      throw error;
    }
  },
  
  // Update an existing audit assignment
  updateAuditAssignment: async (
    id: number,
    assignment: Partial<AuditAssignmentCreateDTO>
  ): Promise<{ message: string; assignment: AuditAssignment }> => {
    try {
      const response = await apiClient.put(`/audit-assignments/${id}`, assignment);
      return response.data;
    } catch (error) {
      console.error(`Error updating audit assignment ${id}:`, error);
      throw error;
    }
  },
  
  // Deactivate an audit assignment (soft delete)
  deactivateAuditAssignment: async (
    id: number
  ): Promise<{ message: string }> => {
    try {
      const response = await apiClient.delete(`/audit-assignments/${id}`);
      return response.data;
    } catch (error) {
      console.error(`Error deactivating audit assignment ${id}:`, error);
      throw error;
    }
  }
};

export default auditAssignmentService; 