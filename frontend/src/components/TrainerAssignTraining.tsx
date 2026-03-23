import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useForm, Controller } from 'react-hook-form';
import trainerAssignmentService from '../services/trainerAssignmentService';
import DataTable, { Column } from './compound/DataTable';
import FilterPanel, { FilterField } from './compound/SearchFilter';
import ErrorDisplay from './ui/ErrorDisplay';
import type {
  Course,
  TrainingPath,
  User,
  Department,
  Assignment,
  PendingAssignment,
  Enrollment,
  AssignmentFormData,
  CreateEnrollmentRequest
} from '../types/trainer-assignment';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel'
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
        <p className="text-gray-600 mb-6">{message}</p>
        <div className="flex space-x-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

const TrainerAssignTraining: React.FC = () => {
  const { user } = useAuth();
  const [pendingAssignments, setPendingAssignments] = useState<PendingAssignment[]>([]);
  
  // Persistent page size for assignments table
  const [pageSize, setPageSize] = useLocalStorage<number>(
    `qtip_pageSize_${user?.id}_TrainerAssignTraining`,
    10
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    enrollmentId?: number;
    title: string;
    message: string;
  }>({
    isOpen: false,
    title: '',
    message: ''
  });

  // Data states
  const [courses, setCourses] = useState<Course[]>([]);
  const [trainingPaths, setTrainingPaths] = useState<TrainingPath[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [totalEnrollments, setTotalEnrollments] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  // Loading states
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form setup
  const { control, handleSubmit, watch, setValue, reset } = useForm<AssignmentFormData>({
    defaultValues: {
      assignment_type: 'COURSE',
      target_type: 'USER',
      target_id: [],
      course_id: null,
      path_id: null,
      due_date: ''
    }
  });

  const watchAssignmentType = watch('assignment_type');
  const watchTargetType = watch('target_type');

  // Load initial data
  useEffect(() => {
    const loadInitialData = async () => {
      console.log('TrainerAssignTraining: Loading initial data...');
      setLoading(true);
      setError(null);
      
      try {
        console.log('TrainerAssignTraining: Fetching courses, paths, and targets...');
        
        const [coursesData, pathsData, targetsData] = await Promise.all([
          trainerAssignmentService.getPublishedCourses(),
          trainerAssignmentService.getTrainingPaths(),
          trainerAssignmentService.getAssignmentTargets()
        ]);

        console.log('TrainerAssignTraining: Received data:', {
          courses: coursesData,
          paths: pathsData,
          targets: targetsData
        });

        setCourses(coursesData || []);
        setTrainingPaths(pathsData || []);
        setUsers(targetsData?.users || []);
        setDepartments(targetsData?.departments || []);
        
        console.log('TrainerAssignTraining: Data loaded successfully');
      } catch (error: any) {
        console.error('TrainerAssignTraining: Error loading initial data:', error);
        const errorMessage = error.response?.data?.message || error.message || 'Failed to load data';
        setError(errorMessage);
        alert(`Error loading data: ${errorMessage}`);
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
  }, []);

  // Load enrollments when page or search changes
  useEffect(() => {
    const loadEnrollments = async () => {
      console.log('TrainerAssignTraining: Loading enrollments...', { currentPage, searchTerm });
      
      try {
        const data = await trainerAssignmentService.getEnrollments(currentPage, pageSize, searchTerm);
        console.log('TrainerAssignTraining: Enrollments data:', data);
        setEnrollments(data.data || []);
        setTotalEnrollments(data.total || 0);
        setTotalPages(Math.ceil((data.total || 0) / pageSize));
      } catch (error: any) {
        console.error('TrainerAssignTraining: Error loading enrollments:', error);
        const errorMessage = error.response?.data?.message || error.message || 'Failed to load enrollments';
        alert(`Error loading enrollments: ${errorMessage}`);
      }
    };

    if (!loading) {
      loadEnrollments();
    }
  }, [currentPage, searchTerm, loading]);

  // Handlers
  const onSubmit = (data: AssignmentFormData) => {
    console.log('TrainerAssignTraining: Form submitted:', data);
    
    if (data.target_id.length === 0) {
      alert('Please select at least one target');
      return;
    }

    if (data.assignment_type === 'COURSE' && !data.course_id) {
      alert('Please select a course');
      return;
    }

    if (data.assignment_type === 'TRAINING_PATH' && !data.path_id) {
      alert('Please select a training path');
      return;
    }

    // Get names for display
    const getTargetNames = (targetIds: number[], targetType: string): string[] => {
      if (targetType === 'USER') {
        return targetIds.map((id: number) => {
          const user = (users || []).find((u: User) => u.id === id);
          return user ? user.username : `User ${id}`;
        });
      } else {
        return targetIds.map((id: number) => {
          const dept = (departments || []).find((d: Department) => d.id === id);
          return dept ? dept.department_name : `Department ${id}`;
        });
      }
    };

    const getCourseName = (courseId: number): string => {
      const course = (courses || []).find((c: Course) => c.id === courseId);
      return course ? course.course_name : `Course ${courseId}`;
    };

    const getPathName = (pathId: number): string => {
      const path = (trainingPaths || []).find((p: TrainingPath) => p.id === pathId);
      return path ? path.path_name : `Path ${pathId}`;
    };

    const newPendingAssignment: PendingAssignment = {
      tempId: Date.now().toString(),
      assignment_type: data.assignment_type,
      target_type: data.target_type,
      target_id: data.target_id,
      course_id: data.course_id || undefined,
      path_id: data.path_id || undefined,
      due_date: data.due_date || undefined,
      courseName: data.assignment_type === 'COURSE' && data.course_id ? getCourseName(data.course_id) : undefined,
      pathName: data.assignment_type === 'TRAINING_PATH' && data.path_id ? getPathName(data.path_id) : undefined,
      targetNames: getTargetNames(data.target_id, data.target_type)
    };

    console.log('TrainerAssignTraining: Adding pending assignment:', newPendingAssignment);
    setPendingAssignments(prev => [...prev, newPendingAssignment]);
    reset();
  };

  const handleRemovePending = (tempId: string) => {
    console.log('TrainerAssignTraining: Removing pending assignment:', tempId);
    setPendingAssignments(prev => prev.filter(a => a.tempId !== tempId));
  };

  const handleSaveAll = async () => {
    if (pendingAssignments.length === 0) {
      alert('No pending assignments to save');
      return;
    }

    console.log('TrainerAssignTraining: Saving all assignments:', pendingAssignments);
    setSaving(true);
    
    try {
      const assignments = pendingAssignments.flatMap(pending => 
        pending.target_id.map(targetId => ({
          assignment_type: pending.assignment_type,
          target_type: pending.target_type,
          target_id: targetId,
          course_id: pending.course_id,
          path_id: pending.path_id,
          due_date: pending.due_date
        }))
      );

      const requestData: CreateEnrollmentRequest = { assignments };
      console.log('TrainerAssignTraining: Sending request:', requestData);
      
      const result = await trainerAssignmentService.createAssignments(requestData);
      console.log('TrainerAssignTraining: Assignment creation result:', result);
      
      // Check if any assignments failed
      if (result.created_count === 0 && pendingAssignments.length > 0) {
        // Show error message if none were created
        alert(`No assignments were created. Please check the server logs for details.`);
      } else if (result.created_count < pendingAssignments.length) {
        // Some succeeded, some failed
        alert(`Successfully created ${result.created_count} of ${pendingAssignments.length} assignments. Some assignments may have failed - check the server logs for details.`);
      } else {
        // All succeeded
        alert(`Successfully created ${result.created_count} assignments!`);
      }
      
      setPendingAssignments([]);
      
      // Reload enrollments
      const enrollmentsData = await trainerAssignmentService.getEnrollments(currentPage, pageSize, searchTerm);
      setEnrollments(enrollmentsData.data || []);
      setTotalEnrollments(enrollmentsData.total || 0);
      setTotalPages(Math.ceil((enrollmentsData.total || 0) / pageSize));
    } catch (error: any) {
      console.error('TrainerAssignTraining: Error creating assignments:', error);
      alert(`Error creating assignments: ${error.response?.data?.message || error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelAssignment = (enrollmentId: number) => {
    console.log('TrainerAssignTraining: Cancelling assignment:', enrollmentId);
    setConfirmModal({
      isOpen: true,
      enrollmentId,
      title: 'Cancel Assignment',
      message: 'Are you sure you want to cancel this assignment? This action cannot be undone.'
    });
  };

  const confirmCancelAssignment = async () => {
    if (!confirmModal.enrollmentId) return;

    console.log('TrainerAssignTraining: Confirming cancel assignment:', confirmModal.enrollmentId);
    
    try {
      await trainerAssignmentService.cancelAssignment(confirmModal.enrollmentId);
      alert('Assignment cancelled successfully!');
      
      // Reload enrollments
      const enrollmentsData = await trainerAssignmentService.getEnrollments(currentPage, pageSize, searchTerm);
      setEnrollments(enrollmentsData.data || []);
      setTotalEnrollments(enrollmentsData.total || 0);
      setTotalPages(Math.ceil((enrollmentsData.total || 0) / pageSize));
      
      setConfirmModal({ isOpen: false, title: '', message: '' });
    } catch (error: any) {
      console.error('TrainerAssignTraining: Error cancelling assignment:', error);
      alert(`Error cancelling assignment: ${error.response?.data?.message || error.message}`);
    }
  };

  console.log('TrainerAssignTraining: Current state:', {
    loading,
    error,
    coursesCount: courses?.length || 0,
    pathsCount: trainingPaths?.length || 0,
    usersCount: users?.length || 0,
    departmentsCount: departments?.length || 0,
    enrollmentsCount: enrollments?.length || 0
  });

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="text-center py-12">
          <div className="text-lg text-gray-600">Loading trainer assignment data...</div>
          <div className="text-sm text-gray-500 mt-2">This may take a few moments...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-red-900 mb-2">Error Loading Data</h2>
          <p className="text-red-700">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
          >
            Reload Page
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h1 className="text-2xl font-bold text-gray-900">Assign Training</h1>
        <p className="text-gray-600 mt-2">Assign courses or training paths to CSRs or departments</p>
        
        {/* Debug Info */}
        <div className="mt-4 text-xs text-gray-500">
          Debug: {courses?.length || 0} courses, {trainingPaths?.length || 0} paths, {users?.length || 0} users, {departments?.length || 0} departments
        </div>
      </div>

      {/* Error Display */}
      {error && <ErrorDisplay message={error} />}

      {/* Data Status Messages */}
      {(courses?.length || 0) === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-800">No published courses available for assignment.</p>
        </div>
      )}

      {(trainingPaths?.length || 0) === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-800">No training paths available for assignment.</p>
        </div>
      )}

      {(users?.length || 0) === 0 && (departments?.length || 0) === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-800">No users or departments available for assignment.</p>
        </div>
      )}

      {/* Assignment Form */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Create Assignment</h2>
        
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Assignment Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Assignment Type
              </label>
              <Controller
                name="assignment_type"
                control={control}
                render={({ field }) => (
                  <div className="space-y-2">
                    <label className="flex items-center">
                      <input
                        type="radio"
                        value="COURSE"
                        checked={field.value === 'COURSE'}
                        onChange={(e) => {
                          field.onChange(e.target.value);
                          setValue('course_id', null);
                          setValue('path_id', null);
                        }}
                        className="mr-2 text-blue-600"
                      />
                      Course {(courses?.length || 0) === 0 && <span className="text-gray-400 text-xs ml-1">(none available)</span>}
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        value="TRAINING_PATH"
                        checked={field.value === 'TRAINING_PATH'}
                        onChange={(e) => {
                          field.onChange(e.target.value);
                          setValue('course_id', null);
                          setValue('path_id', null);
                        }}
                        className="mr-2 text-blue-600"
                        disabled={(trainingPaths?.length || 0) === 0}
                      />
                      Training Path {(trainingPaths?.length || 0) === 0 && <span className="text-gray-400 text-xs ml-1">(none available)</span>}
                    </label>
                  </div>
                )}
              />
            </div>

            {/* Target Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Target Type
              </label>
              <Controller
                name="target_type"
                control={control}
                render={({ field }) => (
                  <div className="space-y-2">
                    <label className="flex items-center">
                      <input
                        type="radio"
                        value="USER"
                        checked={field.value === 'USER'}
                        onChange={(e) => {
                          field.onChange(e.target.value);
                          setValue('target_id', []);
                        }}
                        className="mr-2 text-blue-600"
                        disabled={(users?.length || 0) === 0}
                      />
                      User {(users?.length || 0) === 0 && <span className="text-gray-400 text-xs ml-1">(none available)</span>}
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        value="DEPARTMENT"
                        checked={field.value === 'DEPARTMENT'}
                        onChange={(e) => {
                          field.onChange(e.target.value);
                          setValue('target_id', []);
                        }}
                        className="mr-2 text-blue-600"
                        disabled={(departments?.length || 0) === 0}
                      />
                      Department {(departments?.length || 0) === 0 && <span className="text-gray-400 text-xs ml-1">(none available)</span>}
                    </label>
                  </div>
                )}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Course/Path Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {watchAssignmentType === 'COURSE' ? 'Select Course' : 'Select Training Path'}
              </label>
              {watchAssignmentType === 'COURSE' ? (
                <Controller
                  name="course_id"
                  control={control}
                  render={({ field }) => (
                    <select
                      {...field}
                      value={field.value || ''}
                      onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={(courses?.length || 0) === 0}
                    >
                      <option value="">
                        {(courses?.length || 0) === 0 ? 'No courses available' : 'Select a course...'}
                      </option>
                      {(courses || []).filter((course: Course) => !course.is_draft).map((course: Course) => (
                        <option key={course.id} value={course.id}>
                          {course.course_name}
                        </option>
                      ))}
                    </select>
                  )}
                />
              ) : (
                <Controller
                  name="path_id"
                  control={control}
                  render={({ field }) => (
                    <select
                      {...field}
                      value={field.value || ''}
                      onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={(trainingPaths?.length || 0) === 0}
                    >
                      <option value="">
                        {(trainingPaths?.length || 0) === 0 ? 'No training paths available' : 'Select a training path...'}
                      </option>
                      {(trainingPaths || []).map((path: TrainingPath) => (
                        <option key={path.id} value={path.id}>
                          {path.path_name}
                        </option>
                      ))}
                    </select>
                  )}
                />
              )}
            </div>

            {/* Target Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select {watchTargetType === 'USER' ? 'CSRs' : 'Departments'}
              </label>
              <Controller
                name="target_id"
                control={control}
                render={({ field }) => (
                  <select
                    multiple
                    size={5}
                    value={field.value.map(String)}
                    onChange={(e) => {
                      const values = Array.from(e.target.selectedOptions, option => Number(option.value));
                      field.onChange(values);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={watchTargetType === 'USER' ? (users?.length || 0) === 0 : (departments?.length || 0) === 0}
                  >
                    {watchTargetType === 'USER' ? (
                      (users?.length || 0) === 0 ? (
                        <option disabled>No users available</option>
                      ) : (
                        (users || []).filter((user: User) => user.is_active).map((user: User) => (
                          <option key={user.id} value={user.id}>
                            {user.username} ({user.email})
                          </option>
                        ))
                      )
                    ) : (
                      (departments?.length || 0) === 0 ? (
                        <option disabled>No departments available</option>
                      ) : (
                        (departments || []).filter((dept: Department) => dept.is_active).map((dept: Department) => (
                          <option key={dept.id} value={dept.id}>
                            {dept.department_name}
                          </option>
                        ))
                      )
                    )}
                  </select>
                )}
              />
              <p className="text-xs text-gray-500 mt-1">Hold Ctrl/Cmd to select multiple</p>
            </div>
          </div>

          {/* Due Date */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Due Date (Optional)
              </label>
              <Controller
                name="due_date"
                control={control}
                render={({ field }) => (
                  <input
                    type="date"
                    {...field}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                )}
              />
            </div>
          </div>

          {/* Form Buttons */}
          <div className="flex space-x-3">
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:bg-gray-400"
              disabled={saving || ((courses?.length || 0) === 0 && (trainingPaths?.length || 0) === 0) || ((users?.length || 0) === 0 && (departments?.length || 0) === 0)}
            >
              Add Assignment
            </button>
            <button
              type="button"
              onClick={() => reset()}
              className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition-colors"
            >
              Clear
            </button>
          </div>
        </form>
      </div>

      {/* Pending Assignments */}
      {pendingAssignments.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Pending Assignments ({pendingAssignments.length})</h2>
            <button
              onClick={handleSaveAll}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save All'}
            </button>
          </div>
          
          <DataTable
            columns={[
              {
                key: 'courseName',
                header: 'Course/Path',
                render: (value, assignment) => (
                  <div>
                    <span className="text-sm text-gray-900">
                      {assignment.assignment_type === 'COURSE' ? assignment.courseName : assignment.pathName}
                    </span>
                    <span className="ml-2 text-xs text-gray-500">
                      ({assignment.assignment_type})
                    </span>
                  </div>
                )
              },
              {
                key: 'targetNames',
                header: 'Target(s)',
                render: (value, assignment) => (
                  <div>
                    <span className="text-sm text-gray-900">
                      {assignment.targetNames.join(', ')}
                    </span>
                    <span className="ml-2 text-xs text-gray-500">
                      ({assignment.target_type})
                    </span>
                  </div>
                )
              },
              {
                key: 'due_date',
                header: 'Due Date',
                render: (value, assignment) => (
                  <span className="text-sm text-gray-900">
                    {assignment.due_date || 'No due date'}
                  </span>
                )
              },
              {
                key: 'tempId',
                header: 'Actions',
                sortable: false,
                render: (value, assignment) => (
                  <button
                    onClick={() => handleRemovePending(assignment.tempId)}
                    className="text-red-600 hover:text-red-800 text-sm"
                  >
                    Remove
                  </button>
                )
              }
            ]}
            data={pendingAssignments}
            loading={false}
            emptyMessage="No pending assignments"
            pagination={false}
          />
        </div>
      )}

      {/* Active Assignments */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Active Assignments</h2>
          <div className="flex space-x-3">
            <input
              type="text"
              placeholder="Search assignments..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <DataTable
          columns={[
            {
              key: 'course_name',
              header: 'Course/Path Name',
              render: (value, enrollment) => (
                <div>
                  <span className="text-sm text-gray-900">
                    {enrollment.assignment_type === 'COURSE' ? 
                      (enrollment.course_name || `Course ID: ${enrollment.course_id}`) : 
                      (enrollment.path_name || `Path ID: ${enrollment.path_id}`)
                    }
                  </span>
                  <span className="ml-2 text-xs text-gray-500">
                    ({enrollment.assignment_type || 'COURSE'})
                  </span>
                </div>
              )
            },
            {
              key: 'user_name',
              header: 'Target',
              render: (value, enrollment) => (
                <div>
                  <span className="text-sm text-gray-900">
                    {enrollment.target_type === 'USER' ? 
                      (enrollment.user_name || enrollment.target_name || `User ID: ${enrollment.user_id}`) :
                      (enrollment.department_name || enrollment.target_name || `Department ID: ${enrollment.department_id}`)
                    }
                  </span>
                  <span className="ml-2 text-xs text-gray-500">
                    ({enrollment.target_type || 'USER'})
                  </span>
                </div>
              )
            },
            {
              key: 'due_date',
              header: 'Due Date',
              render: (value, enrollment) => (
                <span className="text-sm text-gray-900">
                  {enrollment.due_date ? new Date(enrollment.due_date).toLocaleDateString() : 'No due date'}
                </span>
              )
            },
            {
              key: 'status',
              header: 'Status',
              render: (value, enrollment) => (
                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                  enrollment.status === 'COMPLETED' 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-yellow-100 text-yellow-800'
                }`}>
                  {enrollment.status === 'COMPLETED' ? 'Completed' : 'In Progress'}
                </span>
              )
            },
            {
              key: 'id',
              header: 'Actions',
              sortable: false,
              render: (value, enrollment) => (
                <button
                  onClick={() => handleCancelAssignment(enrollment.id)}
                  className="text-red-600 hover:text-red-800 text-sm"
                >
                  Cancel Assignment
                </button>
              )
            }
          ]}
          data={enrollments || []}
          loading={loading}
          emptyMessage="No active assignments found"
          pagination={true}
          pageSize={pageSize}
          onPageSizeChange={setPageSize}
          searchable={true}
          searchPlaceholder="Search assignments..."
        />
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ isOpen: false, title: '', message: '' })}
        onConfirm={confirmCancelAssignment}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText="Cancel Assignment"
      />
    </div>
  );
};

export default TrainerAssignTraining; 