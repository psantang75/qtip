import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import directorService from '../services/directorService';
import type { 
  DirectorDepartment, 
  DirectorDepartmentCreateDTO 
} from '../services/directorService';
import type { User } from '../services/userService';
import type { Department } from '../services/departmentService';
import { HiOutlineChevronLeft } from 'react-icons/hi';

// Director Assignment Form Component
const DirectorAssignmentForm: React.FC<{
  directors: User[];
  departments: Department[];
  onAdd: (assignment: DirectorDepartmentCreateDTO) => void;
  onClear: () => void;
}> = ({ directors, departments, onAdd, onClear }) => {
  const [formData, setFormData] = useState<DirectorDepartmentCreateDTO>({
    director_id: 0,
    department_id: 0
  });

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: parseInt(value)
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAdd(formData);
  };

  const handleClear = () => {
    setFormData({
      director_id: 0,
      department_id: 0
    });
    onClear();
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
      <h2 className="text-lg font-semibold mb-4">Assign Director to Department</h2>
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Director *
          </label>
          <select
            name="director_id"
            value={formData.director_id || ''}
            onChange={handleChange}
            required
            className="w-full px-4 py-[9px] border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">Select Director</option>
            {directors.map(director => (
              <option key={director.id} value={director.id}>
                {director.username}
              </option>
            ))}
          </select>
        </div>
        
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Department *
          </label>
          <select
            name="department_id"
            value={formData.department_id || ''}
            onChange={handleChange}
            required
            className="w-full px-4 py-[9px] border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">Select Department</option>
            {departments.map(department => (
              <option key={department.id} value={department.id}>
                {department.department_name}
              </option>
            ))}
          </select>
        </div>
        
        <div className="flex justify-end space-x-4">
          <button
            type="button"
            onClick={handleClear}
            className="px-6 py-2.5 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-opacity-50"
          >
            Clear
          </button>
          <button
            type="submit"
            disabled={!formData.director_id || !formData.department_id}
            className="px-6 py-2.5 bg-primary-blue text-white rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-primary-blue focus:ring-opacity-50 disabled:bg-blue-300 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>
      </form>
    </div>
  );
};

// Pending Assignments Table Component
const PendingAssignmentsTable: React.FC<{
  pendingAssignments: Array<DirectorDepartmentCreateDTO & { directorName: string; departmentName: string }>;
  onRemove: (index: number) => void;
  onSaveAll: () => void;
}> = ({ pendingAssignments, onRemove, onSaveAll }) => {
  if (pendingAssignments.length === 0) {
    return null;
  }
  
  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden border border-gray-200 mt-6">
      <div className="p-4 bg-gray-50 border-b border-gray-200">
        <h2 className="text-lg font-semibold">Pending Assignments</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left text-gray-700">
          <thead className="text-xs font-semibold uppercase bg-gray-100 border-b border-gray-200">
            <tr>
              <th scope="col" className="px-6 py-[13px] text-gray-800 font-bold">Director Name</th>
              <th scope="col" className="px-6 py-[13px] text-gray-800 font-bold">Department Name</th>
              <th scope="col" className="px-6 py-[13px] text-gray-800 font-bold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pendingAssignments.map((assignment, index) => (
              <tr key={index} className="bg-white border-b hover:bg-gray-50">
                <td className="px-6 py-[13px] font-medium text-gray-900 whitespace-nowrap">
                  {assignment.directorName}
                </td>
                <td className="px-6 py-[13px]">
                  {assignment.departmentName}
                </td>
                <td className="px-6 py-[13px]">
                  <button
                    onClick={() => onRemove(index)}
                    className="text-red-600 hover:text-red-900"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end">
        <button
          onClick={onSaveAll}
          className="px-6 py-2.5 bg-primary-blue text-white rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-primary-blue focus:ring-opacity-50"
        >
          Save All Assignments
        </button>
      </div>
    </div>
  );
};

// Active Assignments Table Component
const ActiveAssignmentsTable: React.FC<{
  assignments: DirectorDepartment[];
  onRemove: (assignment: DirectorDepartment) => void;
  isLoading: boolean;
}> = ({ assignments, onRemove, isLoading }) => {
  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200 mt-6">
        <div className="flex justify-center items-center h-40">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-500"></div>
        </div>
      </div>
    );
  }
  
  if (assignments.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200 mt-6">
        <p className="text-gray-500 text-center">No active assignments found.</p>
      </div>
    );
  }
  
  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden border border-gray-200 mt-6">
      <div className="p-4 bg-gray-50 border-b border-gray-200">
        <h2 className="text-lg font-semibold">Active Assignments</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left text-gray-700">
          <thead className="text-xs font-semibold uppercase bg-gray-100 border-b border-gray-200">
            <tr>
              <th scope="col" className="px-6 py-[13px] text-gray-800 font-bold">Director Name</th>
              <th scope="col" className="px-6 py-[13px] text-gray-800 font-bold">Department Name</th>
              <th scope="col" className="px-6 py-[13px] text-gray-800 font-bold">Created Date</th>
              <th scope="col" className="px-6 py-[13px] text-gray-800 font-bold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((assignment) => (
              <tr key={assignment.id} className="bg-white border-b hover:bg-gray-50">
                <td className="px-6 py-[13px] font-medium text-gray-900 whitespace-nowrap">
                  {assignment.director_name}
                </td>
                <td className="px-6 py-[13px]">
                  {assignment.department_name}
                </td>
                <td className="px-6 py-[13px]">
                  {new Date(assignment.created_at).toLocaleDateString()}
                </td>
                <td className="px-6 py-[13px]">
                  <button
                    onClick={() => onRemove(assignment)}
                    className="text-red-600 hover:text-red-900"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Confirmation Modal Component
const ConfirmationModal: React.FC<{
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ title, message, onConfirm, onCancel }) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full">
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        <p className="text-gray-600 mb-6">{message}</p>
        <div className="flex justify-end space-x-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

// Main DirectorAssignment Component
const DirectorAssignment: React.FC = () => {
  // State management
  const [directors, setDirectors] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [activeAssignments, setActiveAssignments] = useState<DirectorDepartment[]>([]);
  const [pendingAssignments, setPendingAssignments] = useState<Array<DirectorDepartmentCreateDTO & { directorName: string; departmentName: string }>>([]);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [modalData, setModalData] = useState<{ show: boolean; title: string; message: string; onConfirm: () => void }>({
    show: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // Fetch initial data
  useEffect(() => {
    loadData();
  }, []);

  // Fetch assignments when page or search changes
  useEffect(() => {
    fetchAssignments();
  }, [currentPage, searchTerm]);

  // Load all required data
  const loadData = async () => {
    setIsLoading(true);
    try {
      // Fetch directors and departments in parallel
      const [directorsResponse, departmentsResponse] = await Promise.all([
        directorService.getDirectors(),
        directorService.getDepartments()
      ]);
      
      setDirectors(directorsResponse);
      setDepartments(departmentsResponse);
      
      await fetchAssignments();
    } catch (error) {
      console.error('Error loading data:', error);
      // Display error notification or handle error
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch director-department assignments
  const fetchAssignments = async () => {
    setIsLoading(true);
    try {
      const response = await directorService.getDirectorAssignments(
        currentPage,
        20,
        undefined,
        undefined,
        searchTerm
      );
      
      setActiveAssignments(response.items);
      setTotalPages(response.totalPages);
    } catch (error) {
      console.error('Error fetching assignments:', error);
      // Display error notification or handle error
    } finally {
      setIsLoading(false);
    }
  };

  // Handle search
  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1); // Reset to first page when search changes
  };

  // Add an assignment to pending list
  const handleAddAssignment = (assignment: DirectorDepartmentCreateDTO) => {
    // Find director and department names for display
    const director = directors.find(d => d.id === assignment.director_id);
    const department = departments.find(d => d.id === assignment.department_id);
    
    if (!director || !department) {
      console.error('Director or department not found');
      return;
    }
    
    // Check if this assignment already exists in pending or active assignments
    const isDuplicate = pendingAssignments.some(
      a => a.director_id === assignment.director_id && a.department_id === assignment.department_id
    );
    
    const isExisting = activeAssignments.some(
      a => a.director_id === assignment.director_id && a.department_id === assignment.department_id
    );
    
    if (isDuplicate || isExisting) {
      // Show alert or notification that assignment already exists
      alert('This director-department assignment already exists.');
      return;
    }
    
    // Add to pending assignments
    setPendingAssignments([
      ...pendingAssignments,
      {
        ...assignment,
        directorName: director.username,
        departmentName: department.department_name
      }
    ]);
  };

  // Remove pending assignment
  const handleRemovePending = (index: number) => {
    setPendingAssignments(pendingAssignments.filter((_, i) => i !== index));
  };

  // Save all pending assignments
  const handleSaveAssignments = async () => {
    if (pendingAssignments.length === 0) return;
    
    setIsLoading(true);
    try {
      // Map to DirectorDepartmentCreateDTO format
      const assignments = pendingAssignments.map(assignment => ({
        director_id: assignment.director_id,
        department_id: assignment.department_id
      }));
      
      // Save to backend
      await directorService.createBulkDirectorAssignments(assignments);
      
      // Clear pending assignments
      setPendingAssignments([]);
      
      // Refresh active assignments
      await fetchAssignments();
    } catch (error) {
      console.error('Error saving assignments:', error);
      // Display error notification or handle error
    } finally {
      setIsLoading(false);
    }
  };

  // Show confirmation modal for removing an active assignment
  const handleShowRemoveModal = (assignment: DirectorDepartment) => {
    setModalData({
      show: true,
      title: 'Remove Assignment',
      message: `Are you sure you want to remove the assignment of ${assignment.director_name} from ${assignment.department_name}?`,
      onConfirm: () => handleRemoveAssignment(assignment.id)
    });
  };

  // Remove active assignment
  const handleRemoveAssignment = async (assignmentId: number) => {
    setIsLoading(true);
    try {
      await directorService.deleteDirectorAssignment(assignmentId);
      setModalData({ ...modalData, show: false });
      await fetchAssignments();
    } catch (error) {
      console.error(`Error removing assignment with ID ${assignmentId}:`, error);
      // Display error notification or handle error
    } finally {
      setIsLoading(false);
    }
  };

  // Handle pagination
  const handlePageChange = (newPage: number) => {
    if (newPage > 0 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  // Handle modal close
  const handleCloseModal = () => {
    setModalData({ ...modalData, show: false });
  };

  // Handle form clear
  const handleClearForm = () => {
    // If needed, add logic to reset form state
  };

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Director Assignment</h1>
        <Link 
          to="/admin/departments" 
          className="flex items-center px-4 py-2 bg-primary-blue text-white rounded font-medium hover:bg-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-blue"
        >
          <HiOutlineChevronLeft className="h-5 w-5 mr-1" />
          <span>Back to Departments</span>
        </Link>
      </div>
      
      {/* Director Assignment Form */}
      <DirectorAssignmentForm
        directors={directors}
        departments={departments}
        onAdd={handleAddAssignment}
        onClear={handleClearForm}
      />
      
      {/* Pending Assignments Table */}
      <PendingAssignmentsTable
        pendingAssignments={pendingAssignments}
        onRemove={handleRemovePending}
        onSaveAll={handleSaveAssignments}
      />
      
      {/* Active Assignments Table */}
      <ActiveAssignmentsTable
        assignments={activeAssignments}
        onRemove={handleShowRemoveModal}
        isLoading={isLoading}
      />
      
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center mt-6">
          <nav className="flex items-center space-x-1">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="px-3 py-1 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              // Logic to show appropriate page numbers
              let pageNum = currentPage;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (currentPage <= 3) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = currentPage - 2 + i;
              }
              
              return (
                <button
                  key={i}
                  onClick={() => handlePageChange(pageNum)}
                  className={`px-3 py-1 rounded-md ${
                    currentPage === pageNum
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="px-3 py-1 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </nav>
        </div>
      )}
      
      {/* Confirmation Modal */}
      {modalData.show && (
        <ConfirmationModal
          title={modalData.title}
          message={modalData.message}
          onConfirm={modalData.onConfirm}
          onCancel={handleCloseModal}
        />
      )}
    </div>
  );
};

export default DirectorAssignment; 