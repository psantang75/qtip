import { api } from './authService'; // Use the shared axios instance with interceptors
import authService from './authService'; // Import auth service to get token

// Types for User Management
export interface User {
  id: number;
  username: string;
  email: string;
  role_id: number;
  role_name: string;
  department_id: number | null;
  department_name: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Role {
  id: number;
  role_name: string;
}

export interface Department {
  id: number;
  department_name: string;
}

export interface UserCreateDTO {
  username: string;
  email: string;
  password: string;
  role_id: number;
  department_id: number | null;
}

export interface UserUpdateDTO {
  username?: string;
  email?: string;
  password?: string;
  role_id?: number;
  department_id?: number | null;
}

export interface UserFilters {
  role_id?: number;
  role?: string;
  department_id?: number;
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

// User management service functions
const userService = {
  // Get users with pagination and filters
  getUsers: async (
    page: number = 1, 
    limit: number = 20,
    filters?: UserFilters
  ): Promise<PaginatedResponse<User>> => {
    try {
      let url = `/users?page=${page}&limit=${limit}`;
      
      // Add filters to URL if they exist
      if (filters) {
        if (filters.role_id) url += `&role_id=${filters.role_id}`;
        if (filters.role) url += `&role=${encodeURIComponent(filters.role)}`;
        if (filters.department_id) url += `&department_id=${filters.department_id}`;
        if (filters.is_active !== undefined) url += `&is_active=${filters.is_active}`;
        if (filters.search) url += `&search=${encodeURIComponent(filters.search)}`;
      }
      
      console.log('[USER SERVICE] Fetching users from:', url);
      
      const api = getAuthorizedAxios();
      const response = await api.get(url);
      
      console.log('[USER SERVICE] Raw API response:', response.data);
      
      // Handle the expected response format
      if (response.data && 'items' in response.data) {
        console.log('[USER SERVICE] Found items array with', response.data.items.length, 'users');
        return response.data;
      }
      
      // Handle legacy format if needed
      if (response.data && 'users' in response.data) {
        console.log('[USER SERVICE] Converting legacy format');
        return {
          items: response.data.users,
          totalItems: response.data.pagination?.total || response.data.users.length,
          totalPages: response.data.pagination?.totalPages || 1,
          currentPage: response.data.pagination?.page || page
        };
      }
      
      // Fallback for unexpected format
      console.warn('[USER SERVICE] Unexpected response format, returning empty result');
      return {
        items: [],
        totalItems: 0,
        totalPages: 0,
        currentPage: page
      };
    } catch (error) {
      console.error('Error fetching users:', error);
      console.error('Error details:', error);
      
      // Return empty result instead of throwing error to keep UI functional
      console.warn('[USER SERVICE] Returning empty result due to API error');
      return {
        items: [],
        totalItems: 0,
        totalPages: 0,
        currentPage: page
      };
    }
  },
  
  // Get a single user by ID
  getUserById: async (userId: number): Promise<User> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.get(`/users/${userId}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching user with ID ${userId}:`, error);
      throw error;
    }
  },
  
  // Create a new user
  createUser: async (userData: UserCreateDTO): Promise<User> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.post('/users', userData);
      return response.data;
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  },
  
  // Update a user
  updateUser: async (userId: number, userData: UserUpdateDTO): Promise<User> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.put(`/users/${userId}`, userData);
      
      // Handle new response format
      if (response.data && response.data.success && response.data.data) {
        return response.data.data;
      } else if (response.data) {
        // For backward compatibility
        return response.data;
      } else {
        throw new Error('Invalid response format from server');
      }
    } catch (error: any) {
      console.error(`Error updating user with ID ${userId}:`, error);
      
      // Extract meaningful error message from axios error response
      if (error?.response?.data?.error) {
        const apiError = error.response.data.error;
        if (typeof apiError === 'string') {
          throw new Error(apiError);
        } else if (apiError.message) {
          throw new Error(apiError.message);
        }
      } else if (error?.response?.data?.success === false && error?.response?.data?.error) {
        // Handle the new global error handler format
        const apiError = error.response.data.error;
        if (apiError.message) {
          throw new Error(apiError.message);
        }
      } else if (error?.response?.data?.code) {
        // Handle specific error codes with user-friendly messages
        switch (error.response.data.code) {
          case 'EMAIL_EXISTS':
            throw new Error('This email address is already in use by another user. Please choose a different email.');
          case 'USERNAME_EXISTS':
            throw new Error('This username is already taken. Please choose a different username.');
          case 'USER_NOT_FOUND':
            throw new Error('User not found. Please refresh the page and try again.');
          case 'INVALID_USER_ID':
            throw new Error('Invalid user ID provided.');
          case 'WEAK_PASSWORD':
          case 'INVALID_USERNAME':
          case 'INVALID_USERNAME_FORMAT':
          case 'INVALID_EMAIL':
          case 'INVALID_ROLE':
            // For validation errors, extract message from error object
            if (error.response.data.error && typeof error.response.data.error === 'object' && error.response.data.error.message) {
              throw new Error(error.response.data.error.message);
            } else if (typeof error.response.data.error === 'string') {
              throw new Error(error.response.data.error);
            }
            throw new Error('Validation failed. Please check your input.');
          default:
            // For any other error, properly extract the message
            if (error.response.data.error && typeof error.response.data.error === 'object' && error.response.data.error.message) {
              throw new Error(error.response.data.error.message);
            } else if (typeof error.response.data.error === 'string') {
              throw new Error(error.response.data.error);
            }
            throw new Error('Failed to update user. Please try again.');
        }
      }
      
      // If no specific error message found, throw the original error
      throw error;
    }
  },
  
  // Soft delete a user (deactivate)
  deleteUser: async (userId: number): Promise<void> => {
    try {
      const api = getAuthorizedAxios();
      await api.delete(`/api/users/${userId}`);
    } catch (error) {
      console.error(`Error deleting user with ID ${userId}:`, error);
      throw error;
    }
  },
  
  // Toggle user activation status
  toggleUserStatus: async (userId: number, isActive: boolean): Promise<User> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.put(`/api/users/${userId}/status`, { is_active: isActive });
      
      // Handle new response format
      if (response.data && response.data.success && response.data.data) {
        return response.data.data;
      } else if (response.data) {
        // For backward compatibility
        return response.data;
      } else {
        throw new Error('Invalid response format from server');
      }
    } catch (error) {
      console.error(`Error toggling status for user with ID ${userId}:`, error);
      throw error;
    }
  },
  
  // Change password
  changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
    try {
      const api = getAuthorizedAxios();
      await api.put('/users/change-password', {
        currentPassword,
        newPassword
      });
    } catch (error: any) {
      console.error('Error changing password:', error);
      
      // Extract meaningful error message from axios error response
      if (error?.response?.data?.error) {
        const apiError = error.response.data.error;
        if (typeof apiError === 'string') {
          throw new Error(apiError);
        } else if (apiError.message) {
          throw new Error(apiError.message);
        }
      }
      
      throw error;
    }
  },
  
  // Get all roles
  getRoles: async (): Promise<Role[]> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.get('/roles');
      
      // Handle new response format with data property
      if (response.data && response.data.data && Array.isArray(response.data.data)) {
        return response.data.data;
      }
      
      // Handle paginated response format
      if (response.data && response.data.items && Array.isArray(response.data.items)) {
        return response.data.items;
      }
      
      // Handle direct array response (backward compatibility)
      if (Array.isArray(response.data)) {
        return response.data;
      }
      
      console.warn('Unexpected response format for roles:', response.data);
      return [];
    } catch (error) {
      console.error('Error fetching roles:', error);
      
      // Return fallback roles based on common QTIP roles
      console.warn('Using fallback roles due to API error');
      return [
        { id: 1, role_name: 'Admin' },
        { id: 2, role_name: 'QA' },
        { id: 3, role_name: 'CSR' },
        { id: 4, role_name: 'Trainer' },
        { id: 5, role_name: 'Manager' },
        { id: 6, role_name: 'Director' }
      ];
    }
  },
  
  // Get all departments
  getDepartments: async (): Promise<Department[]> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.get('/departments');
      console.log('Departments API response:', response.data);
      
      // Handle paginated response format
      if (response.data && response.data.items && Array.isArray(response.data.items)) {
        return response.data.items;
      }
      
      // Handle direct array response (backward compatibility)
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      console.error('Error fetching departments:', error);
      throw error;
    }
  },

  // Get only active departments
  getActiveDepartments: async (): Promise<Department[]> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.get('/departments?is_active=true');
      console.log('Active departments API response:', response.data);
      
      // Handle paginated response format
      if (response.data && response.data.items && Array.isArray(response.data.items)) {
        return response.data.items;
      }
      
      // Handle direct array response (backward compatibility)
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      console.error('Error fetching active departments:', error);
      throw error;
    }
  },
  
  // Get all managers
  getManagers: async (): Promise<User[]> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.get('/users/managers');
      return response.data;
    } catch (error) {
      console.error('Error fetching managers:', error);
      throw error;
    }
  },
  
  // Get all directors
  getDirectors: async (): Promise<User[]> => {
    try {
      const api = getAuthorizedAxios();
      const response = await api.get('/users/directors');
      return response.data;
    } catch (error) {
      console.error('Error fetching directors:', error);
      throw error;
    }
  }
};

export default userService; 