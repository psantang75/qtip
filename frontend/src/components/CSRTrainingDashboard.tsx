import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { 
  TrainingSummary, 
  EnrollmentDetail, 
  PaginatedEnrollments, 
  TrainingFilters 
} from '../types/csr.types';
import { 
  getTrainingSummary, 
  getEnrollments 
} from '../services/csrTrainingService';
import DataTable, { Column } from './compound/DataTable';
import FilterPanel, { FilterField } from './compound/SearchFilter';
import ErrorDisplay from './ui/ErrorDisplay';
import { usePersistentFilters, usePersistentPagination } from '../hooks/useLocalStorage';
import Button from './ui/Button';
import { useAuth } from '../contexts/AuthContext';

// Training Summary Cards Component
const TrainingSummaryCards: React.FC<{ summary: TrainingSummary }> = ({ summary }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <div className="w-8 h-8 bg-blue-500 rounded-md flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
          </div>
          <div className="ml-5 w-0 flex-1">
            <dl>
              <dt className="text-sm font-medium text-gray-500 truncate">Assigned Courses</dt>
              <dd className="text-lg font-medium text-gray-900">{summary.assignedCourses}</dd>
            </dl>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <div className="w-8 h-8 bg-green-500 rounded-md flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="ml-5 w-0 flex-1">
            <dl>
              <dt className="text-sm font-medium text-gray-500 truncate">Completed Courses</dt>
              <dd className="text-lg font-medium text-gray-900">{summary.completedCourses}</dd>
            </dl>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <div className="w-8 h-8 bg-red-500 rounded-md flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="ml-5 w-0 flex-1">
            <dl>
              <dt className="text-sm font-medium text-gray-500 truncate">Overdue Courses</dt>
              <dd className="text-lg font-medium text-gray-900">{summary.overdueCourses}</dd>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
};

// Progress Bar Component
const ProgressBar: React.FC<{ current: number; total: number; className?: string }> = ({ 
  current, 
  total, 
  className = '' 
}) => {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
  
  return (
    <div className={`w-full ${className}`}>
      <div className="flex justify-between text-sm text-gray-600 mb-1">
        <span>{current}/{total} pages</span>
        <span>{percentage}%</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div 
          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

// Status Badge Component
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Completed':
        return 'bg-green-100 text-green-800';
      case 'In Progress':
        return 'bg-blue-100 text-blue-800';
      case 'Overdue':
        return 'bg-red-100 text-red-800';
      case 'Not Started':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(status)}`}>
      {status}
    </span>
  );
};

// Main CSR Training Dashboard Component
const CSRTrainingDashboard: React.FC = () => {
  const { user } = useAuth();
  const [summary, setSummary] = useState<TrainingSummary | null>(null);
  const [paginatedEnrollments, setPaginatedEnrollments] = useState<PaginatedEnrollments | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Persistent filter state (isolated per user)
  const [filters, setFilters, clearFilters] = usePersistentFilters<TrainingFilters>(
    'CSRTrainingDashboard',
    {
      status: 'all',
      dueDateOrder: 'asc'
    },
    user?.id
  );
  
  // Persistent pagination (isolated per user)
  const { currentPage, setCurrentPage, pageSize: itemsPerPage, setPageSize: setItemsPerPage, clearPagination } = usePersistentPagination('CSRTrainingDashboard', 1, 10, user?.id);

  const navigate = useNavigate();

  // Load data function
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [summaryData, enrollmentsData] = await Promise.all([
        getTrainingSummary(),
        getEnrollments(currentPage, itemsPerPage, filters)
      ]);
      
      setSummary(summaryData);
      setPaginatedEnrollments(enrollmentsData);
    } catch (err) {
      console.error('Error loading training data:', err);
      setError('Failed to load training data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [currentPage, itemsPerPage, filters.status, filters.dueDateOrder]);

  // Load data on component mount and when dependencies change
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle filter changes - memoized to prevent unnecessary re-renders
  // Use refs to avoid recreating callback when setters change
  const setFiltersRef = React.useRef(setFilters);
  const setCurrentPageRef = React.useRef(setCurrentPage);
  
  React.useEffect(() => {
    setFiltersRef.current = setFilters;
    setCurrentPageRef.current = setCurrentPage;
  }, [setFilters, setCurrentPage]);

  const handleFilterChange = useCallback((newFilters: Record<string, any>) => {
    setFiltersRef.current(prev => ({ ...prev, ...newFilters }));
    setCurrentPageRef.current(1); // Reset to first page when filters change
  }, []); // Empty deps - uses refs for stability

  // Use refs for pagination setters too
  const setItemsPerPageRef = React.useRef(setItemsPerPage);
  React.useEffect(() => {
    setItemsPerPageRef.current = setItemsPerPage;
  }, [setItemsPerPage]);

  // Handle page changes - memoized to prevent unnecessary re-renders
  const handlePageChange = useCallback((page: number) => {
    setCurrentPageRef.current(page);
  }, []); // Empty deps - uses ref

  // Handle page size changes - memoized to prevent unnecessary re-renders
  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setItemsPerPageRef.current(newPageSize);
    setCurrentPageRef.current(1); // Reset to first page when page size changes
  }, []); // Empty deps - uses refs

  // Handle continuing a course - memoized to prevent unnecessary re-renders
  const handleContinueCourse = useCallback((enrollment: EnrollmentDetail) => {
    navigate(`/training-dashboard/enrollment/${enrollment.id}`);
  }, [navigate]);

  // Handle viewing certificate - memoized to prevent unnecessary re-renders
  const handleViewCertificate = useCallback((enrollment: EnrollmentDetail) => {
    if (enrollment.certificateId) {
      navigate(`/certificates/${enrollment.certificateId}`);
    }
  }, [navigate]);

  // Define filter fields - memoized to prevent unnecessary re-renders
  // Memoized initial values for FilterPanel (list individual properties for efficient comparison)
  // Create a new object only when filter values actually change to prevent infinite loops
  const filterPanelInitialValues = useMemo(() => {
    return {
      status: filters.status,
      dueDateOrder: filters.dueDateOrder
    };
  }, [
    filters.status,
    filters.dueDateOrder
  ]);

  const filterFields: FilterField[] = useMemo(() => [
    {
      key: 'status',
      label: 'Filter by Status',
      type: 'select',
      options: [
        { value: 'all', label: 'All Courses' },
        { value: 'not-started', label: 'Not Started' },
        { value: 'in-progress', label: 'In Progress' },
        { value: 'completed', label: 'Completed' },
        { value: 'overdue', label: 'Overdue' }
      ]
    },
    {
      key: 'dueDateOrder',
      label: 'Sort by Due Date',
      type: 'select',
      options: [
        { value: 'asc', label: 'Earliest First' },
        { value: 'desc', label: 'Latest First' }
      ]
    }
  ], []);

  // Define columns for training courses table - memoized to prevent unnecessary re-renders
  const columns: Column<EnrollmentDetail>[] = useMemo(() => [
    {
      key: 'courseName',
      header: 'Course Name',
      sortable: false,
      render: (value, enrollment) => (
        <div>
          <div className="text-sm font-medium text-gray-900">
            {enrollment.courseName}
          </div>
          {enrollment.description && (
            <div className="text-sm text-gray-500">
              {enrollment.description}
            </div>
          )}
        </div>
      )
    },
    {
      key: 'progress',
      header: 'Progress',
      sortable: false,
      render: (value, enrollment) => (
        <ProgressBar 
          current={enrollment.progress.completed}
          total={enrollment.progress.total}
          className="w-32"
        />
      )
    },
    {
      key: 'dueDate',
      header: 'Due Date',
      sortable: false,
      render: (value, enrollment) => new Date(enrollment.dueDate).toLocaleDateString()
    },
    {
      key: 'status',
      header: 'Status',
      sortable: false,
      render: (value, enrollment) => <StatusBadge status={enrollment.status} />
    },
    {
      key: 'id',
      header: 'Actions',
      sortable: false,
      render: (value, enrollment) => (
        <div className="flex space-x-2 justify-end">
          {enrollment.status === 'Completed' ? (
            <button
              onClick={() => handleViewCertificate(enrollment)}
              className="text-green-600 hover:text-green-900 font-medium"
            >
              View Certificate
            </button>
          ) : (
            <button
              onClick={() => handleContinueCourse(enrollment)}
              className="text-blue-600 hover:text-blue-900 font-medium"
            >
              {enrollment.status === 'Not Started' ? 'Start Course' : 'Continue Course'}
            </button>
          )}
        </div>
      )
    }
  ], [handleViewCertificate, handleContinueCourse]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2 mb-8"></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-gray-200 h-24 rounded-lg"></div>
            ))}
          </div>
          <div className="bg-gray-200 h-96 rounded-lg"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <ErrorDisplay message={error} />
        <button
          onClick={loadData}
          className="mt-4 text-sm bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Training Dashboard</h1>
        <p className="text-gray-600">
          Access all your assigned training courses and track your progress.
        </p>
      </div>

      {/* Training Summary Cards */}
      {summary && <TrainingSummaryCards summary={summary} />}

      {/* Filters */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Filter Training Courses</h2>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { clearFilters(); clearPagination(); }}
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

      {/* Training Courses Table */}
      {paginatedEnrollments && (
        <DataTable
          columns={columns}
          data={paginatedEnrollments.enrollments}
          loading={false}
          emptyMessage="No training courses assigned"
          externalPagination={true}
          currentPage={currentPage}
          totalPages={paginatedEnrollments.totalPages}
          totalItems={paginatedEnrollments.totalPages * itemsPerPage}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          pageSize={itemsPerPage}
          pagination={true}
        />
      )}
    </div>
  );
};

export default CSRTrainingDashboard; 