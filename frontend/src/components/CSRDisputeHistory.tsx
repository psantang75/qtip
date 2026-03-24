// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchDisputeHistory } from '../services/csrService';
import { validateDateRange, sanitizeInput } from '../utils/validation';

// UI Components
import DataTable, { Column } from './compound/DataTable';
import FilterPanel, { FilterField } from './compound/SearchFilter';
import ErrorDisplay from './ui/ErrorDisplay';
import ErrorBoundary from './ui/ErrorBoundary';
import LoadingSpinner from './ui/LoadingSpinner';
import Button from './ui/Button';
import Card from './ui/Card';
import PageHeader from './ui/PageHeader';
import { usePersistentFilters, usePersistentPagination } from '../hooks/useLocalStorage';
import { useAuth } from '../contexts/AuthContext';

interface DisputeHistory {
  dispute_id: number;
  audit_id: number;
  form_name: string;
  score: number;
  previous_score?: number | null;
  adjusted_score?: number | null;
  status: 'OPEN' | 'UPHELD' | 'REJECTED' | 'ADJUSTED';
  created_at: string;
  resolution_notes: string | null;
}



interface FilterState {
  status: string;
  formName: string;
  startDate: string;
  endDate: string;
  search: string;
}

const CSRDisputeHistory: React.FC = () => {
  // State variables
  const { user } = useAuth();
  const navigate = useNavigate();
  
  // Calculate rolling date range (last 90 days) - matching audits pattern
  const getDefaultDates = () => {
    const today = new Date();
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(today.getDate() - 90);
    
    return {
      startDate: ninetyDaysAgo.toISOString().split('T')[0],
      endDate: today.toISOString().split('T')[0]
    };
  };

  const [disputes, setDisputes] = useState<DisputeHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Persistent pagination (isolated per user)
  const { currentPage, setCurrentPage, pageSize: itemsPerPage, setPageSize: setItemsPerPage, clearPagination } = usePersistentPagination('CSRDisputeHistory', 1, 10, user?.id);
  
  const [totalDisputes, setTotalDisputes] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 3;

  // Persistent filter state with default dates (isolated per user)
  const [filters, setFilters, clearFilters] = usePersistentFilters<FilterState>(
    'CSRDisputeHistory',
    () => {
      const defaultDates = getDefaultDates();
      return {
        status: '',
        formName: '',
        startDate: defaultDates.startDate,
        endDate: defaultDates.endDate,
        search: ''
      };
    },
    user?.id
  );

  // Refresh stale date ranges on mount if they're older than 1 day
  React.useEffect(() => {
    const now = new Date();
    const filterEndDate = new Date(filters.endDate);
    const daysDiff = Math.floor((now.getTime() - filterEndDate.getTime()) / (1000 * 60 * 60 * 24));
    
    // If date range is stale (more than 1 day old), refresh with current dates
    if (daysDiff >= 1) {
      const freshDates = getDefaultDates();
      setFilters(prev => ({
        ...prev,
        startDate: freshDates.startDate,
        endDate: freshDates.endDate
      }));
    }
  }, []); // Only run on mount

  // State for form options in filter dropdown (derived from actual dispute data)
  const [formOptions, setFormOptions] = useState<{ form_name: string }[]>([]);
  
  // Sorting state
  const [sortKey, setSortKey] = useState<keyof DisputeHistory | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc' | null>(null);
  // Prevent duplicate fetches when React StrictMode double-invokes effects
  const lastFetchSignatureRef = React.useRef<string | null>(null);
  const isClearingRef = React.useRef<boolean>(false);



  // Extract unique forms from the disputes data whenever disputes change
  useEffect(() => {
    const uniqueForms = disputes.reduce((acc: { form_name: string }[], dispute) => {
      // Check if we already have this form in our list
      const exists = acc.some(form => form.form_name === dispute.form_name);
      
      if (!exists && dispute.form_name) {
        acc.push({ form_name: dispute.form_name });
      }
      
      return acc;
    }, []);

    // Sort forms alphabetically
    uniqueForms.sort((a, b) => a.form_name.localeCompare(b.form_name));
    setFormOptions(uniqueForms);
  }, [disputes]);

  // Fetch dispute history on component mount and when filters/pagination change
  // Use individual filter properties to avoid infinite loops from object reference changes
  useEffect(() => {
    // Use a timeout to batch multiple rapid state updates (e.g., from clear filters)
    const timeoutId = setTimeout(() => {
      const force = isClearingRef.current;
      if (force) {
        isClearingRef.current = false;
        lastFetchSignatureRef.current = null;
      }
      fetchDisputeHistoryData(force);
    }, 0);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, filters.status, filters.formName, filters.startDate, filters.endDate, filters.search, itemsPerPage, sortKey, sortDirection]);

  const fetchDisputeHistoryData = async (force = false) => {
    // Input validation - matching audits pattern
    if (!validateDateRange(filters.startDate, filters.endDate)) {
      setError('Invalid date range. Start date must be before or equal to end date.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Sanitize search input - matching audits pattern
      const sanitizedFilters = {
        formName: sanitizeInput(filters.formName),
        startDate: filters.startDate,
        endDate: filters.endDate,
        status: filters.status,
        searchTerm: sanitizeInput(filters.search)
      };

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

      const response = await fetchDisputeHistory(
        currentPage, 
        itemsPerPage, 
        sanitizedFilters
      );
      
      // Map API response to DisputeHistory format
      const formattedDisputes: DisputeHistory[] = response.data.map((dispute: any) => ({
        dispute_id: dispute.dispute_id,
        audit_id: dispute.audit_id,
        form_name: dispute.form_name || '',
        score: dispute.score || 0,
        previous_score: dispute.previous_score,
        adjusted_score: dispute.adjusted_score,
        status: dispute.status,
        created_at: dispute.created_at,
        resolution_notes: dispute.resolution_notes || null
      }));
      
      // Apply client-side sorting if needed
      let sortedDisputes = formattedDisputes;
      if (sortKey && sortDirection) {
        sortedDisputes = [...formattedDisputes].sort((a, b) => {
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
      
      setDisputes(sortedDisputes);
      setTotalDisputes(response.total);
      setTotalPages(response.totalPages);
      setRetryCount(0); // Reset retry count on success
    } catch (error: any) {
      console.error('Error fetching dispute history:', error);
      // Allow retry for the same signature after error
      lastFetchSignatureRef.current = null;
      
      // Enhanced error handling with specific error types - matching audits pattern
      let errorMessage = 'Failed to load dispute history. Please try again later.';
      
      if (error.response) {
        switch (error.response.status) {
          case 401:
            errorMessage = 'Your session has expired. Please log in again.';
            break;
          case 403:
            errorMessage = 'You do not have permission to view these disputes.';
            break;
          case 404:
            errorMessage = 'No disputes found for the selected criteria.';
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
  };



  const handleViewAuditDetails = (auditId: number) => {
    // Navigate to the audit details page with a source parameter to indicate coming from disputes
    navigate(`/my-audits/${auditId}?source=disputes`);
  };

  const handleViewDisputeDetails = (disputeId: number) => {
    if (!isNaN(disputeId) && disputeId > 0) {
      navigate(`/disputes/${disputeId}`);
    } else {
      setError('Invalid dispute ID. Unable to view details.');
    }
  };
  
  // Handle sorting
  const handleSort = (key: keyof DisputeHistory) => {
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

  const handleFilterChange = (newFilters: Record<string, any>) => {
    setFilters(newFilters as FilterState);
    setCurrentPage(1);
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
    setCurrentPageRef.current(1);
  }, []); // Empty deps - uses refs



  // Retry mechanism for failed requests - matching audits pattern
  const handleRetry = async () => {
    if (retryCount < maxRetries) {
      setRetryCount(prev => prev + 1);
      setError('');
      await fetchDisputeHistoryData(true);
    } else {
      setError('Maximum retry attempts reached. Please refresh the page or contact support.');
    }
  };

  // Helper function to format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit', 
      year: 'numeric'
    });
  };

  // Define table columns - removed badge colors
  const columns: Column<DisputeHistory>[] = [
    {
      key: 'dispute_id',
      header: 'Dispute ID',
      sortable: true,
      render: (value, dispute) => (
        <span className="font-medium">{dispute.dispute_id}</span>
      )
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (value, dispute) => (
        <span className="text-sm">
          {dispute.status.charAt(0).toUpperCase() + dispute.status.slice(1).toLowerCase()}
        </span>
      )
    },
    {
      key: 'audit_id',
      header: 'Review ID',
      sortable: true,
      render: (value, dispute) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleViewAuditDetails(dispute.audit_id)}
          className="text-[#00aeef] hover:text-[#00aeef]-dark"
        >
          {dispute.audit_id}
        </Button>
      )
    },
    {
      key: 'form_name',
      header: 'Form Name',
      sortable: true
    },
    {
      key: 'score',
      header: 'Current Score',
      sortable: true,
      render: (value, dispute) => (
        <span className="font-medium">
          {dispute.score}%
        </span>
      )
    },
    {
      key: 'previous_score',
      header: 'Previous Score',
      sortable: true,
      render: (value, dispute) => (
        <span className="font-medium">
          {dispute.previous_score != null ? `${dispute.previous_score}%` : '-'}
        </span>
      )
    },
    {
      key: 'created_at',
      header: 'Dispute Date',
      sortable: true,
      render: (value, dispute) => formatDate(dispute.created_at)
    },
    {
      key: 'actions' as keyof DisputeHistory,
      header: 'Actions',
      sortable: false,
      render: (value, dispute) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleViewDisputeDetails(dispute.dispute_id)}
          className="text-[#00aeef] hover:text-[#00aeef]-dark"
        >
          View Details
        </Button>
      )
    }
  ];

  // Define filter fields - matching audits pattern
  // Memoized initial values for FilterPanel (list individual properties for efficient comparison)
  // Create a new object only when filter values actually change to prevent infinite loops
  const filterPanelInitialValues = useMemo(() => {
    return {
      status: filters.status,
      formName: filters.formName,
      startDate: filters.startDate,
      endDate: filters.endDate,
      search: filters.search
    };
  }, [
    filters.status,
    filters.formName,
    filters.startDate,
    filters.endDate,
    filters.search
  ]);

  const filterFields: FilterField[] = [
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      options: [
        { value: '', label: 'All Statuses' },
        { value: 'OPEN', label: 'Open' },
        { value: 'UPHELD', label: 'Upheld' },
        { value: 'REJECTED', label: 'Rejected' },
        { value: 'ADJUSTED', label: 'Adjusted' }
      ]
    },
    {
      key: 'formName',
      label: 'Form Name',
      type: 'select',
      options: [
        { value: '', label: 'All Forms' },
        ...formOptions.map(form => ({ value: form.form_name, label: form.form_name }))
      ]
    },
    {
      key: 'search',
      label: 'Search',
      type: 'text',
      placeholder: 'Search by dispute ID or form name...'
    },
    {
      key: 'startDate',
      label: 'From Date',
      type: 'date',
      defaultValue: filters.startDate
    },
    {
      key: 'endDate',
      label: 'To Date',
      type: 'date',
      defaultValue: filters.endDate
    }
  ];

  return (
    <ErrorBoundary>
      <div className="container p-6 mx-auto relative">
        {/* Page Header */}
        <PageHeader
          title="Dispute History"
        />
        
        {/* Error Display */}
        {error && (
          <ErrorDisplay 
            message={error} 
            variant="card"
            dismissible={true}
            onDismiss={() => setError(null)}
            className="mb-6"
            actionLabel={retryCount < maxRetries ? `Retry (${retryCount + 1}/${maxRetries})` : undefined}
            onAction={retryCount < maxRetries ? handleRetry : undefined}
          />
        )}

        {/* Filters Section */}
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
              <LoadingSpinner size="lg" color="primary" aria-label="Loading dispute history" />
              <span className="ml-3 text-neutral-700">Loading disputes...</span>
            </div>
          </Card>
        )}

        {/* Data Table Section */}
        <div id="main-content">
          {!loading && (
            <DataTable
              columns={columns}
              data={disputes}
              loading={false}
              emptyMessage={
                filters.search || filters.status || filters.formName || filters.startDate || filters.endDate
                  ? 'No disputes found matching your filters. Try adjusting your search criteria.'
                  : 'You have no submitted disputes at this time. Disputes will appear here once they are submitted.'
              }
              externalPagination={true}
              currentPage={currentPage}
              totalPages={Math.ceil(totalDisputes / itemsPerPage)}
              totalItems={totalDisputes}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
              pageSize={itemsPerPage}
              externalSorting={true}
              sortKey={sortKey}
              sortDirection={sortDirection}
              onSort={handleSort}
              aria-label="Dispute History Table"
            />
          )}
        </div>


      </div>
    </ErrorBoundary>
  );
};

export default CSRDisputeHistory; 