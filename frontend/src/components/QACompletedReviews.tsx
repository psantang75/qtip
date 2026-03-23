import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { getArrayFromResponse } from '../utils/apiHelpers';
import DataTable, { Column } from './compound/DataTable';
import FilterPanel, { FilterField } from './compound/SearchFilter';
import ErrorDisplay from './ui/ErrorDisplay';
import Button from './ui/Button';
import LoadingSpinner from './ui/LoadingSpinner';
import { useAuth } from '../contexts/AuthContext';
import { usePersistentFilters, useLocalStorage } from '../hooks/useLocalStorage';

// Define types
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

const QACompletedReviews: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const lastFetchSignatureRef = React.useRef<string | null>(null);
  const isClearingRef = React.useRef<boolean>(false);

  // Determine API endpoint based on user role
  const getApiEndpoint = () => {
    if (user?.role_id === 4) { // Trainer role
      return '/trainer/completed';
    }
    return '/qa/completed'; // Default to QA endpoint
  };

  // Determine detail route based on user role
  const getDetailRoute = (id: number) => {
    if (user?.role_id === 4) { // Trainer role
      return `/trainer/completed-reviews/${id}`;
    }
    return `/qa/completed-reviews/${id}`; // Default to QA route
  };

  // Calculate rolling month dates (last 30 days)
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

  // Persistent filter state with default dates (isolated per user)
  const [filters, setFilters, clearFilters] = usePersistentFilters<FilterState>(
    'QACompletedReviews',
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
    `qtip_pageSize_${user?.id}_QACompletedReviews`,
    10
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

  // Effect to fetch forms for dropdown
  useEffect(() => {
    const fetchForms = async () => {
      try {
        const response = await apiClient.get('/forms?is_active=true');
        const formData = getArrayFromResponse<{ id: number; form_name: string }>(response.data, []);
        setFormOptions(formData);
      } catch (err) {
        console.error('Error fetching forms:', err);
        // Could show a toast notification here in the future
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
      limit: 1000  // Get all records for internal pagination
    };
    
    if (filters.form_id_search && filters.form_id_search.trim() !== '') {
      params.form_id = filters.form_id_search.trim();
    }
    delete params.form_id_search;

    // Create stable signature with sorted params
    const orderedParams = Object.keys(params)
      .sort()
      .reduce<Record<string, any>>((acc, key) => {
        acc[key] = params[key];
        return acc;
      }, {});

    const signature = JSON.stringify({
      endpoint: getApiEndpoint(),
      params: orderedParams,
      sortKey,
      sortDirection
    });

    if (!force && signature === lastFetchSignatureRef.current) {
      setIsLoading(false);
      return;
    }

    lastFetchSignatureRef.current = signature;

    try {
      const response = await apiClient.get(getApiEndpoint(), { params });
      const submissionsData = getArrayFromResponse<CompletedSubmission>(response.data, []);
      
      let sortedSubmissions = submissionsData;
      if (sortKey && sortDirection) {
        sortedSubmissions = [...submissionsData].sort((a, b) => {
          const aValue = a[sortKey];
          const bValue = b[sortKey];
          
          if (aValue == null && bValue == null) return 0;
          if (aValue == null) return sortDirection === 'asc' ? -1 : 1;
          if (bValue == null) return sortDirection === 'asc' ? 1 : -1;
          
          if (sortKey === 'total_score') {
            const aScore = typeof aValue === 'number' ? aValue : parseFloat(aValue) || 0;
            const bScore = typeof bValue === 'number' ? bValue : parseFloat(bValue) || 0;
            return sortDirection === 'asc' ? aScore - bScore : bScore - aScore;
          }
          
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
    sortKey,
    user?.role_id
  ]);

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

  // Handle filter changes
  // Use ref to avoid recreating callback when setter changes
  const setFiltersRef = React.useRef(setFilters);
  React.useEffect(() => {
    setFiltersRef.current = setFilters;
  }, [setFilters]);

  const handleFilterChange = useCallback((values: Record<string, any>) => {
    setFiltersRef.current(values as FilterState);
  }, []); // Empty deps - uses ref for stability

  // Handle clear filters
  const handleClearFilters = () => {
    // Set flag to force a fresh fetch after clearing
    isClearingRef.current = true;
    clearFilters();
    clearPageSize();
  };

  // Handle view details
  const handleViewDetails = (submissionId: number) => {
    navigate(getDetailRoute(submissionId));
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



  // Format date for display
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit', 
      year: 'numeric'
    });
  };



  // Define table columns
  const columns: Column<CompletedSubmission>[] = [
    { 
      key: 'status', 
      header: 'Status',
      render: (value, submission) => {
        // Format status to proper case instead of all caps
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
        return `${submission.total_score}%`;
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

  // Define filter fields
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

  // Retry mechanism for failed requests
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
          className="absolute top-0 left-0 bg-primary-blue text-white p-2 m-2 rounded focus:not-sr-only focus:z-50"
        >
          Skip to main content
        </a>
        <a 
          href="#filters-section" 
          className="absolute top-0 left-0 bg-primary-blue text-white p-2 m-2 rounded focus:not-sr-only focus:z-50"
        >
          Skip to filters
        </a>
      </div>

      {/* Header Section */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">Completed Reviews</h1>
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
          <h2 className="text-lg font-semibold text-neutral-900">Filter Reviews</h2>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleClearFilters}
            aria-label="Clear all filters"
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
              <span className="ml-3 text-neutral-700">Loading completed reviews...</span>
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
            emptyMessage="No completed reviews found"
          />
        )}
      </div>
    </div>
  );
};

export default QACompletedReviews; 