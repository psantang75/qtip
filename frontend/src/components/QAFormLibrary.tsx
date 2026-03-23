import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FormListItem } from '../types/form.types';
import { getAllForms } from '../services/formService';
import DataTable, { Column } from './compound/DataTable';
import FilterPanel, { FilterField } from './compound/SearchFilter';
import ErrorDisplay from './ui/ErrorDisplay';
import Button from './ui/Button';
import { usePersistentFilters, useLocalStorage } from '../hooks/useLocalStorage';
import { useAuth } from '../contexts/AuthContext';

interface FilterState {
  interactionType: string;
  search: string;
  showInactive: boolean;
}

const QAFormLibrary: React.FC = () => {
  // Form state
  const { user } = useAuth();
  const navigate = useNavigate();
  const [forms, setForms] = useState<FormListItem[]>([]);
  const [filteredForms, setFilteredForms] = useState<FormListItem[]>([]);
  
  // Persistent filter state (isolated per user)
  const [filters, setFilters, clearFilters] = usePersistentFilters<FilterState>(
    'QAFormLibrary',
    {
      interactionType: 'all',
      search: '',
      showInactive: false
    },
    user?.id
  );

  // Persistent page size (client-side pagination)
  const [pageSize, setPageSize, clearPageSize] = useLocalStorage<number>(
    `qtip_pageSize_${user?.id}_QAFormLibrary`,
    10
  );

  // Handle page size changes from DataTable
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
  };
  
  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Fetch forms on component mount
  useEffect(() => {
    fetchForms();
  }, []);
  
  // Filter forms when filters or forms change
  // Use individual filter properties to avoid infinite loops from object reference changes
  useEffect(() => {
    filterForms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.interactionType, filters.search, filters.showInactive, forms]);
  
  // Fetch forms from API
  const fetchForms = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Use the forms service to get forms
      const formsData = await getAllForms();
      console.log('Review Forms API response:', formsData);
      
      // Extract forms array from API response (handle both old and new formats)
      let formsList: FormListItem[] = [];
      if (Array.isArray(formsData)) {
        // Direct array response (old format)
        formsList = formsData;
      } else if (formsData && Array.isArray((formsData as any).forms)) {
        // Object with forms property (new API format)
        formsList = (formsData as any).forms;
        console.log('Extracted forms array:', formsList.length, 'forms');
      } else {
        console.warn('Review Forms API returned unexpected format:', typeof formsData, formsData);
        formsList = [];
      }
      
      setForms(formsList);
      setIsLoading(false);
    } catch (err) {
      setIsLoading(false);
      setError('Failed to load forms. Please try again.');
      console.error('Error fetching forms:', err);
    }
  };
  
  // Filter forms based on current filter state
  const filterForms = () => {
    let filtered = forms;
    
    // Filter by active status
    if (!filters.showInactive) {
      filtered = filtered.filter(form => form.is_active);
    }
    
    // Filter by interaction type
    if (filters.interactionType !== 'all') {
      filtered = filtered.filter(form => form.interaction_type === filters.interactionType);
    }
    
    // Filter by search term
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filtered = filtered.filter(form => 
        form.form_name.toLowerCase().includes(searchLower)
      );
    }
    
    setFilteredForms(filtered);
  };

  // Handle filter changes
  const handleFilterChange = (newFilters: Record<string, any>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  };
  
  // Handle preview button click
  const handlePreviewForm = async (formId: number) => {
    try {
      // Navigate to the form preview page
      window.location.href = `/qa/form-library/preview?formId=${formId}`;
    } catch (err) {
      setError('Failed to preview form. Please try again.');
      console.error('Error previewing form:', err);
    }
  };

  // Define table columns
  const columns: Column<FormListItem>[] = [
    {
      key: 'form_name',
      header: 'Form Name',
      sortable: true,
      render: (value, form) => (
        <span className="font-medium">{form.form_name}</span>
      )
    },
    {
      key: 'interaction_type',
      header: 'Type',
      sortable: true,
      render: (value, form) => (
        <span>
          {form.interaction_type === 'UNIVERSAL' ? 'Universal' : 
           form.interaction_type === 'CALL' ? 'Call' : 
           form.interaction_type === 'TICKET' ? 'Ticket' : 
           form.interaction_type === 'EMAIL' ? 'Email' : 
           form.interaction_type === 'CHAT' ? 'Chat' : 
           form.interaction_type || '-'}
        </span>
      )
    },
    {
      key: 'version',
      header: 'Version',
      sortable: true
    },
    {
      key: 'created_at',
      header: 'Created Date',
      sortable: true,
      render: (value, form) => new Date(form.created_at).toLocaleDateString()
    },
    {
      key: 'is_active',
      header: 'Status',
      sortable: true,
      render: (value, form) => (
        <span className={`px-2 py-1 text-sm rounded-full ${
          form.is_active 
            ? 'bg-green-100 text-green-800' 
            : 'bg-gray-100 text-gray-800'
        }`}>
          {form.is_active ? 'Active' : 'Inactive'}
        </span>
      )
    },
    {
      key: 'id',
      header: 'Actions',
      sortable: false,
      render: (value, form) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handlePreviewForm(form.id)}
          className="text-indigo-600 hover:text-indigo-900"
        >
          Preview
        </Button>
      )
    }
  ];

  // Define filter fields
  // Memoized initial values for FilterPanel (list individual properties for efficient comparison)
  // Create a new object only when filter values actually change to prevent infinite loops
  const filterPanelInitialValues = useMemo(() => {
    return {
      interactionType: filters.interactionType,
      search: filters.search,
      showInactive: filters.showInactive
    };
  }, [
    filters.interactionType,
    filters.search,
    filters.showInactive
  ]);

  const filterFields: FilterField[] = [
    {
      key: 'interactionType',
      label: 'Form Type',
      type: 'select',
      options: [
        { value: 'all', label: 'All Types' },
        { value: 'UNIVERSAL', label: 'Universal' },
        { value: 'CALL', label: 'Call' },
        { value: 'TICKET', label: 'Ticket' },
        { value: 'EMAIL', label: 'Email' },
        { value: 'CHAT', label: 'Chat' }
      ]
    },
    {
      key: 'search',
      label: 'Search',
      type: 'text',
      placeholder: 'Search by form name...'
    },
    {
      key: 'showInactive',
      label: 'Show Inactive Forms',
      type: 'checkbox'
    }
  ];

  return (
    <div className="container p-6 mx-auto relative">
              <h1 className="text-2xl font-bold text-neutral-900 mb-6">Review Form Library</h1>
      
      {error && <ErrorDisplay message={error} />}

      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">Filters</h2>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { clearFilters(); clearPageSize(); }}
            aria-label="Clear all filters and reset page size"
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

      <DataTable
        columns={columns}
        data={filteredForms}
        loading={isLoading}
        emptyMessage={
          filters.search || filters.interactionType !== 'all' || filters.showInactive
            ? 'No forms found. Try adjusting your filters.'
            : 'No forms available in the library.'
        }
        pagination={true}
        pageSize={pageSize}
        onPageSizeChange={handlePageSizeChange}
        searchable={false}
      />
    </div>
  );
};

export default QAFormLibrary; 