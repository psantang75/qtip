import React, { useState } from 'react';
import type { FormMetadataField, InteractionType } from '../types/form.types';

interface MetadataFieldsEditorProps {
  fields: FormMetadataField[];
  interactionType: InteractionType;
  onFieldsChange: (fields: FormMetadataField[]) => void;
}

const MetadataFieldsEditor: React.FC<MetadataFieldsEditorProps> = ({ 
  fields, 
  interactionType, 
  onFieldsChange 
}) => {
  // Local state to track if editor is expanded
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Add a new field
  const handleAddField = () => {
    const newField: FormMetadataField = {
      field_name: '',
      field_type: 'TEXT',
      is_required: true,
      interaction_type: interactionType,
      dropdown_source: null
    };
    
    onFieldsChange([...fields, newField]);
  };
  
  // Update an existing field
  const handleUpdateField = (index: number, updates: Partial<FormMetadataField>) => {
    const updatedFields = [...fields];
    updatedFields[index] = { ...updatedFields[index], ...updates };
    onFieldsChange(updatedFields);
  };
  
  // Remove a field
  const handleRemoveField = (index: number) => {
    const updatedFields = fields.filter((_, i) => i !== index);
    onFieldsChange(updatedFields);
  };
  
  return (
    <div className="border-t border-gray-200 pt-6 mt-6">
      <h3 
        className="text-lg font-medium text-gray-900 mb-4 flex items-center cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <svg 
          className={`h-5 w-5 mr-2 transition-transform ${isExpanded ? 'transform rotate-90' : ''}`} 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        Metadata Fields
        <span className="ml-2 text-sm text-gray-500">({fields.length} fields)</span>
      </h3>
      
      {isExpanded && (
        <div className="space-y-4">
          {fields.length === 0 ? (
            <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg bg-gray-50">
              <p className="text-gray-500">No metadata fields defined. Add fields to collect additional information.</p>
              <button
                onClick={handleAddField}
                className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
              >
                Add First Field
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-12 gap-4 bg-gray-100 px-4 py-2 rounded-t-md">
                <div className="col-span-3 text-sm font-medium text-gray-700">Field Name</div>
                <div className="col-span-3 text-sm font-medium text-gray-700">Type</div>
                <div className="col-span-3 text-sm font-medium text-gray-700">Source (If Dropdown)</div>
                <div className="col-span-2 text-sm font-medium text-gray-700 text-center">Required</div>
                <div className="col-span-1 text-sm font-medium text-gray-700">Action</div>
              </div>
              
              {fields.map((field, index) => (
                <div key={index} className="grid grid-cols-12 gap-4 items-center bg-white px-4 py-3 border border-gray-200 rounded-md">
                  <div className="col-span-3">
                    <input
                      type="text"
                      value={field.field_name}
                      onChange={(e) => handleUpdateField(index, { field_name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder="Field name"
                    />
                  </div>
                  <div className="col-span-3">
                    <select
                      value={field.field_type}
                      onChange={(e) => handleUpdateField(index, { field_type: e.target.value as any })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white"
                    >
                      <option value="TEXT">Text</option>
                      <option value="DROPDOWN">Dropdown</option>
                      <option value="DATE">Date</option>
                      <option value="AUTO">Automatic</option>
                    </select>
                  </div>
                  <div className="col-span-3">
                    <input
                      type="text"
                      value={field.dropdown_source || ''}
                      onChange={(e) => handleUpdateField(index, { dropdown_source: e.target.value })}
                      disabled={field.field_type !== 'DROPDOWN'}
                      className={`w-full px-3 py-2 border border-gray-300 rounded-md ${
                        field.field_type !== 'DROPDOWN' ? 'bg-gray-100 cursor-not-allowed' : ''
                      }`}
                      placeholder="e.g., users, departments"
                    />
                  </div>
                  <div className="col-span-2 flex justify-center">
                    <input
                      type="checkbox"
                      checked={field.is_required}
                      onChange={(e) => handleUpdateField(index, { is_required: e.target.checked })}
                      className="h-5 w-5 text-blue-600"
                    />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button
                      onClick={() => handleRemoveField(index)}
                      className="text-red-600 hover:text-red-800"
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
              
              <div className="pt-4 flex justify-end">
                <button
                  onClick={handleAddField}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 flex items-center"
                >
                  <svg className="h-4 w-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Add Field
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default MetadataFieldsEditor; 