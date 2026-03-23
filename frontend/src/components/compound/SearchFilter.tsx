import React, { useState } from 'react';
import { Calendar } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface FilterOption {
  value: string | number;
  label: string;
}

export interface FilterField {
  key: string;
  label: string;
  type: 'text' | 'select' | 'checkbox' | 'date';
  options?: FilterOption[];
  placeholder?: string;
  defaultValue?: any;
}

export interface FilterPanelProps {
  fields: FilterField[];
  onFilterChange: (filters: Record<string, any>) => void;
  className?: string;
  title?: string;
  initialValues?: Record<string, any>; // Support for persisted filter values
}

const FilterPanel: React.FC<FilterPanelProps> = ({
  fields = [],
  onFilterChange,
  className,
  title,
  initialValues = {}
}) => {
  const [filters, setFilters] = useState<Record<string, any>>(() => {
    // Initialize with persisted values first, then defaults
    const initialFilters: Record<string, any> = { ...initialValues };
    if (fields && Array.isArray(fields)) {
      fields.forEach(field => {
        // Only set default if not already in initialValues
        if (initialFilters[field.key] === undefined) {
          if (field.defaultValue !== undefined) {
            initialFilters[field.key] = field.defaultValue;
          } else if (field.type === 'text' || field.type === 'date') {
            initialFilters[field.key] = '';
          }
        }
      });
    }
    return initialFilters;
  });

  // Use ref to store the callback to avoid infinite loops when parent doesn't memoize
  const onFilterChangeRef = React.useRef(onFilterChange);
  React.useEffect(() => {
    onFilterChangeRef.current = onFilterChange;
  }, [onFilterChange]);

  // REMOVED: Initial mount effect that called onFilterChange
  // Parent component already manages the filter state, so we don't need to notify it on mount
  // This was causing infinite loops when parent state updates triggered re-renders

  // Sync with initialValues when they change (e.g., after Clear Filters)
  // Use a ref to track the last initialValues to prevent unnecessary updates
  const lastInitialValuesRef = React.useRef<string>('');
  React.useEffect(() => {
    // Only sync if initialValues is provided and has keys
    if (initialValues && Object.keys(initialValues).length > 0) {
      const currentInitialValuesStr = JSON.stringify(initialValues);
      
      // Skip if initialValues haven't actually changed
      if (lastInitialValuesRef.current === currentInitialValuesStr) {
        return;
      }
      
      setFilters(prev => {
        // Check if values are actually different
        const valuesAreDifferent = 
          Object.keys(initialValues).some(key => prev[key] !== initialValues[key]) ||
          Object.keys(prev).some(key => !(key in initialValues) && prev[key] !== '');
        
        if (!valuesAreDifferent) {
          lastInitialValuesRef.current = currentInitialValuesStr;
          return prev;
        }
        
        lastInitialValuesRef.current = currentInitialValuesStr;
        // Just update internal state - DO NOT notify parent since parent already knows these values
        return { ...prev, ...initialValues };
      });
    } else if (Object.keys(initialValues || {}).length === 0 && lastInitialValuesRef.current !== '') {
      // Handle case where initialValues becomes empty (e.g., after clear)
      lastInitialValuesRef.current = '';
      setFilters({});
    }
  }, [JSON.stringify(initialValues)]);

  // Separate regular fields from checkbox fields - safety check
  const regularFields = (fields || []).filter(field => field.type !== 'checkbox');
  const checkboxFields = (fields || []).filter(field => field.type === 'checkbox');

  const handleFilterChange = (key: string, value: any) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    onFilterChangeRef.current(newFilters); // Use ref to avoid dependency issues
  };

  const renderField = (field: FilterField) => {
    switch (field.type) {
      case 'select':
        // Check if field already has an empty value option to avoid duplicates
        const hasEmptyOption = field.options?.some(option => option.value === '' || option.value === null);
        
        return (
          <div key={field.key}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
            </label>
            <select
              name={field.key}
              value={filters[field.key] || ''}
              onChange={(e) => handleFilterChange(field.key, e.target.value)}
              className="w-full px-4 py-[9px] border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              {!hasEmptyOption && <option value="">All {field.label}</option>}
              {field.options?.map((option, index) => (
                <option key={`${field.key}-${option.value}-${index}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        );

      case 'text':
        return (
          <div key={field.key}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
            </label>
            <input
              type="text"
              name={field.key}
              placeholder={field.placeholder}
              value={filters[field.key] || ''}
              onChange={(e) => handleFilterChange(field.key, e.target.value)}
              className="w-full px-4 py-[9px] border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
        );

      case 'date':
        return (
          <div key={field.key}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
            </label>
            <input
              type="date"
              name={field.key}
              value={filters[field.key] || ''}
              onChange={(e) => handleFilterChange(field.key, e.target.value)}
              className="w-full px-4 py-[9px] border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
        );

      case 'checkbox':
        return (
          <div key={field.key} className="flex items-center">
            <input
              type="checkbox"
              id={field.key}
              checked={filters[field.key] || false}
              onChange={(e) => handleFilterChange(field.key, e.target.checked)}
              className="w-4 h-4 min-w-[1rem] min-h-[1rem] text-indigo-600 bg-gray-100 border-gray-300 rounded focus:outline-none mr-2"
              style={{ width: '16px', height: '16px' }}
            />
            <label htmlFor={field.key} className="text-sm text-gray-700 cursor-pointer">
              {field.label}
            </label>
          </div>
        );

      default:
        return null;
    }
  };

  const renderCheckboxes = () => {
    if (checkboxFields.length === 0) return null;

    return (
      <div className="flex items-center justify-end pt-4">
        {checkboxFields.map(field => (
          <div key={field.key} className="flex items-center">
            <input
              type="checkbox"
              id={field.key}
              checked={filters[field.key] || false}
              onChange={(e) => handleFilterChange(field.key, e.target.checked)}
              className="w-4 h-4 min-w-[1rem] min-h-[1rem] text-indigo-600 bg-gray-100 border-gray-300 rounded focus:outline-none mr-2"
              style={{ width: '16px', height: '16px' }}
            />
            <label htmlFor={field.key} className="text-sm text-gray-700 cursor-pointer">
              {field.label}
            </label>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className={cn("mb-8 bg-white rounded-lg shadow-md p-6 border border-gray-200", className)}>
      <div className="mb-4">
        {title && (
          <h2 className="text-lg font-semibold text-gray-800 mb-3">{title}</h2>
        )}
        
        {/* Regular Filter Fields - Grid Layout */}
        {regularFields.length > 0 && (
          <div className={cn(
            "gap-4 mb-4",
            regularFields.length === 1 ? "grid grid-cols-1" :
            regularFields.length === 2 ? "grid grid-cols-1 md:grid-cols-2" :
            "grid grid-cols-1 md:grid-cols-3"
          )}>
            {regularFields.map(renderField)}
          </div>
        )}

        {/* Checkbox Fields */}
        {renderCheckboxes()}
      </div>
    </div>
  );
};

export default FilterPanel;

// Export as SearchFilter for backward compatibility
export { FilterPanel as SearchFilter };
export type { FilterPanelProps as SearchFilterProps }; 