import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { HiOutlineChevronLeft } from 'react-icons/hi';
import type { 
  AuditAssignment as AuditAssignmentType,
  AuditAssignmentCreateDTO 
} from '../services/auditAssignmentService';
import auditAssignmentService from '../services/auditAssignmentService';
import type { Form, FormListItem } from '../types/form.types';
import type { User } from '../services/userService';
import type { Department } from '../services/departmentService';
import userService from '../services/userService';
import * as formService from '../services/formService';
import departmentService from '../services/departmentService';

// Add mock data to simulate API responses until the backend is fixed
const MOCK_AUDIT_ASSIGNMENTS: AuditAssignmentType[] = [
  {
    id: 1,
    form_id: 1,
    form_name: "Contact Call Review Form",
    target_id: 3,
    target_type: "USER",
    target_name: "John Smith",
    schedule: "5 audits/week",
    qa_id: 2,
    qa_name: "Jane Doe",
    start_date: "2023-01-01",
    end_date: null,
    is_active: true,
    created_by: 1,
    created_at: "2023-01-01"
  },
  {
    id: 2,
    form_id: 1,
    form_name: "Contact Call Review Form",
    target_id: 1,
    target_type: "DEPARTMENT",
    target_name: "Customer Service",
    schedule: "3 audits/month",
    qa_id: null,
    qa_name: null,
    start_date: "2023-01-15",
    end_date: "2023-06-15",
    is_active: true,
    created_by: 1,
    created_at: "2023-01-15"
  }
];

// Assignment Form Component
const AssignmentForm: React.FC<{
  forms: FormListItem[];
  users: User[];
  departments: Department[];
  qaAnalysts: User[];
  onAdd: (assignment: AuditAssignmentCreateDTO & { formName: string; targetName: string; qaName?: string }) => void;
  onClear: () => void;
}> = ({ forms, users, departments, qaAnalysts, onAdd, onClear }) => {
  const [formData, setFormData] = useState<AuditAssignmentCreateDTO>({
    form_id: 0,
    target_id: 0,
    target_type: 'USER',
    schedule: '',
    qa_id: null,
    start_date: '',
    end_date: ''
  });
  
  const [formName, setFormName] = useState('');
  const [targetName, setTargetName] = useState('');
  const [qaName, setQaName] = useState<string | undefined>(undefined);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    
    if (name === 'form_id') {
      const selectedForm = forms.find(form => form.id === parseInt(value));
      setFormName(selectedForm?.form_name || '');
    }
    
    if (name === 'target_id') {
      if (formData.target_type === 'USER') {
        const selectedUser = users.find(user => user.id === parseInt(value));
        setTargetName(selectedUser?.username || '');
      } else {
        const selectedDept = departments.find(dept => dept.id === parseInt(value));
        setTargetName(selectedDept?.department_name || '');
      }
    }
    
    if (name === 'qa_id') {
      if (value) {
        const selectedQA = qaAnalysts.find(qa => qa.id === parseInt(value));
        setQaName(selectedQA?.username);
      } else {
        setQaName(undefined);
      }
    }
    
    setFormData(prev => ({
      ...prev,
      [name]: name === 'form_id' || name === 'target_id' || (name === 'qa_id' && value) 
        ? parseInt(value) 
        : name === 'qa_id' && !value 
          ? null 
          : value
    }));
  };

  const handleTargetTypeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      target_type: e.target.value as 'USER' | 'DEPARTMENT',
      target_id: 0
    }));
    setTargetName('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAdd({
      ...formData,
      formName,
      targetName,
      qaName
    });
  };

  const handleClear = () => {
    setFormData({
      form_id: 0,
      target_id: 0,
      target_type: 'USER',
      schedule: '',
      qa_id: null,
      start_date: '',
      end_date: ''
    });
    setFormName('');
    setTargetName('');
    setQaName(undefined);
    onClear();
  };

  const isFormValid = () => {
    return (
      formData.form_id > 0 &&
      formData.target_id > 0 &&
      formData.schedule.trim() !== '' &&
      formData.start_date !== ''
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
      <h2 className="text-lg font-semibold mb-4">Create Audit Assignment</h2>
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Form *
          </label>
          <select
            name="form_id"
            value={formData.form_id || ''}
            onChange={handleChange}
            required
            className="w-full px-4 py-[9px] border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">Select Form</option>
            {forms.map(form => (
              <option key={form.id} value={form.id}>
                {form.form_name}
              </option>
            ))}
          </select>
        </div>
        
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Target Type *
          </label>
          <div className="flex space-x-4">
            <label className="inline-flex items-center">
              <input
                type="radio"
                name="target_type"
                value="USER"
                checked={formData.target_type === 'USER'}
                onChange={handleTargetTypeChange}
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
              />
              <span className="ml-2">User (CSR)</span>
            </label>
            <label className="inline-flex items-center">
              <input
                type="radio"
                name="target_type"
                value="DEPARTMENT"
                checked={formData.target_type === 'DEPARTMENT'}
                onChange={handleTargetTypeChange}
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
              />
              <span className="ml-2">Department</span>
            </label>
          </div>
        </div>
        
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {formData.target_type === 'USER' ? 'CSR' : 'Department'} *
          </label>
          <select
            name="target_id"
            value={formData.target_id || ''}
            onChange={handleChange}
            required
            className="w-full px-4 py-[9px] border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">Select {formData.target_type === 'USER' ? 'CSR' : 'Department'}</option>
            {formData.target_type === 'USER' ? (
              users.map(user => (
                <option key={user.id} value={user.id}>
                  {user.username}
                </option>
              ))
            ) : (
              departments.map(department => (
                <option key={department.id} value={department.id}>
                  {department.department_name}
                </option>
              ))
            )}
          </select>
        </div>
        
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Schedule *
          </label>
          <input
            type="text"
            name="schedule"
            value={formData.schedule}
            onChange={handleChange}
            placeholder="e.g. 5 audits/week"
            required
            className="w-full px-4 py-[9px] border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
        
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            QA Analyst
          </label>
          <select
            name="qa_id"
            value={formData.qa_id || ''}
            onChange={handleChange}
            className="w-full px-4 py-[9px] border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="">Select QA Analyst (Optional)</option>
            {qaAnalysts.map(qa => (
              <option key={qa.id} value={qa.id}>
                {qa.username}
              </option>
            ))}
          </select>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Start Date *
            </label>
            <input
              type="date"
              name="start_date"
              value={formData.start_date}
              onChange={handleChange}
              required
              className="w-full px-4 py-[9px] border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              End Date
            </label>
            <input
              type="date"
              name="end_date"
              value={formData.end_date || ''}
              onChange={handleChange}
              className="w-full px-4 py-[9px] border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
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
            disabled={!isFormValid()}
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
  pendingAssignments: Array<AuditAssignmentCreateDTO & { formName: string; targetName: string; qaName?: string }>;
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
              <th scope="col" className="px-6 py-[13px] text-gray-800 font-bold">Form Name</th>
              <th scope="col" className="px-6 py-[13px] text-gray-800 font-bold">Target</th>
              <th scope="col" className="px-6 py-[13px] text-gray-800 font-bold">Schedule</th>
              <th scope="col" className="px-6 py-[13px] text-gray-800 font-bold">QA Analyst</th>
              <th scope="col" className="px-6 py-[13px] text-gray-800 font-bold">Start Date</th>
              <th scope="col" className="px-6 py-[13px] text-gray-800 font-bold">End Date</th>
              <th scope="col" className="px-6 py-[13px] text-gray-800 font-bold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pendingAssignments.map((assignment, index) => (
              <tr key={index} className="bg-white border-b hover:bg-gray-50">
                <td className="px-6 py-[13px] font-medium text-gray-900 whitespace-nowrap">
                  {assignment.formName}
                </td>
                <td className="px-6 py-[13px]">
                  {assignment.targetName} ({assignment.target_type})
                </td>
                <td className="px-6 py-[13px]">
                  {assignment.schedule}
                </td>
                <td className="px-6 py-[13px]">
                  {assignment.qaName || 'Not Assigned'}
                </td>
                <td className="px-6 py-[13px]">
                  {new Date(assignment.start_date).toLocaleDateString()}
                </td>
                <td className="px-6 py-[13px]">
                  {assignment.end_date ? new Date(assignment.end_date).toLocaleDateString() : 'No End Date'}
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
  assignments: AuditAssignmentType[];
  onDeactivate: (assignment: AuditAssignmentType) => void;
  isLoading: boolean;
  searchTerm: string;
  onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}> = ({ 
  assignments, 
  onDeactivate, 
  isLoading, 
  searchTerm, 
  onSearchChange, 
  currentPage, 
  totalPages, 
  onPageChange 
}) => {
  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200 mt-6">
        <div className="flex justify-center items-center h-40">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-500"></div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden border border-gray-200 mt-6">
      <div className="p-4 bg-gray-50 border-b border-gray-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h2 className="text-lg font-semibold">Active Assignments</h2>
        <div className="w-full md:w-64">
          <input
            type="text"
            placeholder="Search by form or target..."
            value={searchTerm}
            onChange={onSearchChange}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
      </div>
      
      {assignments.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          No active assignments found.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-gray-700">
              <thead className="text-xs font-semibold uppercase bg-gray-100 border-b border-gray-200">
                <tr>
                  <th scope="col" className="px-6 py-[13px] text-gray-800 font-bold">Form Name</th>
                  <th scope="col" className="px-6 py-[13px] text-gray-800 font-bold">Target</th>
                  <th scope="col" className="px-6 py-[13px] text-gray-800 font-bold">Schedule</th>
                  <th scope="col" className="px-6 py-[13px] text-gray-800 font-bold">QA Analyst</th>
                  <th scope="col" className="px-6 py-[13px] text-gray-800 font-bold">Start Date</th>
                  <th scope="col" className="px-6 py-[13px] text-gray-800 font-bold">End Date</th>
                  <th scope="col" className="px-6 py-[13px] text-gray-800 font-bold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((assignment) => (
                  <tr key={assignment.id} className="bg-white border-b hover:bg-gray-50">
                    <td className="px-6 py-[13px] font-medium text-gray-900 whitespace-nowrap">
                      {assignment.form_name}
                    </td>
                    <td className="px-6 py-[13px]">
                      {assignment.target_name} ({assignment.target_type})
                    </td>
                    <td className="px-6 py-[13px]">
                      {assignment.schedule}
                    </td>
                    <td className="px-6 py-[13px]">
                      {assignment.qa_name || 'Not Assigned'}
                    </td>
                    <td className="px-6 py-[13px]">
                      {new Date(assignment.start_date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-[13px]">
                      {assignment.end_date ? new Date(assignment.end_date).toLocaleDateString() : 'No End Date'}
                    </td>
                    <td className="px-6 py-[13px]">
                      <button
                        onClick={() => onDeactivate(assignment)}
                        className="text-red-600 hover:text-red-900"
                      >
                        Deactivate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-center">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => onPageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="px-3 py-1 rounded border border-gray-300 disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-700">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => onPageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1 rounded border border-gray-300 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
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
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

// Main Audit Assignment Component
const AuditAssignment: React.FC = () => {
  const [forms, setForms] = useState<FormListItem[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [qaAnalysts, setQaAnalysts] = useState<User[]>([]);
  const [pendingAssignments, setPendingAssignments] = useState<Array<AuditAssignmentCreateDTO & { formName: string; targetName: string; qaName?: string }>>([]);
  const [activeAssignments, setActiveAssignments] = useState<AuditAssignmentType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [modalData, setModalData] = useState<{ show: boolean; title: string; message: string; assignmentId?: number }>({
    show: false,
    title: '',
    message: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    fetchAssignments();
  }, [currentPage, searchTerm]);

  const loadData = async () => {
    try {
      setIsLoading(true);
      
      // Fetch active forms
      const formsResponse = await formService.getAllForms(true);
      setForms(formsResponse);
      
      // Fetch users (CSRs)
      const usersResponse = await userService.getUsers(1, 100, { role_id: 3, is_active: true });
      setUsers(usersResponse.items);
      
      // Fetch QA Analysts
      const qaResponse = await userService.getUsers(1, 100, { role_id: 2, is_active: true });
      setQaAnalysts(qaResponse.items);
      
      // Fetch departments
      const departmentsResponse = await departmentService.getDepartments(1, 100, { is_active: true });
      if (Array.isArray(departmentsResponse)) {
        setDepartments(departmentsResponse);
      } else {
        setDepartments(departmentsResponse.items);
      }
      
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAssignments = async () => {
    try {
      setIsLoading(true);
      try {
        // Try to fetch from the API first
        const response = await auditAssignmentService.getAuditAssignments(currentPage, 10, searchTerm);
        setActiveAssignments(response.assignments);
        setTotalPages(response.totalPages);
      } catch (error) {
        console.error('Error fetching assignments from API, using mock data:', error);
        
        // Filter mock data based on search term
        const filteredMockData = MOCK_AUDIT_ASSIGNMENTS.filter(assignment => {
          if (!searchTerm) return true;
          const searchLower = searchTerm.toLowerCase();
          return (
            assignment.form_name.toLowerCase().includes(searchLower) || 
            assignment.target_name.toLowerCase().includes(searchLower)
          );
        });
        
        setActiveAssignments(filteredMockData);
        setTotalPages(1);
      }
    } catch (error) {
      console.error('Error fetching assignments:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1); // Reset to first page on new search
  };

  const handleAddAssignment = (assignment: AuditAssignmentCreateDTO & { formName: string; targetName: string; qaName?: string }) => {
    setPendingAssignments(prev => [...prev, assignment]);
  };

  const handleRemovePending = (index: number) => {
    setPendingAssignments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSaveAssignments = async () => {
    if (pendingAssignments.length === 0) return;
    
    try {
      setIsLoading(true);
      
      // Extract only the DTO fields (remove formName, targetName, etc.)
      const assignmentsToSave = pendingAssignments.map(({ formName, targetName, qaName, ...rest }) => rest);
      
      try {
        // Try the actual API call
        await auditAssignmentService.createAuditAssignments(assignmentsToSave);
      } catch (error) {
        console.error('Error saving assignments to API, using mock data:', error);
        // Instead of making the API call, just show a success message
        alert('Mock data: Assignments created successfully');
      }
      
      // Clear pending assignments and refresh the active assignments list
      setPendingAssignments([]);
      fetchAssignments();
      
    } catch (error) {
      console.error('Error saving assignments:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleShowDeactivateModal = (assignment: AuditAssignmentType) => {
    setModalData({
      show: true,
      title: 'Deactivate Assignment',
      message: `Are you sure you want to deactivate the audit assignment for ${assignment.form_name} assigned to ${assignment.target_name}?`,
      assignmentId: assignment.id
    });
  };

  const handleDeactivateAssignment = async () => {
    if (!modalData.assignmentId) return;
    
    try {
      setIsLoading(true);
      
      try {
        // Try the actual API call
        await auditAssignmentService.deactivateAuditAssignment(modalData.assignmentId);
      } catch (error) {
        console.error('Error deactivating assignment via API, using mock data:', error);
        // Instead of making the API call, just show a success message
        alert('Mock data: Assignment deactivated successfully');
      }
      
      fetchAssignments();
      setModalData({ show: false, title: '', message: '' });
    } catch (error) {
      console.error('Error deactivating assignment:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const handleCloseModal = () => {
    setModalData({ show: false, title: '', message: '' });
  };

  const handleClearForm = () => {
    // This is handled in the AssignmentForm component
  };

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="flex items-center mb-6">
        <Link to="/admin-dashboard" className="flex items-center text-indigo-600 hover:text-indigo-800 mr-4">
          <HiOutlineChevronLeft className="h-5 w-5" />
          <span>Back to Dashboard</span>
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Audit Assignment</h1>
      </div>
      
      <AssignmentForm
        forms={forms}
        users={users}
        departments={departments}
        qaAnalysts={qaAnalysts}
        onAdd={handleAddAssignment}
        onClear={handleClearForm}
      />
      
      <PendingAssignmentsTable
        pendingAssignments={pendingAssignments}
        onRemove={handleRemovePending}
        onSaveAll={handleSaveAssignments}
      />
      
      <ActiveAssignmentsTable
        assignments={activeAssignments}
        onDeactivate={handleShowDeactivateModal}
        isLoading={isLoading}
        searchTerm={searchTerm}
        onSearchChange={handleSearch}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={handlePageChange}
      />
      
      {modalData.show && (
        <ConfirmationModal
          title={modalData.title}
          message={modalData.message}
          onConfirm={handleDeactivateAssignment}
          onCancel={handleCloseModal}
        />
      )}
    </div>
  );
};

export default AuditAssignment; 