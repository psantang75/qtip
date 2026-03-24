// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
  HiOutlineEye, 
  HiOutlinePlus,
  HiOutlinePencilSquare,
  HiOutlineCheckCircle,
  HiXMark,
  HiOutlineDocumentArrowDown
} from 'react-icons/hi2';
import managerService from '../services/managerService';
import adminService from '../services/adminService';
import apiClient from '../services/apiClient';
import topicService from '../services/topicService';
import type { 
  CoachingSession,
  CoachingSessionDetails,
  CoachingSessionForm,
  CoachingSessionFilters,
  CSROption,
  CoachingType
} from '../types/manager.types';
import DataTable, { Column } from './compound/DataTable';
import FilterPanel, { FilterField } from './compound/SearchFilter';
import ErrorDisplay from './ui/ErrorDisplay';
import ErrorBoundary from './ui/ErrorBoundary';
import PageHeader from './ui/PageHeader';
import Card from './ui/Card';
import LoadingSpinner from './ui/LoadingSpinner';
import Button from './ui/Button';
import CoachingSessionDetailsModal from './common/CoachingSessionDetailsModal';
import CoachingSessionFormModal from './common/CoachingSessionFormModal';
import { usePersistentFilters, usePersistentPagination } from '../hooks/useLocalStorage';

const ManagerCoachingSessions: React.FC = () => {
  const { user } = useAuth();
  const hasAnalyticsAccess = [1, 2, 4, 5].includes(user?.role_id || 0);
  
  // Determine which service to use based on user role
  // Admin (role_id === 1) and QA (role_id === 2) use adminService to see all sessions
  // Manager (role_id === 5) uses managerService to see only their department's sessions
  // Memoize to provide stable reference and prevent unnecessary callback recreations
  const coachingService = useMemo(() => {
    const isAdminOrQA = user?.role_id === 1 || user?.role_id === 2;
    return isAdminOrQA ? adminService : managerService;
  }, [user?.role_id]);
  
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
  const [sessions, setSessions] = useState<CoachingSession[]>([]);
  const [totalSessions, setTotalSessions] = useState(0);
  
  // Persistent pagination (isolated per user)
  const { currentPage, setCurrentPage, pageSize, setPageSize, clearPagination } = usePersistentPagination('ManagerCoachingSessions', 1, 20, user?.id);
  
  const [loading, setLoading] = useState(true);
  const [filtersLoading, setFiltersLoading] = useState(true);
  
  // Persistent filter state with default dates (isolated per user)
  const [filters, setFilters, clearFilters] = usePersistentFilters<CoachingSessionFilters & { search: string }>(
    'ManagerCoachingSessions',
    () => {
      const defaultDates = getDefaultDates();
      return {
        csr_id: '',
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
  // Prevent duplicate fetches on identical params (e.g., React StrictMode double-invoke)
  const lastFetchSignatureRef = useRef<string | null>(null);
  const isClearingRef = useRef<boolean>(false);
  
  // Modal states
  const [showFormModal, setShowFormModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedSession, setSelectedSession] = useState<CoachingSessionDetails | null>(null);
  const [editingSession, setEditingSession] = useState<CoachingSession | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [completingSession, setCompletingSession] = useState(false);
  const [reopeningSession, setReopeningSession] = useState(false);
  
  // Form state
  interface LocalFormData extends Omit<CoachingSessionForm, 'coaching_type'> {
    coaching_type: CoachingType | '';
    existingAttachment?: {
      filename: string;
      path?: string;
      size?: number;
      mimeType?: string;
    } | null;
  }
  
  const [formData, setFormData] = useState<LocalFormData>({
    csr_id: 0,
    session_date: '',
    topic_ids: [],
    coaching_type: '',
    notes: '',
    status: 'SCHEDULED'
  });
  
  // Options for filters
  const [csrOptions, setCsrOptions] = useState<CSROption[]>([]);
  const [topicOptions, setTopicOptions] = useState<Array<{ id: number; topic_name: string }>>([]);
  const [topicOptionsLoading, setTopicOptionsLoading] = useState(false);

  // Debounced search to improve performance
  const [debouncedFilters, setDebouncedFilters] = useState(filters);
  
  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      setDebouncedFilters(filters);
    }, 300); // 300ms delay
    
    return () => clearTimeout(debounceTimer);
  }, [filters]);

  // Functions
  const fetchCoachingSessions = useCallback(async (force = false) => {
    setLoading(true);
    setError('');
    try {
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

      const response = await coachingService.getCoachingSessions(
        currentPage,
        pageSize,
        debouncedFilters.search,
        {
          csr_id: debouncedFilters.csr_id,
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
      const errorMessage = error instanceof Error ? 
        `Failed to load coaching sessions: ${error.message}` : 
        'Failed to load coaching sessions. Please check your connection and try again.';
      setError(errorMessage);
      // Allow retry for the same signature after error
      lastFetchSignatureRef.current = null;
    } finally {
      setLoading(false);
    }
  }, [currentPage, pageSize, debouncedFilters, coachingService]);

  // Fetch coaching sessions on component mount and when filters/pagination change
  useEffect(() => {
    // Use a timeout to batch multiple rapid state updates (e.g., from clear filters)
    const timeoutId = setTimeout(() => {
      const force = isClearingRef.current;
      if (force) {
        isClearingRef.current = false;
        lastFetchSignatureRef.current = null;
      }
      fetchCoachingSessions(force);
    }, 0);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize, debouncedFilters.csr_id, debouncedFilters.coaching_type, debouncedFilters.endDate, debouncedFilters.search, debouncedFilters.startDate, debouncedFilters.status]);

  const fetchFilterOptions = useCallback(async () => {
    setFiltersLoading(true);
    try {
      // For Admin and QA users, get all CSRs; for Manager users, get team CSRs
      let csrResponse;
      if (user?.role_id === 1 || user?.role_id === 2) {
        // Admin or QA user - get all CSRs via analytics filter endpoint
        try {
          const response = await apiClient.get('/analytics/filters');
          csrResponse = {
            data: response.data.csrs?.map((csr: any) => ({
              id: csr.id,
              username: csr.username
            })) || []
          };
        } catch (err) {
          console.warn('Failed to load CSR list for Admin/QA user:', err);
          // Set empty array instead of showing error - this is not critical
          csrResponse = { data: [] };
        }
      } else {
        // Manager user - get team CSRs
        try {
          csrResponse = await coachingService.getTeamCSRs();
        } catch (err) {
          console.error('Failed to load team CSRs for Manager:', err);
          // For managers, this is more critical, but still allow the page to load
          csrResponse = { data: [] };
        }
      }
      setCsrOptions(csrResponse.data || []);
    } catch (error) {
      console.error('Unexpected error in fetchFilterOptions:', error);
      // Don't show error message - just log it and continue with empty options
      setCsrOptions([]);
    } finally {
      setFiltersLoading(false);
    }
  }, [coachingService, user?.role_id]);

  // Fetch active topics for dropdown
  const fetchTopicOptions = useCallback(async () => {
    setTopicOptionsLoading(true);
    try {
      const response = await topicService.getTopics(1, 1000, { is_active: true });
      console.log('Topics fetched:', response);
      const topics = response.items.map(topic => ({
        id: topic.id,
        topic_name: topic.topic_name
      }));
      console.log('Mapped topics:', topics);
      setTopicOptions(topics);
    } catch (error) {
      console.error('Failed to load topics:', error);
      setTopicOptions([]);
    } finally {
      setTopicOptionsLoading(false);
    }
  }, []);

  // Fetch CSR options on component mount and when service changes
  useEffect(() => {
    fetchFilterOptions();
    fetchTopicOptions();
  }, [fetchFilterOptions, fetchTopicOptions]);

  const handleViewDetails = async (sessionId: number) => {
    try {
      const sessionDetails = await coachingService.getCoachingSessionDetails(sessionId);
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

  const handleEditSession = async (session: CoachingSession) => {
    if (session.status === 'COMPLETED') {
      setError('Cannot edit completed sessions.');
      return;
    }
    
    // Ensure CSR options are loaded before opening the modal
    if (csrOptions.length === 0) {
      await fetchFilterOptions();
    }
    
    setEditingSession(session);
    const sessionTopicIds = session.topic_ids || (session.topic_id ? [session.topic_id] : []);
    const activeTopicIds = sessionTopicIds.filter((id: number) =>
      topicOptions.some((t) => t.id === id)
    );
    setFormData({
      csr_id: session.csr_id,
      session_date: new Date(session.session_date).toISOString().slice(0, 10),
      topic_ids: activeTopicIds,
      coaching_type: session.coaching_type,
      notes: session.notes || '',
      status: session.status,
      attachment: null, // New file selection
      existingAttachment: session.attachment_filename ? {
        filename: session.attachment_filename,
        path: session.attachment_path,
        size: session.attachment_size,
        mimeType: session.attachment_mime_type
      } : null
    });
    setFormError('');
    setShowFormModal(true);
  };

  const handleAddSession = async () => {
    // Ensure CSR options are loaded before opening the modal
    if (csrOptions.length === 0) {
      await fetchFilterOptions();
    }
    
    setEditingSession(null);
    setFormData({
      csr_id: 0,
      session_date: '',
      topic_ids: [],
      coaching_type: '',
      notes: '',
      status: 'SCHEDULED',
      attachment: null,
      existingAttachment: null
    });
    setFormError('');
    setShowFormModal(true);
  };

  const handleCompleteSession = async (sessionId: number) => {
    setCompletingSession(true);
    try {
      await coachingService.completeCoachingSession(sessionId);
      // Force refresh the list after completing
      lastFetchSignatureRef.current = null;
      await fetchCoachingSessions(true);
      setShowDetailsModal(false);
    } catch (error) {
      // Log error for debugging in development
      if (process.env.NODE_ENV === 'development') {
        console.error('Error completing session:', error);
      }
      setError('Failed to complete session.');
    } finally {
      setCompletingSession(false);
    }
  };

  const handleReopenSession = async (sessionId: number) => {
    setReopeningSession(true);
    try {
      await coachingService.reopenCoachingSession(sessionId);
      // Fetch updated session details and refresh the list
      const sessionDetails = await coachingService.getCoachingSessionDetails(sessionId);
      // Force refresh the list after reopening
      lastFetchSignatureRef.current = null;
      await fetchCoachingSessions(true);
      
      // Construct a proper CoachingSession object for editing
      const editingSessionData: CoachingSession = {
        id: sessionDetails.id,
        csr_id: sessionDetails.csr_id,
        csr_name: sessionDetails.csr_name,
        session_date: sessionDetails.session_date,
        topics: sessionDetails.topics,
        topic_ids: sessionDetails.topic_ids,
        coaching_type: sessionDetails.coaching_type,
        notes: sessionDetails.notes || '',
        status: sessionDetails.status,
        created_at: sessionDetails.created_at || new Date().toISOString(),
        created_by_name: sessionDetails.created_by_name || ''
      };
      
      setEditingSession(editingSessionData);
      const detailTopicIds = sessionDetails.topic_ids || [];
      const activeTopicIdsFromDetails = detailTopicIds.filter((id: number) =>
        topicOptions.some((t) => t.id === id)
      );
      setFormData({
        csr_id: sessionDetails.csr_id,
        session_date: new Date(sessionDetails.session_date).toISOString().slice(0, 10),
        topic_ids: activeTopicIdsFromDetails,
        coaching_type: sessionDetails.coaching_type,
        notes: sessionDetails.notes || '',
        status: sessionDetails.status
      });
      setFormError('');
      setShowDetailsModal(false);
      
      // Ensure CSR options are loaded before opening the modal
      if (csrOptions.length === 0) {
        await fetchFilterOptions();
      }
      
      setShowFormModal(true);
    } catch (error) {
      // Log error for debugging in development
      if (process.env.NODE_ENV === 'development') {
        console.error('Error reopening session:', error);
      }
      setError('Failed to reopen session.');
    } finally {
      setReopeningSession(false);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Frontend validation
    const validationErrors: string[] = [];
    
    if (!formData.csr_id || formData.csr_id === 0) {
      validationErrors.push('Please select a CSR');
    }
    
    if (!formData.session_date || formData.session_date.trim() === '') {
      validationErrors.push('Please select a session date');
    }
    
    if (!formData.topic_ids || formData.topic_ids.length === 0) {
      validationErrors.push('Please select at least one topic');
    }
    
    if (!formData.coaching_type) {
      validationErrors.push('Please select a coaching type');
    }
    
    // Validate notes length
    if (formData.notes && formData.notes.length > 2000) {
      validationErrors.push('Notes cannot exceed 2000 characters');
    }
    
    // Display validation errors
    if (validationErrors.length > 0) {
      setFormError(validationErrors.join('. '));
      return;
    }
    
    setFormLoading(true);
    
    try {
      // Create FormData for file upload support
      const submitData = new FormData();
      submitData.append('csr_id', formData.csr_id.toString());
      submitData.append('session_date', formData.session_date);
      // Append topic_ids as array - FormData arrays are sent by repeating the key
      if (formData.topic_ids && formData.topic_ids.length > 0) {
        formData.topic_ids.forEach((topicId) => {
          submitData.append('topic_ids', topicId.toString());
        });
      }
      submitData.append('coaching_type', formData.coaching_type as string);
      submitData.append('status', formData.status);
      if (formData.notes) {
        submitData.append('notes', formData.notes);
      }
      if (formData.attachment) {
        submitData.append('attachment', formData.attachment);
      }
      
      if (editingSession) {
        await coachingService.updateCoachingSession(editingSession.id, submitData);
      } else {
        await coachingService.createCoachingSession(submitData);
      }
      
      setFormLoading(false);
      setFormError('');
      setShowFormModal(false);
      setError('');
      setEditingSession(null);
      setFormData({
        csr_id: 0,
        session_date: '',
        topic_ids: [],
        coaching_type: '',
        notes: '',
        status: 'SCHEDULED',
        attachment: null,
        existingAttachment: null
      });
      // Force refresh the list after update/create
      lastFetchSignatureRef.current = null;
      await fetchCoachingSessions(true);
      
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || 
                         error.message || 
                         'Failed to save coaching session. Please check your connection and try again.';
      setFormError(errorMessage);
      setFormLoading(false);
    }
  };

  const handleFiltersChange = (newFilters: any) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
    setCurrentPage(1);
  };

  const handleClearFilters = () => {
    // Reset signature to allow fresh fetch after clearing
    lastFetchSignatureRef.current = null;
    isClearingRef.current = true;
    clearFilters();
    clearPagination();
    // Reset flag after a delay to allow state updates
    setTimeout(() => {
      isClearingRef.current = false;
    }, 200);
  };

  const handleExportCoachingSessions = async () => {
    try {
      setError('');

      const params: Record<string, any> = {};

      if (filters.search && filters.search.trim() !== '') {
        params.search = filters.search;
      }

      if (filters.csr_id && filters.csr_id.trim() !== '') {
        params.csr_id = filters.csr_id;
      }

      if (filters.status && filters.status.trim() !== '') {
        params.status = filters.status;
      }

      if (filters.coaching_type && filters.coaching_type.trim() !== '') {
        params.coaching_type = filters.coaching_type;
      }

      if (filters.startDate && filters.startDate.trim() !== '') {
        params.startDate = filters.startDate;
      }

      if (filters.endDate && filters.endDate.trim() !== '') {
        params.endDate = filters.endDate;
      }

      const blob = await coachingService.exportCoachingSessions(params);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;

      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
      link.download = `QTIP_CoachingSessions_${dateStr}_${timeStr}.xlsx`;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting coaching sessions:', error);
      setError('Failed to export coaching sessions. Please try again.');
    }
  };

  const handleFormInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    
    if (type === 'file') {
      const fileInput = e.target as HTMLInputElement;
      const file = fileInput.files?.[0];
      
      if (file) {
        // Validate file size (5MB = 5 * 1024 * 1024 bytes)
        const maxSize = 5 * 1024 * 1024;
        if (file.size > maxSize) {
          setFormError('File size cannot exceed 5MB');
          fileInput.value = ''; // Clear the file input
          return;
        }
        
        // Validate file type
        const allowedTypes = [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain',
          'image/jpeg',
          'image/jpg',
          'image/png'
        ];
        
        if (!allowedTypes.includes(file.type)) {
          setFormError('Invalid file type. Only PDF, Word, Text, and Image files are allowed');
          fileInput.value = ''; // Clear the file input
          return;
        }
        
        // Clear any previous file-related errors
        if (formError.includes('File size') || formError.includes('Invalid file type')) {
          setFormError('');
        }
      }
      
      setFormData(prev => ({ ...prev, [name]: file }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  // Retry mechanism for failed requests
  const handleRetry = async () => {
    if (retryCount < maxRetries) {
      setRetryCount(prev => prev + 1);
      setError('');
      await fetchCoachingSessions();
    } else {
      setError('Maximum retry attempts reached. Please refresh the page or contact support.');
    }
  };

  // Format date for display
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

  // Format coaching type for display
  const formatCoachingType = (type: string | null | undefined) => {
    if (!type) return 'N/A';
    return type; // New coaching types are already formatted properly
  };

  // Get status badge color
  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'SCHEDULED':
        return 'bg-blue-100 text-blue-800';
      case 'IN_PROGRESS':
        return 'bg-yellow-100 text-yellow-800';
      case 'COMPLETED':
        return 'bg-green-100 text-green-800';
      case 'CANCELLED':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  // Memoized initial values for FilterPanel (list individual properties for efficient comparison)
  // Create a new object only when filter values actually change to prevent infinite loops
  const filterPanelInitialValues = useMemo(() => {
    return {
      status: filters.status,
      coaching_type: filters.coaching_type,
      csr_id: filters.csr_id,
      startDate: filters.startDate,
      endDate: filters.endDate,
      search: filters.search
    };
  }, [
    filters.status,
    filters.coaching_type,
    filters.csr_id,
    filters.startDate,
    filters.endDate,
    filters.search
  ]);

  // Define filter fields for FilterPanel - reordered as requested
  const filterFields: FilterField[] = [
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
      placeholder: 'Search by CSR name, topic, or notes...'
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
  const sessionColumns: Column<CoachingSession>[] = [
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
        <span>{session.status.replace('_', ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())}</span>
      )
    },
    {
      key: 'coaching_type',
      header: 'Type',
      sortable: true,
      render: (value, session) => formatCoachingType(session.coaching_type)
    },
    {
      key: 'csr_name',
      header: 'CSR Name',
      sortable: true
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
      key: 'created_by_name',
      header: 'Manager/Trainer',
      sortable: true,
      render: (value, session) => session.created_by_name || 'Unknown'
    },
    {
      key: 'session_date',
      header: 'Session Date',
      sortable: true,
      render: (value, session) => formatDate(session.session_date)
    },
    {
      key: 'actions' as keyof CoachingSession,
      header: 'Actions',
      sortable: false,
      render: (value, session) => (
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (session.status === 'COMPLETED') {
                handleViewDetails(session.id);
              } else {
                handleEditSession(session);
              }
            }}
            className="text-primary-blue hover:text-primary-blue-dark"
            aria-label={`View ${session.status === 'COMPLETED' ? 'details' : 'and edit'} for session ${session.id}`}
          >
            View
          </Button>
        </div>
      )
    }
  ];

  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        // Error tracking could be added here for production
      }}
    >
      <div className="container p-6 mx-auto relative">
        {/* Page Header */}
        <header>
          <h1 className="mb-8 text-2xl font-bold">
            Coaching Sessions
          </h1>
        </header>

        {/* Add Session Button */}
        <div className="flex justify-end mb-8">
          <Button
            onClick={handleAddSession}
            variant="primary"
            size="lg"
            className="inline-flex items-center"
          >
            Add Coaching Session
          </Button>
        </div>

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
                      onClick={handleExportCoachingSessions}
                      disabled={loading || sessions.length === 0}
                      leftIcon={<HiOutlineDocumentArrowDown className="h-5 w-5" />}
                      aria-label="Export coaching sessions to Excel"
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
                filters.search || filters.status || filters.coaching_type || filters.startDate || filters.endDate || filters.csr_id
                  ? 'No coaching sessions found matching your filters. Try adjusting your search criteria.' 
                  : 'No coaching sessions found for the selected date range.'
              }
              externalPagination={true}
              currentPage={currentPage}
              totalPages={Math.ceil(totalSessions / pageSize)}
              totalItems={totalSessions}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              pageSizeOptions={[10, 20, 50, 100]}
              aria-label="Coaching Sessions Table"
            />
          )}
        </div>

        {/* Form Modal */}
        <CoachingSessionFormModal
          isOpen={showFormModal}
          onClose={() => {
            setShowFormModal(false);
            setEditingSession(null);
            setFormData({
              csr_id: 0,
              session_date: '',
              topic_ids: [],
              coaching_type: '',
              notes: '',
              status: 'SCHEDULED',
              attachment: null,
              existingAttachment: null
            });
            setFormError('');
          }}
          onSubmit={handleFormSubmit}
          formData={formData}
          onInputChange={handleFormInputChange}
          csrOptions={csrOptions}
          topicOptions={topicOptions}
          editingSession={editingSession}
          formLoading={formLoading}
          formError={formError}
          userRole={user?.role_id}
          csrOptionsLoading={filtersLoading}
          topicOptionsLoading={topicOptionsLoading}
          userName={user?.username}
          onDownloadAttachment={coachingService.downloadCoachingSessionAttachment.bind(coachingService)}
        />

        {/* Details Modal */}
        <CoachingSessionDetailsModal
          isOpen={showDetailsModal}
          onClose={() => setShowDetailsModal(false)}
          session={selectedSession}
          onCompleteSession={handleCompleteSession}
          onReopenSession={handleReopenSession}
          onDownloadAttachment={async (sessionId: number, filename: string) => {
            try {
              const blob = await coachingService.downloadCoachingSessionAttachment(sessionId);
              const url = window.URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = filename || 'attachment';
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              window.URL.revokeObjectURL(url);
            } catch (error) {
              console.error('Download failed:', error);
              setError('Failed to download attachment. Please try again.');
            }
          }}
          completingSession={completingSession}
          reopeningSession={reopeningSession}
          formatDate={formatDate}
          formatCoachingType={formatCoachingType}
          setError={setError}
        />
      </div>
    </ErrorBoundary>
  );
};

export default ManagerCoachingSessions; 