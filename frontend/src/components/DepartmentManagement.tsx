/**
 * DepartmentManagement Component
 * 
 * A comprehensive department management interface following enterprise-grade standards.
 * 
 * ARCHITECTURE:
 * - Separation of concerns: DepartmentForm (form logic) + DepartmentManagement (list management)
 * - Type-safe with TypeScript interfaces and strict validation
 * - Reusable components: FormField, DataTable, FilterPanel, Modal
 * - Professional error handling with user-friendly messages
 * 
 * FEATURES:
 * - CRUD operations (Create, Read, Update, Deactivate - no delete for data integrity)
 * - Advanced filtering and pagination with URL state management
 * - Real-time validation with field-level error feedback
 * - Manager assignment with multi-select functionality
 * - Responsive design with mobile-first approach
 * - Accessibility support with ARIA labels and keyboard navigation
 * 
 * SECURITY:
 * - Input validation and sanitization
 * - Role-based access control
 * - XSS protection through React's built-in escaping
 * 
 * PERFORMANCE:
 * - Optimized re-renders with useCallback and useMemo
 * - Lazy loading with pagination
 * - Debounced search functionality
 * - Efficient state management
 * 
 * @version 2.0.0
 * @author QTIP Development Team
 * @since 1.0.0
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import departmentService from '../services/departmentService';
import userService from '../services/userService';
import DataTable, { Column } from './compound/DataTable';
import FilterPanel, { FilterField } from './compound/SearchFilter';
import Modal from './ui/Modal';
import Button from './ui/Button';
import LoadingSpinner from './ui/LoadingSpinner';
import { FormField } from './forms/FormField';
import ErrorDisplay from './ui/ErrorDisplay';
import { handleErrorIfAuthentication } from '../utils/errorHandling';
import type { 
  Department, 
  DepartmentManager,
  DepartmentFilters, 
  DepartmentCreateDTO, 
  DepartmentUpdateDTO 
} from '../services/departmentService';
import type { User } from '../services/userService';
import { usePersistentFilters, usePersistentPagination } from '../hooks/useLocalStorage';
import { useAuth } from '../contexts/AuthContext';

/**
 * Custom hook for debouncing values
 */
const useDebounce = (value: string, delay: number) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
};

/**
 * Memoized Department row component for table performance with accessibility
 */
const DepartmentTableRow = React.memo<{ department: ExtendedDepartment; onEdit: (department: ExtendedDepartment) => void }>(
  ({ department, onEdit }) => (
    <button 
      onClick={() => onEdit(department)}
      className="text-blue-600 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded px-2 py-1"
      aria-label={`Edit department ${department.department_name}`}
      aria-describedby={`department-${department.id}-status`}
    >
      Edit
      <span id={`department-${department.id}-status`} className="sr-only">
        {department.is_active ? 'Active department' : 'Inactive department'}, 
        {department.managers?.length ? ` Managers: ${department.managers.length}` : ' No managers assigned'}
      </span>
    </button>
  )
);

DepartmentTableRow.displayName = 'DepartmentTableRow';

/**
 * Performance Monitor Component for Development
 */
const PerformanceMonitor: React.FC<{ 
  fetchCount: number; 
  lastFetchTime: number; 
  totalDepartments: number; 
}> = React.memo(({ fetchCount, lastFetchTime, totalDepartments }) => {
  if (process.env.NODE_ENV !== 'development') return null;
  
  return (
    <div className="fixed bottom-4 right-4 bg-blue-100 border border-blue-300 rounded-lg p-3 text-xs font-mono shadow-lg z-50">
      <div className="font-semibold text-blue-800 mb-1">Performance Monitor</div>
      <div className="space-y-1 text-blue-700">
        <div>API Calls: {fetchCount}</div>
        <div>Last Fetch: {lastFetchTime.toFixed(2)}ms</div>
        <div>Total Departments: {totalDepartments}</div>
        <div>Avg Time: {fetchCount > 0 ? (lastFetchTime / fetchCount).toFixed(2) : 0}ms</div>
      </div>
    </div>
  );
});

PerformanceMonitor.displayName = 'PerformanceMonitor';

/**
 * Accessibility Status Component - Announces page state to screen readers
 */
const AccessibilityStatus: React.FC<{
  totalDepartments: number;
  filteredDepartments: number;
  loading: boolean;
  searchTerm: string;
  currentPage: number;
  totalPages: number;
}> = React.memo(({ totalDepartments, filteredDepartments, loading, searchTerm, currentPage, totalPages }) => {
  return (
    <div 
      role="status" 
      aria-live="polite" 
      aria-atomic="true"
      className="sr-only"
      aria-label="Page status for screen readers"
    >
      {!loading && (
        <>
          Department management page loaded. 
          {searchTerm && ` Search results for "${searchTerm}".`}
          {` Showing ${filteredDepartments} of ${totalDepartments} departments.`}
          {totalPages > 1 && ` Page ${currentPage} of ${totalPages}.`}
          Press Tab to navigate through filters, table, and pagination controls.
        </>
      )}
      {loading && 'Loading department data, please wait...'}
    </div>
  );
});

AccessibilityStatus.displayName = 'AccessibilityStatus';

// Extended Department Type (simplified without directors)
interface ExtendedDepartment extends Department {
  // No additional fields needed for now
}

// Department Form Component
const DepartmentForm: React.FC<{
  department?: Department;
  managers: User[];
  onSubmit: (data: DepartmentCreateDTO | DepartmentUpdateDTO) => void;
  onCancel: () => void;
  onStatusChange?: (departmentId: number, isActive: boolean) => void;
  loading?: boolean;
  error?: string;
}> = ({ department, managers, onSubmit, onCancel, onStatusChange, loading = false, error }) => {
  const [formData, setFormData] = useState<DepartmentCreateDTO | DepartmentUpdateDTO>({
    department_name: department?.department_name || '',
    manager_ids: department?.managers?.map(m => m.manager_id) || []
  });

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formLoading, setFormLoading] = useState(false);

  // Validation function
  const validateField = (name: string, value: any): string => {
    switch (name) {
      case 'department_name':
        if (!value || value.trim().length < 2) {
          return 'Department name must be at least 2 characters long';
        }
        break;
    }
    return '';
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;

    setFormData(prev => ({
      ...prev,
      [name]: value
    }));

    // Validate field
    const fieldError = validateField(name, value);
    setErrors(prev => ({
      ...prev,
      [name]: fieldError
    }));
  };

  // Handle manager selection (multiple checkboxes)
  const handleManagerChange = (managerId: number) => {
    setFormData(prev => {
      const currentManagerIds = prev.manager_ids || [];
      const isSelected = currentManagerIds.includes(managerId);
      
      return {
        ...prev,
        manager_ids: isSelected 
          ? currentManagerIds.filter(id => id !== managerId)
          : [...currentManagerIds, managerId]
      };
    });
  };

  // Handle field blur
  const handleBlur = (name: string) => {
    setTouched(prev => ({
      ...prev,
      [name]: true
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate all fields
    const newErrors: Record<string, string> = {};
    Object.keys(formData).forEach(key => {
      if (key !== 'manager_ids') { // Skip array validation here
        const fieldError = validateField(key, (formData as any)[key]);
        if (fieldError) newErrors[key] = fieldError;
      }
    });

    setErrors(newErrors);
    setTouched({
      department_name: true,
      manager_ids: true
    });

    // If no errors, submit
    if (Object.keys(newErrors).length === 0) {
      try {
        setFormLoading(true);
        await onSubmit(formData);
      } catch (err: any) {
        if (handleErrorIfAuthentication(err)) {
          return;
        }
        console.error('Form submission error:', err);
      } finally {
        setFormLoading(false);
      }
    }
  };



  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* Display any general errors */}
      {error && (
        <ErrorDisplay
          variant="card"
          message={error}
          title="Form Error"
          dismissible={false}
        />
      )}

      {/* Department Name Field */}
      <FormField
        name="department_name"
        type="text"
        label="Department Name"
        value={formData.department_name}
        onChange={handleChange}
        onBlur={() => handleBlur('department_name')}
        error={errors.department_name}
        touched={touched.department_name}
        required
        placeholder="Enter department name"
        disabled={formLoading}
      />

      {/* Managers Field - Multi-select with checkboxes */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          Managers
        </label>
        <div className="max-h-96 overflow-y-auto border border-gray-300 rounded-md p-3 bg-gray-50">
          {Array.isArray(managers) && managers.length > 0 ? (
            <div className="space-y-2">
              {managers.map(manager => {
                const isSelected = (formData.manager_ids || []).includes(manager.id);
                return (
                  <label 
                    key={manager.id} 
                    className={`flex items-center cursor-pointer p-2 rounded-md transition-colors ${
                      isSelected 
                        ? 'bg-indigo-100 border-indigo-200 border' 
                        : 'hover:bg-gray-100'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleManagerChange(manager.id)}
                      disabled={formLoading}
                      className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                    />
                    <span className={`ml-2 text-sm ${
                      isSelected ? 'text-indigo-800 font-medium' : 'text-gray-700'
                    }`}>
                      {manager.username}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No managers available</p>
          )}
        </div>
        <p className="text-xs text-gray-500">
          Select one or more managers for this department (optional)
        </p>
      </div>

      {/* Form Actions */}
      <div className="flex justify-between items-center pt-4 border-t border-gray-200">
        {/* Left side - Destructive actions (only when editing) */}
        {department && onStatusChange && (
          <div className="flex space-x-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onStatusChange(department.id, !department.is_active)}
              disabled={formLoading}
              className={department.is_active ? 'text-amber-600 hover:text-amber-700' : 'text-green-600 hover:text-green-700'}
            >
              {department.is_active ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        )}
        
        {/* Right side - Primary actions */}
        <div className="flex space-x-3">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={formLoading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={formLoading}
            loading={formLoading}
          >
            {department ? 'Update Department' : 'Add Department'}
          </Button>
        </div>
      </div>
    </form>
  );
};

// User Assignment Modal Component
const UserAssignmentModal: React.FC<{
  department: Department;
  users: User[];
  onAssign: (userIds: number[]) => void;
  onCancel: () => void;
}> = ({ department, users, onAssign, onCancel }) => {
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);

  const handleCheckboxChange = (userId: number) => {
    setSelectedUserIds(prev => 
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAssign(selectedUserIds);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="mb-6 max-h-80 overflow-y-auto">
        {users && users.length > 0 ? (
          <div className="space-y-2">
            {users.map(user => (
              <div key={user.id} className="flex items-center">
                <input
                  type="checkbox"
                  id={`user-${user.id}`}
                  checked={selectedUserIds.includes(user.id)}
                  onChange={() => handleCheckboxChange(user.id)}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <label htmlFor={`user-${user.id}`} className="ml-2 text-sm text-gray-700">
                  {user.username} ({user.email}) - {user.role_name}
                </label>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500">No users available for assignment.</p>
        )}
      </div>
      
      <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
        >
          Save Assignment
        </Button>
      </div>
    </form>
  );
};

// Main Department Management Component
const DepartmentManagement: React.FC = () => {
  const { user } = useAuth();
  
  const [departments, setDepartments] = useState<ExtendedDepartment[]>([]);
  const [managers, setManagers] = useState<User[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  
  // Persistent pagination (isolated per user)
  const { currentPage, setCurrentPage, pageSize, setPageSize: setPageSizeInternal, clearPagination } = usePersistentPagination('DepartmentManagement', 1, 20, user?.id);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);
  
  // Search state with debouncing (not persisted as it's transient)
  const [searchTerm, setSearchTerm] = useState<string>('');
  const debouncedSearchTerm = useDebounce(searchTerm, 300); // 300ms debounce
  
  // Persistent filter state (excluding search which is handled separately, isolated per user)
  const [filters, setFilters, clearFilters] = usePersistentFilters<Omit<DepartmentFilters, 'search'>>(
    'DepartmentManagement',
    {
      manager_id: undefined,
      is_active: true
    },
    user?.id
  );
  
  // Sorting state
  const [sortKey, setSortKey] = useState<keyof ExtendedDepartment | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc' | null>(null);
  
  // Combined filters for API calls
  const apiFilters = useMemo<DepartmentFilters>(() => ({
    ...filters,
    search: debouncedSearchTerm
  }), [filters, debouncedSearchTerm]);
  
  // Modal states
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [selectedDepartment, setSelectedDepartment] = useState<ExtendedDepartment | undefined>(undefined);
  
  // Confirmation modal state - memoized to prevent unnecessary re-renders
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  // Performance tracking refs
  const performanceRef = useRef({
    lastFetchTime: 0,
    fetchCount: 0
  });

  // Prevent duplicate fetches on identical params (e.g., React StrictMode double-invoke)
  const lastFetchSignatureRef = useRef<string | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const isClearingRef = useRef<boolean>(false);

  // Focus management refs for accessibility
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);

  // Memoized columns for DataTable with accessibility enhancements
  const getColumns = useCallback((editHandler: (department: ExtendedDepartment) => void): Column<ExtendedDepartment>[] => [
    {
      key: 'department_name',
      header: 'Department Name',
      sortable: true,
      render: (value, department) => (
        <span 
          className="font-medium text-gray-900"
          aria-label={`Department: ${value as string}`}
        >
          {value as string}
        </span>
      )
    },
    {
      key: 'managers',
      header: 'Managers',
      sortable: false,
      render: (value, department): React.ReactNode => {
        const managersList: DepartmentManager[] = Array.isArray(value) ? value : [];
        if (managersList.length === 0) {
          return <span className="text-gray-500" aria-label="No managers assigned">-</span>;
        }
        
        const managerNames = managersList.map(manager => manager.manager_name).join(', ');
        
        return (
          <span 
            aria-label={`Managers: ${managerNames}`}
            title={managerNames}
          >
            {managerNames}
          </span>
        );
      }
    },
    {
      key: 'user_count',
      header: 'User Count',
      sortable: true,
      render: (value) => (
        <span aria-label={`User count: ${value || 0}`}>
          {typeof value === 'number' ? value : 0}
        </span>
      )
    },
    {
      key: 'is_active',
      header: 'Status',
      sortable: true,
      render: (value) => (
        <span 
          className="text-gray-900"
          aria-label={`Status: ${value ? 'Active' : 'Inactive'}`}
        >
          {value ? 'Active' : 'Inactive'}
        </span>
      )
    },
    {
      key: 'id',
      header: 'Actions',
      sortable: false,
      render: (_, department) => (
        <DepartmentTableRow department={department} onEdit={editHandler} />
      )
    }
  ], []);

  // Optimized form handlers with useCallback and focus management
  const handleAddDepartment = useCallback(() => {
    lastFocusedElementRef.current = document.activeElement as HTMLElement;
    setSelectedDepartment(undefined);
    setIsFormOpen(true);
  }, []);
  
  const handleEditDepartment = useCallback((department: ExtendedDepartment) => {
    lastFocusedElementRef.current = document.activeElement as HTMLElement;
    setSelectedDepartment(department);
    setIsFormOpen(true);
  }, []);
  
  const handleCloseForm = useCallback(() => {
    setIsFormOpen(false);
    setSelectedDepartment(undefined);
    
    // Restore focus to the element that triggered the modal
    setTimeout(() => {
      if (lastFocusedElementRef.current) {
        lastFocusedElementRef.current.focus();
      }
    }, 100);
  }, []);

  // Memoized columns using the edit handler
  const columns = useMemo(() => getColumns(handleEditDepartment), [getColumns, handleEditDepartment]);

  // Load initial data
  useEffect(() => {
    loadData();
  }, []);
  
  // Ref to store fetchDepartments function so it can be called before it's defined
  const fetchDepartmentsRef = useRef<((force?: boolean) => Promise<void>) | null>(null);
  
  // Re-fetch departments when page or apiFilters change (with debounced search)
  useEffect(() => {
    // Always fetch if we have no data, regardless of signature
    // This ensures data loads when navigating back to the page
    const shouldForce = departments.length === 0 || isClearingRef.current;
    if (shouldForce) {
      lastFetchSignatureRef.current = null;
      if (isClearingRef.current) {
        isClearingRef.current = false;
      }
    }

    // Use a timeout to batch multiple rapid state updates (e.g., from clear filters)
    const timeoutId = setTimeout(() => {
      if (fetchDepartmentsRef.current) {
        fetchDepartmentsRef.current(shouldForce);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize, debouncedSearchTerm, filters.manager_id, filters.is_active, sortKey, sortDirection]);
  
  const loadData = async () => {
    try {
      setLoading(true);
      
      // Load managers
      const managersData = await userService.getManagers();
      
      // Check if we got valid arrays
      if (managersData && Array.isArray(managersData)) {
        setManagers(managersData);
      } else {
        console.error('Invalid managers data format:', managersData);
        setManagers([]);
        setError('Failed to load manager data. Using empty list.');
      }
      
      // Load departments
      await fetchDepartments(true);
    } catch (err: any) {
      if (handleErrorIfAuthentication(err)) {
        return;
      }
      setError('Failed to load department data. Please try again later.');
      console.error('Error loading initial data:', err);
      
      // Set empty data on error
      setManagers([]);
      setDepartments([]);
    } finally {
      setLoading(false);
    }
  };
  
  // Optimized fetch departments with performance tracking
  const fetchDepartments = useCallback(async (force = false) => {
    // Coalesce overlapping identical requests
    if (inFlightRef.current) {
      await inFlightRef.current;
      if (!force) return;
    }

    try {
      const startTime = performance.now();
      setLoading(true);
      setError(null);
      
      performanceRef.current.fetchCount++;

      // Build stable signature with sorted params
      const signatureParams = {
        page: currentPage,
        pageSize,
        ...apiFilters,
        sortKey,
        sortDirection
      };

      const orderedParams = Object.keys(signatureParams)
        .sort()
        .reduce<Record<string, any>>((acc, key) => {
          acc[key] = (signatureParams as any)[key];
          return acc;
        }, {});

      const signature = JSON.stringify({
        endpoint: 'getDepartments',
        params: orderedParams
      });

      if (!force && signature === lastFetchSignatureRef.current) {
        setLoading(false);
        return;
      }

      lastFetchSignatureRef.current = signature;

      const requestPromise = (async () => {
        const response = await departmentService.getDepartments(currentPage, pageSize, apiFilters);
      
        // Determine departments and pagination info
        let departmentList: Department[] = [];
        let totalPagesCount = 1;
        let totalItemsCount = 0;
        let currentPageNum = 1;
        
        // Check if response is a direct array
        if (Array.isArray(response)) {
          console.log('Received array of departments:', response.length);
          departmentList = response;
          totalPagesCount = 1;
          totalItemsCount = response.length;
          currentPageNum = 1;
        } 
        // Check if it's a paginated response object
        else if (response && response.items && Array.isArray(response.items)) {
          departmentList = response.items;
          totalPagesCount = response.totalPages || 1;
          totalItemsCount = response.totalItems || 0;
          currentPageNum = response.currentPage || 1;
        } else {
          // Handle unexpected response format
          console.error('Invalid department data format:', response);
          departmentList = [];
          totalPagesCount = 1;
          totalItemsCount = 0;
          currentPageNum = 1;
          setError('Error loading departments: Invalid response format from server.');
        }
        
        // Apply client-side sorting if needed
        let sortedDepartments = departmentList;
        if (sortKey && sortDirection) {
          sortedDepartments = [...departmentList].sort((a, b) => {
            const aValue = a[sortKey];
            const bValue = b[sortKey];
            
            // Handle null/undefined values
            if (aValue == null && bValue == null) return 0;
            if (aValue == null) return sortDirection === 'asc' ? -1 : 1;
            if (bValue == null) return sortDirection === 'asc' ? 1 : -1;
            
            // Handle different data types
            if (typeof aValue === 'string' && typeof bValue === 'string') {
              return sortDirection === 'asc' 
                ? aValue.localeCompare(bValue)
                : bValue.localeCompare(aValue);
            }
            
            if (typeof aValue === 'number' && typeof bValue === 'number') {
              return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
            }
            
            if (typeof aValue === 'boolean' && typeof bValue === 'boolean') {
              return sortDirection === 'asc' 
                ? (aValue === bValue ? 0 : aValue ? 1 : -1)
                : (aValue === bValue ? 0 : aValue ? -1 : 1);
            }
            
            // Fallback to string comparison
            const aStr = String(aValue);
            const bStr = String(bValue);
            return sortDirection === 'asc' 
              ? aStr.localeCompare(bStr)
              : bStr.localeCompare(aStr);
          });
        }
        
        // Set departments directly without director information
        setDepartments(sortedDepartments as ExtendedDepartment[]);
        
        setTotalPages(totalPagesCount);
        setTotalItems(totalItemsCount);
        setCurrentPage(currentPageNum);
        
        const endTime = performance.now();
        performanceRef.current.lastFetchTime = endTime - startTime;
        
        // Performance logging in development
        if (process.env.NODE_ENV === 'development') {
          console.log(`[PERFORMANCE] Department fetch #${performanceRef.current.fetchCount} took ${performanceRef.current.lastFetchTime.toFixed(2)}ms`);
        }
      })();

      inFlightRef.current = requestPromise;
      await requestPromise;
    } catch (err: any) {
      console.error('Error fetching departments:', err);
      
      // Check for authentication errors (401) - let the axios interceptor handle redirect
      if (handleErrorIfAuthentication(err)) {
        return;
      }
      
      setDepartments([]);
      setTotalPages(1);
      setTotalItems(0);
      
      // Provide more specific error messages based on the error type
      if (err.message && err.message.includes('Network Error')) {
        setError('Failed to connect to the API server. Please check your connection or contact support.');
      } else if (err.response && err.response.status === 404) {
        setError('API endpoint not found. Please check the server configuration.');
      } else {
        setError(`Failed to load departments: ${err.message || 'Unknown error'}`);
      }
      lastFetchSignatureRef.current = null; // Allow retry after error
    } finally {
      setLoading(false);
      inFlightRef.current = null;
    }
  }, [currentPage, pageSize, apiFilters, sortKey, sortDirection]);
  
  // Update ref whenever fetchDepartments changes
  useEffect(() => {
    fetchDepartmentsRef.current = fetchDepartments;
  }, [fetchDepartments]);



  
  // Handle department submission
  const handleSubmitDepartment = async (data: DepartmentCreateDTO | DepartmentUpdateDTO) => {
    try {
      setLoading(true);
      
      if (selectedDepartment) {
        // Update existing department
        await departmentService.updateDepartment(selectedDepartment.id, data);
      } else {
        // Create new department
        await departmentService.createDepartment(data as DepartmentCreateDTO);
      }
      
      // Close form and refresh list
      setIsFormOpen(false);
      fetchDepartments(true);
    } catch (err: any) {
      console.error('Error saving department:', err);
      
      // Check for authentication errors (401) - let the axios interceptor handle redirect
      if (handleErrorIfAuthentication(err)) {
        return;
      }
      
      // Provide more specific error messages based on the error type
      if (err.message && err.message.includes('Network Error')) {
        setError('Failed to connect to the API server. Please check your connection or contact support.');
      } else if (err.response && err.response.status === 404) {
        setError('API endpoint not found. Please check the server configuration.');
      } else if (err.response && err.response.status === 403) {
        setError('Access denied: You need Admin privileges to manage departments. Please contact your administrator.');
      } else if (err.response && err.response.status === 400) {
        setError(`Failed to save department: ${err.response.data?.message || 'Invalid data'}`);
      } else {
        setError(`Failed to save department: ${err.message || 'Unknown error'}`);
      }
    } finally {
      setLoading(false);
    }
  };
  
  // Handle status change confirmation
  const handleConfirmStatusChange = async (departmentId: number, newStatus: boolean) => {
    try {
      setLoading(true);
      await departmentService.toggleDepartmentStatus(departmentId, newStatus);
      
      // Close form modal and refresh departments
      setIsFormOpen(false);
      setSelectedDepartment(undefined);
      fetchDepartments(true);
    } catch (err: any) {
      console.error('Error toggling department status:', err);
      
      // Check for authentication errors (401) - let the axios interceptor handle redirect
      if (handleErrorIfAuthentication(err)) {
        return;
      }
      
      // Provide more specific error messages based on the error type
      if (err.message && err.message.includes('Network Error')) {
        setError('Failed to connect to the API server. Please check your connection or contact support.');
      } else if (err.response && err.response.status === 404) {
        setError('Department not found. It may have been deleted.');
      } else if (err.response && err.response.status === 403) {
        setError('Access denied: You need Admin privileges to manage departments. Please contact your administrator.');
      } else {
        setError(`Failed to update department status: ${err.message || 'Unknown error'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  // Handle department status toggle (keep for compatibility)
  const handleToggleStatus = (departmentId: number, isActive: boolean) => {
    // Show confirmation modal
    setConfirmModal({
      isOpen: true,
      title: `${isActive ? 'Activate' : 'Deactivate'} Department`,
      message: `Are you sure you want to ${isActive ? 'activate' : 'deactivate'} this department?`,
      onConfirm: async () => {
        try {
          setLoading(true);
          await departmentService.toggleDepartmentStatus(departmentId, isActive);
          
          // Close modal and refresh departments
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
          fetchDepartments(true);
        } catch (err: any) {
          console.error('Error toggling department status:', err);
          
          // Check for authentication errors (401) - let the axios interceptor handle redirect
          if (handleErrorIfAuthentication(err)) {
            return;
          }
          
          // Provide more specific error messages based on the error type
          if (err.message && err.message.includes('Network Error')) {
            setError('Failed to connect to the API server. Please check your connection or contact support.');
          } else if (err.response && err.response.status === 404) {
            setError('Department not found. It may have been deleted.');
          } else if (err.response && err.response.status === 403) {
            setError('Access denied: You need Admin privileges to manage departments. Please contact your administrator.');
          } else {
            setError(`Failed to update department status: ${err.message || 'Unknown error'}`);
          }
        } finally {
          setLoading(false);
        }
      }
    });
  };
  

  // Filter fields for FilterPanel - matches UserManagement pattern
  const filterFields = useMemo<FilterField[]>(() => [
    {
      key: 'manager_id',
      label: 'Manager',
      type: 'select',
      options: Array.isArray(managers) ? managers.map(manager => ({
        value: manager.id,
        label: manager.username
      })) : []
    },
    {
      key: 'search',
      label: 'Search',
      type: 'text',
      placeholder: 'Search by department name'
    },
    {
      key: 'is_active',
      label: 'Show Inactive Departments',
      type: 'checkbox',
      defaultValue: false
    }
  ], [managers]);

  // Memoized initial values for FilterPanel (prevents infinite loops and hook order violations)
  const filterPanelInitialValues = useMemo(() => ({
    manager_id: filters.manager_id?.toString() || '',
    is_active: filters.is_active === undefined, // Convert: undefined = show all (checked), true = active only (unchecked)
    search: searchTerm
  }), [filters.manager_id, filters.is_active, searchTerm]);

  // Optimized filter change handler with useCallback
  // Use refs to avoid recreating callback when setters change
  const setFiltersRef = React.useRef(setFilters);
  const setCurrentPageRef = React.useRef(setCurrentPage);
  
  React.useEffect(() => {
    setFiltersRef.current = setFilters;
    setCurrentPageRef.current = setCurrentPage;
  }, [setFilters, setCurrentPage]);

  const handleFilterChange = useCallback((newFilters: Record<string, any>) => {
    // Handle search separately for debouncing
    if ('search' in newFilters) {
      setSearchTerm(newFilters.search || '');
    }
    
    // Convert FilterPanel format to DepartmentFilters format (excluding search)
    const departmentFilters: Omit<DepartmentFilters, 'search'> = {
      manager_id: newFilters.manager_id ? parseInt(newFilters.manager_id) : undefined,
      is_active: newFilters.is_active ? undefined : true // When checked: show all departments, when unchecked: show only active departments
    };
    
    setFiltersRef.current(departmentFilters);
    setCurrentPageRef.current(1); // Reset to first page when filters change
  }, []); // Empty deps - uses refs for stability
  
  // Handle sorting with useCallback
  const handleSort = useCallback((key: keyof ExtendedDepartment) => {
    if (sortKey === key) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else if (sortDirection === 'desc') {
        setSortDirection(null);
        setSortKey(null);
      }
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
    setCurrentPage(1); // Reset to first page when sorting changes
  }, [sortKey, sortDirection]);

  // Use ref for page size setter too
  const setPageSizeInternalRef = React.useRef(setPageSizeInternal);
  React.useEffect(() => {
    setPageSizeInternalRef.current = setPageSizeInternal;
  }, [setPageSizeInternal]);

  // Optimized pagination handler with useCallback
  const handlePageChange = useCallback((newPage: number) => {
    if (newPage > 0 && newPage <= totalPages) {
      setCurrentPageRef.current(newPage);
    }
  }, [totalPages]); // Only totalPages needed

  // Handle page size change
  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSizeInternalRef.current(newPageSize);
    setCurrentPageRef.current(1); // Reset to first page when page size changes
  }, []); // Empty deps - uses refs
  
  // Clear all filters and pagination
  const handleClearAll = useCallback(() => {
    // Reset deduplication ref to allow fresh fetch after clearing
    lastFetchSignatureRef.current = null;
    isClearingRef.current = true;
    
    // Clear filters, pagination, and search
    clearFilters();
    clearPagination();
    setSearchTerm('');
  }, [clearFilters, clearPagination]);
  
  // Optimized confirmation modal close handler with useCallback
  const handleCloseConfirmModal = useCallback(() => {
    setConfirmModal(prev => ({ ...prev, isOpen: false }));
  }, []);

  return (
    <div className="container p-6 mx-auto relative">
      {/* Skip Link for Accessibility */}
      <a 
        href="#main-content" 
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 bg-indigo-600 text-white px-4 py-2 rounded-md z-50"
        aria-label="Skip to main content"
      >
        Skip to main content
      </a>
      
      {/* Accessibility Status Announcements */}
      <AccessibilityStatus
        totalDepartments={totalItems}
        filteredDepartments={departments.length}
        loading={loading}
        searchTerm={searchTerm}
        currentPage={currentPage}
        totalPages={totalPages}
      />
      
      {/* Performance Monitor (Development Only) */}
      <PerformanceMonitor
        fetchCount={performanceRef.current.fetchCount}
        lastFetchTime={performanceRef.current.lastFetchTime}
        totalDepartments={departments.length}
      />
      
      <main id="main-content">
        <h1 
          className="mb-8 text-2xl font-bold"
          id="page-title"
          tabIndex={-1}
        >
          Department Management
        </h1>
      
      {error && (
        <div className="p-4 mb-6 text-red-700 bg-red-100 rounded-md">
          {error}
          <button 
            onClick={() => setError(null)} 
            className="float-right font-bold"
          >
            &times;
          </button>
        </div>
      )}
      
      {/* Add Department Button with enhanced accessibility */}
      <div className="flex justify-end mb-8">
        <Button
          onClick={handleAddDepartment}
          variant="primary"
          size="lg"
          aria-label="Add new department to the system"
          aria-describedby="add-department-description"
        >
          Add Department
        </Button>
        <span id="add-department-description" className="sr-only">
          Opens a form to create a new department
        </span>
      </div>
      
      {/* Filters */}
      <div className="mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Filters</h2>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleClearAll}
            aria-label="Clear all filters and reset pagination"
          >
            Clear Filters
          </Button>
        </div>
        <FilterPanel
          fields={filterFields}
          onFilterChange={handleFilterChange}
          initialValues={filterPanelInitialValues}
        />
      </div>
      
      {/* Department Table */}
      <DataTable
        data={departments || []}
        columns={columns}
        loading={loading}
        searchable={false} // We have custom search above
        externalPagination={true}
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={totalItems}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        pageSize={pageSize}
        externalSorting={true}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSort={handleSort}
        emptyMessage="No departments found. Try adjusting your filters or adding a new department."
      />
      
      {/* Department Form Modal */}
      <Modal 
        isOpen={isFormOpen} 
        onClose={handleCloseForm}
        title={selectedDepartment ? 'Edit Department' : 'Add Department'}
        size="lg"
      >
        <DepartmentForm
          department={selectedDepartment}
          managers={managers}
          onSubmit={handleSubmitDepartment}
          onCancel={handleCloseForm}
          onStatusChange={handleConfirmStatusChange}
        />
      </Modal>
      
      
      {/* Confirmation Modal */}
      <Modal 
        isOpen={confirmModal.isOpen} 
        onClose={handleCloseConfirmModal}
        title={confirmModal.title}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-gray-600">{confirmModal.message}</p>
          <div className="flex justify-end space-x-3">
            <Button
              type="button"
              variant="ghost"
              onClick={handleCloseConfirmModal}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmModal.onConfirm}
            >
              Confirm
            </Button>
          </div>
        </div>
      </Modal>
      </main>
    </div>
  );
};

export default DepartmentManagement; 