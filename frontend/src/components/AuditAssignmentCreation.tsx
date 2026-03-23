import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { HiOutlineChevronLeft } from 'react-icons/hi';
import type { 
  AuditAssignmentCreateDTO 
} from '../services/auditAssignmentService';
import auditAssignmentService from '../services/auditAssignmentService';
import type { FormListItem } from '../types/form.types';
import type { User } from '../services/userService';
import type { Department } from '../services/departmentService';
import userService from '../services/userService';
import * as formService from '../services/formService';
import departmentService from '../services/departmentService';
import { useAuth } from '../contexts/AuthContext';

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
                className="h-[17px] w-[17px] text-[#00aeef] focus:ring-[#00aeef] border-gray-300"
              />
              <span className="ml-2.5 block text-base text-gray-700">User (CSR)</span>
            </label>
            <label className="inline-flex items-center">
              <input
                type="radio"
                name="target_type"
                value="DEPARTMENT"
                checked={formData.target_type === 'DEPARTMENT'}
                onChange={handleTargetTypeChange}
                className="h-[17px] w-[17px] text-[#00aeef] focus:ring-[#00aeef] border-gray-300"
              />
              <span className="ml-2.5 block text-base text-gray-700">Department</span>
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

// Main Audit Assignment Creation Component
const AuditAssignmentCreation: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [forms, setForms] = useState<FormListItem[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [qaAnalysts, setQaAnalysts] = useState<User[]>([]);
  const [pendingAssignments, setPendingAssignments] = useState<Array<AuditAssignmentCreateDTO & { formName: string; targetName: string; qaName?: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

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
      
      // Make sure the user is logged in
      if (!user) {
        alert('Your session appears to have expired. Please log in again.');
        navigate('/login');
        return;
      }
      
      // Extract only the DTO fields (remove formName, targetName, etc.)
      // Don't include created_by - backend will use the authenticated user from JWT
      const assignmentsToSave = pendingAssignments.map(({ formName, targetName, qaName, ...rest }) => rest);
      
      console.log('User context:', user);
      console.log('Saving assignments:', assignmentsToSave);
      
      // Try the actual API call
      const response = await auditAssignmentService.createAuditAssignments(assignmentsToSave);
      console.log('API response:', response);
      
      // Navigate back to the assignments list on success
      navigate('/admin/audit-assignments');
    } catch (error: any) {
      console.error('Error saving assignments:', error);
      
      // More detailed error logging
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
        
        // Handle authentication errors
        if (error.response.status === 401) {
          alert('Your session has expired. Please log in again.');
          navigate('/login');
          return;
        }
      }
      
      // Show error message
      alert(`Error: ${error.message || 'Failed to save assignments'}`);
      setIsLoading(false);
    }
  };

  const handleClearForm = () => {
    // This is handled in the AssignmentForm component
  };

  if (isLoading && forms.length === 0) {
    return (
      <div className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Create Audit Assignments</h1>
          <button
            onClick={() => navigate('/admin/audit-assignments')}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors flex items-center"
          >
            <svg className="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Assignments
          </button>
        </div>
        
        <div className="flex items-center justify-center h-64 bg-white rounded-lg shadow-md">
          <div className="w-10 h-10 border-4 border-gray-300 rounded-full animate-spin border-t-indigo-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Create Audit Assignments</h1>
        <button
          onClick={() => navigate('/admin/audit-assignments')}
          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors flex items-center"
        >
          <svg className="h-5 w-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Assignments
        </button>
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
    </div>
  );
};

export default AuditAssignmentCreation; 