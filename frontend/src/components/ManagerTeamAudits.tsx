// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Eye, AlertTriangle } from 'lucide-react';
import managerService from '../services/managerService';
import type { 
  ManagerTeamAudit,
  TeamAuditFilters,
  CSROption,
  FormOption
} from '../types/manager.types';
import DataTable, { Column } from './compound/DataTable';
import FilterPanel, { FilterField } from './compound/SearchFilter';
import ErrorDisplay from './ui/ErrorDisplay';
import ErrorBoundary from './ui/ErrorBoundary';
import PageHeader from './ui/PageHeader';
import Card from './ui/Card';
import LoadingSpinner from './ui/LoadingSpinner';
import Button from './ui/Button';
import { getScoreColorClass } from '../utils/scoreUtils';
import { usePersistentFilters, usePersistentPagination } from '../hooks/useLocalStorage';

const ManagerTeamAudits: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  // Calculate rolling date range (last 90 days)
  const getDefaultDates = () => {
    const today = new Date();
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(today.getDate() - 90);
    
    return {
      startDate: ninetyDaysAgo.toISOString().split('T')[0], // Format: YYYY-MM-DD
      endDate: today.toISOString().split('T')[0]
    };
  };

  // State variables
  const [audits, setAudits] = useState<ManagerTeamAudit[]>([]);
  const [totalAudits, setTotalAudits] = useState(0);
  
  // Persistent pagination (isolated per user)
  const { currentPage, setCurrentPage, pageSize, setPageSize, clearPagination } = usePersistentPagination('ManagerTeamAudits', 1, 20, user?.id);
  
  const [loading, setLoading] = useState(true);
  const [filtersLoading, setFiltersLoading] = useState(true);
  
  // Persistent filter state with default dates (isolated per user)
  const [filters, setFilters, clearFilters] = usePersistentFilters<TeamAuditFilters & { search: string; form_id_search: string }>(
    'ManagerTeamAudits',
    () => {
      const defaultDates = getDefaultDates();
      return {
        csr_id: '',
        form_id: '',
        form_id_search: '',
        formName: '',
        startDate: defaultDates.startDate,
        endDate: defaultDates.endDate,
        dispute_status: '',
        search: '',
        status: ''
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
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 3;
  
  // Sorting state
  const [sortKey, setSortKey] = useState<keyof ManagerTeamAudit | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc' | null>(null);
  
  // Options for filters
  const [csrOptions, setCsrOptions] = useState<CSROption[]>([]);
  const lastFetchSignatureRef = React.useRef<string | null>(null);
  const inFlightRef = React.useRef<Promise<void> | null>(null);
  const isClearingRef = React.useRef<boolean>(false);

  // Extract unique forms from the audits data whenever audits change
  // Use useMemo to prevent unnecessary recalculations (same logic as CSR My Audits)
  const formOptions = useMemo(() => {
    const uniqueForms = audits.reduce((acc: { form_name: string }[], audit) => {
      // Check if we already have this form in our list
      const exists = acc.some(form => form.form_name === audit.form_name);
      
      if (!exists && audit.form_name) {
        acc.push({ form_name: audit.form_name });
      }
      
      return acc;
    }, []);

    // Sort forms alphabetically
    uniqueForms.sort((a, b) => a.form_name.localeCompare(b.form_name));
    return uniqueForms;
  }, [audits]);

  // Fetch team audits on component mount and when filters/pagination change
  // Use individual filter properties to avoid infinite loops from object reference changes
  useEffect(() => {
    // Always fetch if we have no data, regardless of signature
    // This ensures data loads when navigating back to the page
    const shouldForce = audits.length === 0 || isClearingRef.current;
    if (shouldForce) {
      lastFetchSignatureRef.current = null;
      if (isClearingRef.current) {
        isClearingRef.current = false;
      }
    }

    // Use a timeout to batch multiple rapid state updates (e.g., from clear filters)
    const timeoutId = setTimeout(() => {
      fetchTeamAudits(shouldForce);
    }, 300);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize, filters.csr_id, filters.form_id, filters.form_id_search, filters.formName, filters.startDate, filters.endDate, filters.dispute_status, filters.search, filters.status, sortKey, sortDirection]);

  // Fetch CSR options on component mount
  useEffect(() => {
    fetchFilterOptions();
  }, []);

  // Functions
  const fetchTeamAudits = React.useCallback(async (force = false) => {
    // Prevent overlapping identical requests
    if (inFlightRef.current) {
      await inFlightRef.current;
      if (!force) return;
    }

    setLoading(true);
    setError('');
    try {
      // Sanitize search input (same as CSR My Audits)
      const sanitizedFilters = {
        formName: filters.formName,
        form_id_search: filters.form_id_search,
        startDate: filters.startDate,
        endDate: filters.endDate,
        status: filters.status,
        searchTerm: filters.search
      };
      
      const signatureParams = {
        page: currentPage,
        limit: pageSize,
        search: filters.search,
        ...sanitizedFilters,
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
        endpoint: '/manager/team-audits',
        params: orderedParams
      });

      if (!force && signature === lastFetchSignatureRef.current) {
        setLoading(false);
        return;
      }
      lastFetchSignatureRef.current = signature;

      const requestPromise = (async () => {
        const response = await managerService.getManagerTeamAudits(
          currentPage,
          pageSize,
          filters.search,
          sanitizedFilters
        );
        
        // Apply client-side sorting if needed
        let sortedAudits = response.audits || [];
        if (sortKey && sortDirection) {
          sortedAudits = [...(response.audits || [])].sort((a, b) => {
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
        
        setAudits(sortedAudits);
        setTotalAudits(response.totalCount);
        setRetryCount(0); // Reset retry count on successful fetch
      })();

      inFlightRef.current = requestPromise;
      await requestPromise;
    } catch (error) {
      setError('Failed to load team audits. Please try again later.');
      lastFetchSignatureRef.current = null; // allow retry for same payload
    } finally {
      setLoading(false);
      inFlightRef.current = null;
    }
  }, [
    currentPage,
    filters.endDate,
    filters.formName,
    filters.form_id_search,
    filters.search,
    filters.startDate,
    filters.status,
    pageSize,
    sortDirection,
    sortKey
  ]);

  const fetchFilterOptions = async () => {
    setFiltersLoading(true);
    try {
      const csrResponse = await managerService.getTeamCSRs();
      setCsrOptions(csrResponse.data);
    } catch (error) {
      setError('Failed to load filter options. Please try refreshing the page.');
    } finally {
      setFiltersLoading(false);
    }
  };

  const handleViewDetails = async (auditId: number) => {
    // Navigate to the audit details page
    navigate(`/manager/team-audits/${auditId}`);
  };

  const handleResolveDispute = (disputeId: number) => {
    navigate(`/manager/disputes/${disputeId}`);
  };

  // Use refs to avoid recreating callback when setters change
  const setFiltersRef = React.useRef(setFilters);
  const setCurrentPageRef = React.useRef(setCurrentPage);
  
  React.useEffect(() => {
    setFiltersRef.current = setFilters;
    setCurrentPageRef.current = setCurrentPage;
  }, [setFilters, setCurrentPage]);

  const handleFiltersChange = useCallback((newFilters: any) => {
    setFiltersRef.current(prev => ({ ...prev, ...newFilters }));
    setCurrentPageRef.current(1);
  }, []); // Empty deps - uses refs for stability

  const handleClearFilters = () => {
    // Set flag to force a fresh fetch after clearing
    isClearingRef.current = true;
    clearFilters();
    clearPagination();
  };
  
  // Handle sorting with useCallback
  const handleSort = (key: keyof ManagerTeamAudit) => {
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
  };

  // Format date for display (matching CSR My Audits format)
  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit', 
        year: 'numeric'
      });
    } catch (error) {
      return 'Invalid Date';
    }
  };

  const formatScore = (score: number, totalScore?: number) => {
    if (totalScore) {
      return `${score}/${totalScore} (${((score / totalScore) * 100).toFixed(1)}%)`;
    }
    return `${score}%`;
  };

  // Function to get dispute status display
  const getDisputeStatusDisplay = (status: string) => {
    switch (status) {
      case 'None':
        return 'None';
      case 'Pending':
        return 'Pending';
      case 'Resolved':
        return 'Resolved';
      default:
        return status;
    }
  };

  // Retry mechanism for failed requests
  const handleRetry = async () => {
    if (retryCount < maxRetries) {
      setRetryCount(prev => prev + 1);
      setError('');
      await fetchTeamAudits(true);
    } else {
      setError('Maximum retry attempts reached. Please refresh the page or contact support.');
    }
  };

  // Memoized initial values for FilterPanel (list individual properties for efficient comparison)
  // Create a new object only when filter values actually change to prevent infinite loops
  const filterPanelInitialValues = useMemo(() => {
    return {
      csr_id: filters.csr_id || '',
      form_id: filters.form_id || '',
      form_id_search: filters.form_id_search || '',
      formName: filters.formName || '',
      status: filters.status || '',
      dispute_status: filters.dispute_status || '',
      startDate: filters.startDate || '',
      endDate: filters.endDate || '',
      search: filters.search || ''
    };
  }, [
    filters.csr_id,
    filters.form_id,
    filters.form_id_search,
    filters.formName,
    filters.status,
    filters.dispute_status,
    filters.startDate,
    filters.endDate,
    filters.search
  ]);

  // Define filter fields for FilterPanel
  const filterFields: FilterField[] = [
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      options: [
        { value: '', label: 'All Statuses' },
        { value: 'SUBMITTED', label: 'Submitted' },
        { value: 'DISPUTED', label: 'Disputed' },
        { value: 'FINALIZED', label: 'Finalized' }
      ]
    },
    {
      key: 'formName',
      label: 'Form',
      type: 'select',
      options: [
        { value: '', label: 'All Forms' },
        ...formOptions.map(form => ({ 
          value: form.form_name, 
          label: form.form_name 
        }))
      ]
    },
    {
      key: 'form_id_search',
      label: 'Form ID',
      type: 'text',
      placeholder: 'Search by form ID'
    },
    {
      key: 'search',
      label: 'Search',
      type: 'text',
      placeholder: 'Search by CSR name or review ID...'
    },
    {
      key: 'csr_id',
      label: 'CSR',
      type: 'select',
      options: [
        { value: '', label: 'All CSRs' },
        ...(Array.isArray(csrOptions) ? csrOptions.map(csr => ({ 
          value: csr.id?.toString() || '', 
          label: csr.username || 'Unknown CSR' 
        })) : [])
      ]
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

  // Define columns for DataTable
  const auditColumns: Column<ManagerTeamAudit>[] = [
    {
      key: 'id',
      header: 'Review ID',
      sortable: true,
      render: (value, audit) => (
        <span className="font-medium">#{audit.id}</span>
      )
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (value, audit) => (
        <span className="font-medium">
          {audit.status.charAt(0) + audit.status.slice(1).toLowerCase()}
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
      key: 'csr_name',
      header: 'CSR Name',
      sortable: true
    },
    {
      key: 'form_name',
      header: 'Form Name',
      sortable: true
    },
    {
      key: 'total_score',
      header: 'Score',
      sortable: true,
      render: (value, audit) => {
        if (audit.total_score == null || audit.total_score === undefined) {
          return '';
        }
        return (
          <span className="font-medium">
            {audit.total_score}%
          </span>
        );
      }
    },
    {
      key: 'submitted_at',
      header: 'Review Date',
      sortable: true,
      render: (value, audit) => formatDate(audit.submitted_at)
    },
    {
      key: 'actions' as keyof ManagerTeamAudit,
      header: 'Actions',
      sortable: false,
      render: (value, audit) => (
        <div className="flex items-center space-x-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleViewDetails(audit.id)}
            className="text-[#00aeef] hover:text-[#00aeef]-dark"
            aria-label={`View details for review ${audit.id}`}
          >
            View Details
          </Button>
          {audit.dispute_status === 'Pending' && audit.dispute_id && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleResolveDispute(audit.dispute_id!)}
              className="text-orange-600 hover:text-orange-800 flex items-center"
              aria-label={`Resolve dispute for review ${audit.id}`}
            >
              <AlertTriangle className="h-4 w-4 mr-1" />
              Resolve
            </Button>
          )}
        </div>
      )
    }
  ];

  // Skip links configuration
  const skipLinks = [
    { href: '#main-content', label: 'Skip to main content' },
    { href: '#filters-section', label: 'Skip to filters' }
  ];

  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        // Error tracking could be added here for production
      }}
    >
      <div className="container p-6 mx-auto relative">
        {/* Page Header */}
        <PageHeader 
          title="Team Reviews"
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
          {filtersLoading ? (
            <Card variant="bordered" className="p-6">
              <div className="animate-pulse">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="h-12 bg-gray-200 rounded"></div>
                  <div className="h-12 bg-gray-200 rounded"></div>
                  <div className="h-12 bg-gray-200 rounded"></div>
                </div>
              </div>
            </Card>
          ) : (
            <div>
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
                onFilterChange={handleFiltersChange}
                initialValues={filterPanelInitialValues}
              />
            </div>
          )}
        </div>

        {/* Loading State */}
        {loading && (
          <Card variant="bordered" className="mb-8 p-12" role="status" aria-live="polite">
            <div className="flex justify-center items-center">
              <LoadingSpinner size="lg" color="primary" aria-label="Loading team reviews" />
              <span className="ml-3 text-neutral-700">Loading team reviews...</span>
            </div>
          </Card>
        )}

        {/* Data Table Section */}
        <div id="main-content">
          {!loading && (
            <DataTable
              columns={auditColumns}
              data={audits}
              loading={false}
              emptyMessage={
                filters.search || filters.status || filters.formName || filters.startDate || filters.endDate || filters.csr_id
                  ? 'No team reviews found matching your filters. Try adjusting your search criteria.' 
                  : 'No team reviews found for the selected date range.'
              }
              externalPagination={true}
              currentPage={currentPage}
              totalPages={Math.ceil(totalAudits / pageSize)}
              totalItems={totalAudits}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              pageSizeOptions={[10, 20, 50, 100]}
              externalSorting={true}
              sortKey={sortKey}
              sortDirection={sortDirection}
              onSort={handleSort}
              aria-label="Team Reviews Table"
            />
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
};

export default ManagerTeamAudits; 