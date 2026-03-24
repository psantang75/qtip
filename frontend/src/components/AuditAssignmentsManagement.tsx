// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import auditAssignmentService from '../services/auditAssignmentService';
import type { AuditAssignment as AuditAssignmentType } from '../services/auditAssignmentService';
import userService from '../services/userService';
import DataTable, { Column } from './compound/DataTable';
import Modal from './ui/Modal';
import Button from './ui/Button';
import ErrorDisplay from './ui/ErrorDisplay';

const AuditAssignmentsManagement: React.FC = () => {
  const navigate = useNavigate();
  
  const [assignments, setAssignments] = useState<AuditAssignmentType[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [qaOptions, setQaOptions] = useState<{id: number, username: string}[]>([]);
  const [targetOptions, setTargetOptions] = useState<{id: number, name: string, type: string}[]>([]);
  const [filters, setFilters] = useState({
    qaId: '',
    targetId: '',
    isActive: ''  // Show all by default
  });
  
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    assignmentId?: number;
  }>({
    isOpen: false,
    title: '',
    message: ''
  });

  // Ensure all arrays are always safe
  const safeAssignments = Array.isArray(assignments) ? assignments : [];
  const safeTargetOptions = Array.isArray(targetOptions) ? targetOptions : [];
  const safeQaOptions = Array.isArray(qaOptions) ? qaOptions : [];

  // Define columns for DataTable
  const columns: Column<AuditAssignmentType>[] = [
    {
      key: 'form_name',
      header: 'Form Name',
      sortable: true,
      render: (value) => (
        <span className="font-medium text-gray-900">{value as string}</span>
      )
    },
    {
      key: 'target_name',
      header: 'Target',
      sortable: true,
      render: (value, assignment) => (
        <span>{value} ({assignment.target_type})</span>
      )
    },
    {
      key: 'schedule',
      header: 'Schedule',
      sortable: true
    },
    {
      key: 'qa_name',
      header: 'QA Analyst',
      sortable: true,
      render: (value) => value || 'Not Assigned'
    },
    {
      key: 'start_date',
      header: 'Start Date',
      sortable: true,
      render: (value) => new Date(value as string).toLocaleDateString()
    },
    {
      key: 'end_date',
      header: 'End Date',
      sortable: true,
      render: (value) => value ? new Date(value as string).toLocaleDateString() : 'No End Date'
    },
    {
      key: 'id',
      header: 'Actions',
      sortable: false,
      render: (_, assignment) => (
        <div className="space-x-2">
          {assignment.is_active ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDeactivate(assignment.id)}
              className="text-red-600 hover:text-red-700"
            >
              Deactivate
            </Button>
          ) : (
            <span className="text-gray-400">Deactivated</span>
          )}
        </div>
      )
    }
  ];
  
  useEffect(() => {
    fetchAssignments();
    loadFilterOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, searchTerm, filters.qaId, filters.targetId, filters.isActive]);
  
  const loadFilterOptions = async () => {
    try {
      // Load QA analysts for filter dropdown
      const qaResponse = await userService.getUsers(1, 100, { role_id: 2 });
      setQaOptions(Array.isArray(qaResponse.items) ? qaResponse.items : []);
    } catch (error) {
      console.error('Error loading filter options:', error);
      setQaOptions([]); // Ensure we always have an array
      setError('Failed to load filter options.');
    }
  };
  
  // Extract unique target options from assignments
  useEffect(() => {
    console.log('useEffect target options - assignments type:', typeof assignments, 'isArray:', Array.isArray(assignments), 'length:', assignments?.length);
    if (Array.isArray(assignments) && assignments.length > 0) {
      const uniqueTargets = new Map<string, {id: number, name: string, type: string}>();
      
      assignments.forEach(assignment => {
        const key = `${assignment.target_type}-${assignment.target_id}`;
        if (!uniqueTargets.has(key)) {
          uniqueTargets.set(key, {
            id: assignment.target_id,
            name: assignment.target_name,
            type: assignment.target_type
          });
        }
      });
      
      setTargetOptions(Array.from(uniqueTargets.values()));
    } else {
      setTargetOptions([]);
    }
  }, [assignments]);
  
  const fetchAssignments = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Build query parameters
      const queryParams: Record<string, string> = {};
      
      if (searchTerm) {
        queryParams.search = searchTerm;
      }
      
      // Only add is_active parameter if a filter value is selected
      if (filters.isActive !== '') {
        queryParams.is_active = filters.isActive;
      }
      
      if (filters.qaId) {
        queryParams.qa_id = filters.qaId;
      }
      
      if (filters.targetId) {
        queryParams.target_id = filters.targetId;
      }
      
      console.log('Fetching assignments with params:', { page: currentPage, limit: 10, searchTerm, queryParams });
      
      const response = await auditAssignmentService.getAuditAssignments(
        currentPage, 
        10, 
        searchTerm,
        queryParams
      );
      
      console.log('Received assignments:', response);
      
      // Extract assignments array safely
      let assignmentsArray: AuditAssignmentType[] = [];
      if (Array.isArray(response)) {
        // Direct array response
        assignmentsArray = response;
      } else if (response && Array.isArray(response.assignments)) {
        // Object with assignments property (current API format)
        assignmentsArray = response.assignments;
        console.log('Extracted assignments array:', assignmentsArray.length, 'assignments');
      } else {
        console.warn('Assignments API returned unexpected format:', typeof response, response);
        assignmentsArray = [];
      }
      
      // Ensure we're always setting an array
      const finalArray = Array.isArray(assignmentsArray) ? assignmentsArray : [];
      console.log('Setting assignments state with:', finalArray.length, 'items');
      setAssignments(finalArray);
      setTotalPages(response.totalPages || 1);

      // If we deactivated the last item on the page, go to previous page
      if (finalArray.length === 0 && currentPage > 1) {
        setCurrentPage(prev => prev - 1);
      }
    } catch (error) {
      console.error('Error fetching assignments:', error);
      setAssignments([]);
      setTotalPages(1);
      setError('Failed to load audit assignments. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  
  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1); // Reset to first page on search
  };
  
  const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFilters(prev => ({
      ...prev,
      [name]: value
    }));
    setCurrentPage(1); // Reset to first page on filter change
  };
  
  const clearFilters = () => {
    // Reset to default values
    setFilters({
      qaId: '',
      targetId: '',
      isActive: ''  // Changed from 'true' to '' to show all items by default
    });
    setSearchTerm('');
  };
  
  const handleCreateAssignment = () => {
    navigate('/admin/audit-assignments/create');
  };
  
  const handleDeactivate = (assignmentId: number) => {
    const assignment = safeAssignments.find(a => a.id === assignmentId);
    if (!assignment) return;
    
    setConfirmModal({
      isOpen: true,
      title: 'Deactivate Assignment',
      message: `Are you sure you want to deactivate the audit assignment for ${assignment.form_name} assigned to ${assignment.target_name}?`,
      assignmentId: assignmentId
    });
  };
  
  const handleConfirmDeactivate = async () => {
    if (!confirmModal.assignmentId) return;
    
    try {
      setLoading(true);
      
      // Log what we're deactivating
      console.log(`Deactivating assignment ID: ${confirmModal.assignmentId}`);
      
      // Call the service to deactivate
      const response = await auditAssignmentService.deactivateAuditAssignment(confirmModal.assignmentId);
      console.log('Deactivation response:', response);
      
      // Close the modal first
      setConfirmModal(prev => ({ ...prev, isOpen: false }));
      
      // Then fetch the updated assignments list
      await fetchAssignments();
    } catch (error) {
      console.error('Error deactivating assignment:', error);
      setError('Failed to deactivate the assignment. Please try again.');
      setConfirmModal(prev => ({ ...prev, isOpen: false }));
    } finally {
      setLoading(false);
    }
  };
  
  const handleCloseModal = () => {
    setConfirmModal(prev => ({ ...prev, isOpen: false }));
  };
  
  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  // Debug render
  console.log('Render - assignments type:', typeof assignments, 'isArray:', Array.isArray(assignments), 'length:', assignments?.length);
  
  return (
    <div className="container p-6 mx-auto">
      <h1 className="mb-8 text-2xl font-bold">Audit Assignments</h1>
      
      {error && (
        <ErrorDisplay
          variant="card"
          message={error}
          title="Error"
          dismissible={true}
          onDismiss={() => setError(null)}
          className="mb-6"
        />
      )}
      
      {/* Actions Buttons */}
      <div className="flex justify-between items-center mb-8">
        <div></div>
        <div>
          <Button
            onClick={handleCreateAssignment}
            variant="primary"
            size="lg"
          >
            Assign Audits
          </Button>
        </div>
      </div>
      
      {/* Search and Filters */}
      <div className="mb-8 bg-white rounded-lg shadow-md p-6 border border-gray-200">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-800 mb-3"></h2>
          
          {/* Filter Fields - All in One Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target</label>
              <select
                name="targetId"
                value={filters.targetId}
                onChange={handleFilterChange}
                className="w-full px-4 py-[9px] border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="">All Targets</option>
                {safeTargetOptions.map((option) => (
                  <option key={`${option.type}-${option.id}`} value={option.id}>
                    {option.name} ({option.type})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">QA Analyst</label>
              <select
                name="qaId"
                value={filters.qaId}
                onChange={handleFilterChange}
                className="w-full px-4 py-[9px] border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="">All QA Analysts</option>
                {safeQaOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.username}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search by form name, target, or QA analyst..."
                  value={searchTerm}
                  onChange={handleSearch}
                  className="w-full px-4 py-[9px] border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
                {(searchTerm || filters.qaId || filters.targetId || filters.isActive !== '') && (
                  <button 
                    onClick={clearFilters}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    title="Clear all filters"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Status Checkbox */}
          <div className="flex items-center justify-end pt-4">
            <input
              type="checkbox"
              id="showOnlyActive"
              checked={filters.isActive === 'true'}
              onChange={() => setFilters(prev => ({ 
                ...prev, 
                isActive: prev.isActive === 'true' ? '' : 'true'
              }))}
              className="mr-2"
            />
            <label htmlFor="showOnlyActive" className="text-sm text-gray-700">
              Show only active assignments
            </label>
          </div>
        </div>
      </div>
      
      {/* Assignment Table with DataTable */}
      <DataTable
        data={safeAssignments}
        columns={columns}
        loading={loading}
        searchable={false} // We have custom search above
        pagination={false} // We have custom pagination below
        emptyMessage="No audit assignments found. Click 'Assign Audits' to create a new assignment."
        className={loading ? "opacity-50" : ""}
      />
      
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center mt-6">
          <div className="flex items-center space-x-2">
            <Button
              variant="tertiary"
              size="sm"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
            >
              Previous
            </Button>
            <span className="text-sm text-gray-700 px-3">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="tertiary"
              size="sm"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
      
      {/* Confirmation Modal */}
      <Modal 
        isOpen={confirmModal.isOpen} 
        onClose={handleCloseModal}
        title={confirmModal.title}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-gray-600">{confirmModal.message}</p>
          <div className="flex justify-end space-x-3">
            <Button
              type="button"
              variant="ghost"
              onClick={handleCloseModal}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmDeactivate}
            >
              Deactivate
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default AuditAssignmentsManagement;