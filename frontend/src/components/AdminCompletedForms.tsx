// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../services/apiClient';
import DataTable, { Column } from './compound/DataTable';
import FilterPanel, { FilterField } from './compound/SearchFilter';
import ErrorDisplay from './ui/ErrorDisplay';
import Button from './ui/Button';
import LoadingSpinner from './ui/LoadingSpinner';
import { getArrayFromResponse } from '../utils/apiHelpers';
import { usePersistentFilters, useLocalStorage } from '../hooks/useLocalStorage';
import { useAuth } from '../contexts/AuthContext';

// Types - exactly matching QA
interface CompletedSubmission {
  id: number;
  form_id: number;
  form_name: string;
  auditor_name: string;
  csr_name: string;
  submitted_at: string;
  total_score: number;
  status: 'SUBMITTED' | 'FINALIZED' | 'DISPUTED';
}

interface FilterState {
  form_id: string;
  form_id_search: string;
  date_start: string;
  date_end: string;
  status: string;
  search: string;
}

const AdminCompletedForms: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const lastFetchSignatureRef = React.useRef<string | null>(null);
  const isClearingRef = React.useRef<boolean>(false);

  // Calculate rolling month dates (last 30 days) - same as QA
  const getDefaultDates = () => {
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    
    return {
      date_start: thirtyDaysAgo.toISOString().split('T')[0], // Format: YYYY-MM-DD
      date_end: today.toISOString().split('T')[0]
    };
  };

  // State for submissions data
  const [submissions, setSubmissions] = useState<CompletedSubmission[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Persistent filter state with default dates (function for fresh dates on clear)
  const [filters, setFilters, clearFilters] = usePersistentFilters<FilterState>(
    'AdminCompletedForms',
    () => {
      const defaultDates = getDefaultDates();
      return {
        form_id: '',
        form_id_search: '',
        date_start: defaultDates.date_start,
        date_end: defaultDates.date_end,
        status: '',
        search: ''
      };
    },
    user?.id
  );

  // Refresh stale date ranges on mount if they're older than 1 day
  React.useEffect(() => {
    const now = new Date();
    const filterEndDate = new Date(filters.date_end);
    const daysDiff = Math.floor((now.getTime() - filterEndDate.getTime()) / (1000 * 60 * 60 * 24));
    
    // If date range is stale (more than 1 day old), refresh with current dates
    if (daysDiff >= 1) {
      const freshDates = getDefaultDates();
      setFilters(prev => ({
        ...prev,
        date_start: freshDates.date_start,
        date_end: freshDates.date_end
      }));
    }
  }, []); // Only run on mount

  // Persistent page size (client-side pagination)
  const [pageSize, setPageSize, clearPageSize] = useLocalStorage<number>(
    `qtip_pageSize_${user?.id}_AdminCompletedForms`,
    20
  );

  // Handle page size changes from DataTable
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
  };

  // State for form options in filter dropdown
  const [formOptions, setFormOptions] = useState<{ id: number; form_name: string }[]>([]);
  
  // Sorting state
  const [sortKey, setSortKey] = useState<keyof CompletedSubmission | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc' | null>(null);

  // Effect to fetch forms for dropdown - same as QA
  useEffect(() => {
    const fetchForms = async () => {
      try {
        const response = await apiClient.get('/forms?is_active=true');
        const formData = getArrayFromResponse<{ id: number; form_name: string }>(response.data, []);
        // Sort forms alphabetically by form_name
        const sortedFormData = formData.sort((a, b) => a.form_name.localeCompare(b.form_name));
        setFormOptions(sortedFormData);
      } catch (err) {
        console.error('Error fetching forms:', err);
      }
    };

    fetchForms();
  }, []);

  const fetchCompletedSubmissions = useCallback(async (force = false) => {
    setIsLoading(true);
    setError(null);

    // Build params - use form_id_search if provided, otherwise use form_id from dropdown
    const params: any = {
      ...filters,
      page: 1,
      limit: 1000
    };
    
    // If form_id_search has a value, use it as form_id (overriding the dropdown selection)
    if (filters.form_id_search && filters.form_id_search.trim() !== '') {
      params.form_id = filters.form_id_search;
    }
    
    // Remove form_id_search from params as backend doesn't expect it
    delete params.form_id_search;

    // Create a stable signature: sort params keys to avoid order-related churn
    const orderedParams = Object.keys(params)
      .sort()
      .reduce<Record<string, any>>((acc, key) => {
        acc[key] = params[key];
        return acc;
      }, {});

    const signature = JSON.stringify({
      params: orderedParams,
      sortKey,
      sortDirection
    });

    // Skip duplicate requests with identical payload unless force=true
    if (!force && signature === lastFetchSignatureRef.current) {
      setIsLoading(false);
      return;
    }

    lastFetchSignatureRef.current = signature;

    try {
      const response = await apiClient.get('/admin/completed-forms', { params });
      const submissionsData = getArrayFromResponse<CompletedSubmission>(response.data, []);
      
      // Apply client-side sorting if needed
      let sortedSubmissions = submissionsData;
      if (sortKey && sortDirection) {
        sortedSubmissions = [...submissionsData].sort((a, b) => {
          const aValue = a[sortKey];
          const bValue = b[sortKey];
          
          // Handle null/undefined values
          if (aValue == null && bValue == null) return 0;
          if (aValue == null) return sortDirection === 'asc' ? -1 : 1;
          if (bValue == null) return sortDirection === 'asc' ? 1 : -1;
          
          // Special handling for total_score to ensure integer sorting
          if (sortKey === 'total_score') {
            const aScore = typeof aValue === 'number' ? aValue : parseFloat(aValue) || 0;
            const bScore = typeof bValue === 'number' ? bValue : parseFloat(bValue) || 0;
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
      
      setSubmissions(sortedSubmissions);
      setIsLoading(false);
    } catch (err: any) {
      console.error('Error fetching completed submissions:', err);
      setError(err.response?.data?.message || err.message || 'Error fetching completed submissions');
      setSubmissions([]);
      lastFetchSignatureRef.current = null; // allow retry of same payload after an error
      setIsLoading(false);
    }
  }, [
    filters.date_end,
    filters.date_start,
    filters.form_id,
    filters.form_id_search,
    filters.search,
    filters.status,
    sortDirection,
    sortKey
  ]);

  // Effect to fetch completed submissions when filters change - same as QA
  useEffect(() => {
    // Use a timeout to batch multiple rapid state updates (e.g., from clear filters)
    const timeoutId = setTimeout(() => {
      const force = isClearingRef.current;
      if (force) {
        isClearingRef.current = false;
        lastFetchSignatureRef.current = null;
      }
      fetchCompletedSubmissions(force);
    }, 0);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.date_end, filters.date_start, filters.form_id, filters.form_id_search, filters.search, filters.status, sortDirection, sortKey]);

  // Use ref to avoid recreating callback when setter changes
  const setFiltersRef = React.useRef(setFilters);
  React.useEffect(() => {
    setFiltersRef.current = setFilters;
  }, [setFilters]);

  // Handle filter changes - same as QA (memoized with ref pattern)
  const handleFilterChange = useCallback((values: Record<string, any>) => {
    setFiltersRef.current(values as FilterState);
  }, []); // Empty deps - uses ref for stability

  // Handle view details - admin-specific navigation  
  const handleViewDetails = (submissionId: number) => {
    // Navigate to admin-specific completed form page
    navigate(`/admin/completed-forms/${submissionId}`);
  };
  
  // Handle sorting
  const handleSort = (key: keyof CompletedSubmission) => {
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
  };

  // Format date for display - consistent with QA
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit', 
      year: 'numeric'
    });
  };

  // Define table columns - improved score handling
  const columns: Column<CompletedSubmission>[] = [
    { 
      key: 'status', 
      header: 'Status',
      render: (value, submission) => {
        // Format status to proper case instead of all caps - same as QA
        const statusText = submission.status.charAt(0).toUpperCase() + submission.status.slice(1).toLowerCase();
        return statusText;
      }
    },
    { 
      key: 'form_id', 
      header: 'Form ID',
      render: (value, submission) => {
        return <span className="font-medium">{submission.form_id}</span>;
      }
    },
    { key: 'form_name', header: 'Form Name' },
    { key: 'auditor_name', header: 'Auditor' },
    { 
      key: 'csr_name', 
      header: 'CSR'
    },
    { 
      key: 'submitted_at', 
      header: 'Submission Date',
      render: (value, submission) => formatDate(submission.submitted_at)
    },
    { 
      key: 'total_score', 
      header: 'Score',
      render: (value, submission) => {
        if (submission.total_score == null || submission.total_score === undefined) {
          return '';
        }
        const score = Number(submission.total_score);
        const isValidScore = !isNaN(score);
        
        if (!isValidScore) {
          return '';
        }
        
        return `${score.toFixed(2)}%`;
      }
    },
    {
      key: 'id',
      header: 'Actions',
      render: (value, submission) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleViewDetails(submission.id)}
          className="text-primary-blue hover:text-primary-blue-dark"
          aria-label={`View details for submission ${submission.id}`}
        >
          View
        </Button>
      )
    }
  ];

  // Define filter fields - same as QA
  // Memoized initial values for FilterPanel (list individual properties for efficient comparison)
  // Create a new object only when filter values actually change to prevent infinite loops
  const filterPanelInitialValues = useMemo(() => {
    return {
      form_id: filters.form_id,
      form_id_search: filters.form_id_search,
      date_start: filters.date_start,
      date_end: filters.date_end,
      status: filters.status,
      search: filters.search
    };
  }, [
    filters.form_id,
    filters.form_id_search,
    filters.date_start,
    filters.date_end,
    filters.status,
    filters.search
  ]);

  const filterFields: FilterField[] = [
    {
      key: 'status',
      label: 'Status',
      type: 'select' as const,
      options: [
        { value: '', label: 'All Statuses' },
        { value: 'SUBMITTED', label: 'Submitted' },
        { value: 'FINALIZED', label: 'Finalized' },
        { value: 'DISPUTED', label: 'Disputed' }
      ]
    },
    {
      key: 'form_id',
      label: 'Form',
      type: 'select' as const,
      options: [
        { value: '', label: 'All Forms' },
        ...formOptions.map(form => ({ value: form.id.toString(), label: form.form_name }))
      ]
    },
    {
      key: 'form_id_search',
      label: 'Form ID',
      type: 'text' as const,
      placeholder: 'Search by form ID'
    },
    {
      key: 'search',
      label: 'Search',
      type: 'text' as const,
      placeholder: 'Search by CSR, auditor, form name...'
    },
    {
      key: 'date_start',
      label: 'From Date',
      type: 'date' as const,
      defaultValue: filters.date_start
    },
    {
      key: 'date_end',
      label: 'To Date',
      type: 'date' as const,
      defaultValue: filters.date_end
    }
  ];

  // Retry mechanism for failed requests - same as QA
  const handleRetry = () => {
    setError(null);
    fetchCompletedSubmissions(true);
  };

  return (
    <div className="container p-6 mx-auto relative">
      {/* Skip Links for Accessibility */}
      <div className="sr-only">
        <a 
          href="#main-content" 
          className="absolute top-0 left-0 bg-blue-600 text-white p-2 m-2 rounded focus:not-sr-only focus:z-50"
        >
          Skip to main content
        </a>
        <a 
          href="#filters-section" 
          className="absolute top-0 left-0 bg-blue-600 text-white p-2 m-2 rounded focus:not-sr-only focus:z-50"
        >
          Skip to filters
        </a>
      </div>

      {/* Header Section */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">Completed Forms</h1>
        <p className="text-neutral-600 mt-1">
          View and manage all completed audit submissions across the platform
        </p>
      </div>

      {/* Error Display with Retry */}
      {error && (
        <div className="mb-6">
          <ErrorDisplay message={error} />
          <div className="mt-4 text-center">
            <Button
              variant="secondary"
              onClick={handleRetry}
              loading={isLoading}
              className="text-sm"
            >
              Try Again
            </Button>
          </div>
        </div>
      )}

      {/* Filter Section */}
      <div id="filters-section" className="mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Filter Completed Forms</h2>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              isClearingRef.current = true;
              clearFilters();
              clearPageSize();
            }}
            aria-label="Clear all filters and reset page size"
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

      {/* Loading State */}
      {isLoading && (
        <div className="mb-8">
          <div className="bg-white rounded-lg shadow-sm border p-12">
            <div className="flex justify-center items-center">
              <LoadingSpinner size="lg" color="primary" />
              <span className="ml-3 text-neutral-700">Loading completed forms...</span>
            </div>
          </div>
        </div>
      )}

      {/* Data Table Section */}
      <div id="main-content">
        {!isLoading && (
          <DataTable
            data={submissions}
            columns={columns}
            loading={false}
            pagination={true}
            pageSize={pageSize}
            onPageSizeChange={handlePageSizeChange}
            externalSorting={true}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={handleSort}
            emptyMessage="No completed submissions found for the selected criteria."
          />
        )}
      </div>
    </div>
  );
};

export default AdminCompletedForms; 