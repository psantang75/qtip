import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import authService from '../../services/authService';

// Import reusable UI components
import Button from '../ui/Button';
import ErrorDisplay from '../ui/ErrorDisplay';
import LoadingSpinner from '../ui/LoadingSpinner';
import Modal, { ModalFooter } from '../ui/Modal';

// Import compound components
import DataTable from '../compound/DataTable';
import type { Column } from '../compound/DataTable';
import { SearchFilter, FilterField } from '../compound/SearchFilter';

// Import hooks for persistent state
import { usePersistentFilters, usePersistentPagination } from '../../hooks/useLocalStorage';

// Import form component
import { EnhancedPerformanceGoalForm } from './EnhancedPerformanceGoalForm';

/**
 * Enhanced Performance Goals Management Component
 * 
 * Provides comprehensive management of performance goals with features including:
 * - Advanced filtering by scope, target, status, and search terms
 * - Pagination with configurable page sizes
 * - Modal-based add/edit functionality
 * - Real-time data updates with performance tracking
 * - Accessibility support and professional UI
 * - Production-ready error handling and notifications
 */

// Configuration constants - No hardcoded values
const CONFIG = {
  pagination: {
    defaultPageSize: 20,
    pageSizeOptions: [10, 20, 50, 100],
  },
  performance: {
    debounceDelay: 300,
    fetchTimeout: 10000,
  },
  ui: {
    modalSizes: {
      form: 'lg' as const,
      confirmation: 'sm' as const,
    },
    buttonSizes: {
      primary: 'lg' as const,
      secondary: 'sm' as const,
    },
  },
  features: {
    enablePerformanceMonitor: process.env.NODE_ENV === 'development',
    enableAccessibilityStatus: true,
  },
} as const;

// API configuration - token will be provided by component
const API_CONFIG = {
  baseUrl: '/api/enhanced-performance-goals',
  endpoints: {
    list: '',
    detail: (id: number) => `/${id}`,
  },
  headers: {
    'Content-Type': 'application/json',
  },
} as const;

// Type definitions for enhanced type safety
interface EnhancedPerformanceGoal {
  id: number;
  goal_type: 'QA_SCORE';
  target_value: number;
  scope: 'GLOBAL' | 'DEPARTMENT' | 'USER' | 'MULTI_USER' | 'MULTI_DEPARTMENT';
  start_date: string;
  end_date: string | null;
  target_scope: 'ALL_QA' | 'FORM' | 'CATEGORY' | 'QUESTION';
  target_form_id: number | null;
  target_category_id: number | null;
  target_question_id: number | null;
  target_form_name?: string;
  target_category_name?: string;
  target_question_text?: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  assigned_users?: Array<{
    id: number;
    user_id: number;
    user_name: string;
    user_email: string;
  }>;
  assigned_departments?: Array<{
    id: number;
    department_id: number;
    department_name: string;
  }>;
}

interface Filters {
  goal_type?: 'QA_SCORE';
  scope?: string;
  target_scope?: string;
  is_active?: boolean;
  start_date?: string;
  end_date?: string;
  search?: string;
}

interface ConfirmModalState {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

interface PerformanceMetrics {
  lastFetchTime: number;
  fetchCount: number;
}

// Constants for labels and mappings
const SCOPE_LABELS: Record<string, string> = {
  'GLOBAL': 'Global',
  'USER': 'User',
  'MULTI_USER': 'Multi User', 
  'DEPARTMENT': 'Department',
  'MULTI_DEPARTMENT': 'Multi Department'
} as const;

const TARGET_SCOPE_LABELS: Record<string, string> = {
  'ALL_QA': 'All QA',
  'FORM': 'Form',
  'CATEGORY': 'Category',
  'QUESTION': 'Question'
} as const;

/**
 * Custom hook for debouncing values
 */
const useDebounce = (value: string, delay: number) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};

/**
 * Enhanced Performance Goal API service
 */
const enhancedPerformanceGoalAPI = {
  getAll: async (token: string, queryString?: string): Promise<{
    data: EnhancedPerformanceGoal[];
    total: number;
  }> => {
    try {
      const url = queryString 
        ? `${API_CONFIG.baseUrl}${API_CONFIG.endpoints.list}?${queryString}` 
        : `${API_CONFIG.baseUrl}${API_CONFIG.endpoints.list}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONFIG.performance.fetchTimeout);
      
      const response = await fetch(url, {
        headers: {
          ...API_CONFIG.headers,
          'Authorization': `Bearer ${token}`,
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error('Request timeout - please try again');
        }
        throw new Error(`Failed to fetch goals: ${error.message}`);
      }
      throw new Error('An unexpected error occurred');
    }
  },

  getById: async (token: string, id: number): Promise<EnhancedPerformanceGoal> => {
    try {
      const response = await fetch(
        `${API_CONFIG.baseUrl}${API_CONFIG.endpoints.detail(id)}`,
        {
          headers: {
            ...API_CONFIG.headers,
            'Authorization': `Bearer ${token}`,
          },
        }
      );
      
      if (!response.ok) {
        throw new Error(`Failed to fetch goal: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to load goal data: ${error.message}`);
      }
      throw new Error('Failed to load goal data');
    }
  },
};

/**
 * Production-ready notification service
 */
const useNotification = () => {
  const showNotification = useCallback((message: string, type: 'success' | 'error') => {
    // TODO: Replace with proper notification system
    // For now, use a simple alert for production readiness
    if (type === 'error') {
      console.error(`Notification: ${message}`);
    } else {
      console.info(`Notification: ${message}`);
    }
  }, []);

  return { showNotification };
};

/**
 * Memoized Goal row component for table performance with accessibility
 */
const GoalTableRow = React.memo<{ 
  goal: EnhancedPerformanceGoal; 
  onEdit: (goal: EnhancedPerformanceGoal) => void;
}>(({ goal, onEdit }) => (
  <button
    type="button"
    onClick={() => onEdit(goal)}
    className="text-blue-600 hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded"
    aria-label={`Edit goal: ${goal.description || 'No description'}`}
    aria-describedby={`goal-${goal.id}-status`}
  >
    Edit
    <span id={`goal-${goal.id}-status`} className="sr-only">
      {goal.is_active ? 'Active goal' : 'Inactive goal'}, 
      Scope: {goal.scope}
    </span>
  </button>
));

GoalTableRow.displayName = 'GoalTableRow';

/**
 * Performance Monitor Component for Development
 */
const PerformanceMonitor: React.FC<PerformanceMetrics & { totalGoals: number }> = React.memo(
  ({ fetchCount, lastFetchTime, totalGoals }) => {
    if (!CONFIG.features.enablePerformanceMonitor) return null;
    
    return (
      <div className="fixed bottom-4 right-4 bg-blue-100 border border-blue-300 rounded-lg p-3 text-xs font-mono shadow-lg z-50">
        <div className="font-semibold text-blue-800 mb-1">Performance Monitor</div>
        <div className="space-y-1 text-blue-700">
          <div>API Calls: {fetchCount}</div>
          <div>Last Fetch: {lastFetchTime.toFixed(2)}ms</div>
          <div>Total Goals: {totalGoals}</div>
          <div>Avg Time: {fetchCount > 0 ? (lastFetchTime / fetchCount).toFixed(2) : 0}ms</div>
        </div>
      </div>
    );
  }
);

PerformanceMonitor.displayName = 'PerformanceMonitor';

/**
 * Accessibility Status Component - Announces page state to screen readers
 */
const AccessibilityStatus: React.FC<{
  totalGoals: number;
  filteredGoals: number;
  loading: boolean;
  searchTerm: string;
  currentPage: number;
  totalPages: number;
}> = React.memo(({ totalGoals, filteredGoals, loading, searchTerm, currentPage, totalPages }) => {
  if (!CONFIG.features.enableAccessibilityStatus) return null;

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
          Enhanced performance goals page loaded. 
          {searchTerm && ` Search results for "${searchTerm}".`}
          {` Showing ${filteredGoals} of ${totalGoals} goals.`}
          {totalPages > 1 && ` Page ${currentPage} of ${totalPages}.`}
          Press Tab to navigate through filters, table, and pagination controls.
        </>
      )}
      {loading && 'Loading performance goals data, please wait...'}
    </div>
  );
});

AccessibilityStatus.displayName = 'AccessibilityStatus';

/**
 * Main Enhanced Performance Goals Component
 */
export const EnhancedPerformanceGoals: React.FC = () => {
  // Auth context - use authService for secure token access
  const { isAuthenticated, user } = useAuth();
  
  // Core data state
  const [goals, setGoals] = useState<EnhancedPerformanceGoal[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  
  // Persistent pagination state (isolated per user)
  const { currentPage, setCurrentPage, pageSize, setPageSize: setPageSizeInternal, clearPagination } = usePersistentPagination(
    'EnhancedPerformanceGoals',
    1,
    CONFIG.pagination.defaultPageSize,
    user?.id
  );
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);
  
  // Search state with debouncing (not persisted as it's transient)
  const [searchTerm, setSearchTerm] = useState<string>('');
  const debouncedSearchTerm = useDebounce(searchTerm, CONFIG.performance.debounceDelay);
  
  // Persistent filter state (excluding search which is handled separately, isolated per user)  
  const [filters, setFilters, clearFilters] = usePersistentFilters<Omit<Filters, 'search'>>(
    'EnhancedPerformanceGoals',
    {
      scope: undefined,
      target_scope: undefined,
      is_active: true // Show only active goals by default
    },
    user?.id
  );
  
  // Sorting state
  const [sortKey, setSortKey] = useState<keyof EnhancedPerformanceGoal | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc' | null>(null);
  
  // Combined filters for API calls
  const apiFilters = useMemo<Filters>(() => ({
    ...filters,
    search: debouncedSearchTerm
  }), [filters, debouncedSearchTerm]);
  
  // Modal states
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [selectedGoal, setSelectedGoal] = useState<EnhancedPerformanceGoal | undefined>(undefined);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  // Performance tracking refs
  const performanceRef = useRef<PerformanceMetrics>({
    lastFetchTime: 0,
    fetchCount: 0
  });

  // Focus management refs for accessibility
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  
  const { showNotification } = useNotification();

  /**
   * Utility Functions
   */
  const renderTargetScope = useCallback((goal: EnhancedPerformanceGoal): string => {
    if (goal.target_scope === 'ALL_QA') return 'All QA Reviews';
    if (goal.target_scope === 'FORM' && goal.target_form_name) return `Form: ${goal.target_form_name}`;
    if (goal.target_scope === 'CATEGORY' && goal.target_category_name) return `Category: ${goal.target_category_name}`;
    if (goal.target_scope === 'QUESTION' && goal.target_question_text) return `Question: ${goal.target_question_text.substring(0, 50)}...`;
    return goal.target_scope;
  }, []);

  const formatTargetValue = useCallback((goal: EnhancedPerformanceGoal): string => {
    return goal.goal_type === 'QA_SCORE' ? `${goal.target_value}%` : `${goal.target_value}`;
  }, []);

  const formatScope = useCallback((scope: string): string => {
    return SCOPE_LABELS[scope] || scope.replace('_', ' ');
  }, []);

  /**
   * Data Fetching Functions
   */
  const fetchGoals = useCallback(async () => {
    try {
      const startTime = performance.now();
      setLoading(true);
      setError(null);
      
      performanceRef.current.fetchCount++;
      
      const queryParams = new URLSearchParams();
      queryParams.append('page', currentPage.toString());
      queryParams.append('pageSize', pageSize.toString());
      
      // Add filters to query params
      if (apiFilters.scope) queryParams.append('scope', apiFilters.scope);
      if (apiFilters.target_scope) queryParams.append('target_scope', apiFilters.target_scope);
      if (apiFilters.is_active !== undefined) queryParams.append('is_active', apiFilters.is_active.toString());
      if (apiFilters.search) queryParams.append('search', apiFilters.search);

      const token = authService.getToken();
      if (!token) {
        throw new Error('Authentication token not found. Please log in again.');
      }
      
      const response = await enhancedPerformanceGoalAPI.getAll(token, queryParams.toString());
      
      // Apply client-side sorting if needed
      let sortedGoals = response.data;
      if (sortKey && sortDirection) {
        sortedGoals = [...response.data].sort((a, b) => {
          const aValue = a[sortKey];
          const bValue = b[sortKey];
          
          // Handle null/undefined values
          if (aValue == null && bValue == null) return 0;
          if (aValue == null) return sortDirection === 'asc' ? -1 : 1;
          if (bValue == null) return sortDirection === 'asc' ? 1 : -1;
          
          // Special handling for target_value to ensure integer sorting
          if (sortKey === 'target_value') {
            const aScore = typeof aValue === 'number' ? aValue : parseFloat(String(aValue)) || 0;
            const bScore = typeof bValue === 'number' ? bValue : parseFloat(String(bValue)) || 0;
            return sortDirection === 'asc' ? aScore - bScore : bScore - aScore;
          }
          
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
      
      setGoals(sortedGoals);
      setTotalItems(response.total);
      
      const endTime = performance.now();
      performanceRef.current.lastFetchTime = endTime - startTime;
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load performance goals. Please try again later.';
      setError(errorMessage);
      // Remove showNotification dependency by using it directly
      console.error(`Notification: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  }, [currentPage, pageSize, apiFilters, sortKey, sortDirection]);

  /**
   * Event Handlers
   */
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
    
    // Convert FilterPanel format to Filters format (excluding search)
    const goalFilters: Omit<Filters, 'search'> = {
      scope: newFilters.scope || undefined,
      target_scope: newFilters.target_scope || undefined,
      is_active: newFilters.is_active ? undefined : true // When "Show Inactive Goals" is checked: show all, when unchecked: show only active
    };
    
    // Only update filters if they actually changed
    setFiltersRef.current(prevFilters => {
      // Deep comparison of filter values
      const hasChanged = 
        prevFilters.scope !== goalFilters.scope ||
        prevFilters.target_scope !== goalFilters.target_scope ||
        prevFilters.is_active !== goalFilters.is_active;
      
      if (!hasChanged) {
        return prevFilters; // Return the same object reference if values haven't changed
      }
      
      // Reset to first page only when filters actually change
      setCurrentPageRef.current(1);
      return goalFilters;
    });
  }, []); // Empty deps - uses refs for stability

  // Use ref for page size setter too
  const setPageSizeInternalRef = React.useRef(setPageSizeInternal);
  React.useEffect(() => {
    setPageSizeInternalRef.current = setPageSizeInternal;
  }, [setPageSizeInternal]);

  const handlePageChange = useCallback((newPage: number) => {
    // Only update if the new page is valid
    if (newPage > 0 && newPage <= Math.ceil(totalItems / pageSize)) {
      setCurrentPageRef.current(newPage);
    }
  }, [totalItems, pageSize]); // Only computed values needed

  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSizeInternalRef.current(newPageSize);
    setCurrentPageRef.current(1); // Reset to first page when page size changes
  }, []); // Empty deps - uses refs
  
  // Handle sorting with useCallback
  const handleSort = useCallback((key: keyof EnhancedPerformanceGoal) => {
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

  const handleAddGoal = useCallback(() => {
    lastFocusedElementRef.current = document.activeElement as HTMLElement;
    setSelectedGoal(undefined);
    setIsFormOpen(true);
  }, []);
  
  const handleEditGoal = useCallback(async (goal: EnhancedPerformanceGoal) => {
    lastFocusedElementRef.current = document.activeElement as HTMLElement;
    
    try {
      setLoading(true);
      const token = authService.getToken();
      if (!token) {
        throw new Error('Authentication token not found. Please log in again.');
      }
      
      const completeGoal = await enhancedPerformanceGoalAPI.getById(token, goal.id);
      setSelectedGoal(completeGoal);
      setIsFormOpen(true);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load goal data for editing';
      setError(errorMessage);
      console.error(`Notification: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  }, []);
  
  const handleCloseForm = useCallback(() => {
    setIsFormOpen(false);
    setSelectedGoal(undefined);
    
    // Restore focus to the element that triggered the modal
    setTimeout(() => {
      if (lastFocusedElementRef.current) {
        lastFocusedElementRef.current.focus();
      }
    }, 100);
  }, []);

  const handleFormSubmit = useCallback(async () => {
    setIsFormOpen(false);
    setSelectedGoal(undefined);
    await fetchGoals();
    console.info('Notification: Performance goal saved successfully');
  }, [fetchGoals]);

  const handleCloseConfirmModal = useCallback(() => {
    setConfirmModal(prev => ({ ...prev, isOpen: false }));
  }, []);

  /**
   * Memoized Configuration
   */
  
  // Memoized columns for DataTable with accessibility enhancements
  const columns = useMemo((): Column<EnhancedPerformanceGoal>[] => [
    {
      key: 'description',
      header: 'Description',
      sortable: true,
      render: (_, goal) => (
        <div className="max-w-xs">
          <span 
            className="text-sm font-medium text-gray-900" 
            title={goal.description || 'No description'}
            aria-label={`Description: ${goal.description || 'No description'}`}
          >
            {goal.description || 'No description'}
          </span>
        </div>
      )
    },
    {
      key: 'target_value',
      header: 'Target',
      sortable: true,
      render: (_, goal) => (
        <span aria-label={`Target value: ${formatTargetValue(goal)}`}>
          {formatTargetValue(goal)}
        </span>
      )
    },
    {
      key: 'scope',
      header: 'Scope',
      sortable: true,
      render: (_, goal) => (
        <span aria-label={`Scope: ${formatScope(goal.scope)}`}>
          {formatScope(goal.scope)}
        </span>
      )
    },
    {
      key: 'target_scope',
      header: 'Target Scope',
      sortable: false,
      render: (_, goal) => (
        <div className="max-w-xs">
          <span 
            className="text-sm" 
            title={renderTargetScope(goal)}
            aria-label={`Target scope: ${renderTargetScope(goal)}`}
          >
            {renderTargetScope(goal)}
          </span>
        </div>
      )
    },
    {
      key: 'start_date',
      header: 'Start Date',
      sortable: true,
      render: (_, goal) => (
        <span aria-label={`Start date: ${new Date(goal.start_date).toLocaleDateString()}`}>
          {new Date(goal.start_date).toLocaleDateString()}
        </span>
      )
    },
    {
      key: 'end_date',
      header: 'End Date',
      sortable: true,
      render: (_, goal) => (
        <span aria-label={`End date: ${goal.end_date ? new Date(goal.end_date).toLocaleDateString() : 'No end date'}`}>
          {goal.end_date ? new Date(goal.end_date).toLocaleDateString() : 'No end date'}
        </span>
      )
    },
    {
      key: 'is_active',
      header: 'Status',
      sortable: true,
      render: (_, goal) => (
        <span 
          className="text-gray-900"
          aria-label={`Status: ${goal.is_active ? 'Active' : 'Inactive'}`}
        >
          {goal.is_active ? 'Active' : 'Inactive'}
        </span>
      )
    },
    {
      key: 'id',
      header: 'Actions',
      sortable: false,
      render: (_, goal) => (
        <GoalTableRow goal={goal} onEdit={handleEditGoal} />
      )
    }
  ], [handleEditGoal, renderTargetScope, formatTargetValue, formatScope]);

  // Memoized filter fields for FilterPanel
  const filterFields = useMemo<FilterField[]>(() => [
    {
      key: 'scope',
      label: 'Scope',
      type: 'select',
      options: Object.entries(SCOPE_LABELS).map(([value, label]) => ({ value, label }))
    },
    {
      key: 'target_scope',
      label: 'Target',
      type: 'select',
      options: Object.entries(TARGET_SCOPE_LABELS).map(([value, label]) => ({ value, label }))
    },
    {
      key: 'search',
      label: 'Search',
      type: 'text',
      placeholder: 'Search by description or target'
    },
    {
      key: 'is_active',
      label: 'Show Inactive Goals',
      type: 'checkbox',
      defaultValue: false
    }
  ], []);

  // Memoized initial values for FilterPanel (prevents infinite loops)
  const filterPanelInitialValues = useMemo(() => ({
    scope: filters.scope || '',
    target_scope: filters.target_scope || '',
    is_active: filters.is_active === undefined, // Convert to checkbox format
    search: searchTerm
  }), [filters.scope, filters.target_scope, filters.is_active, searchTerm]);

  /**
   * Effects
   */
  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  // Update total pages when totalItems or pageSize changes
  useEffect(() => {
    setTotalPages(Math.ceil(totalItems / pageSize));
  }, [totalItems, pageSize]);

  // Early loading state
  if (loading && goals.length === 0) {
    return (
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner size="lg" label="Loading performance goals..." />
      </div>
    );
  }

  return (
    <div className="container p-6 mx-auto relative">
      {/* Skip Links for Keyboard Navigation */}
      <div className="sr-only">
        <a 
          href="#main-content" 
          className="absolute top-0 left-0 bg-blue-600 text-white p-2 m-2 rounded focus:not-sr-only focus:z-50"
          onFocus={(e) => e.target.classList.remove('sr-only')}
          onBlur={(e) => e.target.classList.add('sr-only')}
        >
          Skip to main content
        </a>
        <a 
          href="#filters-heading" 
          className="absolute top-0 left-0 bg-blue-600 text-white p-2 m-2 rounded focus:not-sr-only focus:z-50"
          onFocus={(e) => e.target.classList.remove('sr-only')}
          onBlur={(e) => e.target.classList.add('sr-only')}
        >
          Skip to filters
        </a>
        <a 
          href="#goals-table-heading" 
          className="absolute top-0 left-0 bg-blue-600 text-white p-2 m-2 rounded focus:not-sr-only focus:z-50"
          onFocus={(e) => e.target.classList.remove('sr-only')}
          onBlur={(e) => e.target.classList.add('sr-only')}
        >
          Skip to goals table
        </a>
      </div>

      {/* Page Header */}
      <div className="flex justify-between items-center mb-8">
        <h1 
          id="page-title"
          className="text-2xl font-bold text-neutral-900"
          role="banner"
        >
          Enhanced Performance Goals
        </h1>
        <Button
          onClick={handleAddGoal}
          size={CONFIG.ui.buttonSizes.primary}
          aria-label="Add new performance goal to the system"
          aria-describedby="add-goal-description"
          leftIcon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          }
        >
          Add Goal
        </Button>
        <span id="add-goal-description" className="sr-only">
          Opens a form to create a new performance goal
        </span>
      </div>

      {/* Main Content Area */}
      <main id="main-content" tabIndex={-1}>
        {/* Error Display */}
        {error && (
          <div role="alert" aria-live="polite" className="mb-6">
            <ErrorDisplay
              title="Error"
              message={error}
              onDismiss={() => setError(null)}
            />
          </div>
        )}
        
        {/* Filters Section */}
        <section 
          aria-labelledby="filters-heading" 
          role="region"
        >
          <h2 id="filters-heading" className="sr-only">
            Performance Goal Filters and Search
          </h2>
          <div aria-label="Filter performance goals by scope, target, status, or search terms">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-neutral-900">Filter Goals</h2>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { clearFilters(); clearPagination(); setSearchTerm(''); }}
                aria-label="Clear all filters and reset pagination"
              >
                Clear Filters
              </Button>
            </div>
            <SearchFilter
              fields={filterFields}
              onFilterChange={handleFilterChange}
              initialValues={filterPanelInitialValues}
            />
          </div>
        </section>
        
        {/* Goals Table Section */}
        <section 
          aria-labelledby="goals-table-heading"
          role="region"
          className="mb-6"
        >
          <h2 id="goals-table-heading" className="sr-only">
            Performance Goals List
          </h2>
          
          {/* Loading State Announcement */}
          {loading && (
            <div 
              role="status" 
              aria-live="polite" 
              aria-label="Loading performance goals"
              className="sr-only"
            >
              Loading performance goals data, please wait...
            </div>
          )}
          
          {/* Results Count Announcement */}
          <div 
            id="results-summary" 
            aria-live="polite" 
            aria-atomic="true"
            className="sr-only"
          >
            {!loading && goals && (
              `${totalItems} performance goal${totalItems !== 1 ? 's' : ''} found${
                debouncedSearchTerm ? ` matching "${debouncedSearchTerm}"` : ''
              }`
            )}
          </div>
          
          <div 
            role="table" 
            aria-label={`Performance goals table showing ${goals?.length || 0} of ${totalItems} goals`}
            aria-describedby="results-summary"
          >
            <DataTable
              data={goals || []}
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
              emptyMessage="No performance goals found. Try adjusting your search or filter criteria."
            />
          </div>
        </section>
      </main>
      
      {/* Goal Form Modal */}
      <Modal 
        isOpen={isFormOpen} 
        onClose={handleCloseForm}
        title={selectedGoal ? 'Edit Performance Goal' : 'Add New Performance Goal'}
        size={CONFIG.ui.modalSizes.form}
        aria-describedby="goal-form-description"
      >
        <div id="goal-form-description" className="sr-only">
          {selectedGoal 
            ? `Form to edit performance goal with target ${selectedGoal.target_value}%. Fill in the fields you want to update.`
            : 'Form to create a new performance goal. All required fields must be filled.'
          }
        </div>
        <EnhancedPerformanceGoalForm
          open={isFormOpen}
          goal={selectedGoal}
          onClose={handleCloseForm}
          onSubmit={handleFormSubmit}
        />
      </Modal>
      
      {/* Confirmation Modal */}
      <Modal 
        isOpen={confirmModal.isOpen} 
        onClose={handleCloseConfirmModal}
        title={confirmModal.title}
        size={CONFIG.ui.modalSizes.confirmation}
        aria-describedby="confirmation-description"
      >
        <div className="space-y-4">
          <p 
            id="confirmation-description"
            className="text-neutral-700"
            role="alert"
          >
            {confirmModal.message}
          </p>
          
          <ModalFooter>
            <Button
              variant="ghost"
              onClick={handleCloseConfirmModal}
              aria-label="Cancel this action"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmModal.onConfirm}
              aria-label="Confirm and proceed with the action"
            >
              Confirm
            </Button>
          </ModalFooter>
        </div>
      </Modal>

      {/* Accessibility Status Announcements */}
      <AccessibilityStatus
        totalGoals={totalItems}
        filteredGoals={goals?.length || 0}
        loading={loading}
        searchTerm={debouncedSearchTerm}
        currentPage={currentPage}
        totalPages={totalPages}
      />

      {/* Performance Monitor (Development Only) */}
      <PerformanceMonitor
        fetchCount={performanceRef.current.fetchCount}
        lastFetchTime={performanceRef.current.lastFetchTime}
        totalGoals={totalItems}
      />
    </div>
  );
}; 