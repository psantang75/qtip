import React from 'react';
import type { Form } from '../types/form.types';
import FormMetadataDisplay from './FormMetadataDisplay';

interface FormPreviewProps {
  form: Form;
}

const FormPreview: React.FC<FormPreviewProps> = ({ form }) => {
  const calculateCategoryWeight = (categoryIndex: number): string => {
    const category = form.categories[categoryIndex];
    if (!category) return '0%';
    
    return `${Math.round(category.weight * 100)}%`;
  };
  
  const calculateQuestionWeight = (categoryIndex: number, questionIndex: number): string => {
    const category = form.categories[categoryIndex];
    if (!category) return '0%';
    
    const question = category.questions[questionIndex];
    if (!question) return '0%';
    
    // Calculate both the category-relative weight and the overall form weight
    const questionPercentOfCategory = Math.round(question.weight * 100);
    const questionPercentOfForm = Math.round(question.weight * category.weight * 100);
    
    return `${questionPercentOfCategory}% of category (${questionPercentOfForm}% of total)`;
  };
  
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-gray-800 mb-2">{form.form_name}</h2>
        <div className="text-sm text-gray-600">
          <p>Version: {form.version || 1}</p>
          <p className="mt-1">
            Status: <span className={form.is_active ? 'text-green-600' : 'text-gray-500'}>
              {form.is_active ? 'Active' : 'Inactive'}
            </span>
          </p>
          <p className="mt-1">
            Interaction Type: <span className="font-medium">{form.interaction_type}</span>
          </p>
        </div>
      </div>
      
      <div className="border-t border-gray-200 pt-4">
        <h3 className="text-lg font-medium mb-4">Form Preview</h3>
        <p className="text-sm text-gray-600 mb-6">
          This is how QA analysts will see the form when conducting an audit.
        </p>
        
        {/* Display metadata fields for CALL interaction type */}
        {form.interaction_type === 'CALL' && form.metadata_fields && form.metadata_fields.length > 0 && (
          <div className="bg-white rounded-lg shadow-md border border-gray-200 p-5 mb-6">
            <FormMetadataDisplay
              metadataFields={form.metadata_fields}
              readonly={false}
              values={Object.fromEntries(
                form.metadata_fields.map(field => {
                  // Use field.field_name if field.id is 0 or falsy to avoid "0" keys
                  const fieldKey = (field.id && field.id !== 0) ? field.id.toString() : field.field_name;
                  return [
                    fieldKey,
                    ''
                  ];
                })
              )}
              onChange={(fieldId, value) => console.log(`Field ${fieldId} changed to: ${value}`)}
              currentUser={{ id: 1, username: 'QA Analyst' }}
            />
          </div>
        )}
        
        <div className="space-y-8">
          {form.categories.map((category, categoryIndex) => (
            <div key={categoryIndex} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-lg font-medium text-gray-800">{category.category_name}</h4>
                <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded">
                  Weight: {calculateCategoryWeight(categoryIndex)}
                </span>
              </div>
              
              <div className="space-y-3">
                {category.questions.map((question, questionIndex) => (
                  <div key={questionIndex} className="bg-white p-4 rounded border border-gray-200">
                    {question.question_type !== 'SUB_CATEGORY' && (
                      <div className="flex items-start justify-between mb-3">
                        <h5 className="text-md font-medium text-gray-700">{question.question_text}</h5>
                        <span className="bg-gray-100 text-gray-800 text-xs font-medium px-2.5 py-0.5 rounded">
                          {calculateQuestionWeight(categoryIndex, questionIndex)}
                        </span>
                      </div>
                    )}
                    
                    <div className="mt-3">
                      {question.question_type === 'YES_NO' && (
                        <div className="flex space-x-4">
                          <label className="inline-flex items-center">
                            <input
                              type="radio"
                              name={`q_${categoryIndex}_${questionIndex}`}
                              className="form-radio h-4 w-4 text-blue-600"
                              disabled
                            />
                            <span className="ml-2 text-gray-700">Yes</span>
                          </label>
                          <label className="inline-flex items-center">
                            <input
                              type="radio"
                              name={`q_${categoryIndex}_${questionIndex}`}
                              className="form-radio h-4 w-4 text-blue-600"
                              disabled
                            />
                            <span className="ml-2 text-gray-700">No</span>
                          </label>
                          <label className="inline-flex items-center">
                            <input
                              type="radio"
                              name={`q_${categoryIndex}_${questionIndex}`}
                              className="form-radio h-4 w-4 text-blue-600"
                              disabled
                            />
                            <span className="ml-2 text-gray-700">N/A</span>
                          </label>
                        </div>
                      )}
                      
                      {question.question_type === 'SCALE' && (
                        <div className="flex space-x-6">
                          {Array.from({ length: 5 }, (_, i) => (
                            <label key={i} className="flex flex-col items-center">
                              <input
                                type="radio"
                                name={`q_${categoryIndex}_${questionIndex}`}
                                className="form-radio h-4 w-4 text-blue-600"
                                disabled
                              />
                              <span className="mt-1 text-sm text-gray-600">{i + 1}</span>
                            </label>
                          ))}
                        </div>
                      )}
                      
                      {question.question_type === 'TEXT' && (
                        <textarea
                          className="form-textarea w-full border border-gray-300 rounded-md px-3 py-2 bg-gray-50 cursor-not-allowed"
                          rows={3}
                          placeholder="Enter comments..."
                          disabled
                        ></textarea>
                      )}
                      
                      {question.question_type === 'N_A' && (
                        <div className="text-sm text-gray-500 italic">Not applicable</div>
                      )}
                      
                      {question.question_type === 'INFO_BLOCK' && (
                        <div className="bg-blue-50 p-3 rounded text-sm text-blue-800">
                          Informational text - no score impact
                        </div>
                      )}
                      
                      {question.question_type === 'SUB_CATEGORY' && (
                        <div className="py-1">
                          <div className="font-bold text-gray-800 text-xl">{question.question_text}</div>
                          <hr className="mt-2 border-t border-gray-300" />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FormPreview; 