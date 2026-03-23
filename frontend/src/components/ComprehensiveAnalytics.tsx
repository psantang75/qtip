import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import {
  HiOutlineChartBar,
  HiOutlineAdjustmentsHorizontal,
  HiOutlineDocumentArrowDown,
  HiOutlineEye,
  HiOutlineEyeSlash,
  HiArrowPath,
  HiOutlineCalendar,
  HiOutlineUsers,
  HiOutlineDocumentText,
  HiOutlineQuestionMarkCircle,
  HiOutlineTag,
  HiOutlinePlay,
  HiOutlineClipboardDocumentList,
  HiOutlineChartBarSquare,
  HiOutlineTableCells,
  HiOutlineInformationCircle,
  HiOutlineChevronDown
} from 'react-icons/hi2';
import { useAuth } from '../contexts/AuthContext';
import { usePersistentFilters } from '../hooks/useLocalStorage';

// Import our design system components
import Button from './ui/Button';
import Card from './ui/Card';
import LoadingSpinner from './ui/LoadingSpinner';
import ErrorDisplay from './ui/ErrorDisplay';

// Types for the comprehensive reporting system
interface FilterOptions {
  departments: Array<{ id: number; department_name: string }>;
  forms: Array<{ id: number; form_name: string; user_version?: number; user_version_date?: string; is_active?: boolean }>;
  csrs: Array<{ id: number; username: string; department_id: number | null }>;
  categories: Array<{ id: number; name: string; form_id: number }>;
  questions: Array<{ id: number; name: string; form_id: number; category_id: number; question_type?: string; yes_value?: number }>;
  datePresets: Array<{ id: string; name: string }>;
}

interface ReportFilters {
  reportType: 'raw_scores' | 'summary';
  startDate: string;
  endDate: string;
  departmentIds?: number[];
  csrIds?: number[];
  formIds?: string[]; // Changed to array of composite keys
  categoryId?: number;
  questionId?: number;
  includeQuestionBreakdown?: boolean;
  includeCategoryBreakdown?: boolean;
}

interface ReportData {
  [key: string]: any;
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#00aeef', '#06B6D4', '#84CC16', '#F97316'];

const ComprehensiveAnalytics: React.FC = () => {
  const { user } = useAuth();
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    departments: [],
    forms: [],
    csrs: [],
    categories: [],
    questions: [],
    datePresets: []
  });

  const [filters, setFilters, clearFilters] = usePersistentFilters<ReportFilters>(
    'ComprehensiveAnalytics',
    () => ({
      reportType: 'summary',
      startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
      includeQuestionBreakdown: false,
      includeCategoryBreakdown: false
    }),
    user?.id
  );

  // Refresh stale date ranges on mount if they're older than 1 day
  React.useEffect(() => {
    const now = new Date();
    const filterEndDate = new Date(filters.endDate);
    const daysDiff = Math.floor((now.getTime() - filterEndDate.getTime()) / (1000 * 60 * 60 * 24));
    
    // If date range is stale (more than 1 day old), refresh with current dates
    if (daysDiff >= 1) {
      setFilters(prev => ({
        ...prev,
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0]
      }));
    }
  }, []); // Only run on mount

  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(true);
  const [departmentDropdownOpen, setDepartmentDropdownOpen] = useState(false);
  const [csrDropdownOpen, setCsrDropdownOpen] = useState(false);
  const [formDropdownOpen, setFormDropdownOpen] = useState(false);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Load filter options on component mount
  useEffect(() => {
    loadFilterOptions();
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest('.dropdown-container')) {
        setDepartmentDropdownOpen(false);
        setCsrDropdownOpen(false);
        setFormDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const loadFilterOptions = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/analytics/filters', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (!response.ok) {
        throw new Error('Failed to load filter options');
      }
      
      const data = await response.json();
      setFilterOptions(data);
    } catch (error) {
      console.error('Error loading filter options:', error);
      setError('Failed to load filter options');
    }
  };

  // Utility to get a cookie value by name
  function getCookie(name: string): string | undefined {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop()?.split(';').shift();
  }

  const generateReport = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const token = localStorage.getItem('token');
      const csrfToken = getCookie('XSRF-TOKEN');
      
      // Parse composite keys to get form criteria
      let formIds: number[] = [];
      if (filters.formIds && filters.formIds.length > 0) {
        console.log('[COMPREHENSIVE ANALYTICS] Processing formIds:', filters.formIds);
        console.log('[COMPREHENSIVE ANALYTICS] Available forms:', filterOptions.forms);
        
        // Process each selected form composite key
        filters.formIds.forEach(compositeKey => {
          // Check if it's a composite key (contains double pipe and version info)
          if (compositeKey.includes('||')) {
            console.log('[COMPREHENSIVE ANALYTICS] Processing composite key:', compositeKey);
            // Split by the LAST double pipe to separate form name from version
            const lastDashIndex = compositeKey.lastIndexOf('||');
            const formName = compositeKey.substring(0, lastDashIndex);
            const userVersion = compositeKey.substring(lastDashIndex + 2);
            const version = userVersion === 'no-version' ? null : userVersion;
            
            console.log('[COMPREHENSIVE ANALYTICS] Parsed composite key:', {
              formName,
              userVersion,
              version
            });
            
            // Find all forms that match the criteria
            const matchingForms = filterOptions.forms.filter(form => 
              form.form_name === formName &&
              (form.user_version || null) === (version ? parseInt(version) : null)
            );
            
            console.log('[COMPREHENSIVE ANALYTICS] Matching forms found:', matchingForms);
            
            formIds.push(...matchingForms.map(form => form.id));
          }
        });
      }
      
      console.log('[COMPREHENSIVE ANALYTICS] Final formIds array:', formIds);
      
      // Resolve category IDs - if a category is selected, find ALL matching categories across all form instances
      let categoryIds: number[] | undefined = undefined;
      if (filters.categoryId && formIds.length > 0) {
        const selectedCategory = filterOptions.categories.find(cat => cat.id === filters.categoryId);
        if (selectedCategory) {
          // Find all categories with the same name across all matching forms
          categoryIds = filterOptions.categories
            .filter(cat => 
              formIds.includes(cat.form_id) && 
              cat.name === selectedCategory.name
            )
            .map(cat => cat.id);
          console.log('[COMPREHENSIVE ANALYTICS] Resolved category IDs:', categoryIds);
        }
      }
      
      // Resolve question IDs - if a question is selected, find ALL matching questions across all categories
      let questionIds: number[] | undefined = undefined;
      if (filters.questionId && categoryIds && categoryIds.length > 0) {
        const selectedQuestion = filterOptions.questions.find(q => q.id === filters.questionId);
        if (selectedQuestion) {
          // Find all questions with the same name across all matching categories
          questionIds = filterOptions.questions
            .filter(q => 
              categoryIds!.includes(q.category_id) && 
              q.name === selectedQuestion.name
            )
            .map(q => q.id);
          console.log('[COMPREHENSIVE ANALYTICS] Resolved question IDs:', questionIds);
        }
      }
      
      // Create enhanced filters with all matching IDs
      const enhancedFilters = {
        ...filters,
        formIds: formIds, // Send array of form IDs
        categoryIds: categoryIds, // Send array of category IDs (if applicable)
        questionIds: questionIds // Send array of question IDs (if applicable)
      };
      
      console.log('[COMPREHENSIVE ANALYTICS] Enhanced filters:', enhancedFilters);
      
      const response = await fetch('/api/analytics/comprehensive-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-XSRF-TOKEN': csrfToken || ''
        },
        body: JSON.stringify(enhancedFilters),
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to generate report');
      }
      
      const data = await response.json();
      console.log('[COMPREHENSIVE ANALYTICS] Response data:', data);
      console.log('[COMPREHENSIVE ANALYTICS] Submissions:', data.submissions);
      console.log('[COMPREHENSIVE ANALYTICS] Total count:', data.totalCount);
      setReportData(data);
    } catch (error) {
      console.error('Error generating report:', error);
      setError('Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (field: keyof ReportFilters, value: any) => {
    setFilters(prev => ({
      ...prev,
      [field]: value
    }));
    // Clear report data when filters change
    setReportData(null);
    setError(null);
    // Reset sort when filters change
    setSortColumn(null);
    setSortDirection('asc');
  };

  const handleDatePreset = (preset: string) => {
    const now = new Date();
    const ranges: Record<string, { startDate: string; endDate: string }> = {
      'last7days': {
        startDate: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: now.toISOString().split('T')[0]
      },
      'last30days': {
        startDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: now.toISOString().split('T')[0]
      },
      'last90days': {
        startDate: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: now.toISOString().split('T')[0]
      },
      'thisMonth': {
        startDate: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0],
        endDate: now.toISOString().split('T')[0]
      },
      'lastMonth': {
        startDate: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0],
        endDate: new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0]
      },
      'thisYear': {
        startDate: new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0],
        endDate: now.toISOString().split('T')[0]
      }
    };
    
    if (ranges[preset]) {
      setFilters(prev => ({
        ...prev,
        ...ranges[preset]
      }));
      // Clear report data when date preset changes
      setReportData(null);
      setError(null);
    }
  };

  const handleMultiSelectChange = (field: 'csrIds' | 'departmentIds', selectedId: number) => {
    const currentValues = filters[field] || [];
    const updatedValues = currentValues.includes(selectedId)
      ? currentValues.filter(id => id !== selectedId)
      : [...currentValues, selectedId];
    
    handleFilterChange(field, updatedValues);
    // Clear report data is already handled by handleFilterChange
  };

  const handleFormMultiSelectChange = (compositeKey: string) => {
    const currentValues = filters.formIds || [];
    const updatedValues = currentValues.includes(compositeKey)
      ? currentValues.filter(key => key !== compositeKey)
      : [...currentValues, compositeKey];
    
    handleFilterChange('formIds', updatedValues);
    // Reset dependent fields when form changes
    if (updatedValues.length === 0) {
      handleFilterChange('categoryId', undefined);
      handleFilterChange('questionId', undefined);
    }
  };

  const getFilteredCSRs = () => {
    // If no departments are selected, show all CSRs
    if (!filters.departmentIds || filters.departmentIds.length === 0) {
      console.log('No departments selected, showing all CSRs:', filterOptions.csrs.length);
      return filterOptions.csrs;
    }
    
    // Filter CSRs to only show those in selected departments
    // Handle null department_id by excluding CSRs without departments when filtering
    const filtered = filterOptions.csrs.filter(csr => 
      csr.department_id && filters.departmentIds?.includes(csr.department_id)
    );
    
    console.log('Departments selected:', filters.departmentIds);
    console.log('All CSRs:', filterOptions.csrs);
    console.log('Filtered CSRs:', filtered);
    
    return filtered;
  };

  const exportReport = async () => {
    if (!reportData) return;
    
    try {
      const token = localStorage.getItem('token');
      const csrfToken = getCookie('XSRF-TOKEN');
      
      // Parse composite keys to get form criteria (same logic as generateReport)
      let formIds: number[] = [];
      if (filters.formIds && filters.formIds.length > 0) {
        console.log('[COMPREHENSIVE ANALYTICS EXPORT] Processing formIds:', filters.formIds);
        
        // Process each selected form composite key
        filters.formIds.forEach(compositeKey => {
          // Check if it's a composite key (contains double pipe and version info)
          if (compositeKey.includes('||')) {
            console.log('[COMPREHENSIVE ANALYTICS EXPORT] Processing composite key:', compositeKey);
            // Split by the LAST double pipe to separate form name from version
            const lastDashIndex = compositeKey.lastIndexOf('||');
            const formName = compositeKey.substring(0, lastDashIndex);
            const userVersion = compositeKey.substring(lastDashIndex + 2);
            const version = userVersion === 'no-version' ? null : userVersion;
            
            // Find all forms that match the criteria
            const matchingForms = filterOptions.forms.filter(form => 
              form.form_name === formName &&
              (form.user_version || null) === (version ? parseInt(version) : null)
            );
            
            formIds.push(...matchingForms.map(form => form.id));
            console.log('[COMPREHENSIVE ANALYTICS EXPORT] Extracted form IDs:', formIds);
          }
        });
      }
      
      // Resolve category IDs
      let categoryIds: number[] | undefined = undefined;
      if (filters.categoryId && formIds.length > 0) {
        const selectedCategory = filterOptions.categories.find(cat => cat.id === filters.categoryId);
        if (selectedCategory) {
          categoryIds = filterOptions.categories
            .filter(cat => 
              formIds.includes(cat.form_id) && 
              cat.name === selectedCategory.name
            )
            .map(cat => cat.id);
          console.log('[COMPREHENSIVE ANALYTICS EXPORT] Resolved category IDs:', categoryIds);
        }
      }
      
      // Resolve question IDs
      let questionIds: number[] | undefined = undefined;
      if (filters.questionId && categoryIds && categoryIds.length > 0) {
        const selectedQuestion = filterOptions.questions.find(q => q.id === filters.questionId);
        if (selectedQuestion) {
          questionIds = filterOptions.questions
            .filter(q => 
              categoryIds!.includes(q.category_id) && 
              q.name === selectedQuestion.name
            )
            .map(q => q.id);
          console.log('[COMPREHENSIVE ANALYTICS EXPORT] Resolved question IDs:', questionIds);
        }
      }
      
      // Create enhanced filters with all matching IDs
      const enhancedFilters = {
        ...filters,
        formIds: formIds,
        categoryIds: categoryIds,
        questionIds: questionIds
      };
      
      console.log('[COMPREHENSIVE ANALYTICS EXPORT] Enhanced filters:', enhancedFilters);
      
      const response = await fetch('/api/analytics/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-XSRF-TOKEN': csrfToken || ''
        },
        body: JSON.stringify(enhancedFilters),
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to export report');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      // Format: QTIP_AnalyticsReport_YYYY-MM-DD_HH-MM-SS
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
      const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
      link.download = `QTIP_AnalyticsReport_${dateStr}_${timeStr}.xlsx`;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export report:', error);
      setError('Failed to export report');
    }
  };

  const renderQueryBuilder = () => (
    <div className={`bg-white rounded-lg shadow-sm border transition-all duration-300 ${showFilters ? 'mb-6' : 'mb-2'}`}>
      <div className="p-4 border-b border-gray-100 flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900">
          Query Builder
        </h2>
        <Button
          onClick={() => setShowFilters(!showFilters)}
          variant="ghost"
          size="sm"
        >
          {showFilters ? (
            <HiOutlineEyeSlash className="h-5 w-5" />
          ) : (
            <HiOutlineEye className="h-5 w-5" />
          )}
        </Button>
      </div>

      {showFilters && (
        <div className="p-6 space-y-6">
          {/* Report Type Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">Report Type</label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: 'summary' as const, label: 'Summary Overview', icon: HiOutlineInformationCircle },
                { key: 'raw_scores' as const, label: 'Raw Score Data', icon: HiOutlineTableCells }
              ].map(type => {
                const Icon = type.icon;
                return (
                  <button
                    key={type.key}
                    onClick={() => handleFilterChange('reportType', type.key)}
                    className={`p-3 rounded-lg border-2 text-center transition-all ${
                      filters.reportType === type.key
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-gray-300 text-gray-700'
                    }`}
                  >
                    <Icon className="h-6 w-6 mx-auto mb-2" />
                    <div className="text-sm font-medium">{type.label}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Date Range</label>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => handleFilterChange('startDate', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => handleFilterChange('endDate', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {filterOptions.datePresets
                  .filter(preset => preset.id !== 'thisQuarter')
                  .map(preset => (
                    <button
                      key={preset.id}
                      onClick={() => handleDatePreset(preset.id)}
                      className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
                    >
                      {preset.name}
                    </button>
                  ))}
              </div>
            </div>
          </div>

          {/* Basic Filters */}
          <div>
            <h3 className="text-md font-medium text-gray-800 mb-4">
              Basic Filters
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Department Multi-Select Dropdown */}
              {(user?.role_id === 1 || user?.role_id === 2) && (
                <div className="relative dropdown-container">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Departments
                  </label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setDepartmentDropdownOpen(!departmentDropdownOpen)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white text-left flex items-center justify-between"
                    >
                      <span className="text-gray-700">
                        {!filters.departmentIds || filters.departmentIds.length === 0 ? 
                          'All Departments' : 
                          `${filters.departmentIds.length} department${filters.departmentIds.length > 1 ? 's' : ''} selected`
                        }
                      </span>
                      <HiOutlineChevronDown className={`h-4 w-4 transition-transform ${departmentDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    
                    {departmentDropdownOpen && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                        <div className="p-2">
                          <label className="flex items-center text-sm text-gray-600 hover:bg-gray-50 p-1 rounded">
                            <input
                              type="checkbox"
                              checked={!filters.departmentIds || filters.departmentIds.length === 0}
                              onChange={() => {
                                handleFilterChange('departmentIds', undefined);
                                handleFilterChange('csrIds', undefined);
                              }}
                              className="h-3 w-3 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mr-2"
                            />
                            All Departments
                          </label>
                          {filterOptions.departments.map(dept => (
                            <label key={dept.id} className="flex items-center text-sm hover:bg-gray-50 p-1 rounded">
                              <input
                                type="checkbox"
                                checked={filters.departmentIds?.includes(dept.id) || false}
                                onChange={() => handleMultiSelectChange('departmentIds', dept.id)}
                                className="h-3 w-3 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mr-2"
                              />
                              {dept.department_name}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* CSR Multi-Select Dropdown */}
              <div className="relative dropdown-container">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  CSRs
                </label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setCsrDropdownOpen(!csrDropdownOpen)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white text-left flex items-center justify-between"
                  >
                    <span className="text-gray-700">
                      {!filters.csrIds || filters.csrIds.length === 0 ? 
                        'All CSRs' : 
                        `${filters.csrIds.length} CSR${filters.csrIds.length > 1 ? 's' : ''} selected`
                      }
                    </span>
                    <HiOutlineChevronDown className={`h-4 w-4 transition-transform ${csrDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {csrDropdownOpen && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                      <div className="p-2">
                        <label className="flex items-center text-sm text-gray-600 hover:bg-gray-50 p-1 rounded">
                          <input
                            type="checkbox"
                            checked={!filters.csrIds || filters.csrIds.length === 0}
                            onChange={() => handleFilterChange('csrIds', undefined)}
                            className="h-3 w-3 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mr-2"
                          />
                          All CSRs
                        </label>
                        {getFilteredCSRs().map(csr => (
                          <label key={csr.id} className="flex items-center text-sm hover:bg-gray-50 p-1 rounded">
                            <input
                              type="checkbox"
                              checked={filters.csrIds?.includes(csr.id) || false}
                              onChange={() => handleMultiSelectChange('csrIds', csr.id)}
                              className="h-3 w-3 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mr-2"
                            />
                            {csr.username}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Horizontal Divider */}
          <div className="border-t border-gray-200"></div>

          {/* Form Selection */}
          <div>
            <h3 className="text-md font-medium text-gray-800 mb-4">
              Form Selection
            </h3>
            
            {/* Form Multi-Select Dropdown */}
            <div className="relative dropdown-container mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Forms <span className="text-red-600">*</span> <span className="text-xs text-gray-500">(Required - Select one or more)</span>
              </label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setFormDropdownOpen(!formDropdownOpen)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white text-left flex items-center justify-between"
                >
                  <span className="text-gray-700">
                    {!filters.formIds || filters.formIds.length === 0 ? 
                      'Select Forms *' : 
                      `${filters.formIds.length} form${filters.formIds.length > 1 ? 's' : ''} selected`
                    }
                  </span>
                  <HiOutlineChevronDown className={`h-4 w-4 transition-transform ${formDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                
                {formDropdownOpen && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                    <div className="p-2">
                      {(() => {
                        // Deduplicate forms based on form name, user version, and date
                        const uniqueForms = filterOptions.forms.reduce((acc, form) => {
                          const key = `${form.form_name}||${form.user_version || 'no-version'}`;
                          if (!acc.has(key)) {
                            acc.set(key, form);
                          }
                          return acc;
                        }, new Map());
                        
                        return Array.from(uniqueForms.values()).map(form => {
                          const compositeKey = `${form.form_name}||${form.user_version || 'no-version'}`;
                          const versionInfo = form.user_version ? ` (v${form.user_version}` : '';
                          const dateInfo = form.user_version_date ? ` - ${new Date(form.user_version_date).toLocaleDateString()}` : '';
                          const displayName = `${form.form_name}${versionInfo}${dateInfo}${versionInfo ? ')' : ''}`;
                          
                          return (
                            <label key={form.id} className="flex items-center text-sm hover:bg-gray-50 p-1 rounded">
                              <input
                                type="checkbox"
                                checked={filters.formIds?.includes(compositeKey) || false}
                                onChange={() => handleFormMultiSelectChange(compositeKey)}
                                className="h-3 w-3 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mr-2"
                              />
                              {displayName}
                            </label>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Category Selection (only show if form is selected) */}
            {filters.formIds && filters.formIds.length > 0 && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Category (Optional)
                </label>
                <select
                  value={filters.categoryId || ''}
                  onChange={(e) => {
                    const categoryId = e.target.value ? parseInt(e.target.value) : undefined;
                    handleFilterChange('categoryId', categoryId);
                    // Reset question when category changes
                    handleFilterChange('questionId', undefined);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Categories (Form-level reporting)</option>
                  {(() => {
                    // Parse all selected composite form keys to get the actual form IDs
                    let formIds: number[] = [];
                    if (filters.formIds && filters.formIds.length > 0) {
                      filters.formIds.forEach(compositeKey => {
                        if (compositeKey.includes('||')) {
                          // Split by the LAST double pipe to separate form name from version
                          const lastDashIndex = compositeKey.lastIndexOf('||');
                          const formName = compositeKey.substring(0, lastDashIndex);
                          const userVersion = compositeKey.substring(lastDashIndex + 2);
                          const version = userVersion === 'no-version' ? null : userVersion;
                          
                          // Find all forms that match the criteria
                          const matchingForms = filterOptions.forms.filter(form => 
                            form.form_name === formName &&
                            (form.user_version || null) === (version ? parseInt(version) : null)
                          );
                          
                          formIds.push(...matchingForms.map(form => form.id));
                        }
                      });
                    }
                    
                    // Filter categories by the resolved form IDs and deduplicate by name
                    const categoriesMap = new Map();
                    filterOptions.categories
                      .filter(category => formIds.includes(category.form_id))
                      .forEach(category => {
                        // Use category name as key to deduplicate
                        if (!categoriesMap.has(category.name)) {
                          categoriesMap.set(category.name, category);
                        }
                      });
                    
                    return Array.from(categoriesMap.values()).map(category => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ));
                  })()}
                </select>
              </div>
            )}

            {/* Question Selection (only show if category is selected) */}
            {filters.categoryId && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Question (Optional)
                </label>
                <select
                  value={filters.questionId || ''}
                  onChange={(e) => {
                    const questionId = e.target.value ? parseInt(e.target.value) : undefined;
                    handleFilterChange('questionId', questionId);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Questions (Category-level reporting)</option>
                  {(() => {
                    // Parse all selected composite form keys to get the actual form IDs
                    let formIds: number[] = [];
                    if (filters.formIds && filters.formIds.length > 0) {
                      filters.formIds.forEach(compositeKey => {
                        if (compositeKey.includes('||')) {
                          const lastDashIndex = compositeKey.lastIndexOf('||');
                          const formName = compositeKey.substring(0, lastDashIndex);
                          const userVersion = compositeKey.substring(lastDashIndex + 2);
                          const version = userVersion === 'no-version' ? null : userVersion;
                          
                          const matchingForms = filterOptions.forms.filter(form => 
                            form.form_name === formName &&
                            (form.user_version || null) === (version ? parseInt(version) : null)
                          );
                          
                          formIds.push(...matchingForms.map(form => form.id));
                        }
                      });
                    }
                    
                    // Get the selected category name
                    const selectedCategory = filterOptions.categories.find(cat => cat.id === filters.categoryId);
                    if (!selectedCategory) return [];
                    
                    // Find all matching categories across all selected forms
                    const matchingCategoryIds = filterOptions.categories
                      .filter(cat => 
                        formIds.includes(cat.form_id) && 
                        cat.name === selectedCategory.name
                      )
                      .map(cat => cat.id);
                    
                    // Get questions from all matching categories and deduplicate by name
                    const questionsMap = new Map();
                    filterOptions.questions
                      .filter(question => 
                        matchingCategoryIds.includes(question.category_id) && 
                        question.question_type !== 'SUB_CATEGORY' &&
                        question.question_type !== 'TEXT' &&
                        !(question.question_type === 'YES_NO' && question.yes_value === 0)
                      )
                      .forEach(question => {
                        // Use question name as key to deduplicate
                        if (!questionsMap.has(question.name)) {
                          questionsMap.set(question.name, question);
                        }
                      });
                    
                    return Array.from(questionsMap.values()).map(question => (
                      <option key={question.id} value={question.id}>
                        {question.name}
                      </option>
                    ));
                  })()}
                </select>
              </div>
            )}
          </div>

          {/* Horizontal Divider */}
          <div className="border-t border-gray-200"></div>

          {/* Advanced Options */}
          {filters.reportType === 'raw_scores' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">Advanced Options</label>
              <div className="space-y-2">                
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={filters.includeCategoryBreakdown || false}
                    onChange={(e) => handleFilterChange('includeCategoryBreakdown', e.target.checked)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mr-2"
                  />
                  <span className="text-sm text-gray-700">Include Category-Level Breakdown</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={filters.includeQuestionBreakdown || false}
                    onChange={(e) => handleFilterChange('includeQuestionBreakdown', e.target.checked)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mr-2"
                  />
                  <span className="text-sm text-gray-700">Include Question-Level Breakdown</span>
                </label>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 pt-4 border-t border-gray-100">
            <Button
              onClick={generateReport}
              disabled={loading || !filters.formIds || filters.formIds.length === 0}
              variant="primary"
              size="md"
              leftIcon={loading ? undefined : <HiOutlinePlay className="h-4 w-4" />}
            >
              {loading && <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />}
              Generate Report
            </Button>
            
            <Button
              onClick={clearFilters}
              variant="ghost"
              size="md"
              leftIcon={<HiArrowPath className="h-4 w-4" />}
            >
              Reset Filters
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  const renderResults = () => {
    if (loading) {
      return (
        <Card className="p-12">
          <div className="text-center">
            <LoadingSpinner size="lg" color="primary" className="mx-auto mb-4" />
            <p className="text-gray-500">Generating report...</p>
          </div>
        </Card>
      );
    }

    if (error) {
      return (
        <ErrorDisplay
          variant="card"
          message={error}
          title="Error"
          onDismiss={() => setError(null)}
        />
      );
    }

    if (!reportData) {
      return (
        <div className="bg-white rounded-lg shadow-sm border p-12">
          <div className="text-center text-gray-500">
            <HiOutlineClipboardDocumentList className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium mb-2">No Report Generated</p>
            <p>Configure your query parameters above and click "Generate Report" to view comprehensive analytics.</p>
          </div>
        </div>
      );
    }

    // Render different report types
    switch (filters.reportType) {
      case 'summary':
        return renderSummaryReport();
      case 'raw_scores':
        return renderRawScoresReport();
      default:
        return null;
    }
  };

  const renderSummaryReport = () => {
    // Sort the data
    const sortedSubmissions = sortData(reportData.submissions || []);

    // Sortable header component
    const SortableHeader = ({ column, children }: { column: string; children: React.ReactNode }) => (
      <th 
        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
        onClick={() => handleSort(column)}
      >
        <div className="flex items-center gap-1">
          {children}
          {sortColumn === column && (
            <span className="text-blue-500">
              {sortDirection === 'asc' ? '↑' : '↓'}
            </span>
          )}
        </div>
      </th>
    );

    return (
      <div className="space-y-6">
        {/* Raw Data Table - Moved to Top */}
        {reportData.submissions && reportData.submissions.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold">
                {filters.questionId ? 'Question Scores' : 
                 filters.categoryId ? 'Category Scores' : 
                 filters.formIds && filters.formIds.length > 0 ? 'Form Level Scores' : 
                 'Raw Score Data'}
              </h3>
              <p className="text-sm text-gray-600">Total Records: {reportData.totalCount || reportData.submissions.length}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <SortableHeader column="submission_id">Submission ID</SortableHeader>
                    <SortableHeader column="submission_date">Date</SortableHeader>
                    <SortableHeader column="csr_name">CSR</SortableHeader>
                    <SortableHeader column="form_name">Form</SortableHeader>
                    <SortableHeader column="total_score">Form Score</SortableHeader>
                    {filters.categoryId && !filters.questionId && (
                      <>
                        <SortableHeader column="category_name">Category</SortableHeader>
                        <SortableHeader column="responses">Responses</SortableHeader>
                        <SortableHeader column="category_score">Category Score</SortableHeader>
                      </>
                    )}
                    {filters.questionId && (
                      <>
                        <SortableHeader column="category_name">Category</SortableHeader>
                        <SortableHeader column="category_score">Category Score</SortableHeader>
                        <SortableHeader column="question">Question</SortableHeader>
                        <SortableHeader column="responses">Responses</SortableHeader>
                        <SortableHeader column="question_average_score">Question Score</SortableHeader>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sortedSubmissions.slice(0, 100).map((submission: any, index: number) => (
                    <tr key={`summary-${submission.submission_id}-${index}`} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      #{submission.submission_id}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(submission.submission_date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {submission.csr_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {submission.form_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        submission.total_score >= 90 ? 'bg-green-100 text-green-800' :
                        submission.total_score >= 80 ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {submission.total_score}%
                      </span>
                    </td>
                    {filters.categoryId && !filters.questionId && (
                      <>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {submission.category_name || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {submission.responses !== null && submission.responses !== undefined ? submission.responses : '0'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {submission.category_possible_points === 0 || submission.category_score === null || submission.category_score === undefined ? (
                            <span className="text-gray-500">N/A</span>
                          ) : (
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              submission.category_score >= 90 ? 'bg-green-100 text-green-800' :
                              submission.category_score >= 80 ? 'bg-yellow-100 text-yellow-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {submission.category_score.toFixed(1)}%
                            </span>
                          )}
                        </td>
                      </>
                    )}
                    {filters.questionId && (
                      <>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {submission.category_name || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {submission.category_possible_points === 0 || submission.category_score === null || submission.category_score === undefined ? (
                            <span className="text-gray-500">N/A</span>
                          ) : (
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              submission.category_score >= 90 ? 'bg-green-100 text-green-800' :
                              submission.category_score >= 80 ? 'bg-yellow-100 text-yellow-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {submission.category_score.toFixed(1)}%
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          {submission.question || submission.question_text || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {submission.responses !== null && submission.responses !== undefined ? submission.responses : '0'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            (submission.question_average_score * 100) >= 90 ? 'bg-green-100 text-green-800' :
                            (submission.question_average_score * 100) >= 80 ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {submission.question_average_score !== null && submission.question_average_score !== undefined ? `${(submission.question_average_score * 100).toFixed(1)}%` : '0.0%'}
                          </span>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sortedSubmissions.length > 100 && (
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
              <p className="text-sm text-gray-600">
                Showing first 100 records of {reportData.totalCount || reportData.submissions.length}. Export for complete data.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Score Distribution */}
      {reportData.overview?.scoreDistribution && (
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h3 className="text-lg font-semibold mb-4">Score Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={reportData.overview.scoreDistribution}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="range" />
              <YAxis />
              <Tooltip formatter={(value: any) => [value, 'Count']} />
              <Bar dataKey="count" fill="#3B82F6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

    </div>
    );
  };

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New column, default to ascending
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const sortData = useMemo(() => {
    return (data: any[]) => {
      if (!data || data.length === 0) {
        return data;
      }

      // If no specific column is selected, use default sorting for raw scores
      if (!sortColumn) {
        return [...data].sort((a, b) => {
          // First sort by form_name alphabetically
          const formNameA = String(a.form_name || '').toLowerCase();
          const formNameB = String(b.form_name || '').toLowerCase();
          
          if (formNameA !== formNameB) {
            return formNameA < formNameB ? -1 : formNameA > formNameB ? 1 : 0;
          }
          
          // Then sort by submission_id ascending
          const submissionIdA = parseInt(a.submission_id) || 0;
          const submissionIdB = parseInt(b.submission_id) || 0;
          
          if (submissionIdA !== submissionIdB) {
            return submissionIdA - submissionIdB;
          }
          
          // Then sort by category_name ascending
          const categoryNameA = String(a.category_name || '').toLowerCase();
          const categoryNameB = String(b.category_name || '').toLowerCase();
          
          if (categoryNameA !== categoryNameB) {
            return categoryNameA < categoryNameB ? -1 : categoryNameA > categoryNameB ? 1 : 0;
          }
          
          // Finally sort by question ascending
          const questionA = String(a.question || '').toLowerCase();
          const questionB = String(b.question || '').toLowerCase();
          
          return questionA < questionB ? -1 : questionA > questionB ? 1 : 0;
        });
      }

      return [...data].sort((a, b) => {
        let aVal = a[sortColumn];
        let bVal = b[sortColumn];

        // Handle dates
        if (sortColumn === 'submission_date') {
          aVal = new Date(aVal).getTime();
          bVal = new Date(bVal).getTime();
        }

        // Handle numeric values
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        }

        // Handle strings
        const aStr = String(aVal || '').toLowerCase();
        const bStr = String(bVal || '').toLowerCase();
        
        if (sortDirection === 'asc') {
          return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
        } else {
          return aStr > bStr ? -1 : aStr < bStr ? 1 : 0;
        }
      });
    };
  }, [sortColumn, sortDirection]);

  const renderRawScoresReport = () => {
    // Get the selected form names for display (without version info)
    let selectedFormNames: string[] = [];
    if (filters.formIds && filters.formIds.length > 0) {
      filters.formIds.forEach(compositeKey => {
        if (compositeKey.includes('||')) {
          // Extract form name from composite key
          const lastDashIndex = compositeKey.lastIndexOf('||');
          const formName = compositeKey.substring(0, lastDashIndex);
          if (!selectedFormNames.includes(formName)) {
            selectedFormNames.push(formName);
          }
        }
      });
    }
    const selectedFormName = selectedFormNames.length > 0 ? selectedFormNames.join(', ') : '';

    // Get the selected category name
    let selectedCategoryName = '';
    if (filters.categoryId) {
      const category = filterOptions.categories.find(c => c.id === filters.categoryId);
      if (category) {
        selectedCategoryName = category.name;
      }
    }

    // Get the selected question name
    let selectedQuestionName = '';
    if (filters.questionId) {
      const question = filterOptions.questions.find(q => q.id === filters.questionId);
      if (question) {
        selectedQuestionName = question.name;
      }
    }

    // Determine if we're at category level (category selected but no question)
    const isCategoryLevel = filters.categoryId && !filters.questionId && !filters.includeQuestionBreakdown;
    const isQuestionLevel = filters.questionId;
    const isFormLevelWithCategoryBreakdown = !filters.categoryId && !filters.questionId && filters.includeCategoryBreakdown && !filters.includeQuestionBreakdown;
    const isQuestionLevelBreakdown = !filters.questionId && filters.includeQuestionBreakdown;

    // Sort the data
    const sortedSubmissions = sortData(reportData.submissions || []);

    // Sortable header component
    const SortableHeader = ({ column, children }: { column: string; children: React.ReactNode }) => (
      <th 
        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
        onClick={() => handleSort(column)}
      >
        <div className="flex items-center gap-1">
          {children}
          {sortColumn === column && (
            <span className="text-blue-500">
              {sortDirection === 'asc' ? '↑' : '↓'}
            </span>
          )}
        </div>
      </th>
    );

    return (
      <div className="space-y-6">
        {/* Raw Data Table */}
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <div>
            <h3 className="text-lg font-semibold">Raw Score Data</h3>
            <p className="text-sm text-gray-600">Total Records: {reportData.totalCount}</p>
            </div>
            {reportData.totalCount > 0 && (
              <Button
                onClick={exportReport}
                variant="secondary"
                size="sm"
                leftIcon={<HiOutlineDocumentArrowDown className="h-5 w-5" />}
              >
                Export to Excel
              </Button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <SortableHeader column="submission_id">Submission ID</SortableHeader>
                  <SortableHeader column="submission_date">Date</SortableHeader>
                  <SortableHeader column="csr_name">CSR</SortableHeader>
                  <SortableHeader column="form_name">Form</SortableHeader>
                  <SortableHeader column="total_score">Form Score</SortableHeader>
                  {(isCategoryLevel || isFormLevelWithCategoryBreakdown) && !isQuestionLevelBreakdown && (
                    <>
                      <SortableHeader column="category_name">Category</SortableHeader>
                      <SortableHeader column="category_score">Category Score</SortableHeader>
                    </>
                  )}
                  {isQuestionLevel && (
                    <>
                      <SortableHeader column="category_name">Category</SortableHeader>
                      <SortableHeader column="category_score">Category Score</SortableHeader>
                      <SortableHeader column="question">Question</SortableHeader>
                      <SortableHeader column="question_answer">Answer</SortableHeader>
                    </>
                  )}
                  {isQuestionLevelBreakdown && !isQuestionLevel && (
                    <>
                      <SortableHeader column="category_name">Category</SortableHeader>
                      <SortableHeader column="category_score">Category Score</SortableHeader>
                      <SortableHeader column="question">Question</SortableHeader>
                      <SortableHeader column="question_answer">Answer</SortableHeader>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sortedSubmissions.slice(0, 100).map((submission: any, index: number) => (
                  <tr key={`${submission.submission_id}-${submission.category_id || 'form'}-${submission.question_id || 'no-question'}-${index}`} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      #{submission.submission_id}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(submission.submission_date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {submission.csr_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {submission.form_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        submission.total_score >= 90 ? 'bg-green-100 text-green-800' :
                        submission.total_score >= 80 ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {submission.total_score}%
                      </span>
                    </td>
                    {(isCategoryLevel || isFormLevelWithCategoryBreakdown) && !isQuestionLevelBreakdown && (
                      <>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {submission.category_name || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {submission.category_possible_points === 0 || submission.category_score === null || submission.category_score === undefined ? (
                            <span className="text-gray-500">N/A</span>
                          ) : (
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              submission.category_score >= 90 ? 'bg-green-100 text-green-800' :
                              submission.category_score >= 80 ? 'bg-yellow-100 text-yellow-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {submission.category_score.toFixed(1)}%
                            </span>
                          )}
                        </td>
                      </>
                    )}
                    {isQuestionLevel && (
                      <>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {submission.category_name || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {submission.category_possible_points === 0 || submission.category_score === null || submission.category_score === undefined ? (
                            <span className="text-gray-500">N/A</span>
                          ) : (
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              submission.category_score >= 90 ? 'bg-green-100 text-green-800' :
                              submission.category_score >= 80 ? 'bg-yellow-100 text-yellow-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {submission.category_score.toFixed(1)}%
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          {submission.question || 'N/A'}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          {submission.question_answer || 'N/A'}
                        </td>
                      </>
                    )}
                    {isQuestionLevelBreakdown && !isQuestionLevel && (
                      <>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {submission.category_name || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {submission.category_possible_points === 0 || submission.category_score === null || submission.category_score === undefined ? (
                            <span className="text-gray-500">N/A</span>
                          ) : (
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              submission.category_score >= 90 ? 'bg-green-100 text-green-800' :
                              submission.category_score >= 80 ? 'bg-yellow-100 text-yellow-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {submission.category_score.toFixed(1)}%
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          {submission.question || submission.question_text || 'N/A'}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          {submission.question_answer || 'N/A'}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sortedSubmissions.length > 100 && (
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
              <p className="text-sm text-gray-600">
                Showing first 100 records of {reportData.totalCount}. Export for complete data.
              </p>
            </div>
          )}
        </div>

        {/* Statistics - Show Form-Level, Category-Level (if applicable), and Question-Level */}
        {(reportData.statistics || reportData.categoryLevelStatistics || reportData.specificLevelStatistics) && (
          <div className="space-y-4">
            {/* Form-Level Statistics (always shown) */}
            {reportData.statistics && (
              <div className="bg-white rounded-lg shadow-sm border p-6">
                <h3 className="text-lg font-semibold mb-2">
                  Form-Level Score Statistics
                </h3>
                {selectedFormName && (
                  <p className="text-sm text-[#00aeef] mb-2">Form: {selectedFormName}</p>
                )}
                <p className="text-xs text-gray-500 mb-4">
                  Overall statistics for all submissions in the selected form(s)
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center">
                    <p className="text-xl font-bold text-blue-900">
                      {typeof reportData.statistics.mean === 'number' && !isNaN(reportData.statistics.mean) 
                        ? reportData.statistics.mean.toFixed(1) 
                        : '0.0'}%
                    </p>
                    <p className="text-xs text-gray-600">Mean</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-blue-900">
                      {typeof reportData.statistics.median === 'number' && !isNaN(reportData.statistics.median) 
                        ? reportData.statistics.median.toFixed(1) 
                        : '0.0'}%
                    </p>
                    <p className="text-xs text-gray-600">Median</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-blue-900">
                      {typeof reportData.statistics.min === 'number' && !isNaN(reportData.statistics.min) 
                        ? reportData.statistics.min.toFixed(0) 
                        : '0'}%
                    </p>
                    <p className="text-xs text-gray-600">Minimum</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-blue-900">
                      {typeof reportData.statistics.max === 'number' && !isNaN(reportData.statistics.max) 
                        ? reportData.statistics.max.toFixed(0) 
                        : '0'}%
                    </p>
                    <p className="text-xs text-gray-600">Maximum</p>
                  </div>
                </div>
              </div>
            )}

            {/* Category-Level Statistics (shown when category or question is filtered) */}
            {(reportData.categoryLevelStatistics || (reportData.specificLevelStatistics && filters.categoryId && !filters.questionId)) && (
              <div className="bg-white rounded-lg shadow-sm border p-6">
                <h3 className="text-lg font-semibold mb-2">
                  Category-Level Score Statistics
                </h3>
                {selectedCategoryName && (
                  <p className="text-sm text-[#00aeef] mb-2">Category: {selectedCategoryName}</p>
                )}
                <p className="text-xs text-gray-500 mb-4">
                  Statistics for the selected category
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {(() => {
                    const stats = reportData.categoryLevelStatistics || (filters.categoryId && !filters.questionId ? reportData.specificLevelStatistics : null);
                    if (!stats) return null;
                    
                    // Check if the category has zero possible points by looking at the raw data
                    const categoryPossiblePoints = reportData.submissions && reportData.submissions.length > 0 
                      ? reportData.submissions[0].category_possible_points 
                      : null;
                    const hasZeroPossiblePoints = categoryPossiblePoints === 0;
                    
                    return (
                      <>
                        <div className="text-center">
                          <p className="text-xl font-bold text-purple-900">
                            {hasZeroPossiblePoints ? 'N/A' : 
                             (typeof stats.mean === 'number' && !isNaN(stats.mean) 
                              ? stats.mean.toFixed(1) 
                              : '0.0') + '%'}
                          </p>
                          <p className="text-xs text-gray-600">Mean</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xl font-bold text-purple-900">
                            {hasZeroPossiblePoints ? 'N/A' : 
                             (typeof stats.median === 'number' && !isNaN(stats.median) 
                              ? stats.median.toFixed(1) 
                              : '0.0') + '%'}
                          </p>
                          <p className="text-xs text-gray-600">Median</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xl font-bold text-purple-900">
                            {hasZeroPossiblePoints ? 'N/A' : 
                             (typeof stats.min === 'number' && !isNaN(stats.min) 
                              ? stats.min.toFixed(0) 
                              : '0') + '%'}
                          </p>
                          <p className="text-xs text-gray-600">Minimum</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xl font-bold text-purple-900">
                            {hasZeroPossiblePoints ? 'N/A' : 
                             (typeof stats.max === 'number' && !isNaN(stats.max) 
                              ? stats.max.toFixed(0) 
                              : '0') + '%'}
                          </p>
                          <p className="text-xs text-gray-600">Maximum</p>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Question-Level Statistics (shown when question is filtered) */}
            {reportData.specificLevelStatistics && filters.questionId && (
              <div className="bg-white rounded-lg shadow-sm border p-6">
                <h3 className="text-lg font-semibold mb-2">
                  Question-Level Score Statistics
                </h3>
                {selectedQuestionName && (
                  <p className="text-sm text-[#00aeef] mb-2">Question: {selectedQuestionName}</p>
                )}
                <p className="text-xs text-gray-500 mb-4">
                  Statistics for the selected question only
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center">
                    <p className="text-xl font-bold text-green-900">
                      {typeof reportData.specificLevelStatistics.mean === 'number' && !isNaN(reportData.specificLevelStatistics.mean) 
                        ? reportData.specificLevelStatistics.mean.toFixed(1) 
                        : '0.0'}%
                    </p>
                    <p className="text-xs text-gray-600">Mean</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-green-900">
                      {typeof reportData.specificLevelStatistics.median === 'number' && !isNaN(reportData.specificLevelStatistics.median) 
                        ? reportData.specificLevelStatistics.median.toFixed(1) 
                        : '0.0'}%
                    </p>
                    <p className="text-xs text-gray-600">Median</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-green-900">
                      {typeof reportData.specificLevelStatistics.min === 'number' && !isNaN(reportData.specificLevelStatistics.min) 
                        ? reportData.specificLevelStatistics.min.toFixed(0) 
                        : '0'}%
                    </p>
                    <p className="text-xs text-gray-600">Minimum</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-green-900">
                      {typeof reportData.specificLevelStatistics.max === 'number' && !isNaN(reportData.specificLevelStatistics.max) 
                        ? reportData.specificLevelStatistics.max.toFixed(0) 
                        : '0'}%
                    </p>
                    <p className="text-xs text-gray-600">Maximum</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Category-Level Breakdown - RIGHT AFTER Category Statistics */}
        {reportData.categoryBreakdown && (
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h3 className="text-lg font-semibold mb-4">Category-Level Analysis</h3>
            
            {/* Category Summary */}
            {reportData.categoryBreakdown.summary && (
              <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-blue-600">
                      {reportData.categoryBreakdown.summary.totalCategories || 0}
                    </p>
                    <p className="text-sm text-gray-600">Total Categories</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-600">
                      {typeof reportData.categoryBreakdown.summary.averageScore === 'number' && !isNaN(reportData.categoryBreakdown.summary.averageScore)
                        ? reportData.categoryBreakdown.summary.averageScore.toFixed(1) + '%'
                        : 'N/A'}
                    </p>
                    <p className="text-sm text-gray-600">Average Score</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-semibold text-purple-600">
                      {reportData.categoryBreakdown.summary.highestPerformingCategory?.category_name || 'N/A'}
                    </p>
                    <p className="text-sm text-gray-600">Best Category</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-semibold text-orange-600">
                      {reportData.categoryBreakdown.summary.lowestPerformingCategory?.category_name || 'N/A'}
                    </p>
                    <p className="text-sm text-gray-600">Needs Improvement</p>
                  </div>
                </div>
                {reportData.categoryBreakdown.summary.note && (
                  <p className="text-sm text-gray-600 italic text-center">
                    {reportData.categoryBreakdown.summary.note}
                  </p>
                )}
              </div>
            )}

            {/* Category Details Table */}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Questions</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Responses</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Score</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category %</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {reportData.categoryBreakdown.categories?.map((category: any) => (
                    <tr key={category.category_id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">
                        {category.category_name}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {category.total_questions}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {category.total_responses}
                      </td>
                      <td className="px-6 py-4 text-sm font-medium">
                        {typeof category.average_score === 'number' && !isNaN(category.average_score)
                          ? (
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              category.average_score >= 90 ? 'bg-green-100 text-green-800' :
                              category.average_score >= 80 ? 'bg-yellow-100 text-yellow-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {category.average_score.toFixed(1)}%
                            </span>
                          )
                          : 'N/A'}
                      </td>
                      <td className="px-6 py-4 text-sm font-medium">
                        {typeof category.category_percentage === 'number' && !isNaN(category.category_percentage)
                          ? category.category_percentage.toFixed(1) + '%'
                          : 'N/A'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Question-Level Breakdown */}
        {reportData.questionBreakdown && (
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h3 className="text-lg font-semibold mb-4">Question-Level Analysis</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Question</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Score</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Responses</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {reportData.questionBreakdown.questions?.map((question: any) => (
                    <tr key={question.question_id}>
                      <td className="px-6 py-4 text-sm text-gray-900">{question.question_text}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">{question.category_name}</td>
                      <td className="px-6 py-4 text-sm font-medium">
                        {typeof question.average_score === 'number' && !isNaN(question.average_score)
                          ? (
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              question.average_score >= 90 ? 'bg-green-100 text-green-800' :
                              question.average_score >= 80 ? 'bg-yellow-100 text-yellow-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {question.average_score.toFixed(1)}%
                            </span>
                          )
                          : 'N/A'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">{question.total_responses}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Analytics</h1>
      </div>

      {user?.role_id === 3 ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
          <HiOutlineInformationCircle className="h-12 w-12 mx-auto mb-4 text-yellow-600" />
          <h3 className="text-lg font-medium text-yellow-800 mb-2">Limited Access</h3>
          <p className="text-yellow-700">
            Comprehensive analytics are not available for CSR role. Please contact your manager or QA team for reports.
          </p>
        </div>
      ) : (
        <>
          {renderQueryBuilder()}
          {renderResults()}
        </>
      )}
    </div>
  );
};

export default ComprehensiveAnalytics; 