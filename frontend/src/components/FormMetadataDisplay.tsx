import React, { useState, useEffect } from 'react';
import { cn } from '../lib/utils';
import type { FormMetadataField } from '../types/form.types';
import { getAuthorizedAxios } from '../utils/axiosUtils';

interface FormMetadataDisplayProps {
  metadataFields: FormMetadataField[];
  values?: Record<string, string>;
  onChange?: (fieldId: string, value: string) => void;
  readonly?: boolean;
  currentUser?: { id: number; username: string };
  csrOptions?: { id: number; username: string }[];
  errors?: Record<string, string>;
}

const FormMetadataDisplay: React.FC<FormMetadataDisplayProps> = ({
  metadataFields,
  values = {},
  onChange,
  readonly = false,
  currentUser,
  csrOptions = [],
  errors = {},
}) => {
  const [csrs, setCsrs] = useState<{ id: number; username: string }[]>(csrOptions);
  const [loading, setLoading] = useState<boolean>(false);
  const [hasFetched, setHasFetched] = useState<boolean>(false);

  // Fetch CSR users from the API
  useEffect(() => {
    // Only fetch if we're displaying a CSR dropdown, no options were provided, and we haven't fetched yet
    const needsFetch = metadataFields.some(
      field => field.field_type === 'DROPDOWN' && 
      field.field_name === 'CSR' && 
      csrOptions.length === 0
    ) && !hasFetched;

    if (needsFetch) {
      fetchCSRs();
    }
  }, [metadataFields, csrOptions, hasFetched]);

  const fetchCSRs = async () => {
    if (hasFetched) return; // Prevent duplicate fetches
    
    try {
      setLoading(true);
      const api = getAuthorizedAxios();
      
      // Fetch only active CSRs using the correct API parameters
      // CSR role_id is typically 3, but we'll get all users with CSR role and filter
      const response = await api.get('/api/users', {
        params: { 
          role_id: 3, // CSR role ID - we should use this instead of role name
          is_active: true, // Explicitly request only active users
          limit: 100 
        }
      });
      
      console.log('CSR users response data:', response.data);
      
      // Handle different response formats
      let allUsers = [];
      if (response.data && response.data.items) {
        allUsers = response.data.items;
      } else if (Array.isArray(response.data)) {
        allUsers = response.data;
      }
      
      // Double-check that we only have active CSRs
      // This is a safety net in case the backend filtering didn't work
      const csrData = allUsers.filter((user: any) => {
        const isActive = 
          user.is_active === true || 
          user.is_active === 1 || 
          user.active === true || 
          user.active === 1;

        const isCSR = 
          user.role_id === 3 || 
          user.role_name === 'CSR' ||
          user.role === 'CSR';

        return isActive && isCSR;
      });
      
      console.log('Filtered active CSR data:', csrData);
      console.log('Total CSRs found:', csrData.length);
      
      setCsrs(csrData);
      setHasFetched(true);
          } catch (error) {
        console.error('Error fetching CSR users:', error);
        
        // Fallback: try the old API format if the new one fails
        try {
          console.log('Trying fallback API call with role name...');
          const fallbackResponse = await getAuthorizedAxios().get('/api/users', {
          params: { 
            role: 'CSR',
            is_active: true,
            limit: 100 
          }
        });
        
        let allUsers = [];
        if (fallbackResponse.data && fallbackResponse.data.items) {
          allUsers = fallbackResponse.data.items;
        } else if (Array.isArray(fallbackResponse.data)) {
          allUsers = fallbackResponse.data;
        }
        
        // Filter for active CSRs only
        const csrData = allUsers.filter((user: any) => {
          const isActive = 
            user.is_active === true || 
            user.is_active === 1 || 
            user.active === true || 
            user.active === 1;

          return isActive;
        });
        
        console.log('Fallback: Filtered active CSR data:', csrData);
        setCsrs(csrData);
      } catch (fallbackError) {
        console.error('Fallback CSR fetch also failed:', fallbackError);
        setCsrs([]);
      }
      
      setHasFetched(true);
    } finally {
      setLoading(false);
    }
  };

  if (!metadataFields || metadataFields.length === 0) {
    return null;
  }

  const handleChange = (fieldId: string, value: string) => {
    if (onChange) {
      onChange(fieldId, value);
    }
  };

  // Get today's date in YYYY-MM-DD format for default Review Date
  const today = new Date().toISOString().split('T')[0];

  // Create a copy of metadataFields to manipulate
  const displayFields = [...metadataFields];
  
  // If there's an odd number of non-spacer fields, add a blank spacer field at the end
  const nonSpacerCount = displayFields.filter(field => field.field_type !== 'SPACER').length;
  if (nonSpacerCount % 2 !== 0 && displayFields.every(field => field.field_type !== 'SPACER')) {
    displayFields.push({
      field_name: '',
      field_type: 'SPACER',
      is_required: false,
      interaction_type: 'CALL',
    } as FormMetadataField);
  }

  // Use the fetched CSRs if available, otherwise use the provided options
  const displayCSRs = csrs.length > 0 ? csrs : csrOptions;

  const inputBase = 'w-full text-[13px] border border-slate-200 rounded-md px-2.5 py-1.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#00aeef] transition-colors';
  const inputReadonly = 'bg-slate-50 text-slate-400 cursor-not-allowed';

  return (
    <div>
      {/* Panel header — distinct from category headers inside the form */}
      <div className="px-4 py-3 bg-white border border-slate-200 rounded-t-lg border-b-0">
        <h3 className="text-[15px] font-semibold text-slate-800">Form Details</h3>
      </div>

      {/* Fields grid */}
      <div className="border border-t-0 border-slate-200 rounded-b-lg overflow-hidden bg-white px-4 py-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2.5">
          {displayFields.map((field, index) => {
            if (field.field_type === 'SPACER') {
              return <div key={`spacer-${index}`} />;
            }

            const fieldKey = (field.id && field.id !== 0) ? field.id.toString() : field.field_name;
            let defaultValue = values[fieldKey] || '';

            if (field.field_type === 'AUTO') {
              if ((field.field_name === 'Reviewer Name' || field.field_name === 'Auditor Name') && currentUser) {
                defaultValue = currentUser.username;
              } else if (field.field_name === 'Review Date' || field.field_name === 'Audit Date') {
                defaultValue = values[fieldKey] || today;
              }
            }

            const fieldError = errors[`metadata_${field.id}`] || errors[fieldKey];

            // Clean field name (guard against trailing 0/1 from is_required corruption)
            let displayName = field.field_name;
            if (displayName.length > 1 && (displayName.endsWith('0') || displayName.endsWith('1'))) {
              const trimmed = displayName.slice(0, -1);
              if (trimmed.match(/[a-zA-Z]/)) displayName = trimmed;
            }
            const label = field.is_required ? `${displayName}*` : displayName;

            return (
              <div key={fieldKey}>
                <label className="block text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">
                  {label}
                </label>

                {field.field_type === 'AUTO' ? (
                  <input
                    type="text"
                    value={defaultValue}
                    readOnly
                    className={cn(inputBase, inputReadonly)}
                  />
                ) : field.field_type === 'DROPDOWN' && field.field_name === 'CSR' ? (
                  <select
                    value={values[fieldKey] || ''}
                    onChange={e => handleChange(fieldKey, e.target.value)}
                    disabled={readonly || loading}
                    className={cn(inputBase, (readonly || loading) && inputReadonly)}
                    required={field.is_required}
                  >
                    <option value="">Select CSR…</option>
                    {loading
                      ? <option disabled>Loading…</option>
                      : displayCSRs.map(csr => (
                          <option key={csr.id} value={csr.id.toString()}>{csr.username}</option>
                        ))
                    }
                  </select>
                ) : field.field_type === 'DROPDOWN' && field.dropdown_source ? (
                  <select
                    value={values[fieldKey] || ''}
                    onChange={e => handleChange(fieldKey, e.target.value)}
                    disabled={readonly}
                    className={cn(inputBase, readonly && inputReadonly)}
                    required={field.is_required}
                  >
                    <option value="">Select {displayName}…</option>
                    {field.dropdown_source.split(',').map(opt => opt.trim()).filter(Boolean).map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : field.field_type === 'DATE' ? (
                  <input
                    type="date"
                    value={values[fieldKey] || ''}
                    onChange={e => handleChange(fieldKey, e.target.value)}
                    readOnly={readonly}
                    className={cn(inputBase, readonly && inputReadonly)}
                    required={field.is_required}
                  />
                ) : (
                  <input
                    type="text"
                    value={values[fieldKey] || ''}
                    onChange={e => handleChange(fieldKey, e.target.value)}
                    readOnly={readonly}
                    placeholder={`Enter ${displayName.toLowerCase()}…`}
                    className={cn(inputBase, readonly && inputReadonly)}
                    required={field.is_required}
                  />
                )}

                {fieldError && (
                  <p className="mt-0.5 text-[11px] text-red-500">{fieldError}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default FormMetadataDisplay; 