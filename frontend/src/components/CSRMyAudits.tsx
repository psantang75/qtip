// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import type { CSRAudit } from '../types/csr.types';
import { fetchCSRAudits } from '../services/csrService';
import { USER_ROLES, isCSR } from '../constants/roles';
import { validateDateRange, sanitizeInput } from '../utils/validation';
import DataTable, { Column } from './compound/DataTable';
import FilterPanel, { FilterField } from './compound/SearchFilter';
import ErrorDisplay from './ui/ErrorDisplay';
import ErrorBoundary from './ui/ErrorBoundary';
import LoadingSpinner from './ui/LoadingSpinner';
import Button from './ui/Button';
import Card from './ui/Card';
import PageHeader from './ui/PageHeader';
import SkipLinks from './ui/SkipLinks';
import { usePersistentFilters, usePersistentPagination } from '../hooks/useLocalStorage';

interface FilterState {
  status: string;
  formName: string;
  form_id_search: string;
  search: string;
  date_start: string;
  date_end: string;
}

const CSRMyAudits: React.FC = () => {
  // State variables
  const { user } = useAuth();
  const navigate = useNavigate();
  
  // Security check - ensure user is CSR
  useEffect(() => {
    if (user && !isCSR(user.role_id)) {
      console.warn('Unauthorized access attempt to CSR My Audits page');
      navigate('/unauthorized');
      return;
    }
  }, [user, navigate]);
  
  // Calculate rolling date range (last 90 days)
  const getDefaultDates = () => {
    const today = new Date();
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(today.getDate() - 90);
    
    return {
      date_start: ninetyDaysAgo.toISOString().split('T')[0], // Format: YYYY-MM-DD
      date_end: today.toISOString().split('T')[0]
    };
  };

  const [audits, setAudits] = useState<CSRAudit[]>([]);
  const [totalAudits, setTotalAudits] = useState(0);
  
  // Persistent pagination (isolated per user)
  const { currentPage, setCurrentPage, pageSize: itemsPerPage, setPageSize: setItemsPerPage, clearPagination } = usePersistentPagination('CSRMyAudits', 1, 10, user?.id);
  
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 3;
  
  // Persistent filter state with default dates (isolated per user)
  const [filters, setFilters, clearFilters] = usePersistentFilters<FilterState>(
    'CSRMyAudits',
    () => {
      const defaultDates = getDefaultDates();
      return {
        status: '',
        formName: '',
        form_id_search: '',
        search: '',
        date_start: defaultDates.date_start,
        date_end: defaultDates.date_end
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
  
  const [error, setError] = useState('');
  
  // Sorting state
  const [sortKey, setSortKey] = useState<keyof CSRAudit | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc' | null>(null);
  // Track the last request payload to prevent duplicate fetch storms
  const lastFetchSignatureRef = React.useRef<string | null>(null);
  const isClearingRef = React.useRef<boolean>(false);
  
  // Extract unique forms from the audits data whenever audits change
  // Use useMemo to prevent unnecessary recalculations
  const formOptions = useMemo(() => {
    const uniqueForms = audits.reduce((acc: { form_name: string }[], audit) => {
      // Check if we already have this form in our list
      const exists = acc.some(form => form.form_name === audit.formName);
      
      if (!exists && audit.formName) {
        acc.push({ form_name: audit.formName });
      }
      
      return acc;
    }, []);

    // Sort forms alphabetically
    uniqueForms.sort((a, b) => a.form_name.localeCompare(b.form_name));
    return uniqueForms;
  }, [audits]);

  // Functions
  const fetchAudits = useCallback(async (force = false) => {
    // Input validation
    if (!validateDateRange(filters.date_start, filters.date_end)) {
      setError('Invalid date range. Start date must be before or equal to end date.');
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      // Sanitize search input
      const sanitizedFilters = {
        formName: sanitizeInput(filters.formName),
        form_id_search: sanitizeInput(filters.form_id_search),
        startDate: filters.date_start,
        endDate: filters.date_end,
        status: filters.status,
        searchTerm: sanitizeInput(filters.search)
      };

      // Skip duplicate calls when the request payload hasn't changed unless forced
      const signature = JSON.stringify({
        page: currentPage,
        limit: itemsPerPage,
        sortKey,
        sortDirection,
        ...sanitizedFilters
      });

      if (!force && signature === lastFetchSignatureRef.current) {
        setLoading(false);
        return;
      }

      lastFetchSignatureRef.current = signature;
      
      const response = await fetchCSRAudits(currentPage, itemsPerPage, sanitizedFilters);
      
      // Apply client-side sorting if needed
      let sortedAudits = response.audits;
      if (sortKey && sortDirection) {
        sortedAudits = [...response.audits].sort((a, b) => {
          const aValue = a[sortKey];
          const bValue = b[sortKey];
          
          // Handle null/undefined values
          if (aValue == null && bValue == null) return 0;
          if (aValue == null) return sortDirection === 'asc' ? -1 : 1;
          if (bValue == null) return sortDirection === 'asc' ? 1 : -1;
          
          // Special handling for score to ensure integer sorting
          if (sortKey === 'score') {
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
      
      setAudits(sortedAudits);
      setTotalAudits(response.totalCount);
      setRetryCount(0); // Reset retry count on success
    } catch (error: any) {
      console.error('Error fetching audits:', error);
      // Allow retries for the same signature after an error
      lastFetchSignatureRef.current = null;
      
      // Enhanced error handling with specific error types
      let errorMessage = 'Failed to load audits. Please try again later.';
      
      if (error.response) {
        switch (error.response.status) {
          case 401:
            errorMessage = 'Your session has expired. Please log in again.';
            break;
          case 403:
            errorMessage = 'You do not have permission to view these audits.';
            break;
          case 404:
            errorMessage = 'No audits found for the selected criteria.';
            break;
          case 429:
            errorMessage = 'Too many requests. Please wait a moment and try again.';
            break;
          case 500:
            errorMessage = 'Server error. Our team has been notified.';
            break;
          default:
            errorMessage = `Error ${error.response.status}: ${error.response.data?.message || 'Unknown error occurred'}`;
        }
      } else if (error.request) {
        errorMessage = 'Network error. Please check your internet connection.';
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [
    currentPage,
    itemsPerPage,
    filters.date_end,
    filters.date_start,
    filters.formName,
    filters.form_id_search,
    filters.search,
    filters.status,
    sortDirection,
    sortKey
  ]);

  // Fetch audits on component mount and when filters/pagination change
  // Use individual filter properties to avoid infinite loops from object reference changes
  useEffect(() => {
    // Use a timeout to batch multiple rapid state updates (e.g., from clear filters)
    const timeoutId = setTimeout(() => {
      const force = isClearingRef.current;
      if (force) {
        isClearingRef.current = false;
        lastFetchSignatureRef.current = null;
      }
      fetchAudits(force);
    }, 0);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, itemsPerPage, filters.date_end, filters.date_start, filters.formName, filters.form_id_search, filters.search, filters.status, sortDirection, sortKey]);

  const handleViewDetails = (id: number) => {
    // Navigate to the audit details page
    navigate(`/my-audits/${id}`);
  };
  
  // Handle sorting
  const handleSort = (key: keyof CSRAudit) => {
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

  const handleFilterChange = (newFilters: Record<string, any>) => {
    setFilters(newFilters as FilterState);
    setCurrentPage(1); // Reset to first page on filter change
  };

  const handleClearFilters = () => {
    // Set flag to force a fresh fetch after clearing
    isClearingRef.current = true;
    clearFilters();
    clearPagination();
  };

  // Use refs for pagination setters
  const setCurrentPageRef = React.useRef(setCurrentPage);
  const setItemsPerPageRef = React.useRef(setItemsPerPage);
  
  React.useEffect(() => {
    setCurrentPageRef.current = setCurrentPage;
    setItemsPerPageRef.current = setItemsPerPage;
  }, [setCurrentPage, setItemsPerPage]);

  // Handle page change
  const handlePageChange = useCallback((page: number) => {
    setCurrentPageRef.current(page);
  }, []); // Empty deps - uses ref

  // Handle page size change
  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setItemsPerPageRef.current(newPageSize);
    setCurrentPageRef.current(1); // Reset to first page when page size changes
  }, []); // Empty deps - uses refs

  const totalPages = Math.ceil(totalAudits / itemsPerPage);

  // Define table columns
  const columns: Column<CSRAudit>[] = [
    {
      key: 'id',
      header: 'Review ID',
      sortable: true,
      render: (value, audit) => (
        <span className="font-medium">{audit.id}</span>
      )
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (value, audit) => (
        <span className="text-sm">
          {audit.status.charAt(0).toUpperCase() + audit.status.slice(1).toLowerCase()}
        </span>
      )
    },
    {
      key: 'form_id',
      header: 'Form ID',
      sortable: true,
      render: (value, audit) => (
        <span className="font-medium">{audit.form_id}</span>
      )
    },
    {
      key: 'formName',
      header: 'Form Name',
      sortable: true
    },
    {
      key: 'submittedDate',
      header: 'Review Date',
      sortable: true,
      render: (value, audit) => formatDate(audit.submittedDate)
    },
    {
      key: 'score',
      header: 'Score',
      sortable: true,
      render: (value, audit) => (
        <span className="font-medium">
          {audit.score}%
        </span>
      )
    },
    {
      key: 'id' as keyof CSRAudit,
      header: 'Actions',
      sortable: false,
      render: (value, audit) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleViewDetails(audit.id)}
          className="text-[#00aeef] hover:text-[#00aeef]-dark"
          aria-label={`View details for audit ${audit.id}`}
        >
          View Details
        </Button>
      )
    }
  ];

  // Memoized initial values for FilterPanel (list individual properties for efficient comparison)
  // Create a new object only when filter values actually change to prevent infinite loops
  const filterPanelInitialValues = useMemo(() => {
    return {
      status: filters.status,
      formName: filters.formName,
      form_id_search: filters.form_id_search,
      search: filters.search,
      date_start: filters.date_start,
      date_end: filters.date_end
    };
  }, [
    filters.status,
    filters.formName,
    filters.form_id_search,
    filters.search,
    filters.date_start,
    filters.date_end
  ]);

  // Define filter fields
  const filterFields: FilterField[] = [
    {
      key: 'status',
      label: 'Status',
      type: 'select' as const,
      options: [
        { value: '', label: 'All Statuses' },
        { value: 'DRAFT', label: 'Draft' },
        { value: 'SUBMITTED', label: 'Submitted' },
        { value: 'DISPUTED', label: 'Disputed' },
        { value: 'FINALIZED', label: 'Finalized' }
      ]
    },
    {
      key: 'formName',
      label: 'Form Name',
      type: 'select' as const,
      options: [
        { value: '', label: 'All Forms' },
        ...formOptions.map(form => ({ value: form.form_name, label: form.form_name }))
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
      placeholder: 'Search by review ID or form name...'
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
  const handleRetry = async () => {
    if (retryCount < maxRetries) {
      setRetryCount(prev => prev + 1);
      setError('');
      await fetchAudits(true);
    } else {
      setError('Maximum retry attempts reached. Please refresh the page or contact support.');
    }
  };

  // Skip links configuration
  const skipLinks = [
    { href: '#main-content', label: 'Skip to main content' },
    { href: '#filters-section', label: 'Skip to filters' }
  ];

  // Don't render if user is not authorized
  if (user && !isCSR(user.role_id)) {
    return null;
  }

  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        console.error('CSRMyAudits Error:', error, errorInfo);
        // Could send to error tracking service here
      }}
    >
      <div className="container p-6 mx-auto relative">
        {/* Skip Links for Accessibility */}
        <SkipLinks links={skipLinks} />

        {/* Page Header */}
        <PageHeader 
          title="My Reviews"
        />

        {/* Error Display with Enhanced Retry */}
        {error && (
          <Card className="mb-6">
            <ErrorDisplay message={error} />
            {retryCount < maxRetries && (
              <div className="mt-4 text-center">
                <Button
                  variant="secondary"
                  onClick={handleRetry}
                  loading={loading}
                  className="text-sm"
                >
                  Try Again ({maxRetries - retryCount} attempts left)
                </Button>
              </div>
            )}
            {retryCount >= maxRetries && (
              <div className="mt-4 text-center">
                <Button
                  variant="secondary"
                  onClick={() => window.location.reload()}
                  className="text-sm"
                >
                  Refresh Page
                </Button>
              </div>
            )}
          </Card>
        )}

        {/* Filter Section */}
        <div id="filters-section" className="mb-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-neutral-900">Filters</h2>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleClearFilters}
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

        {/* Loading State */}
        {loading && (
          <Card variant="bordered" className="mb-8 p-12" role="status" aria-live="polite">
            <div className="flex justify-center items-center">
              <LoadingSpinner size="lg" color="primary" aria-label="Loading audits" />
              <span className="ml-3 text-neutral-700">Loading audits...</span>
            </div>
          </Card>
        )}

        {/* Data Table Section */}
        <div id="main-content">
          {!loading && (
            <DataTable
              columns={columns}
              data={audits}
              loading={false}
              emptyMessage={
                filters.search || filters.status || filters.formName || filters.date_start || filters.date_end
                  ? 'No audits found matching your filters. Try adjusting your search criteria.' 
                  : 'You have no completed audits at this time. Audits will appear here once they are submitted and reviewed.'
              }
              externalPagination={true}
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={totalAudits}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
              pageSize={itemsPerPage}
              externalSorting={true}
              sortKey={sortKey}
              sortDirection={sortDirection}
              onSort={handleSort}
              aria-label="My Audits Table"
            />
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
};

export default CSRMyAudits; 