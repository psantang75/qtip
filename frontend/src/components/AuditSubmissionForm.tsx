import React, { useState, useEffect } from 'react';
import type { Form, FormMetadataField } from '../types/form.types';
import FormMetadataDisplay from './FormMetadataDisplay';

interface AuditSubmissionFormProps {
  formId: number;
  callId?: number; // Optional for manual reviews
  onSubmit: (data: any) => Promise<void>;
  onCancel: () => void;
}

const AuditSubmissionForm: React.FC<AuditSubmissionFormProps> = ({
  formId,
  callId,
  onSubmit,
  onCancel
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [metadataValues, setMetadataValues] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [csrOptions, setCsrOptions] = useState<{ id: number; username: string }[]>([]);
  const [currentUser, setCurrentUser] = useState<{ id: number; username: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch form, CSRs, and user data
  useEffect(() => {
    const fetchFormData = async () => {
      try {
        setIsLoading(true);
        
        // These would be real API calls in the actual implementation
        // For demo purposes, we'll simulate the data
        
        // Simulate fetching the form with metadata
        const mockForm: Form = {
          id: formId,
          form_name: 'Call Quality Audit',
          interaction_type: 'CALL',
          version: 1,
          is_active: true,
          categories: [
            {
              id: 1,
              category_name: 'Greeting & Introduction',
              weight: 0.2,
              questions: [
                {
                  id: 1,
                  question_text: 'Agent greeted customer professionally',
                  question_type: 'YES_NO',
                  weight: 0.5,
                }
              ]
            }
          ],
          metadata_fields: [
                          { id: 1, field_name: 'Reviewer Name', field_type: 'AUTO', is_required: true, dropdown_source: null, interaction_type: 'CALL' },
            { id: 2, field_name: 'Review Date', field_type: 'AUTO', is_required: true, dropdown_source: null, interaction_type: 'CALL' },
            { id: 3, field_name: 'CSR', field_type: 'DROPDOWN', is_required: true, dropdown_source: 'users', interaction_type: 'CALL' },
            { id: 4, field_name: 'Customer ID', field_type: 'TEXT', is_required: true, dropdown_source: null, interaction_type: 'CALL' },
            { id: 5, field_name: 'Customer Name', field_type: 'TEXT', is_required: true, dropdown_source: null, interaction_type: 'CALL' },
            { id: 6, field_name: 'Ticket Number', field_type: 'TEXT', is_required: true, dropdown_source: null, interaction_type: 'CALL' },
            { id: 7, field_name: 'Call Conversation ID', field_type: 'TEXT', is_required: true, dropdown_source: null, interaction_type: 'CALL' },
            { id: 8, field_name: 'Call Date', field_type: 'DATE', is_required: true, dropdown_source: null, interaction_type: 'CALL' },
          ]
        };

        // Simulate fetching CSR list
        const mockCsrOptions = [
          { id: 101, username: 'john.doe' },
          { id: 102, username: 'jane.smith' },
          { id: 103, username: 'robert.johnson' },
        ];

        // Simulate current user data
        const mockCurrentUser = { id: 201, username: 'qa.analyst' };
        
        // Set the data
        setForm(mockForm);
        setCsrOptions(mockCsrOptions);
        setCurrentUser(mockCurrentUser);
        
        // If this is for an existing call, pre-fill some metadata
        if (callId) {
          setMetadataValues({
            '3': '101', // CSR ID
            '4': 'CUST-12345', // Customer ID
            '5': 'John Customer', // Customer Name
            '6': 'TKT-789', // Ticket Number
            '7': 'CALL-456', // Recording ID
            '8': new Date().toISOString().split('T')[0], // Call date (today)
          });
        }
        
        setIsLoading(false);
      } catch (error) {
        console.error('Error fetching form data:', error);
        setError('Failed to load form data. Please try again.');
        setIsLoading(false);
      }
    };

    fetchFormData();
  }, [formId, callId]);

  const handleMetadataChange = (fieldId: string, value: string) => {
    setMetadataValues(prev => ({
      ...prev,
      [fieldId]: value
    }));
  };

  const handleAnswerChange = (questionId: string, value: any) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!form || !currentUser) return;
    
    try {
      setIsSubmitting(true);
      
      // Prepare metadata entries
      const metadata = Object.entries(metadataValues).map(([field_id, value]) => ({
        field_id: parseInt(field_id),
        value,
      }));
      
      // Prepare form answers
      const formAnswers = Object.entries(answers).map(([question_id, value]) => ({
        question_id: parseInt(question_id),
        value: value.toString(),
      }));
      
      // Create submission payload
      const payload = {
        form_id: form.id,
        call_id: callId,
        submitted_by: currentUser.id,
        metadata,
        answers: formAnswers,
      };
      
      // Submit the data
      await onSubmit(payload);
      
      setIsSubmitting(false);
    } catch (error) {
      console.error('Error submitting form:', error);
      setError('Failed to submit the form. Please try again.');
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!form || !currentUser) {
    return <div className="text-red-500">Form not found</div>;
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl">
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">{form.form_name}</h1>
          <div className="flex items-center space-x-3">
            <span className="text-sm bg-blue-100 text-blue-800 px-2 py-1 rounded">
              {form.interaction_type}
            </span>
            <span className="text-sm bg-gray-100 text-gray-700 px-2 py-1 rounded">
              Version {form.version}
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Metadata Display Component */}
          {form.metadata_fields && form.metadata_fields.length > 0 && (
            <FormMetadataDisplay
              metadataFields={form.metadata_fields}
              values={metadataValues}
              onChange={handleMetadataChange}
              currentUser={currentUser}
              csrOptions={csrOptions}
            />
          )}

          {/* Form Questions */}
          <div className="space-y-6">
            {form.categories.map((category, catIndex) => (
              <div key={catIndex} className="bg-gray-50 rounded-lg border border-gray-200 p-4">
                <h3 className="text-lg font-medium text-gray-800 mb-3">{category.category_name}</h3>
                
                <div className="space-y-4">
                  {category.questions.map((question, qIndex) => (
                    <div key={qIndex} className="bg-white p-4 rounded-md border border-gray-200">
                      <div className="mb-2">
                        <div className="flex justify-between items-start">
                          <h4 className="text-gray-800 font-medium">{question.question_text}</h4>
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                            Weight: {(question.weight * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>
                      
                      {question.question_type === 'YES_NO' && (
                        <div className="flex space-x-4 mt-2">
                          <label className="inline-flex items-center">
                            <input
                              type="radio"
                              name={`question_${question.id}`}
                              value="YES"
                              checked={answers[question.id?.toString() || ''] === 'YES'}
                              onChange={() => handleAnswerChange(question.id?.toString() || '', 'YES')}
                              className="h-4 w-4 text-blue-600"
                              required
                            />
                            <span className="ml-2 text-sm text-gray-700">Yes</span>
                          </label>
                          <label className="inline-flex items-center">
                            <input
                              type="radio"
                              name={`question_${question.id}`}
                              value="NO"
                              checked={answers[question.id?.toString() || ''] === 'NO'}
                              onChange={() => handleAnswerChange(question.id?.toString() || '', 'NO')}
                              className="h-4 w-4 text-blue-600"
                              required
                            />
                            <span className="ml-2 text-sm text-gray-700">No</span>
                          </label>
                          <label className="inline-flex items-center">
                            <input
                              type="radio"
                              name={`question_${question.id}`}
                              value="N/A"
                              checked={answers[question.id?.toString() || ''] === 'N/A'}
                              onChange={() => handleAnswerChange(question.id?.toString() || '', 'N/A')}
                              className="h-4 w-4 text-blue-600"
                            />
                            <span className="ml-2 text-sm text-gray-700">N/A</span>
                          </label>
                        </div>
                      )}
                      
                      {question.question_type === 'TEXT' && (
                        <textarea
                          name={`question_${question.id}`}
                          value={answers[question.id?.toString() || ''] || ''}
                          onChange={(e) => handleAnswerChange(question.id?.toString() || '', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md mt-2"
                          rows={3}
                          placeholder="Enter your response..."
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Form Actions */}
          <div className="mt-8 flex justify-end space-x-4">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Submitting...' : 'Submit Audit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AuditSubmissionForm; 