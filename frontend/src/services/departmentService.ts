import { api } from './authService'; // Use shared axios instance with interceptors
import authService from './authService';
import type { User } from './userService';

// Types for Department Management
export interface DepartmentManager {
  id: number;
  department_id: number;
  manager_id: number;
  manager_name: string;
  assigned_at: string;
  assigned_by: number;
  is_active: boolean;
}

export interface Department {
  id: number;
  department_name: string;
  managers: DepartmentManager[];
  user_count: number;
  is_active: boolean;
  created_at: string;
}

export interface DepartmentCreateDTO {
  department_name: string;
  manager_ids?: number[];
}

export interface DepartmentUpdateDTO {
  department_name?: string;
  manager_ids?: number[];
}

export interface DepartmentManagerAssignmentDTO {
  department_id: number;
  manager_ids: number[];
}

export interface DepartmentFilters {
  manager_id?: number;
  is_active?: boolean;
  search?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
}

// Helper function to get the shared axios instance (already has auth headers via interceptor)
const getAuthorizedAxios = () => {
  // Return the shared api instance that has the 401 interceptor
  return api;
};

// Department management service functions
const departmentService = {
  // Get departments with pagination and filters
  getDepartments: async (
    page: number = 1, 
    limit: number = 20,
    filters?: DepartmentFilters
  ): Promise<PaginatedResponse<Department> | Department[]> => {
    try {
      let url = `/departments?page=${page}&limit=${limit}`;
      
      // Add filters to URL if they exist
      if (filters) {
        if (filters.manager_id) url += `&manager_id=${filters.manager_id}`;
        if (filters.is_active !== undefined) url += `&is_active=${filters.is_active}`;
        if (filters.search) url += `&search=${encodeURIComponent(filters.search)}`;
      }
      
      const api = getAuthorizedAxios();
      const response = await api.get(url);
      return response.data;
    } catch (error) {
      console.error('Error fetching departments:', error);
      throw error;
    }
  },
  
  // Get a single department by ID
  getDepartmentById: async (departmentId: number): Promise<Department> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.get(`/departments/${departmentId}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching department with ID ${departmentId}:`, error);
      throw error;
    }
  },
  
  // Create a new department
  createDepartment: async (departmentData: DepartmentCreateDTO): Promise<Department> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.post('/departments', departmentData);
      return response.data;
    } catch (error) {
      console.error('Error creating department:', error);
      throw error;
    }
  },
  
  // Update a department
  updateDepartment: async (departmentId: number, departmentData: DepartmentUpdateDTO): Promise<Department> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.put(`/api/departments/${departmentId}`, departmentData);
      
      // Handle different response formats
      if (response.data && response.data.success && response.data.data) {
        return response.data.data;
      } else if (response.data) {
        return response.data;
      } else {
        throw new Error('Invalid response format from server');
      }
    } catch (error) {
      console.error(`Error updating department with ID ${departmentId}:`, error);
      throw error;
    }
  },
  
  // Delete a department
  deleteDepartment: async (departmentId: number): Promise<void> => {
    try {
      const api = getAuthorizedAxios();
      await api.delete(`/api/departments/${departmentId}`);
    } catch (error) {
      console.error(`Error deleting department with ID ${departmentId}:`, error);
      throw error;
    }
  },
  
  // Toggle department activation status
  toggleDepartmentStatus: async (departmentId: number, isActive: boolean): Promise<Department> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.put(`/api/departments/${departmentId}/status`, { is_active: isActive });
      
      // Handle different response formats
      if (response.data && response.data.success && response.data.data) {
        return response.data.data;
      } else if (response.data) {
        return response.data;
      } else {
        throw new Error('Invalid response format from server');
      }
    } catch (error) {
      console.error(`Error toggling status for department with ID ${departmentId}:`, error);
      throw error;
    }
  },
  
  // Assign users to a department
  assignUsers: async (departmentId: number, userIds: number[]): Promise<void> => {
    try {
      const api = getAuthorizedAxios();
      await api.post(`/api/departments/${departmentId}/users`, { user_ids: userIds });
    } catch (error) {
      console.error(`Error assigning users to department with ID ${departmentId}:`, error);
      throw error;
    }
  },
  
  // Get users eligible to be assigned to department
  getAssignableUsers: async (): Promise<User[]> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.get('/departments/users/assignable');
      return response.data;
    } catch (error) {
      console.error('Error fetching assignable users:', error);
      throw error;
    }
  },

  // Assign managers to a department
  assignManagers: async (departmentId: number, managerIds: number[]): Promise<void> => {
    try {
      const api = getAuthorizedAxios();
      await api.post(`/api/departments/${departmentId}/managers`, { manager_ids: managerIds });
    } catch (error) {
      console.error(`Error assigning managers to department with ID ${departmentId}:`, error);
      throw error;
    }
  },

  // Get managers for a specific department
  getDepartmentManagers: async (departmentId: number): Promise<DepartmentManager[]> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.get(`/api/departments/${departmentId}/managers`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching managers for department with ID ${departmentId}:`, error);
      throw error;
    }
  }
};

export default departmentService; 