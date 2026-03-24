import { useState, useCallback, useEffect, useRef } from 'react';
import userService from '../services/userService';
import type { 
  User, 
  Role, 
  Department, 
  UserFilters, 
  UserCreateDTO, 
  UserUpdateDTO,
  PaginatedResponse 
} from '../services/userService';

interface UseUsersOptions {
  autoLoad?: boolean;
  pageSize?: number;
  enableCache?: boolean;
  cacheTimeout?: number; // in milliseconds
}

interface UseUsersState {
  users: User[];
  loading: boolean;
  error: string | null;
  totalPages: number;
  totalItems: number;
  currentPage: number;
  filters: UserFilters;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * Enhanced users management hook
 * Provides comprehensive user operations with caching and state management
 */
export const useUsers = (options: UseUsersOptions = {}) => {
  const {
    autoLoad = true,
    pageSize = 20,
    enableCache = true,
    cacheTimeout = 5 * 60 * 1000 // 5 minutes
  } = options;

  // Main state
  const [state, setState] = useState<UseUsersState>({
    users: [],
    loading: false,
    error: null,
    totalPages: 1,
    totalItems: 0,
    currentPage: 1,
    filters: {
      role_id: undefined,
      department_id: undefined,
      is_active: true,
      search: ''
    }
  });

  // Reference data state
  const [roles, setRoles] = useState<Role[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [managers, setManagers] = useState<User[]>([]);
  const [directors, setDirectors] = useState<User[]>([]);

  // Cache for reference data
  const cacheRef = useRef<Map<string, CacheEntry<any>>>(new Map());

  // Helper function to check cache validity
  const isCacheValid = useCallback((key: string): boolean => {
    if (!enableCache) return false;
    
    const entry = cacheRef.current.get(key);
    if (!entry) return false;
    
    return Date.now() - entry.timestamp < cacheTimeout;
  }, [enableCache, cacheTimeout]);

  // Helper function to set cache
  const setCache = useCallback((key: string, data: any) => {
    if (!enableCache) return;
    
    cacheRef.current.set(key, {
      data,
      timestamp: Date.now()
    });
  }, [enableCache]);

  // Helper function to get cache
  const getCache = useCallback(<T>(key: string): T | null => {
    if (!enableCache) return null;
    
    const entry = cacheRef.current.get(key);
    if (!entry || !isCacheValid(key)) return null;
    
    return entry.data as T;
  }, [enableCache, isCacheValid]);

  // Clear all caches
  const clearCache = useCallback(() => {
    cacheRef.current.clear();
  }, []);

  // Fetch users with current filters and pagination
  const fetchUsers = useCallback(async (page?: number, customFilters?: Partial<UserFilters>) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const targetPage = page || state.currentPage;
      const targetFilters = { ...state.filters, ...customFilters };
      
      // Check cache for this specific query
      const cacheKey = `users-${targetPage}-${JSON.stringify(targetFilters)}`;
      const cached = getCache<PaginatedResponse<User>>(cacheKey);
      
      if (cached) {
        setState(prev => ({
          ...prev,
          users: cached.items,
          totalPages: cached.totalPages,
          totalItems: cached.totalItems,
          currentPage: cached.currentPage,
          filters: targetFilters,
          loading: false
        }));
        return cached;
      }

      const response = await userService.getUsers(targetPage, pageSize, targetFilters);
      
      // Cache the response
      setCache(cacheKey, response);
      
      setState(prev => ({
        ...prev,
        users: response.items,
        totalPages: response.totalPages,
        totalItems: response.totalItems,
        currentPage: response.currentPage,
        filters: targetFilters,
        loading: false
      }));
      
      return response;
    } catch (error: any) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: error.message || 'Failed to fetch users'
      }));
      throw error;
    }
  }, [state.currentPage, state.filters, pageSize, getCache, setCache]);

  // Load reference data (roles, departments, managers)
  const loadReferenceData = useCallback(async () => {
    try {
      // Check cache first
      const cachedRoles = getCache<Role[]>('roles');
      const cachedDepartments = getCache<Department[]>('departments');
      const cachedManagers = getCache<User[]>('managers');
      const cachedDirectors = getCache<User[]>('directors');

      // Load roles
      if (cachedRoles) {
        setRoles(cachedRoles);
      } else {
        const rolesData = await userService.getRoles();
        setRoles(Array.isArray(rolesData) ? rolesData : []);
        setCache('roles', rolesData);
      }

      // Load departments
      if (cachedDepartments) {
        setDepartments(cachedDepartments);
      } else {
        const departmentsData = await userService.getDepartments();
        setDepartments(Array.isArray(departmentsData) ? departmentsData : []);
        setCache('departments', departmentsData);
      }

      // Load managers
      if (cachedManagers) {
        setManagers(cachedManagers);
      } else {
        const managersData = await userService.getManagers();
        setManagers(Array.isArray(managersData) ? managersData : []);
        setCache('managers', managersData);
      }

      // Load directors
      if (cachedDirectors) {
        setDirectors(cachedDirectors);
      } else {
        const directorsData = await userService.getUsers(1, 100, { role_id: 6 }).then(r => r.items);
        setDirectors(Array.isArray(directorsData) ? directorsData : []);
        setCache('directors', directorsData);
      }
    } catch (error) {
      console.error('Error loading reference data:', error);
    }
  }, [getCache, setCache]);

  // Create a new user
  const createUser = useCallback(async (userData: UserCreateDTO) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const newUser = await userService.createUser(userData);
      
      // Clear cache to force refresh
      clearCache();
      
      // Refresh current page
      await fetchUsers();
      
      return { success: true, user: newUser };
    } catch (error: any) {
      // Extract meaningful error message from the API response
      let errorMessage = 'Failed to create user';
      
      if (error?.response?.data?.error) {
        const apiError = error.response.data.error;
        if (typeof apiError === 'string') {
          errorMessage = apiError;
        } else if (apiError.message) {
          errorMessage = apiError.message;
        }
      } else if (error?.response?.data?.code) {
        // Handle specific error codes with user-friendly messages
        switch (error.response.data.code) {
          case 'EMAIL_EXISTS':
            errorMessage = 'This email address is already in use by another user. Please choose a different email.';
            break;
          case 'USERNAME_EXISTS':
            errorMessage = 'This username is already taken. Please choose a different username.';
            break;
          case 'VALIDATION_ERROR':
            errorMessage = 'Please check your input and try again.';
            break;
          default:
            errorMessage = error.response.data.error || errorMessage;
        }
      } else if (error?.message) {
        errorMessage = error.message;
      }
      
      setState(prev => ({
        ...prev,
        loading: false,
        error: errorMessage
      }));
      return { success: false, error: errorMessage };
    }
  }, [fetchUsers, clearCache]);

  // Update an existing user
  const updateUser = useCallback(async (userId: number, userData: UserUpdateDTO) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const updatedUser = await userService.updateUser(userId, userData);
      
      // Clear cache to force refresh
      clearCache();
      
      // Refresh current page
      await fetchUsers();
      
      return { success: true, user: updatedUser };
    } catch (error: any) {
      // Extract meaningful error message from the API response
      let errorMessage = 'Failed to update user';
      
      if (error?.response?.data?.error) {
        const apiError = error.response.data.error;
        if (typeof apiError === 'string') {
          errorMessage = apiError;
        } else if (apiError.message) {
          errorMessage = apiError.message;
        }
      } else if (error?.response?.data?.code) {
        // Handle specific error codes with user-friendly messages
        switch (error.response.data.code) {
          case 'EMAIL_EXISTS':
            errorMessage = 'This email address is already in use by another user. Please choose a different email.';
            break;
          case 'USERNAME_EXISTS':
            errorMessage = 'This username is already taken. Please choose a different username.';
            break;
          case 'USER_NOT_FOUND':
            errorMessage = 'User not found. Please refresh the page and try again.';
            break;
          case 'INVALID_USER_ID':
            errorMessage = 'Invalid user ID. Please refresh the page and try again.';
            break;
          case 'VALIDATION_ERROR':
            errorMessage = 'Please check your input and try again.';
            break;
          default:
            errorMessage = error.response.data.error || errorMessage;
        }
      } else if (error?.message) {
        errorMessage = error.message;
      }
      
      setState(prev => ({
        ...prev,
        loading: false,
        error: errorMessage
      }));
      return { success: false, error: errorMessage };
    }
  }, [fetchUsers, clearCache]);

  // Toggle user status
  const toggleUserStatus = useCallback(async (userId: number, isActive: boolean) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const updatedUser = await userService.toggleUserStatus(userId, isActive);
      
      // Clear cache to force refresh
      clearCache();
      
      // Refresh current page
      await fetchUsers();
      
      return { success: true, user: updatedUser };
    } catch (error: any) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: error.message || 'Failed to toggle user status'
      }));
      return { success: false, error: error.message };
    }
  }, [fetchUsers, clearCache]);

  // Delete a user
  const deleteUser = useCallback(async (userId: number) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      await userService.deleteUser(userId);
      
      // Clear cache to force refresh
      clearCache();
      
      // Refresh current page
      await fetchUsers();
      
      return { success: true };
    } catch (error: any) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: error.message || 'Failed to delete user'
      }));
      return { success: false, error: error.message };
    }
  }, [fetchUsers, clearCache]);

  // Search users
  const searchUsers = useCallback(async (searchQuery: string) => {
    return fetchUsers(1, { search: searchQuery });
  }, [fetchUsers]);

  // Filter users
  const filterUsers = useCallback(async (filters: Partial<UserFilters>) => {
    return fetchUsers(1, filters);
  }, [fetchUsers]);

  // Go to specific page
  const goToPage = useCallback(async (page: number) => {
    return fetchUsers(page);
  }, [fetchUsers]);

  // Refresh current data
  const refresh = useCallback(async () => {
    clearCache();
    await Promise.all([
      fetchUsers(),
      loadReferenceData()
    ]);
  }, [fetchUsers, loadReferenceData, clearCache]);

  // Get user by ID (with caching)
  const getUserById = useCallback(async (userId: number) => {
    const cacheKey = `user-${userId}`;
    const cached = getCache<User>(cacheKey);
    
    if (cached) {
      return cached;
    }
    
    try {
      const user = await userService.getUserById(userId);
      setCache(cacheKey, user);
      return user;
    } catch (error) {
      console.error(`Error fetching user ${userId}:`, error);
      throw error;
    }
  }, [getCache, setCache]);

  // Utility functions
  const isAdmin = useCallback((user: User) => user.role_id === 1, []);
  const isManager = useCallback((user: User) => user.role_id === 2, []);
  const isActive = useCallback((user: User) => user.is_active, []);

  // Get users by role
  const getUsersByRole = useCallback((roleId: number) => {
    return state.users.filter(user => user.role_id === roleId);
  }, [state.users]);

  // Get users by department
  const getUsersByDepartment = useCallback((departmentId: number) => {
    return state.users.filter(user => user.department_id === departmentId);
  }, [state.users]);

  // Initial load
  useEffect(() => {
    if (autoLoad) {
      loadReferenceData();
      fetchUsers();
    }
  }, [autoLoad]); // Only run on mount

  return {
    // State
    ...state,
    
    // Reference data
    roles,
    departments,
    managers,
    directors,
    
    // Core operations
    fetchUsers,
    loadReferenceData,
    createUser,
    updateUser,
    toggleUserStatus,
    deleteUser,
    getUserById,
    
    // Search and filtering
    searchUsers,
    filterUsers,
    
    // Navigation
    goToPage,
    
    // Utilities
    refresh,
    clearCache,
    isAdmin,
    isManager,
    isActive,
    getUsersByRole,
    getUsersByDepartment,
    
    // Computed properties
    hasUsers: state.users.length > 0,
    isEmpty: state.users.length === 0 && !state.loading,
    isFirstPage: state.currentPage === 1,
    isLastPage: state.currentPage === state.totalPages,
    
    // Pagination helpers
    nextPage: state.currentPage < state.totalPages ? () => goToPage(state.currentPage + 1) : null,
    prevPage: state.currentPage > 1 ? () => goToPage(state.currentPage - 1) : null,
    
    // Cache info
    cacheEnabled: enableCache,
    cacheSize: cacheRef.current.size
  };
}; 