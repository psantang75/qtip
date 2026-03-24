// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { 
  HiOutlineEye, 
  HiOutlineExclamationCircle,
  HiOutlineX
} from 'react-icons/hi';
import { HiOutlineDocumentArrowDown } from 'react-icons/hi2';
import managerService from '../services/managerService';
import apiClient from '../services/apiClient';
import type { 
  Dispute,
  DisputeFilters,
  DisputeDetails,
  ResolutionForm,
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
import { handleErrorIfAuthentication } from '../utils/errorHandling';
import { usePersistentFilters, usePersistentPagination } from '../hooks/useLocalStorage';

// Course interface for training assignments
interface Course {
  id: number;
  course_name: string;
  description?: string;
}

const ManagerDisputeResolution: React.FC = () => {
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
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [totalDisputes, setTotalDisputes] = useState(0);
  
  // Persistent pagination (isolated per user)
  const { currentPage, setCurrentPage, pageSize, setPageSize, clearPagination } = usePersistentPagination('ManagerDisputeResolution', 1, 10, user?.id);
  
  const [loading, setLoading] = useState(true);
  const [filtersLoading, setFiltersLoading] = useState(true);
  
  // Persistent filter state with default dates (isolated per user)
  const [filters, setFilters, clearFilters] = usePersistentFilters<DisputeFilters & { search: string; formName: string; form_id_search: string }>(
    'ManagerDisputeResolution',
    () => {
      const defaultDates = getDefaultDates();
      return {
        csr_id: '',
        form_id: '',
        form_id_search: '',
        formName: '',
        status: '',
        startDate: defaultDates.startDate,
        endDate: defaultDates.endDate,
        search: ''
      };
    },
    user?.id
  );

  // Refresh stale date ranges on mount if they're older than 1 day
  // Include setFilters to ensure correct localStorage key when user changes
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setFilters]); // Include setFilters to ensure correct localStorage key when user changes

  // QA role users can only see ADJUSTED disputes - lock status filter
  const isQA = user?.role_id === 2;
  const hasAnalyticsAccess = [1, 2, 4, 5].includes(user?.role_id || 0);
  const statusLockedRef = React.useRef(false);
  React.useEffect(() => {
    if (isQA && filters.status !== 'ADJUSTED' && !statusLockedRef.current) {
      statusLockedRef.current = true;
      setFilters(prev => ({
        ...prev,
        status: 'ADJUSTED'
      }));
      // Reset lock after a brief delay to allow the update to complete
      setTimeout(() => {
        statusLockedRef.current = false;
      }, 100);
    }
  }, [isQA, filters.status, setFilters]); // Include setFilters to ensure correct localStorage key when user changes
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 3;
  
  // Deduplication refs
  const lastFetchSignatureRef = React.useRef<string | null>(null);
  const fetchTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  
  // Sorting state
  const [sortKey, setSortKey] = useState<keyof Dispute | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc' | null>(null);
  
  // Modal state
  const [selectedDispute, setSelectedDispute] = useState<DisputeDetails | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [currentDisputeId, setCurrentDisputeId] = useState<number | null>(null);
  
  // Resolution form state
  const [resolutionForm, setResolutionForm] = useState<ResolutionForm>({
    resolution_action: 'UPHOLD',
    resolution_notes: ''
  });
  const [courses, setCourses] = useState<Course[]>([]);
  const [submitting, setSubmitting] = useState(false);
  
  // Filter options
  const [csrOptions, setCsrOptions] = useState<CSROption[]>([]);
  const [formOptions, setFormOptions] = useState<FormOption[]>([]);

  // Extract unique forms from the disputes data whenever disputes change
  // Use useMemo to prevent unnecessary recalculations (same logic as team audits)
  const uniqueFormOptions = useMemo(() => {
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
    return uniqueForms;
  }, [disputes]);

  // Fetch disputes on component mount and when filters/pagination change
  // Use individual filter properties to avoid infinite loops from object reference changes
  useEffect(() => {
    // Build params signature
    const paramsKey = JSON.stringify({
      page: currentPage,
      pageSize,
      csr_id: filters.csr_id || '',
      form_id: filters.form_id || '',
      form_id_search: filters.form_id_search || '',
      formName: filters.formName || '',
      status: filters.status || '',
      startDate: filters.startDate || '',
      endDate: filters.endDate || '',
      search: filters.search || '',
      sortKey: sortKey || '',
      sortDirection: sortDirection || ''
    });

    // Always fetch if we have no data, regardless of signature
    // This ensures data loads when navigating back to the page
    if (disputes.length === 0) {
      // Clear signature to force fetch
      lastFetchSignatureRef.current = null;
    } else {
      // Skip if params haven't changed AND we already have data
      if (lastFetchSignatureRef.current === paramsKey) {
        return;
      }
    }

    // Set signature immediately to prevent duplicate calls while debouncing
    lastFetchSignatureRef.current = paramsKey;

    // Clear any pending timeout
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
    }

    // Debounce to batch rapid state updates
    fetchTimeoutRef.current = setTimeout(() => {
      fetchDisputes();
    }, 300);

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize, filters.csr_id, filters.form_id, filters.form_id_search, filters.formName, filters.status, filters.startDate, filters.endDate, filters.search, sortKey, sortDirection]);

  // Fetch filter options on component mount
  useEffect(() => {
    fetchFilterOptions();
  }, []);

  const fetchDisputes = useCallback(async (force = false) => {
    // Note: Deduplication is handled by the useEffect hook via lastFetchSignatureRef
    // This function just performs the actual fetch
    setLoading(true);
    setError('');
    try {
      // Sanitize search input (same as team audits)
      const sanitizedFilters = {
        formName: filters.formName,
        startDate: filters.startDate,
        endDate: filters.endDate,
        status: filters.status,
        csr_id: filters.csr_id,
        searchTerm: filters.search,
        form_id_search: filters.form_id_search
      };
      
      // Build params object - only include non-empty filters
      const params: Record<string, any> = {
        page: currentPage,
        limit: pageSize,
      };

      // Add search if provided
      if (filters.search && filters.search.trim() !== '') {
        params.search = filters.search;
      }
      
      // Add form_id_search if provided (takes precedence over formName)
      if (filters.form_id_search && filters.form_id_search.trim() !== '') {
        params.form_id = filters.form_id_search; // Backend expects form_id
      }

      // Add other filters only if they have values
      Object.entries(sanitizedFilters).forEach(([key, value]) => {
        if (key !== 'searchTerm' && key !== 'form_id_search' && value && value.trim() !== '') {
          params[key] = value;
        }
      });

      // QA users: always force status to ADJUSTED (backend also enforces this, but ensure frontend sends it)
      if (isQA) {
        params.status = 'ADJUSTED';
      }

      console.log('Frontend filters state:', filters);
      console.log('Final params being sent:', params);
      
      const response = await managerService.getTeamDisputes(params);
      console.log('Raw API response:', response);
      
      // Apply client-side sorting if needed
      let sortedDisputes = response.disputes || [];
      if (sortKey && sortDirection) {
        sortedDisputes = [...(response.disputes || [])].sort((a, b) => {
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
      
      setDisputes(sortedDisputes);
      setTotalDisputes(response.total || 0);
      setRetryCount(0); // Reset retry count on successful fetch
    } catch (err) {
      console.error('Error fetching disputes:', err);
      setError('Failed to load disputes. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [currentPage, pageSize, filters, sortKey, sortDirection, isQA]);

  const fetchFilterOptions = async () => {
    setFiltersLoading(true);
    try {
      // For Admin and QA users, get all CSRs; for Manager users, get team CSRs
      let csrPromise;
      if (user?.role_id === 1 || user?.role_id === 2) {
        // Admin or QA user - get all CSRs via analytics filter endpoint
        csrPromise = apiClient.get('/analytics/filters').then(response => ({
          data: response.data.csrs?.map((csr: any) => ({
            id: csr.id,
            username: csr.username
          })) || []
        }));
      } else {
        // Manager user - get team CSRs
        csrPromise = managerService.getTeamCSRs();
      }

      // Only try to get courses if user is a manager (not admin/QA)
      const coursesPromise = (user?.role_id === 3) ? managerService.getCourses() : Promise.resolve({ data: [] });
      
      const [csrResponse, coursesResponse] = await Promise.allSettled([
        csrPromise,
        coursesPromise
      ]);
      
      // Handle CSR options
      if (csrResponse.status === 'fulfilled') {
        setCsrOptions(csrResponse.value.data || []);
      } else {
        console.error('Failed to load CSR options:', csrResponse.reason);
        setCsrOptions([]);
      }
      
      // Handle courses (optional - may fail for Admin users)
      if (coursesResponse.status === 'fulfilled') {
        setCourses(coursesResponse.value.data || []);
      } else {
        console.warn('Failed to load courses (this may be expected for Admin users):', coursesResponse.reason);
        setCourses([]);
      }
    } catch (err) {
      console.error('Error fetching filter options:', err);
      setError('Failed to load filter options. Please try refreshing the page.');
    } finally {
      setFiltersLoading(false);
    }
  };

  const handleDisputeClick = async (disputeId: number) => {
    try {
      setModalLoading(true);
      setModalOpen(true);
      setCurrentDisputeId(disputeId);
      setError(''); // Clear any previous errors
      
      const response = await managerService.getDisputeDetails(disputeId);
      setSelectedDispute(response);
      
      // Reset resolution form
      setResolutionForm({
        resolution_action: 'UPHOLD',
        resolution_notes: ''
      });
    } catch (err) {
      console.error('Error fetching dispute details:', err);
      // Keep the modal open but show error inside it
      setSelectedDispute(null);
      setError('Failed to load dispute details. Please try again or contact support.');
    } finally {
      setModalLoading(false);
    }
  };

  const handleResolutionSubmit = async () => {
    if (!selectedDispute || !resolutionForm.resolution_notes.trim()) {
      setError('Resolution notes are required.');
      return;
    }

    if (resolutionForm.resolution_action === 'ADJUST' && 
        (resolutionForm.new_score === undefined || resolutionForm.new_score < 0 || resolutionForm.new_score > 100)) {
      setError('New score must be between 0 and 100.');
      return;
    }

    if (resolutionForm.resolution_action === 'ASSIGN_TRAINING' && !resolutionForm.training_id) {
      setError('Please select a training course.');
      return;
    }

    try {
      setSubmitting(true);
      await managerService.resolveDispute(selectedDispute.id, resolutionForm);
      
      // Close modal and refresh disputes
      setModalOpen(false);
      setSelectedDispute(null);
      fetchDisputes();
      setError('');
    } catch (err: any) {
      console.error('Error resolving dispute:', err);
      
      // Check for authentication errors (401) - let the axios interceptor handle redirect
      if (handleErrorIfAuthentication(err)) {
        return;
      }
      
      setError('Failed to resolve dispute. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFiltersChange = (newFilters: any) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
    setCurrentPage(1);
  };

  const handleClearFilters = () => {
    // Clear any pending timeouts
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
      fetchTimeoutRef.current = null;
    }
    
    // Reset deduplication ref to allow fresh fetch after clearing
    lastFetchSignatureRef.current = null;
    
    // Clear filters and pagination - this will trigger useEffect to fetch with default values
    clearFilters();
    clearPagination();
  };

  const handleExportDisputes = async () => {
    try {
      setError('');

      const params: Record<string, any> = {};

      if (filters.search && filters.search.trim() !== '') {
        params.search = filters.search;
      }

      if (filters.form_id_search && filters.form_id_search.trim() !== '') {
        params.form_id = filters.form_id_search;
      }

      if (filters.formName && filters.formName.trim() !== '') {
        params.formName = filters.formName;
      }

      if (filters.status && filters.status.trim() !== '' && !isQA) {
        params.status = filters.status;
      }

      if (filters.csr_id && filters.csr_id.trim() !== '') {
        params.csr_id = filters.csr_id;
      }

      if (filters.startDate && filters.startDate.trim() !== '') {
        params.startDate = filters.startDate;
      }

      if (filters.endDate && filters.endDate.trim() !== '') {
        params.endDate = filters.endDate;
      }

      const blob = await managerService.exportTeamDisputes(params);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;

      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
      link.download = `QTIP_DisputeResolution_${dateStr}_${timeStr}.xlsx`;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exporting disputes:', err);
      setError('Failed to export disputes. Please try again.');
    }
  };
  
  // Handle sorting with useCallback
  const handleSort = (key: keyof Dispute) => {
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

  // Retry mechanism for failed requests
  const handleRetry = async () => {
    if (retryCount < maxRetries) {
      setRetryCount(prev => prev + 1);
      setError('');
      await fetchDisputes();
    } else {
      setError('Maximum retry attempts reached. Please refresh the page or contact support.');
    }
  };

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

  // Memoized initial values for FilterPanel (list individual properties for efficient comparison)
  // Create a new object only when filter values actually change to prevent infinite loops
  const filterPanelInitialValues = useMemo(() => {
    return {
      csr_id: filters.csr_id,
      form_id: filters.form_id,
      form_id_search: filters.form_id_search,
      formName: filters.formName,
      status: filters.status, // Include status to reflect QA user's locked ADJUSTED status
      startDate: filters.startDate,
      endDate: filters.endDate,
      search: filters.search
    };
  }, [
    filters.csr_id,
    filters.form_id,
    filters.form_id_search,
    filters.formName,
    filters.status, // Include status to reflect QA user's locked ADJUSTED status
    filters.startDate,
    filters.endDate,
    filters.search
  ]);

  // Define filter fields for FilterPanel - EXACT SAME ORDER AS TEAM AUDITS
  // QA users cannot change status filter - it's locked to ADJUSTED
  const filterFields: FilterField[] = [
    // Only show status filter for non-QA users
    ...(isQA ? [] : [{
      key: 'status',
      label: 'Status',
      type: 'select' as const,
      options: [
        { value: '', label: 'All Statuses' },
        { value: 'OPEN', label: 'Open' },
        { value: 'UPHELD', label: 'Upheld' },
        { value: 'REJECTED', label: 'Rejected' },
        { value: 'ADJUSTED', label: 'Adjusted' }
      ]
    }]),
    {
      key: 'formName',
      label: 'Form',
      type: 'select' as const,
      options: [
        { value: '', label: 'All Forms' },
        ...uniqueFormOptions.map(form => ({ 
          value: form.form_name, 
          label: form.form_name 
        }))
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
      placeholder: 'Search by CSR name or dispute ID...'
    },
    {
      key: 'csr_id',
      label: 'CSR',
      type: 'select' as const,
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
      type: 'date' as const,
      defaultValue: filters.startDate
    },
    {
      key: 'endDate',
      label: 'To Date',
      type: 'date' as const,
      defaultValue: filters.endDate
    }
  ];

  // Define columns for DataTable
  const disputeColumns: Column<Dispute>[] = [
    {
      key: 'id',
      header: 'Dispute ID',
      sortable: true,
      render: (value, dispute) => (
        <span className="font-medium">#{dispute.id}</span>
      )
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (value, dispute) => (
        <span className="font-medium">
          {dispute.status.charAt(0) + dispute.status.slice(1).toLowerCase()}
        </span>
      )
    },
    {
      key: 'csr_name',
      header: 'CSR Name',
      sortable: true
    },
    {
      key: 'submission_id',
      header: 'Review ID',
      sortable: true,
      render: (value, dispute) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            // Navigate based on user role
            if (user?.role_id === 1) {
              // Admin user - use admin route
              navigate(`/admin/completed-forms/${dispute.submission_id}?returnTo=disputes`);
            } else if (user?.role_id === 2) {
              // QA user - use QA route
              navigate(`/qa/completed-reviews/${dispute.submission_id}?returnTo=disputes`);
            } else {
              // Manager user - use manager route
              navigate(`/manager/team-audits/${dispute.submission_id}?returnTo=disputes`);
            }
          }}
          className="text-primary-blue hover:text-primary-blue-dark font-medium"
          aria-label={`View audit details for audit ${dispute.submission_id}`}
        >
          #{dispute.submission_id}
        </Button>
      )
    },
    {
      key: 'form_id',
      header: 'Form ID',
      sortable: true,
      render: (value, dispute) => (
        <span className="font-medium">{dispute.form_id}</span>
      )
    },
    {
      key: 'form_name',
      header: 'Form Name',
      sortable: true
    },
    {
      key: 'total_score',
      header: 'Current Score',
      sortable: true,
      render: (value, dispute) => {
        if (dispute.total_score == null || dispute.total_score === undefined) {
          return '';
        }
        return (
          <span className="font-medium">
            {dispute.total_score}%
          </span>
        );
      }
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
      header: 'Date',
      sortable: true,
      render: (value, dispute) => formatDate(dispute.created_at)
    },
    {
      key: 'actions' as keyof Dispute,
      header: 'Actions',
      sortable: false,
      render: (value, dispute) => {
        const isResolved = ['ADJUSTED', 'UPHELD', 'REJECTED'].includes(dispute.status);
        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (isResolved) {
                handleDisputeClick(dispute.id);
              } else {
                // Navigate based on user role
                if (user?.role_id === 1) {
                  // Admin user - use admin route
                  navigate(`/admin/completed-forms/${dispute.submission_id}?mode=dispute-resolution&disputeId=${dispute.id}&returnTo=disputes`);
                } else if (user?.role_id === 2) {
                  // QA user - use QA route
                  navigate(`/qa/completed-reviews/${dispute.submission_id}?mode=dispute-resolution&disputeId=${dispute.id}&returnTo=disputes`);
                } else {
                  // Manager user - use manager route
                  navigate(`/manager/team-audits/${dispute.submission_id}?mode=dispute-resolution&disputeId=${dispute.id}&returnTo=disputes`);
                }
              }
            }}
            className="text-primary-blue hover:text-primary-blue-dark"
            aria-label={`${isResolved ? 'View' : 'Resolve'} dispute ${dispute.id}`}
          >
            {isResolved ? 'View Details' : 'Resolve'}
          </Button>
        );
      }
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
          title="Dispute Resolution"
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
                <div className="flex items-center gap-2">
                  {hasAnalyticsAccess && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleExportDisputes}
                      disabled={loading || disputes.length === 0}
                      leftIcon={<HiOutlineDocumentArrowDown className="h-5 w-5" />}
                      aria-label="Export disputes to Excel"
                    >
                      Export to Excel
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleClearFilters}
                    aria-label="Clear all filters and reset pagination"
                  >
                    Clear Filters
                  </Button>
                </div>
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
              <LoadingSpinner size="lg" color="primary" aria-label="Loading disputes" />
              <span className="ml-3 text-neutral-700">Loading disputes...</span>
            </div>
          </Card>
        )}

        {/* Data Table Section */}
        <div id="main-content">
          {!loading && (
            <DataTable
              columns={disputeColumns}
              data={disputes}
              loading={false}
              emptyMessage={
                filters.search || filters.status || filters.formName || filters.startDate || filters.endDate || filters.csr_id
                  ? 'No disputes found matching your filters. Try adjusting your search criteria.' 
                  : 'No disputes found for the selected date range.'
              }
              externalPagination={true}
              currentPage={currentPage}
              totalPages={Math.ceil(totalDisputes / pageSize)}
              totalItems={totalDisputes}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              pageSizeOptions={[10, 20, 50, 100]}
              externalSorting={true}
              sortKey={sortKey}
              sortDirection={sortDirection}
              onSort={handleSort}
              aria-label="Disputes Table"
            />
          )}
        </div>

        {/* Dispute Resolution Modal */}
        {modalOpen && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-4xl shadow-lg rounded-md bg-white">
              <div className="mt-3">
                {/* Modal Header */}
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Resolve Dispute #{selectedDispute?.id}
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setModalOpen(false)}
                    className="text-gray-400 hover:text-gray-600"
                    aria-label="Close modal"
                  >
                    <HiOutlineX className="h-6 w-6" />
                  </Button>
                </div>

                {modalLoading ? (
                  <div className="flex justify-center py-8">
                    <LoadingSpinner size="lg" color="primary" />
                  </div>
                ) : error && !selectedDispute ? (
                  <div className="text-center py-8">
                    <div className="text-red-600 mb-4">
                                             <HiOutlineExclamationCircle className="h-12 w-12 mx-auto mb-2" />
                      <p className="text-lg font-medium">Error Loading Dispute</p>
                      <p className="text-sm text-gray-600 mt-2">{error}</p>
                    </div>
                    <div className="flex justify-center space-x-3">
                      <Button
                        variant="secondary"
                        onClick={() => setModalOpen(false)}
                      >
                        Close
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => {
                          if (currentDisputeId) {
                            handleDisputeClick(currentDisputeId);
                          }
                        }}
                        disabled={!currentDisputeId}
                      >
                        Retry
                      </Button>
                    </div>
                  </div>
                ) : selectedDispute ? (
                  <div className="space-y-6">
                    {/* Dispute Information */}
                    <Card className="p-4">
                      <h4 className="text-md font-medium text-gray-900 mb-3">Dispute Information</h4>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="font-medium text-gray-700">CSR:</span>
                          <span className="ml-2 text-gray-900">{selectedDispute.csr_name}</span>
                        </div>
                        <div>
                          <span className="font-medium text-gray-700">Form:</span>
                          <span className="ml-2 text-gray-900">{selectedDispute.form_name}</span>
                        </div>
                        <div>
                          <span className="font-medium text-gray-700">Current Score:</span>
                          <span className="ml-2 text-gray-900">{selectedDispute.total_score}%</span>
                        </div>
                        <div>
                          <span className="font-medium text-gray-700">Previous Score:</span>
                          <span className="ml-2 text-gray-900">
                            {selectedDispute.previous_score != null ? `${selectedDispute.previous_score}%` : 'N/A'}
                          </span>
                        </div>
                        <div>
                          <span className="font-medium text-gray-700">Submitted:</span>
                          <span className="ml-2 text-gray-900">{formatDate(selectedDispute.created_at)}</span>
                        </div>
                      </div>
                      <div className="mt-4">
                        <span className="font-medium text-gray-700">Reason:</span>
                        <p className="mt-1 text-gray-900">{selectedDispute.reason}</p>
                      </div>
                    </Card>

                    {/* Resolution Form - Only show for open disputes */}
                    {selectedDispute.status === 'OPEN' ? (
                      <Card variant="bordered" className="p-4 bg-blue-50">
                        <h4 className="text-md font-medium text-blue-900 mb-3">Resolution</h4>
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-medium text-blue-700 mb-1">Action</label>
                            <select
                              value={resolutionForm.resolution_action}
                              onChange={(e) => setResolutionForm(prev => ({ ...prev, resolution_action: e.target.value as any }))}
                              className="w-full px-3 py-2 border border-blue-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="UPHOLD">Uphold Original Score</option>
                              <option value="ADJUST">Adjust Score</option>
                              <option value="ASSIGN_TRAINING">Assign Additional Training</option>
                            </select>
                          </div>

                          {resolutionForm.resolution_action === 'ADJUST' && (
                            <div>
                              <label className="block text-sm font-medium text-blue-700 mb-1">New Score (%)</label>
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={resolutionForm.new_score || ''}
                                onChange={(e) => setResolutionForm(prev => ({ ...prev, new_score: parseInt(e.target.value) }))}
                                className="w-full px-3 py-2 border border-blue-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          )}

                          {resolutionForm.resolution_action === 'ASSIGN_TRAINING' && (
                            <div>
                              <label className="block text-sm font-medium text-blue-700 mb-1">Training Course</label>
                              <select
                                value={resolutionForm.training_id || ''}
                                onChange={(e) => setResolutionForm(prev => ({ ...prev, training_id: parseInt(e.target.value) }))}
                                className="w-full px-3 py-2 border border-blue-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="">Select Course</option>
                                {courses.map(course => (
                                  <option key={course.id} value={course.id}>
                                    {course.course_name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          <div>
                            <label className="block text-sm font-medium text-blue-700 mb-1">Resolution Notes</label>
                            <textarea
                              rows={4}
                              value={resolutionForm.resolution_notes}
                              onChange={(e) => setResolutionForm(prev => ({ ...prev, resolution_notes: e.target.value }))}
                              className="w-full px-3 py-2 border border-blue-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="Explain your resolution decision..."
                            />
                          </div>
                        </div>
                      </Card>
                    ) : (
                      // Show resolution details for resolved disputes
                      <Card className="p-4">
                        <h4 className="text-md font-medium text-gray-900 mb-3">Resolution Details</h4>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="font-medium text-gray-700">Status:</span>
                            <span className="ml-2 font-medium">
                              {selectedDispute.status.charAt(0) + selectedDispute.status.slice(1).toLowerCase()}
                            </span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">Resolved At:</span>
                            <span className="ml-2 text-gray-900">
                              {selectedDispute.resolved_at ? formatDate(selectedDispute.resolved_at) : 'N/A'}
                            </span>
                          </div>
                        </div>
                        {selectedDispute.resolution_notes && (
                          <div className="mt-4">
                            <span className="font-medium text-gray-700">Resolution Notes:</span>
                            <p className="mt-1 text-gray-900 bg-white p-3 rounded border">
                              {selectedDispute.resolution_notes}
                            </p>
                          </div>
                        )}
                      </Card>
                    )}

                    {/* Actions */}
                    <div className="flex justify-end space-x-3">
                      <Button
                        variant="secondary"
                        onClick={() => setModalOpen(false)}
                      >
                        {selectedDispute.status === 'OPEN' ? 'Cancel' : 'Close'}
                      </Button>
                      {selectedDispute.status === 'OPEN' && (
                        <Button
                          variant="primary"
                          onClick={handleResolutionSubmit}
                          loading={submitting}
                        >
                          Submit Resolution
                        </Button>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
};

export default ManagerDisputeResolution; 