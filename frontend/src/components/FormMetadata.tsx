import React, { useState, useEffect } from 'react';
import type { InteractionType, FormMetadataField, MetadataFieldType } from '../types/form.types';
import Button from './ui/Button';

interface FormMetadataProps {
  formName: string;
  isActive: boolean;
  version: number;
  interactionType?: InteractionType;
  metadataFields?: FormMetadataField[];
  userVersion?: number;
  userVersionDate?: string;
  onFormNameChange: (value: string) => void;
  onIsActiveChange: (value: boolean) => void;
  onInteractionTypeChange?: (value: InteractionType) => void;
  onMetadataFieldsChange?: (fields: FormMetadataField[]) => void;
  onUserVersionChange?: (value: number) => void;
  onUserVersionDateChange?: (value: string) => void;
  error?: string;
  userVersionError?: string;
  userVersionDateError?: string;
}

const FormMetadata: React.FC<FormMetadataProps> = ({
  formName,
  isActive,
  version,
  interactionType = 'CALL',
  metadataFields = [],
  userVersion = 0,
  userVersionDate = '',
  onFormNameChange,
  onIsActiveChange,
  onInteractionTypeChange,
  onMetadataFieldsChange,
  onUserVersionChange,
  onUserVersionDateChange,
  error,
  userVersionError,
  userVersionDateError,
}) => {
  // Initialize default call metadata fields if none exist and type is CALL
  const [localMetadataFields, setLocalMetadataFields] = useState<FormMetadataField[]>(metadataFields);

  useEffect(() => {
    // Always ensure the 4 required fields exist at the beginning
    const requiredFields: FormMetadataField[] = [
      { field_name: 'Reviewer Name', field_type: 'AUTO', is_required: true, interaction_type: interactionType, sort_order: 0 },
      { field_name: 'Review Date', field_type: 'AUTO', is_required: true, interaction_type: interactionType, sort_order: 1 },
      { field_name: 'CSR', field_type: 'DROPDOWN', is_required: true, interaction_type: interactionType, sort_order: 2 },
      { field_name: 'Spacer-1', field_type: 'SPACER', is_required: false, interaction_type: interactionType, sort_order: 3 },
    ];
    
    // If no metadata fields exist, add default optional fields
    if (!metadataFields || metadataFields.length === 0) {
      const defaultOptionalFields: FormMetadataField[] = [
        { field_name: 'Customer ID', field_type: 'TEXT', is_required: true, interaction_type: interactionType, sort_order: 4 },
        { field_name: 'Customer Name', field_type: 'TEXT', is_required: true, interaction_type: interactionType, sort_order: 5 },
        { field_name: 'Ticket Number', field_type: 'TEXT', is_required: true, interaction_type: interactionType, sort_order: 6 },
        { field_name: 'Spacer-2', field_type: 'SPACER', is_required: false, interaction_type: interactionType, sort_order: 7 },
        { field_name: 'Call Conversation ID', field_type: 'TEXT', is_required: true, interaction_type: interactionType, sort_order: 8 },
        { field_name: 'Call Date', field_type: 'DATE', is_required: true, interaction_type: interactionType, sort_order: 9 },
      ];
      
      const allFields = [...requiredFields, ...defaultOptionalFields];
      setLocalMetadataFields(allFields);
      onMetadataFieldsChange?.(allFields);
    } else {
      // Filter out any existing required fields from metadataFields to avoid duplicates
      const existingOptionalFields = metadataFields.filter(field => 
        !['Reviewer Name', 'Review Date', 'CSR', 'Spacer-1'].includes(field.field_name)
      );
      
      // Ensure all fields have sort_order values
      const allFields = [...requiredFields, ...existingOptionalFields].map((field, index) => ({
        ...field,
        sort_order: field.sort_order !== undefined ? field.sort_order : index
      }));
      setLocalMetadataFields(allFields);
    }
  }, [interactionType, metadataFields, onMetadataFieldsChange, onInteractionTypeChange]);

  const handleInteractionTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newType = e.target.value as InteractionType;
    onInteractionTypeChange?.(newType);
    
    // Update interaction type for all existing fields
    const updatedFields = localMetadataFields.map(field => ({
      ...field,
      interaction_type: newType
    }));
    setLocalMetadataFields(updatedFields);
    onMetadataFieldsChange?.(updatedFields);
  };

  const addMetadataField = () => {
    const newField: FormMetadataField = {
      field_name: '',
      field_type: 'TEXT',
      is_required: true,
      interaction_type: interactionType,
      sort_order: localMetadataFields.length, // Set sort_order to the next available position
    };
    const updatedFields = [...localMetadataFields, newField];
    setLocalMetadataFields(updatedFields);
    onMetadataFieldsChange?.(updatedFields);
  };

  const addSpacerField = () => {
    // Create a unique name for the spacer to avoid database unique constraint violations
    const spacerCount = localMetadataFields.filter(field => field.field_type === 'SPACER').length;
    const spacerField: FormMetadataField = {
      field_name: `Spacer-${spacerCount + 1}`,
      field_type: 'SPACER',
      is_required: false,
      interaction_type: interactionType,
      sort_order: localMetadataFields.length, // Set sort_order to the next available position
    };
    const updatedFields = [...localMetadataFields, spacerField];
    setLocalMetadataFields(updatedFields);
    onMetadataFieldsChange?.(updatedFields);
  };

  const updateMetadataField = (index: number, field: Partial<FormMetadataField>) => {
    const updatedFields = [...localMetadataFields];
    updatedFields[index] = { ...updatedFields[index], ...field };
    setLocalMetadataFields(updatedFields);
    onMetadataFieldsChange?.(updatedFields);
  };

  const removeMetadataField = (index: number) => {
    // Prevent deletion of the first 4 required fields
    if (index < 4) {
      return;
    }
    
    const updatedFields = localMetadataFields.filter((_, i) => i !== index);
    setLocalMetadataFields(updatedFields);
    onMetadataFieldsChange?.(updatedFields);
  };

  const moveMetadataField = (index: number, direction: 'up' | 'down') => {
    // Prevent moving the first 4 required fields or moving optional fields into required area
    if (
      index < 4 ||  // Can't move required fields
      (direction === 'up' && index === 4) ||  // Can't move first optional field up into required area
      (direction === 'down' && index === localMetadataFields.length - 1)  // Can't move last item down
    ) {
      return;
    }

    const updatedFields = [...localMetadataFields];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    
    // Swap the fields
    [updatedFields[index], updatedFields[newIndex]] = [updatedFields[newIndex], updatedFields[index]];
    
    // Update sort_order for all fields to match their new array positions
    const fieldsWithSortOrder = updatedFields.map((field, idx) => ({
      ...field,
      sort_order: idx
    }));
    
    setLocalMetadataFields(fieldsWithSortOrder);
    onMetadataFieldsChange?.(fieldsWithSortOrder);
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <div className="flex justify-between items-center mb-5">
        <h3 className="text-xl font-semibold text-gray-800">Form Details</h3>
        <div className="flex items-center">
          <input
            type="checkbox"
            id="isActive"
            checked={!isActive}
            onChange={(e) => onIsActiveChange(!e.target.checked)}
            className="w-4 h-4 min-w-[1rem] min-h-[1rem] text-indigo-600 bg-gray-100 border-gray-300 rounded focus:outline-none"
            style={{ width: '16px', height: '16px' }}
          />
          <label htmlFor="isActive" className="ml-2 text-sm text-gray-700">
            Make Inactive
          </label>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <label htmlFor="formName" className="block text-sm font-medium text-gray-700 mb-1">
            Form Name*
          </label>
          <input
            type="text"
            id="formName"
            value={formName}
            onChange={(e) => onFormNameChange(e.target.value)}
            placeholder="Enter form name"
            className={`w-full px-4 py-2.5 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all ${
              error ? 'border-red-500 bg-red-50' : 'border-gray-300'
            }`}
            required
          />
          {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
        </div>

        <div>
          <label htmlFor="interactionType" className="block text-sm font-medium text-gray-700 mb-1">
            Interaction Type*
          </label>
          <select
            id="interactionType"
            value={interactionType}
            onChange={handleInteractionTypeChange}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white transition-all"
          >
            <option value="CALL">Call</option>
            <option value="TICKET">Ticket</option>
            <option value="EMAIL">Email</option>
            <option value="CHAT">Chat</option>
          </select>
        </div>

        <div>
          <label htmlFor="version" className="block text-sm font-medium text-gray-700 mb-1">
            Version
          </label>
          <div className="relative">
            <input
              type="number"
              id="version"
              value={version}
              disabled
              className="w-full px-4 py-2.5 border border-gray-200 rounded-md bg-gray-50 cursor-not-allowed text-gray-500 font-medium"
            />
            <div className="absolute right-3 top-2.5 bg-gray-200 px-2 py-0.5 rounded text-xs text-gray-600">
              Auto-incremented
            </div>
          </div>
        </div>
      </div>

      {/* Add the new User Version fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
        <div>
          <label htmlFor="userVersion" className="block text-sm font-medium text-gray-700 mb-1">
            User Version*
          </label>
          <input
            type="number"
            id="userVersion"
            value={userVersion || ''}
            onChange={(e) => onUserVersionChange?.(parseInt(e.target.value) || 0)}
            placeholder="Enter user version"
            className={`w-full px-4 py-2.5 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all ${
              userVersionError ? 'border-red-500 bg-red-50' : 'border-gray-300'
            }`}
            required
          />
          {userVersionError && <p className="mt-1 text-sm text-red-600">{userVersionError}</p>}
        </div>

        <div>
          <label htmlFor="userVersionDate" className="block text-sm font-medium text-gray-700 mb-1">
            User Version Date*
          </label>
          <input
            type="date"
            id="userVersionDate"
            value={userVersionDate}
            onChange={(e) => onUserVersionDateChange?.(e.target.value)}
            className={`w-full px-4 py-2.5 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all ${
              userVersionDateError ? 'border-red-500 bg-red-50' : 'border-gray-300'
            }`}
            required
          />
          {userVersionDateError && <p className="mt-1 text-sm text-red-600">{userVersionDateError}</p>}
        </div>
      </div>

      {/* Metadata Fields Section */}
      <div className="mt-8">
        
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
          {/* Required Fields Section */}
          <div className="mt-6 mb-6 border-t-2 border-gray-300 relative">
            <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-gray-50 px-3">
              <span className="text-sm font-medium text-gray-600">Required Fields</span>
            </div>
          </div>
          
          {/* Required fields display (first 4 fields) */}
          {localMetadataFields.slice(0, 4).map((field, index) => (
            <div key={index} className={`${field.field_type === 'SPACER' ? 'bg-gray-100' : 'bg-white'} p-3 rounded mb-2 border border-gray-200`}>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="font-medium text-gray-800">
                    {field.field_name}
                    <span className="text-sm text-gray-500 font-normal ml-2">
                      {field.field_type === 'AUTO' && '- Auto-populated field'}
                      {field.field_type === 'DROPDOWN' && '- Dropdown selection'}
                      {field.field_type === 'SPACER' && '- Visual spacer'}
                    </span>
                  </div>
                </div>
                <div className="text-xs text-gray-500 font-medium">
                  {field.field_type}
                </div>
              </div>
            </div>
          ))}
          
          {/* Horizontal line separator */}
          <div className="mt-16 mb-6 border-t-2 border-gray-300 relative">
            <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-gray-50 px-3">
              <span className="text-sm font-medium text-gray-600">Optional Fields</span>
            </div>
          </div>
          
          {/* Add Field Button for Optional Section */}
          <div className="flex justify-end mb-6">
            <Button
              type="button"
              onClick={addMetadataField}
              variant="primary"
              size="sm"
            >
              Add Field
            </Button>
          </div>
          
          {/* Column headers for optional fields */}
          <div className="grid grid-cols-10 gap-4 font-medium text-sm text-gray-600 mb-2 px-2">
            <div className="col-span-4">Field Name</div>
            <div className="col-span-2">Type</div>
            <div className="col-span-3">Required</div>
            <div className="col-span-1 text-center">Actions</div>
          </div>
          
          {/* Optional fields (from index 4 onwards) */}
          {localMetadataFields.slice(4).map((field, index) => {
            const actualIndex = index + 4; // Adjust index since we're slicing
            return (
              <div key={actualIndex} className={`grid grid-cols-10 gap-4 ${field.field_type === 'SPACER' ? 'bg-gray-100' : 'bg-white'} p-2 rounded mb-2 items-center`}>
                <div className="col-span-4">
                  <input
                    type="text"
                    value={field.field_name}
                    onChange={(e) => updateMetadataField(actualIndex, { field_name: e.target.value })}
                    className={`w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 ${field.field_type === 'SPACER' ? 'bg-gray-200 text-gray-400' : ''}`}
                    placeholder={field.field_type === 'SPACER' ? "Visual spacer (ID will be hidden)" : "Field name"}
                    disabled={field.field_type === 'SPACER'}
                  />
                </div>
                <div className="col-span-2">
                  <select
                    value={field.field_type}
                    onChange={(e) => updateMetadataField(actualIndex, { field_type: e.target.value as MetadataFieldType })}
                    className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="TEXT">Text</option>
                    <option value="DROPDOWN">Dropdown</option>
                    <option value="DATE">Date</option>
                    <option value="AUTO">Auto</option>
                    <option value="SPACER">Spacer</option>
                  </select>
                </div>
                <div className="col-span-3 flex items-center">
                  <input
                    type="checkbox"
                    checked={field.is_required}
                    onChange={(e) => updateMetadataField(actualIndex, { is_required: e.target.checked })}
                    className="w-4 h-4 min-w-[1rem] min-h-[1rem] text-indigo-600 bg-gray-100 border-gray-300 rounded focus:outline-none"
                    style={{ width: '16px', height: '16px' }}
                    disabled={field.field_type === 'SPACER'}
                  />
                  <span className="ml-2 text-sm font-medium text-gray-700">Required</span>
                </div>
                <div className="col-span-1 flex justify-center space-x-1">
                  {/* Order controls */}
                  <div className="flex flex-col mr-2">
                    <button
                      type="button"
                      onClick={() => moveMetadataField(actualIndex, 'up')}
                      disabled={actualIndex === 4}
                      className={`p-1.5 ${actualIndex === 4 ? 'text-gray-300 cursor-not-allowed' : 'text-blue-600 hover:bg-blue-50'} rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500`}
                      title="Move up"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => moveMetadataField(actualIndex, 'down')}
                      disabled={actualIndex === localMetadataFields.length - 1}
                      className={`p-1.5 ${actualIndex === localMetadataFields.length - 1 ? 'text-gray-300 cursor-not-allowed' : 'text-blue-600 hover:bg-blue-50'} rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500`}
                      title="Move down"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                  
                  {/* Delete button */}
                  <button
                    type="button"
                    onClick={() => removeMetadataField(actualIndex)}
                    className="p-1.5 text-red-600 hover:bg-red-50 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                    title="Delete field"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
          
          {localMetadataFields.length === 0 && (
            <div className="text-center py-4 text-gray-500">
              No metadata fields defined. Click "Add Field" to create one.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FormMetadata; 