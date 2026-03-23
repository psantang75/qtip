import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import axios from 'axios';
import { HiOutlineEye } from 'react-icons/hi';
import { useNavigate } from 'react-router-dom';
import DataTable, { Column } from './compound/DataTable';
import FilterPanel, { FilterField } from './compound/SearchFilter';
import ErrorDisplay from './ui/ErrorDisplay';
import { usePersistentFilters, usePersistentPagination } from '../hooks/useLocalStorage';
import Button from './ui/Button';
import { useAuth } from '../contexts/AuthContext';

// Types based on the backend controller interfaces
interface TrainingEnrollment {
  id: number;
  user_id: number;
  csr_name: string;
  csr_email: string;
  course_id: number;
  course_name: string;
  course_description: string;
  progress: number;
  status: 'IN_PROGRESS' | 'COMPLETED';
  enrolled_date: string;
  due_date: string;
  display_status: string;
  total_pages: number;
  completed_pages: number;
  progressText: string;
  progressPercentage: number;
  enrollment_type?: string;
}

interface TrainingDetails {
  enrollment: {
    id: number;
    csrName: string;
    csrEmail: string;
    csrDepartment: string;
    courseName: string;
    courseDescription: string;
    progress: number;
    progressText: string;
    status: string;
    enrolledDate: string;
    dueDate: string | null;
  };
  coursePages: Array<{
    id: number;
    pageTitle: string;
    contentType: string;
    pageOrder: number;
    completionStatus: string;
  }>;
  quizResults: Array<{
    quizId: number;
    quizTitle: string;
    passScore: number;
    score: number;
    passFail: string;
    completedDate: string;
  }>;
  certificate: {
    certificateId: number;
    issueDate: string;
    expiryDate: string;
  } | null;
}

interface FilterState {
  csr_id: string;
  course_id: string;
  status: string;
  search: string;
}

interface CSROption {
  id: number;
  username: string;
}

interface CourseOption {
  id: number;
  course_name: string;
  description: string;
  type?: string;
}

const ManagerTeamTraining: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  // State
  const [enrollments, setEnrollments] = useState<TrainingEnrollment[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  
  // Persistent pagination (isolated per user)
  const { currentPage, setCurrentPage, pageSize, setPageSize, clearPagination } = usePersistentPagination('ManagerTeamTraining', 1, 20, user?.id);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalCount, setTotalCount] = useState<number>(0);

  // Persistent filter states (isolated per user)
  const [filters, setFilters, clearFilters] = usePersistentFilters<FilterState>(
    'ManagerTeamTraining',
    {
      csr_id: '',
      course_id: '',
      status: '',
      search: ''
    },
    user?.id
  );

  // Filter options
  const [csrOptions, setCsrOptions] = useState<CSROption[]>([]);
  const [courseOptions, setCourseOptions] = useState<CourseOption[]>([]);

  // Modal states
  const [selectedTraining, setSelectedTraining] = useState<TrainingDetails | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState<boolean>(false);
  const [detailsLoading, setDetailsLoading] = useState<boolean>(false);

  // Prevent duplicate fetches on identical params (e.g., React StrictMode double-invoke)
  const lastFetchSignatureRef = useRef<string | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const isClearingRef = useRef<boolean>(false);

  // Fetch training enrollments
  const fetchTeamTraining = useCallback(async (force = false) => {
    // Coalesce overlapping identical requests
    if (inFlightRef.current) {
      await inFlightRef.current;
      if (!force) return;
    }

    try {
      setLoading(true);
      setError('');
      const token = localStorage.getItem('token');
      
      const params = new URLSearchParams({
        page: currentPage.toString(),
        pageSize: pageSize.toString(),
      });

      if (filters.search) params.append('search', filters.search);
      if (filters.csr_id) params.append('csr_id', filters.csr_id);
      if (filters.course_id) params.append('course_id', filters.course_id);
      if (filters.status) params.append('status', filters.status);

      // Build stable signature with sorted params
      const signatureParams = {
        page: currentPage,
        pageSize,
        search: filters.search || '',
        csr_id: filters.csr_id || '',
        course_id: filters.course_id || '',
        status: filters.status || ''
      };

      const orderedParams = Object.keys(signatureParams)
        .sort()
        .reduce<Record<string, any>>((acc, key) => {
          acc[key] = (signatureParams as any)[key];
          return acc;
        }, {});

      const signature = JSON.stringify({
        endpoint: '/api/manager/enrollments',
        params: orderedParams
      });

      if (!force && signature === lastFetchSignatureRef.current) {
        setLoading(false);
        return;
      }

      lastFetchSignatureRef.current = signature;

      const requestPromise = (async () => {
        console.log('Making request with token:', token);
        console.log('Request URL:', `/api/manager/enrollments?${params.toString()}`);
        
        const response = await axios.get(`/api/manager/enrollments?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        
        console.log('Response received:', response);

        if (response.data.success) {
          setEnrollments(response.data.data);
          setTotalCount(response.data.total);
          setTotalPages(Math.ceil(response.data.total / pageSize));
        } else {
          setError('Failed to fetch training data');
          lastFetchSignatureRef.current = null; // Allow retry
        }
      })();

      inFlightRef.current = requestPromise;
      await requestPromise;
    } catch (error) {
      console.error('Error fetching training enrollments:', error);
      setError('Failed to fetch training data');
      lastFetchSignatureRef.current = null; // Allow retry after error
    } finally {
      setLoading(false);
      inFlightRef.current = null;
    }
  }, [currentPage, pageSize, filters.search, filters.csr_id, filters.course_id, filters.status]);

  // Fetch filter options
  const fetchFilterOptions = async () => {
    try {
      const token = localStorage.getItem('token');
      
      const [csrsResponse, coursesResponse] = await Promise.all([
        axios.get('/api/manager/team-csrs', {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get('/api/manager/courses', {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      setCsrOptions(csrsResponse.data.data || []);
      setCourseOptions(coursesResponse.data.data || []);
    } catch (error) {
      console.error('Error fetching filter options:', error);
    }
  };

  // Handle filters change
  const handleFiltersChange = (newFilters: any) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
    setCurrentPage(1);
  };

  // View training details
  const handleViewDetails = async (enrollmentId: number) => {
    try {
      setDetailsLoading(true);
      const token = localStorage.getItem('token');
      
      const response = await axios.get(`/api/manager/enrollments/${enrollmentId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data.success) {
        setSelectedTraining(response.data.data);
        setShowDetailsModal(true);
      } else {
        setError('Failed to fetch training details');
      }
    } catch (error) {
      console.error('Error fetching training details:', error);
      setError('Failed to fetch training details');
    } finally {
      setDetailsLoading(false);
    }
  };

  // Status color classes
  const getStatusColorClass = (status: string) => {
    switch (status) {
      case 'Completed':
        return 'bg-green-100 text-green-800';
      case 'Overdue':
        return 'bg-red-100 text-red-800';
      case 'In Progress':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  // Format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Memoized initial values for FilterPanel (list individual properties for efficient comparison)
  // Create a new object only when filter values actually change to prevent infinite loops
  const filterPanelInitialValues = useMemo(() => {
    return {
      csr_id: filters.csr_id,
      course_id: filters.course_id,
      status: filters.status,
      search: filters.search
    };
  }, [
    filters.csr_id,
    filters.course_id,
    filters.status,
    filters.search
  ]);

  // Define filter fields for FilterPanel
  const filterFields: FilterField[] = [
    {
      key: 'search',
      label: 'Search',
      type: 'text',
      placeholder: 'Search by CSR name or course name...'
    },
    {
      key: 'csr_id',
      label: 'CSR',
      type: 'select',
      options: [
        { value: '', label: 'All CSRs' },
        ...(csrOptions || []).map(csr => ({ value: csr.id.toString(), label: csr.username }))
      ]
    },
    {
      key: 'course_id',
      label: 'Course / Training Path',
      type: 'select',
      options: [
        { value: '', label: 'All Courses & Training Paths' },
        ...(courseOptions || []).map(course => ({ 
          value: course.id.toString(), 
          label: course.type === 'PATH' ? `${course.course_name} (Training Path)` : course.course_name
        }))
      ]
    },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      options: [
        { value: '', label: 'All Status' },
        { value: 'IN_PROGRESS', label: 'In Progress' },
        { value: 'COMPLETED', label: 'Completed' }
      ]
    }
  ];

  // Define columns for DataTable
  const trainingColumns: Column<TrainingEnrollment>[] = [
    {
      key: 'csr_name',
      header: 'CSR Name',
      sortable: true,
      render: (value, enrollment) => (
        <div>
          <div className="font-medium text-gray-900">{enrollment.csr_name}</div>
          <div className="text-gray-500">{enrollment.csr_email}</div>
        </div>
      )
    },
    {
      key: 'course_name',
      header: 'Course / Training Path',
      sortable: true,
      render: (value, enrollment) => (
        <div>
          <div className="font-medium text-gray-900 flex items-center">
            {enrollment.course_name}
            {enrollment.enrollment_type === 'PATH' && (
              <span className="ml-2 px-2 py-1 bg-purple-100 text-purple-800 text-xs rounded-full">
                Training Path
              </span>
            )}
          </div>
          <div className="text-gray-500 truncate max-w-xs">{enrollment.course_description}</div>
        </div>
      )
    },
    {
      key: 'progress',
      header: 'Progress',
      sortable: true,
      render: (value, enrollment) => (
        <div>
          <div className="text-gray-900 mb-1">{enrollment.progressText}</div>
          <div className="w-32 bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full"
              style={{ width: `${enrollment.progressPercentage}%` }}
            ></div>
          </div>
        </div>
      )
    },
    {
      key: 'due_date',
      header: 'Due Date',
      sortable: true,
      render: (value, enrollment) => (
        <span className="text-gray-900">{formatDate(enrollment.due_date)}</span>
      )
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (value, enrollment) => (
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${getStatusColorClass(enrollment.display_status)}`}>
          {enrollment.display_status}
        </span>
      )
    },
    {
      key: 'actions' as keyof TrainingEnrollment,
      header: 'Actions',
      sortable: false,
      render: (value, enrollment) => (
        <button 
          onClick={() => handleViewDetails(enrollment.id)}
          disabled={detailsLoading}
          className="text-blue-600 hover:text-blue-800 hover:underline font-medium flex items-center"
        >
          <HiOutlineEye className="h-4 w-4 mr-1" />
          View Details
        </button>
      )
    }
  ];

  // Load data on component mount and when filters change
  // Use individual filter properties to avoid infinite loops from object reference changes
  useEffect(() => {
    // Use a timeout to batch multiple rapid state updates (e.g., from clear filters)
    const timeoutId = setTimeout(() => {
      const force = isClearingRef.current;
      if (force) {
        isClearingRef.current = false;
        lastFetchSignatureRef.current = null;
      }
      fetchTeamTraining(force);
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [fetchTeamTraining]);

  useEffect(() => {
    fetchFilterOptions();
  }, []);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Team Training</h1>
        <p className="text-gray-600 mt-2">
          Monitor your team's training progress and compliance
        </p>
      </div>

      {/* Error Display */}
      {error && <ErrorDisplay message={error} />}

      {/* Filters */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Filters</h2>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              isClearingRef.current = true;
              clearFilters();
              clearPagination();
            }}
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

      {/* Training Table */}
      <DataTable
        columns={trainingColumns}
        data={enrollments}
        loading={loading}
        emptyMessage="No team training found."
        externalPagination={true}
        currentPage={currentPage}
        totalPages={Math.ceil(totalCount / pageSize)}
        totalItems={totalCount}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
        onPageSizeChange={setPageSize}
        pageSizeOptions={[10, 20, 50, 100]}
      />

      {/* Training Details Modal */}
      {showDetailsModal && selectedTraining && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-4xl shadow-lg rounded-md bg-white">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b">
              <h3 className="text-lg font-bold text-gray-900">Training Details</h3>
              <button
                onClick={() => setShowDetailsModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Content */}
            <div className="mt-4 max-h-96 overflow-y-auto">
              {/* Enrollment Info */}
              <div className="bg-blue-50 rounded-lg p-4 mb-6">
                <h4 className="text-lg font-semibold text-blue-900 mb-3">Enrollment Information</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-blue-600 font-medium">CSR Name</p>
                    <p className="text-blue-900">{selectedTraining.enrollment.csrName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-blue-600 font-medium">Course</p>
                    <p className="text-blue-900">{selectedTraining.enrollment.courseName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-blue-600 font-medium">Progress</p>
                    <p className="text-blue-900">{selectedTraining.enrollment.progressText}</p>
                  </div>
                  <div>
                    <p className="text-sm text-blue-600 font-medium">Status</p>
                    <p className="text-blue-900">{selectedTraining.enrollment.status}</p>
                  </div>
                  <div>
                    <p className="text-sm text-blue-600 font-medium">Enrolled Date</p>
                    <p className="text-blue-900">{formatDate(selectedTraining.enrollment.enrolledDate)}</p>
                  </div>
                  {selectedTraining.enrollment.dueDate && (
                    <div>
                      <p className="text-sm text-blue-600 font-medium">Due Date</p>
                      <p className="text-blue-900">{formatDate(selectedTraining.enrollment.dueDate)}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Course Pages */}
              {selectedTraining.coursePages.length > 0 && (
                <div className="bg-green-50 rounded-lg p-4 mb-6">
                  <h4 className="text-lg font-semibold text-green-900 mb-3">Course Pages</h4>
                  <div className="space-y-2">
                    {selectedTraining.coursePages.map((page, index) => (
                      <div key={`page-${selectedTraining.enrollment.id}-${page.id}-${index}`} className="flex items-center justify-between bg-white p-3 rounded border">
                        <div>
                          <p className="font-medium text-green-900">{page.pageTitle}</p>
                          <p className="text-sm text-green-600">{page.contentType}</p>
                        </div>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          page.completionStatus === 'COMPLETED' 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-gray-100 text-gray-800'
                        }`}>
                          {page.completionStatus === 'COMPLETED' ? 'Completed' : 'Not Started'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Quiz Results */}
              {selectedTraining.quizResults.length > 0 && (
                <div className="bg-yellow-50 rounded-lg p-4 mb-6">
                  <h4 className="text-lg font-semibold text-yellow-900 mb-3">Quiz Results</h4>
                  <div className="space-y-2">
                    {selectedTraining.quizResults.map((quiz, index) => (
                      <div key={`quiz-${selectedTraining.enrollment.id}-${quiz.quizId}-${index}`} className="flex items-center justify-between bg-white p-3 rounded border">
                        <div>
                          <p className="font-medium text-yellow-900">{quiz.quizTitle}</p>
                          <p className="text-sm text-yellow-600">
                            Score: {quiz.score}% (Pass: {quiz.passScore}%)
                          </p>
                          <p className="text-xs text-yellow-500">
                            Completed: {formatDate(quiz.completedDate)}
                          </p>
                        </div>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          quiz.passFail === 'PASS' 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {quiz.passFail}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Certificate */}
              {selectedTraining.certificate && (
                <div className="bg-purple-50 rounded-lg p-4">
                  <h4 className="text-lg font-semibold text-purple-900 mb-3">Certificate</h4>
                  <div className="bg-white p-3 rounded border">
                    <p className="font-medium text-purple-900">Certificate #{selectedTraining.certificate.certificateId}</p>
                    <p className="text-sm text-purple-600">
                      Issued: {formatDate(selectedTraining.certificate.issueDate)}
                    </p>
                    {selectedTraining.certificate.expiryDate && (
                      <p className="text-sm text-purple-600">
                        Expires: {formatDate(selectedTraining.certificate.expiryDate)}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagerTeamTraining; 