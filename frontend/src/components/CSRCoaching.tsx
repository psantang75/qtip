import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { USER_ROLES } from '../constants/roles';
import { 
  HiOutlineEye, 
  HiOutlineDocumentArrowDown,
  HiXMark
} from 'react-icons/hi2';
import { 
  getCSRCoachingSessions, 
  getCSRCoachingSessionDetails,
  downloadCSRCoachingAttachment 
} from '../services/csrCoachingService';
import type { CSRCoachingSession, CSRCoachingFilters, PaginatedCSRCoaching } from '../types/csr.types';
import DataTable, { Column } from './compound/DataTable';
import FilterPanel, { FilterField } from './compound/SearchFilter';
import ErrorDisplay from './ui/ErrorDisplay';
import ErrorBoundary from './ui/ErrorBoundary';
import PageHeader from './ui/PageHeader';
import Card from './ui/Card';
import LoadingSpinner from './ui/LoadingSpinner';
import Button from './ui/Button';
import { usePersistentFilters, usePersistentPagination } from '../hooks/useLocalStorage';

const CSRCoaching: React.FC = () => {
  const { user } = useAuth();
  
  // Calculate rolling date range (last 90 days) with end date one month from today
  const getDefaultDates = () => {
    const today = new Date();
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(today.getDate() - 90);
    
    // Set end date to one month from today
    const oneMonthFromToday = new Date();
    oneMonthFromToday.setMonth(today.getMonth() + 1);
    
    return {
      startDate: ninetyDaysAgo.toISOString().split('T')[0], // Format: YYYY-MM-DD
      endDate: oneMonthFromToday.toISOString().split('T')[0]
    };
  };

  // State variables
  const [sessions, setSessions] = useState<CSRCoachingSession[]>([]);
  const [totalSessions, setTotalSessions] = useState(0);
  
  // Persistent pagination (isolated per user)
  const { currentPage, setCurrentPage, pageSize, setPageSize, clearPagination } = usePersistentPagination('CSRCoaching', 1, 20, user?.id);
  
  const [loading, setLoading] = useState(true);
  
  // Persistent filter state with default dates (isolated per user)
  const [filters, setFilters, clearFilters] = usePersistentFilters<CSRCoachingFilters & { search: string }>(
    'CSRCoaching',
    () => {
      const defaultDates = getDefaultDates();
      return {
        status: '',
        coaching_type: '',
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
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 3;
  // Prevent duplicate fetches when React StrictMode double-invokes effects
  const lastFetchSignatureRef = React.useRef<string | null>(null);
  const isClearingRef = React.useRef<boolean>(false);
  
  // Modal states
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedSession, setSelectedSession] = useState<CSRCoachingSession | null>(null);
  const [downloadingAttachment, setDownloadingAttachment] = useState(false);

  // Debounced filters - same pattern as manager coaching
  const [debouncedFilters, setDebouncedFilters] = useState(filters);

  // Debounce filters to prevent too many API calls
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(filters);
    }, 300); // Reduced debounce time for better responsiveness

    return () => clearTimeout(timer);
  }, [filters]);

  // Functions
  const fetchCoachingSessions = useCallback(async (force = false) => {
    setLoading(true);
    setError('');
    try {
      // Debug logging only in development
      if (process.env.NODE_ENV === 'development') {
        console.log('CSR Coaching - Fetching with filters:', {
          status: debouncedFilters.status,
          coaching_type: debouncedFilters.coaching_type,
          startDate: debouncedFilters.startDate,
          endDate: debouncedFilters.endDate,
          search: debouncedFilters.search
        });
      }

      const signature = JSON.stringify({
        page: currentPage,
        pageSize,
        filters: debouncedFilters
      });

      if (!force && signature === lastFetchSignatureRef.current) {
        setLoading(false);
        return;
      }
      lastFetchSignatureRef.current = signature;

      const response: PaginatedCSRCoaching = await getCSRCoachingSessions(
        currentPage,
        pageSize,
        {
          status: debouncedFilters.status,
          coaching_type: debouncedFilters.coaching_type,
          startDate: debouncedFilters.startDate,
          endDate: debouncedFilters.endDate,
          search: debouncedFilters.search
        }
      );
      
      setSessions(response.sessions || []);
      setTotalSessions(response.totalCount || 0);
      setRetryCount(0); // Reset retry count on successful fetch
    } catch (error) {
      // Log error for debugging in development
      if (process.env.NODE_ENV === 'development') {
        console.error('Error fetching coaching sessions:', error);
      }
      // Allow retry for the same signature after an error
      lastFetchSignatureRef.current = null;
      const errorMessage = error instanceof Error ? 
        `Failed to load coaching sessions: ${error.message}` : 
        'Failed to load coaching sessions. Please check your connection and try again.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [currentPage, pageSize, debouncedFilters]);

  const handleViewDetails = async (sessionId: number) => {
    try {
      const sessionDetails = await getCSRCoachingSessionDetails(sessionId);
      setSelectedSession(sessionDetails);
      setShowDetailsModal(true);
    } catch (error) {
      // Log error for debugging in development
      if (process.env.NODE_ENV === 'development') {
        console.error('Error fetching session details:', error);
      }
      setError('Failed to load session details.');
    }
  };

  const handleDownloadAttachment = async (sessionId: number, filename: string) => {
    setDownloadingAttachment(true);
    let url: string | null = null;
    
    try {
      const blob = await downloadCSRCoachingAttachment(sessionId);
      
      // Check blob size (limit to 50MB)
      const maxSize = 50 * 1024 * 1024; // 50MB
      if (blob.size > maxSize) {
        throw new Error('File too large to download');
      }
      
      // Create download link with proper cleanup
      url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
    } catch (error) {
      // Log error for debugging in development
      if (process.env.NODE_ENV === 'development') {
        console.error('Error downloading attachment:', error);
      }
      
      const errorMessage = error instanceof Error ? 
        `Failed to download attachment: ${error.message}` : 
        'Failed to download attachment. Please try again.';
      setError(errorMessage);
    } finally {
      // Always cleanup blob URL
      if (url) {
        window.URL.revokeObjectURL(url);
      }
      setDownloadingAttachment(false);
    }
  };

  const handleFiltersChange = (newFilters: Partial<CSRCoachingFilters & { search: string }>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
    setCurrentPage(1);
  };

  const handleClearFilters = () => {
    // Reset deduplication ref to allow fresh fetch after clearing
    lastFetchSignatureRef.current = null;
    isClearingRef.current = true;
    
    // Clear filters and pagination
    clearFilters();
    clearPagination();
  };

  const handleRetry = async () => {
    if (retryCount < maxRetries) {
      setRetryCount(prev => prev + 1);
      setError('');
      await fetchCoachingSessions(true);
    } else {
      setError('Maximum retry attempts reached. Please refresh the page or contact support.');
    }
  };

  // Load data on component mount and when dependencies change
  useEffect(() => {
    // Always fetch if we have no data, regardless of signature
    // This ensures data loads when navigating back to the page
    const shouldForce = sessions.length === 0 || isClearingRef.current;
    if (shouldForce) {
      lastFetchSignatureRef.current = null;
      if (isClearingRef.current) {
        isClearingRef.current = false;
      }
    }

    // Use a small timeout to batch rapid state updates (e.g., from clear filters)
    // Since we're watching debouncedFilters, we don't need a long delay
    const timeoutId = setTimeout(() => {
      fetchCoachingSessions(shouldForce);
    }, 100); // Small delay to batch updates, debounce is already handled by debouncedFilters

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedFilters.status, debouncedFilters.coaching_type, debouncedFilters.startDate, debouncedFilters.endDate, debouncedFilters.search, currentPage, pageSize]);

  // Format date for display with validation
  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    
    try {
      const date = new Date(dateString);
      
      // Check if date is valid
      if (isNaN(date.getTime())) {
        return 'Invalid Date';
      }
      
      return date.toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit', 
        year: 'numeric'
      });
    } catch (error) {
      console.warn('Date formatting error:', error);
      return 'Invalid Date';
    }
  };

  // Format coaching type for display
  const formatCoachingType = (type: string | null | undefined) => {
    if (!type) return 'N/A';
    return type; // New coaching types are already formatted properly
  };

  // Format status for display (no badges)
  const formatStatus = (status: string) => {
    return status.replace('_', ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
  };

  // Define filter fields - same pattern as manager coaching
  // Memoized initial values for FilterPanel (list individual properties for efficient comparison)
  // Create a new object only when filter values actually change to prevent infinite loops
  const filterPanelInitialValues = useMemo(() => {
    return {
      status: filters.status,
      coaching_type: filters.coaching_type,
      startDate: filters.startDate,
      endDate: filters.endDate,
      search: filters.search
    };
  }, [
    filters.status,
    filters.coaching_type,
    filters.startDate,
    filters.endDate,
    filters.search
  ]);

  const filterFields: FilterField[] = useMemo(() => [
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      options: [
        { value: '', label: 'All Statuses' },
        { value: 'SCHEDULED', label: 'Scheduled' },
        { value: 'COMPLETED', label: 'Completed' }
      ]
    },
    {
      key: 'coaching_type',
      label: 'Coaching Type',
      type: 'select',
      options: [
        { value: '', label: 'All Types' },
        { value: 'Classroom', label: 'Classroom' },
        { value: 'Side-by-Side', label: 'Side-by-Side' },
        { value: 'Team Session', label: 'Team Session' },
        { value: '1-on-1', label: '1-on-1' },
        { value: 'PIP', label: 'PIP' },
        { value: 'Verbal Warning', label: 'Verbal Warning' },
        { value: 'Written Warning', label: 'Written Warning' }
      ]
    },
    {
      key: 'search',
      label: 'Search',
      type: 'text',
      placeholder: 'Search by trainer/manager name, topic, or notes...'
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
  ], [filters.startDate, filters.endDate]);

  // Define columns for DataTable - similar to manager coaching but CSR perspective
  const sessionColumns: Column<CSRCoachingSession>[] = useMemo(() => [
    {
      key: 'id',
      header: 'Session ID',
      sortable: true,
      render: (value, session) => (
        <span className="font-medium">#{session.id}</span>
      )
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (value, session) => (
        <span>{formatStatus(session.status)}</span>
      )
    },
    {
      key: 'coaching_type',
      header: 'Type',
      sortable: true,
      render: (value, session) => formatCoachingType(session.coaching_type)
    },
    {
      key: 'manager_name',
      header: 'Created By',
      sortable: true,
      render: (value, session) => session.manager_name || 'Unknown'
    },
    {
      key: 'topics',
      header: 'Topics',
      sortable: false,
      render: (value, session) => {
        const topics = session.topics || (session.topic ? [session.topic] : []);
        const displayText = topics.length > 0 ? topics.join(', ') : 'No topics';
        return (
          <div className="max-w-xs">
            <span className="truncate block" title={displayText}>
              {displayText}
            </span>
          </div>
        );
      }
    },
    {
      key: 'session_date',
      header: 'Session Date',
      sortable: true,
      render: (value, session) => formatDate(session.session_date)
    },
    {
      key: 'actions' as keyof CSRCoachingSession,
      header: 'Actions',
      sortable: false,
      render: (value, session) => (
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleViewDetails(session.id)}
            className="text-primary-blue hover:text-primary-blue-dark"
            aria-label={`View details for session ${session.id}`}
          >
            View Details
          </Button>
        </div>
      )
    }
  ], []);

  // Skip links configuration
  const skipLinks = [
    { href: '#main-content', label: 'Skip to main content' },
    { href: '#filters-section', label: 'Skip to filters' }
  ];

  // Don't render if user is not authorized
  if (user && user.role_id !== USER_ROLES.CSR) {
    return null;
  }

  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        console.error('CSRCoaching Error:', error, errorInfo);
        // Could send to error tracking service here
      }}
    >
      <div className="container p-6 mx-auto relative">
        {/* Page Header */}
        <PageHeader 
          title="My Coaching Sessions"
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
            onFilterChange={handleFiltersChange}
            initialValues={filterPanelInitialValues}
          />
        </div>

        {/* Loading State */}
        {loading && (
          <Card variant="bordered" className="mb-8 p-12" role="status" aria-live="polite">
            <div className="flex justify-center items-center">
              <LoadingSpinner size="lg" color="primary" aria-label="Loading coaching sessions" />
              <span className="ml-3 text-neutral-700">Loading coaching sessions...</span>
            </div>
          </Card>
        )}

        {/* Data Table Section */}
        <div id="main-content">
          {!loading && (
            <DataTable
              columns={sessionColumns}
              data={sessions}
              loading={false}
              emptyMessage={
                filters.search || filters.status || filters.coaching_type || filters.startDate || filters.endDate
                  ? 'No coaching sessions found matching your filters. Try adjusting your search criteria.' 
                  : 'No coaching sessions found for the selected date range. Coaching sessions from your trainers and managers will appear here.'
              }
              externalPagination={true}
              currentPage={currentPage}
              totalPages={Math.ceil(totalSessions / pageSize)}
              totalItems={totalSessions}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              pageSizeOptions={[10, 20, 50, 100]}
              aria-label="My Coaching Sessions Table"
            />
          )}
        </div>

        {/* Details Modal - similar to manager coaching but read-only for CSR */}
        {showDetailsModal && selectedSession && (
          <div 
            className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowDetailsModal(false);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setShowDetailsModal(false);
              }
            }}
          >
            <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-4xl shadow-lg rounded-md bg-white">
              <div className="mt-3">
                <div className="flex items-center justify-between mb-4">
                  <h3 
                    id="modal-title"
                    className="text-lg font-medium text-gray-900"
                  >
                    Coaching Session Details
                  </h3>
                  <button
                    onClick={() => setShowDetailsModal(false)}
                    className="text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
                    aria-label="Close modal"
                  >
                    <HiXMark className="h-6 w-6" />
                  </button>
                </div>

                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Status
                      </label>
                      <div className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50">
                        {formatStatus(selectedSession.status)}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Type
                      </label>
                      <div className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50">
                        {formatCoachingType(selectedSession.coaching_type)}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Created By
                      </label>
                      <div className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50">
                        {selectedSession.manager_name || 'Unknown'}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Date
                      </label>
                      <div className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50">
                        {formatDate(selectedSession.session_date)}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Topics
                    </label>
                    <div className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50 min-h-[40px]">
                      {selectedSession.topics && selectedSession.topics.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {selectedSession.topics.map((topic, index) => (
                            <span 
                              key={index}
                              className="inline-block bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm"
                            >
                              {topic}
                            </span>
                          ))}
                        </div>
                      ) : selectedSession.topic ? (
                        <span>{selectedSession.topic}</span>
                      ) : (
                        <span className="text-gray-500">No topics</span>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Notes
                    </label>
                    <div className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50 min-h-[100px]">
                      {selectedSession.notes ? (
                        <span className="whitespace-pre-wrap">{selectedSession.notes}</span>
                      ) : (
                        <span className="text-gray-500">No notes</span>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Attachment
                    </label>
                    <div className="w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50">
                      {selectedSession.attachment_filename ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDownloadAttachment(selectedSession.id, selectedSession.attachment_filename!)}
                          loading={downloadingAttachment}
                          disabled={downloadingAttachment}
                          className="text-blue-600 hover:text-blue-800 p-0"
                        >
                          <HiOutlineDocumentArrowDown className="h-4 w-4 mr-1" />
                          {selectedSession.attachment_filename}
                        </Button>
                      ) : (
                        <span className="text-gray-500">No attachment</span>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-end space-x-3">
                    <Button
                      variant="secondary"
                      onClick={() => setShowDetailsModal(false)}
                    >
                      Close
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
};

export default CSRCoaching; 