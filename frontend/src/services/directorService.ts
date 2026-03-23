import axios from 'axios';
import authService from './authService';
import type { User } from './userService';
import type { Department } from './departmentService';

// Type definitions for Director Assignments
export interface DirectorDepartment {
  id: number;
  director_id: number;
  department_id: number;
  director_name?: string;
  department_name?: string;
  created_at: string;
}

export interface DirectorDepartmentCreateDTO {
  director_id: number;
  department_id: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
}

// Helper function to create axios instance with auth headers
const getAuthorizedAxios = () => {
  const token = authService.getToken();
  return axios.create({
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    }
  });
};

// Director assignment service functions
const directorService = {
  // Get all director-department assignments with pagination and filters
  getDirectorAssignments: async (
    page: number = 1, 
    limit: number = 20,
    directorId?: number,
    departmentId?: number,
    search?: string
  ): Promise<PaginatedResponse<DirectorDepartment>> => {
    try {
      let url = `/api/director-departments?page=${page}&limit=${limit}`;
      
      // Add filters to URL if they exist
      if (directorId) url += `&director_id=${directorId}`;
      if (departmentId) url += `&department_id=${departmentId}`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      
      const api = getAuthorizedAxios();
      const response = await api.get(url);
      return response.data;
    } catch (error) {
      console.error('Error fetching director assignments:', error);
      throw error;
    }
  },
  
  // Get assignments for a specific director
  getDirectorAssignmentsById: async (directorId: number): Promise<DirectorDepartment[]> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.get(`/api/director-departments/${directorId}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching assignments for director ID ${directorId}:`, error);
      throw error;
    }
  },
  
  // Create a new director-department assignment
  createDirectorAssignment: async (assignmentData: DirectorDepartmentCreateDTO): Promise<DirectorDepartment> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.post('/director-departments', assignmentData);
      return response.data;
    } catch (error) {
      console.error('Error creating director assignment:', error);
      throw error;
    }
  },
  
  // Create multiple director-department assignments
  createBulkDirectorAssignments: async (assignments: DirectorDepartmentCreateDTO[]): Promise<DirectorDepartment[]> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.post('/director-departments/bulk', { assignments });
      return response.data;
    } catch (error) {
      console.error('Error creating bulk director assignments:', error);
      throw error;
    }
  },
  
  // Delete a director-department assignment
  deleteDirectorAssignment: async (assignmentId: number): Promise<void> => {
    try {
      const api = getAuthorizedAxios();
      await api.delete(`/api/director-departments/${assignmentId}`);
    } catch (error) {
      console.error(`Error deleting director assignment with ID ${assignmentId}:`, error);
      throw error;
    }
  },
  
  // Get directors (users with Director role)
  getDirectors: async (): Promise<User[]> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.get('/users/directors');
      return response.data;
    } catch (error) {
      console.error('Error fetching directors:', error);
      throw error;
    }
  },
  
  // Get available departments
  getDepartments: async (): Promise<Department[]> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.get('/departments?is_active=true');
      return response.data.items || response.data;
    } catch (error) {
      console.error('Error fetching departments:', error);
      throw error;
    }
  }
};

export default directorService; 