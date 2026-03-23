import React, { useState, useEffect } from 'react';
import authService from '../../services/authService';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Modal from '../ui/Modal';
import ErrorDisplay from '../ui/ErrorDisplay';
import LoadingSpinner from '../ui/LoadingSpinner';
import { FormField } from '../forms/FormField';
// Production-safe notification hook
const useNotification = () => ({
  showNotification: (message: string, type: 'success' | 'error') => {
    // Only log errors in production for debugging
    if (type === 'error') {
      console.error('Performance Goal Error:', message);
    }
    // TODO: Integrate with proper notification system (toast, snackbar, etc.)
  }
});

// Helper function to get secure headers
const getSecureHeaders = () => {
  const token = authService.getToken();
  if (!token) {
    throw new Error('Authentication token not found. Please log in again.');
  }
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
};

// Enhanced Performance Goal API - using existing implementation
const enhancedPerformanceGoalAPI = {
  getAll: async (queryString?: string) => {
    try {
      const url = queryString ? `/api/enhanced-performance-goals?${queryString}` : '/api/enhanced-performance-goals';
      const response = await fetch(url, {
        headers: getSecureHeaders()
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      // Only log in development or for critical errors
      if (process.env.NODE_ENV === 'development') {
        console.error('Error fetching enhanced performance goals:', error);
      }
      throw error;
    }
  },

  create: async (data: any) => {
    try {
      const response = await fetch('/api/enhanced-performance-goals', {
        method: 'POST',
        headers: getSecureHeaders(),
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error creating enhanced performance goal:', error);
      }
      throw error;
    }
  },

  update: async (id: number, data: any) => {
    try {
      const response = await fetch(`/api/enhanced-performance-goals/${id}`, {
        method: 'PUT',
        headers: getSecureHeaders(),
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error updating enhanced performance goal:', error);
      }
      throw error;
    }
  },

  // New method to get form options efficiently
  getFormOptions: async () => {
    try {
      const response = await fetch('/api/enhanced-performance-goals/options/forms', {
        headers: getSecureHeaders()
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error fetching form options:', error);
      }
      throw error;
    }
  }
};
import userService from '../../services/userService';
import type { User, Department } from '../../services/userService';

interface EnhancedPerformanceGoal {
  id: number;
  goal_type: 'QA_SCORE';
  target_value: number;
  scope: 'GLOBAL' | 'DEPARTMENT' | 'USER' | 'MULTI_USER' | 'MULTI_DEPARTMENT';
  start_date: string;
  end_date: string | null;
  target_scope: 'ALL_QA' | 'FORM' | 'CATEGORY' | 'QUESTION';
  target_form_id: number | null;
  target_category_id: number | null;
  target_question_id: number | null;
  description: string | null;
  is_active: boolean;
  assigned_users?: Array<{
    user_id: number;
    user_name: string;
  }>;
  assigned_departments?: Array<{
    department_id: number;
    department_name: string;
  }>;
}

interface FormData {
  goal_type: 'QA_SCORE';
  target_value: number;
  scope: 'GLOBAL' | 'DEPARTMENT' | 'USER' | 'MULTI_USER' | 'MULTI_DEPARTMENT';
  start_date: string;
  end_date: string | null;
  target_scope: 'ALL_QA' | 'FORM' | 'CATEGORY' | 'QUESTION';
  target_form_id: number | null;
  target_category_id: number | null;
  target_question_id: number | null;
  description: string;
  user_ids: number[];
  department_ids: number[];
  is_active: boolean;
}

// Using User and Department from userService

interface FormOption {
  id: number;
  form_name: string;
  categories: CategoryOption[];
}

interface CategoryOption {
  id: number;
  category_name: string;
  questions: QuestionOption[];
}

interface QuestionOption {
  id: number;
  question_text: string;
}

interface Props {
  open: boolean;
  goal: EnhancedPerformanceGoal | null;
  onClose: () => void;
  onSubmit: () => void;
}

export const EnhancedPerformanceGoalForm: React.FC<Props> = ({
  open,
  goal,
  onClose,
  onSubmit
}) => {
  const [formData, setFormData] = useState<FormData>({
    goal_type: 'QA_SCORE',
    target_value: 90,
    scope: 'GLOBAL',
    start_date: new Date().toISOString().split('T')[0],
    end_date: null,
    target_scope: 'ALL_QA',
    target_form_id: null,
    target_category_id: null,
    target_question_id: null,
    description: '',
    user_ids: [],
    department_ids: [],
    is_active: true
  });

  const [loading, setLoading] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [options, setOptions] = useState({
    forms: [] as FormOption[],
    users: [] as User[],
    departments: [] as Department[]
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [hasEndDate, setHasEndDate] = useState(false);

  const { showNotification } = useNotification();

  // Load options data
  useEffect(() => {
    const loadOptions = async () => {
      // Prevent multiple simultaneous loads
      if (optionsLoading || !open) return;
      
      // Don't reload if we already have data
      if (options.forms.length > 0 && options.users.length > 0 && options.departments.length > 0) {
        return;
      }

      try {
        setOptionsLoading(true);
        
        // Load all options in parallel using the optimized endpoints
        const [formsResponse, usersResponse, departmentsRes] = await Promise.all([
          enhancedPerformanceGoalAPI.getFormOptions(), // Use the optimized endpoint
          userService.getUsers(1, 100), // Get all users with reasonable limit
          userService.getDepartments()
        ]);
        
        const finalOptions = {
          forms: Array.isArray(formsResponse) ? formsResponse : [],
          users: (usersResponse.items || []).filter((user: any) => 
            user.is_active && user.role_id === 3 // Only active CSRs
          ),
          departments: (departmentsRes || []).filter((dept: any) => 
            dept.is_active // Only active departments
          )
        };
        
        setOptions(finalOptions);
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Error loading options:', error);
        }
        showNotification('Failed to load form options', 'error');
      } finally {
        setOptionsLoading(false);
      }
    };

    if (open) {
      loadOptions();
    }
  }, [open]); // Removed showNotification from dependencies to prevent loops

  // Initialize form data when goal prop changes
  useEffect(() => {
    if (goal && open) {
      const user_ids = goal.assigned_users?.map(u => u.user_id) || [];
      const department_ids = goal.assigned_departments?.map(d => d.department_id) || [];
      
      // Format date for HTML input
      const formatDateForInput = (dateString: string | null): string => {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toISOString().split('T')[0];
      };
      
      setFormData({
        goal_type: goal.goal_type,
        target_value: goal.target_value,
        scope: goal.scope,
        start_date: formatDateForInput(goal.start_date),
        end_date: goal.end_date ? formatDateForInput(goal.end_date) : null,
        target_scope: goal.target_scope,
        target_form_id: goal.target_form_id,
        target_category_id: goal.target_category_id,
        target_question_id: goal.target_question_id,
        description: goal.description || '',
        user_ids: user_ids,
        department_ids: department_ids,
        is_active: goal.is_active
      });
      setHasEndDate(!!goal.end_date);
    } else if (open) {
      // Reset form for new goal
      setFormData({
        goal_type: 'QA_SCORE',
        target_value: 90,
        scope: 'GLOBAL',
        start_date: new Date().toISOString().split('T')[0],
        end_date: null,
        target_scope: 'ALL_QA',
        target_form_id: null,
        target_category_id: null,
        target_question_id: null,
        description: '',
        user_ids: [],
        department_ids: [],
        is_active: true
      });
      setHasEndDate(false);
    }
  }, [goal, open]); // Added open to reset form when modal opens without a goal

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setErrors({});
      setTouched({});
      setLoading(false);
      setOptionsLoading(false);
    }
  }, [open]);

  // Validation function
  const validateField = (name: string, value: any): string => {
    switch (name) {
      case 'target_value':
        if (!value || value <= 0) {
          return 'Target value is required and must be greater than 0';
        }
        if (value > 100) {
          return 'Target value cannot exceed 100%';
        }
        if (!Number.isInteger(Number(value))) {
          return 'Target value must be a whole number';
        }
        break;
      case 'start_date':
        if (!value) {
          return 'Start date is required';
        }
        break;
      case 'end_date':
        if (hasEndDate && value && formData.start_date >= value) {
          return 'End date must be after start date';
        }
        break;
      case 'user_ids':
        if (['USER', 'MULTI_USER'].includes(formData.scope) && (!value || value.length === 0)) {
          return 'At least one user must be selected for user scope';
        }
        break;
      case 'department_ids':
        if (['DEPARTMENT', 'MULTI_DEPARTMENT'].includes(formData.scope) && (!value || value.length === 0)) {
          return 'At least one department must be selected for department scope';
        }
        break;
      case 'target_form_id':
        if (formData.target_scope === 'FORM' && !value) {
          return 'Form selection is required for form target scope';
        }
        break;
      case 'target_category_id':
        if (formData.target_scope === 'CATEGORY' && !value) {
          return 'Category selection is required for category target scope';
        }
        break;
      case 'target_question_id':
        if (formData.target_scope === 'QUESTION' && !value) {
          return 'Question selection is required for question target scope';
        }
        break;
    }
    return '';
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    let processedValue: any = value;

    if (type === 'number') {
      if (name === 'target_value') {
        // Ensure target_value is always a whole number
        processedValue = value ? Math.round(Number(value)) : '';
      } else {
        processedValue = value ? Number(value) : '';
      }
    } else if (type === 'checkbox') {
      processedValue = (e.target as HTMLInputElement).checked;
    }

    setFormData(prev => ({
      ...prev,
      [name]: processedValue
    }));

    // Validate field
    const fieldError = validateField(name, processedValue);
    setErrors(prev => ({
      ...prev,
      [name]: fieldError
    }));
  };

  // Handle field blur
  const handleBlur = (name: string) => {
    setTouched(prev => ({
      ...prev,
      [name]: true
    }));
  };

  const handleInputChange = (field: keyof FormData, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    
    // Clear related errors
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
    
    // Validate field
    const fieldError = validateField(field, value);
    setErrors(prev => ({
      ...prev,
      [field]: fieldError
    }));
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    
    // Validate all fields
    Object.keys(formData).forEach(key => {
      const fieldError = validateField(key, (formData as any)[key]);
      if (fieldError) newErrors[key] = fieldError;
    });

    setErrors(newErrors);
    setTouched({
      target_value: true,
      start_date: true,
      end_date: true,
      user_ids: true,
      department_ids: true,
      target_form_id: true,
      target_category_id: true,
      target_question_id: true
    });

    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;

    try {
      setLoading(true);

      const submitData = {
        ...formData,
        end_date: hasEndDate ? formData.end_date : null
      };

      if (goal) {
        await enhancedPerformanceGoalAPI.update(goal.id, submitData);
        showNotification('Performance goal updated successfully', 'success');
      } else {
        await enhancedPerformanceGoalAPI.create(submitData);
        showNotification('Performance goal created successfully', 'success');
      }

      onSubmit();
    } catch (error: any) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error submitting goal:', error);
      }
      showNotification(
        error.response?.data?.message || 'Failed to save performance goal',
        'error'
      );
    } finally {
      setLoading(false);
    }
  };

  const getAvailableCategories = (): CategoryOption[] => {
    if (!formData.target_form_id || !Array.isArray(options.forms)) {
      return [];
    }
    
    const selectedForm = options.forms.find(f => f.id === formData.target_form_id);
    return Array.isArray(selectedForm?.categories) ? selectedForm.categories : [];
  };

  const getAvailableQuestions = (): QuestionOption[] => {
    if (!formData.target_category_id) return [];
    const availableCategories = getAvailableCategories();
    if (!Array.isArray(availableCategories)) return [];
    const selectedCategory = availableCategories.find(c => c.id === formData.target_category_id);
    return Array.isArray(selectedCategory?.questions) ? selectedCategory.questions : [];
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={goal ? 'Edit Performance Goal' : 'Create Performance Goal'}
      size="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        {/* Loading State */}
        {optionsLoading && (
          <div className="flex items-center justify-center py-8">
            <LoadingSpinner />
            <span className="ml-2 text-gray-600">Loading form options...</span>
          </div>
        )}

        {!optionsLoading && (
          <>
            {/* Basic Information Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b border-gray-200 pb-2">
                Basic Information
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  name="target_value"
                  type="number"
                  label="Target Value (%)"
                  value={formData.target_value}
                  onChange={handleChange}
                  onBlur={() => handleBlur('target_value')}
                  error={errors.target_value}
                  touched={touched.target_value}
                  required
                  min={1}
                  max={100}
                  step={1}
                  disabled={loading}
                />

                <FormField
                  name="scope"
                  type="select"
                  label="Scope"
                  value={formData.scope}
                  onChange={handleChange}
                  onBlur={() => handleBlur('scope')}
                  error={errors.scope}
                  touched={touched.scope}
                  required
                  disabled={loading}
                  options={[
                    { value: 'GLOBAL', label: 'Global' },
                    { value: 'USER', label: 'Single User' },
                    { value: 'MULTI_USER', label: 'Multiple Users' },
                    { value: 'DEPARTMENT', label: 'Single Department' },
                    { value: 'MULTI_DEPARTMENT', label: 'Multiple Departments' }
                  ]}
                />
              </div>

              {/* Date Fields Row */}
              <div className={`grid gap-4 ${hasEndDate ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1 md:grid-cols-2'}`}>
                <FormField
                  name="start_date"
                  type="date"
                  label="Start Date"
                  value={formData.start_date}
                  onChange={handleChange}
                  onBlur={() => handleBlur('start_date')}
                  error={errors.start_date}
                  touched={touched.start_date}
                  required
                  disabled={loading}
                />

                {hasEndDate && (
                  <FormField
                    name="end_date"
                    type="date"
                    label="End Date"
                    value={formData.end_date || ''}
                    onChange={handleChange}
                    onBlur={() => handleBlur('end_date')}
                    error={errors.end_date}
                    touched={touched.end_date}
                    disabled={loading}
                  />
                )}

                <div className="space-y-2">
                  <label className="flex items-center h-10 mt-6">
                    <input
                      type="checkbox"
                      checked={hasEndDate}
                      onChange={(e) => {
                        setHasEndDate(e.target.checked);
                        if (!e.target.checked) {
                          handleInputChange('end_date', null);
                        }
                      }}
                      disabled={loading}
                      className="h-5 w-5 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                    />
                    <span className="ml-2 text-sm font-medium text-gray-700">Set End Date</span>
                  </label>
                </div>
              </div>

              <FormField
                name="description"
                type="text"
                label="Description"
                value={formData.description}
                onChange={handleChange}
                onBlur={() => handleBlur('description')}
                error={errors.description}
                touched={touched.description}
                placeholder="Optional description..."
                disabled={loading}
              />
            </div>

            {/* Target Scope Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900 border-b border-gray-200 pb-2">
                Target Scope
              </h3>
              
              <FormField
                name="target_scope"
                type="select"
                label="Target Type"
                value={formData.target_scope}
                onChange={(e) => {
                  handleChange(e);
                  // Reset dependent fields
                  handleInputChange('target_form_id', null);
                  handleInputChange('target_category_id', null);
                  handleInputChange('target_question_id', null);
                }}
                onBlur={() => handleBlur('target_scope')}
                error={errors.target_scope}
                touched={touched.target_scope}
                required
                disabled={loading}
                options={[
                  { value: 'ALL_QA', label: 'All QA Reviews' },
                  { value: 'FORM', label: 'Specific Form' },
                  { value: 'CATEGORY', label: 'Specific Category' },
                  { value: 'QUESTION', label: 'Specific Question' }
                ]}
              />

              {formData.target_scope !== 'ALL_QA' && (
                <FormField
                  name="target_form_id"
                  type="select"
                  label="Form"
                  value={formData.target_form_id?.toString() || ''}
                  onChange={(e) => {
                    const value = e.target.value ? Number(e.target.value) : null;
                    handleInputChange('target_form_id', value);
                    handleInputChange('target_category_id', null);
                    handleInputChange('target_question_id', null);
                  }}
                  onBlur={() => handleBlur('target_form_id')}
                  error={errors.target_form_id}
                  touched={touched.target_form_id}
                  required={['FORM', 'CATEGORY', 'QUESTION'].includes(formData.target_scope)}
                  disabled={loading}
                  options={[
                    { value: '', label: 'Select a form...' },
                    ...(Array.isArray(options.forms) ? options.forms.map(form => ({
                      value: form.id.toString(),
                      label: form.form_name
                    })) : [])
                  ]}
                />
              )}

              {(formData.target_scope === 'CATEGORY' || formData.target_scope === 'QUESTION') && (
                <FormField
                  name="target_category_id"
                  type="select"
                  label="Category"
                  value={formData.target_category_id?.toString() || ''}
                  onChange={(e) => {
                    const value = e.target.value ? Number(e.target.value) : null;
                    handleInputChange('target_category_id', value);
                    handleInputChange('target_question_id', null);
                  }}
                  onBlur={() => handleBlur('target_category_id')}
                  error={errors.target_category_id}
                  touched={touched.target_category_id}
                  required
                  disabled={loading || !formData.target_form_id}
                  options={[
                    { value: '', label: 'Select a category...' },
                    ...(Array.isArray(getAvailableCategories()) ? getAvailableCategories().map(category => ({
                      value: category.id.toString(),
                      label: category.category_name
                    })) : [])
                  ]}
                />
              )}

              {formData.target_scope === 'QUESTION' && (
                <FormField
                  name="target_question_id"
                  type="select"
                  label="Question"
                  value={formData.target_question_id?.toString() || ''}
                  onChange={(e) => {
                    const value = e.target.value ? Number(e.target.value) : null;
                    handleInputChange('target_question_id', value);
                  }}
                  onBlur={() => handleBlur('target_question_id')}
                  error={errors.target_question_id}
                  touched={touched.target_question_id}
                  required
                  disabled={loading || !formData.target_category_id}
                  options={[
                    { value: '', label: 'Select a question...' },
                    ...(Array.isArray(getAvailableQuestions()) ? getAvailableQuestions().map(question => ({
                      value: question.id.toString(),
                      label: question.question_text.length > 100 
                        ? question.question_text.substring(0, 100) + '...'
                        : question.question_text
                    })) : [])
                  ]}
                />
              )}
            </div>

            {/* Assignment Section */}
            {formData.scope !== 'GLOBAL' && (
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-gray-900 border-b border-gray-200 pb-2">
                  Assignments
                </h3>
                
                {['USER', 'MULTI_USER'].includes(formData.scope) && (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Select Users {['USER'].includes(formData.scope) && '(Select one)'}
                    </label>
                    <div 
                      className="overflow-y-auto border border-gray-300 rounded-md p-4 bg-gray-50"
                      style={{ height: '160px', minHeight: '160px', maxHeight: '160px', display: 'block' }}
                    >
                      {(Array.isArray(options.users) ? options.users : []).map(user => {
                        const isSelected = formData.user_ids.includes(user.id);
                        return (
                            <label 
                              key={user.id} 
                              className={`flex items-center cursor-pointer p-3 rounded-md transition-colors ${
                                isSelected 
                                  ? 'bg-indigo-100 border-indigo-200 border' 
                                  : 'hover:bg-gray-100'
                              }`}
                            >
                              <input
                                type={formData.scope === 'USER' ? 'radio' : 'checkbox'}
                                name="user_selection"
                                value={user.id}
                                checked={isSelected}
                                onChange={(e) => {
                                  if (formData.scope === 'USER') {
                                    handleInputChange('user_ids', e.target.checked ? [user.id] : []);
                                  } else {
                                    const newIds = e.target.checked
                                      ? [...formData.user_ids, user.id]
                                      : formData.user_ids.filter(id => id !== user.id);
                                    handleInputChange('user_ids', newIds);
                                  }
                                }}
                                disabled={loading}
                                className="h-5 w-5 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded mr-1"
                              />
                              <span className={`ml-2 text-sm ${
                                isSelected ? 'text-indigo-800 font-medium' : 'text-gray-700'
                              }`}>
                                {user.username} - {user.email}
                                {user.department_name && (
                                  <span className="text-gray-500"> ({user.department_name})</span>
                                )}
                              </span>
                            </label>
                          );
                        })}
                    </div>
                    {errors.user_ids && (
                      <p className="text-sm text-red-600">{errors.user_ids}</p>
                    )}
                  </div>
                )}

                {['DEPARTMENT', 'MULTI_DEPARTMENT'].includes(formData.scope) && (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Select Departments {['DEPARTMENT'].includes(formData.scope) && '(Select one)'}
                    </label>
                    <div 
                      className="overflow-y-auto border border-gray-300 rounded-md p-4 bg-gray-50"
                      style={{ height: '160px', minHeight: '160px', maxHeight: '160px', display: 'block' }}
                    >
                      {(Array.isArray(options.departments) ? options.departments : []).map(dept => {
                        const isSelected = formData.department_ids.includes(dept.id);
                        return (
                          <label 
                            key={dept.id} 
                            className={`flex items-center cursor-pointer p-3 rounded-md transition-colors ${
                              isSelected 
                                ? 'bg-indigo-100 border-indigo-200 border' 
                                : 'hover:bg-gray-100'
                            }`}
                          >
                            <input
                              type={formData.scope === 'DEPARTMENT' ? 'radio' : 'checkbox'}
                              name="department_selection"
                              value={dept.id}
                              checked={isSelected}
                              onChange={(e) => {
                                if (formData.scope === 'DEPARTMENT') {
                                  handleInputChange('department_ids', e.target.checked ? [dept.id] : []);
                                } else {
                                  const newIds = e.target.checked
                                    ? [...formData.department_ids, dept.id]
                                    : formData.department_ids.filter(id => id !== dept.id);
                                  handleInputChange('department_ids', newIds);
                                }
                              }}
                              disabled={loading}
                              className="h-5 w-5 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded mr-1"
                            />
                            <span className={`ml-2 text-sm ${
                              isSelected ? 'text-indigo-800 font-medium' : 'text-gray-700'
                            }`}>
                              {dept.department_name}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {errors.department_ids && (
                      <p className="text-sm text-red-600">{errors.department_ids}</p>
                    )}
                  </div>
                )}
              </div>
            )}


          </>
        )}

        {/* Form Actions */}
        <div className="flex justify-between items-center pt-4 border-t border-gray-200">
          {/* Left side - Destructive actions (only when editing) */}
          {goal && (
            <div className="flex space-x-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleInputChange('is_active', !formData.is_active)}
                disabled={loading || optionsLoading}
                className={formData.is_active ? 'text-amber-600 hover:text-amber-700' : 'text-green-600 hover:text-green-700'}
              >
                {formData.is_active ? 'Deactivate' : 'Activate'}
              </Button>
            </div>
          )}
          
          {/* Right side - Primary actions */}
          <div className="flex space-x-3">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={loading || optionsLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={loading || optionsLoading}
              loading={loading}
            >
              {goal ? 'Update Goal' : 'Create Goal'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}; 