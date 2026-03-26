import React, { useState, useEffect } from 'react';
import apiClient from '../../services/apiClient';
import { prepareFormForRender } from './formRenderPrep';
import { FormRenderer } from './formRendererComponents';
import { calculateFormScore } from './scoringAdapter';
import { processConditionalLogic } from './formConditions';
import type { Form as FormType, Answer as AnswerType } from '../../types';

interface CompletedFormProps {
  submissionId?: number;
  submissionData?: any; // Allow passing data directly
  formId?: number;      // Allow direct form ID for fetching form structure
  showScore?: boolean;
  showCategories?: boolean;
  showQuestions?: boolean;
  onError?: (error: string) => void;
}

interface SubmissionData {
  id: number;
  form_id: number;
  form?: FormType;
  answers: Array<{
    question_id: number;
    answer: string;
    score: number;
    notes: string;
  }>;
  total_score: number;
}

// Define a StyleSheet component to avoid React warnings with style tag
const StyleSheet: React.FC<{ css: string }> = ({ css }) => {
  // Use useInsertionEffect if available (React 18+) or useLayoutEffect as fallback
  const useInsertionEffect = React.useLayoutEffect;
  
  useInsertionEffect(() => {
    // Create style element
    const style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.textContent = css;
    
    // Append to head
    document.head.appendChild(style);
    
    // Cleanup
    return () => {
      document.head.removeChild(style);
    };
  }, [css]);
  
  return null;
};

/**
 * A reusable component for rendering completed forms in a read-only view
 * This uses the same approach as QAManualAuditForm for consistent display
 */
const CompletedFormRenderer: React.FC<CompletedFormProps> = ({
  submissionId,
  formId,
  submissionData: initialData,
  showScore = true,
  showCategories = true,
  showQuestions = true,
  onError
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [submission, setSubmission] = useState<SubmissionData | null>(initialData || null);
  const [form, setForm] = useState<FormType | null>(null);
  const [formRenderData, setFormRenderData] = useState<any | null>(null);
  const [answersRecord, setAnswersRecord] = useState<Record<number, AnswerType>>({});
  const [visibilityMap, setVisibilityMap] = useState<Record<number, boolean>>({});

  // Effect to process data immediately if provided
  useEffect(() => {
    if (initialData) {
      processSubmissionData(initialData);
    }
  }, [initialData]);

  // Fetch form data if we have a form ID
  const fetchFormData = async (id: number) => {
    try {
      const response = await apiClient.get(`/forms/${id}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching form:', error);
      throw new Error('Failed to fetch form data');
    }
  };

  // Process the submission data and fetch form if needed
  const processSubmissionData = async (submissionData: any) => {
    try {
      if (!submissionData) {
        throw new Error('No submission data received');
      }
      
      console.log('Processing submission data:', {
        id: submissionData.id,
        form_id: submissionData.form_id || formId,
        answers_length: submissionData.answers?.length || 0,
      });
      
      // First get the form structure - either from the submission or by fetching it
      let formData = submissionData.form;
      
      if (!formData) {
        // If form not included, get form ID from submission or props
        const formIdToFetch = submissionData.form_id || formId;
        if (!formIdToFetch) {
          throw new Error('No form data or form ID available');
        }
        
        console.log(`Fetching form data for form ID: ${formIdToFetch}`);
        try {
          formData = await fetchFormData(formIdToFetch);
          console.log('Fetched form data successfully:', {
            id: formData.id,
            name: formData.name,
            categories_count: formData.categories?.length
          });
        } catch (fetchErr) {
          console.error('Failed to fetch form data:', fetchErr);
          throw new Error('Failed to fetch form data');
        }
      }
      
      // If we still don't have form data with categories, we can't proceed
      if (!formData || !formData.categories || !Array.isArray(formData.categories) || formData.categories.length === 0) {
        console.error('Form data is missing or has no categories', formData);
        throw new Error('Form data is missing categories');
      }
      
      // Store the form for later use
      setForm(formData);
      
      // Convert answers array to record format for processing
      const answersByQuestionId: Record<number, AnswerType> = {};
      
      if (Array.isArray(submissionData.answers)) {
        submissionData.answers.forEach((answer: any) => {
          if (answer && answer.question_id) {
            // Find the corresponding question to get its type and score values
            const questionObj = formData?.categories?.flatMap((cat: any) => cat.questions || [])
              .find((q: any) => q.id === answer.question_id);
              
            let answerScore = answer.score || 0;
            
            // Fix for yes/no questions that have a "yes" answer but zero score
            if (questionObj && 
                questionObj.question_type?.toLowerCase() === 'yes_no' && 
                answer.answer?.toLowerCase() === 'yes' && 
                (answerScore === 0 || answerScore === undefined)) {
              
              // Get the correct score from the question definition
              // For yes/no questions, each question has a fixed point value (typically 1 point)
              // Use yes_value or score_if_yes field, with fallback to 1 point for yes/no questions
              answerScore = questionObj.yes_value || 
                           questionObj.score_if_yes || 
                           1;  // Default value for yes/no questions
                           
              // Log the fix for debugging
              console.log(`Fixed score for YES answer on question ${answer.question_id} from ${answer.score} to ${answerScore}`);
            }
            
            answersByQuestionId[answer.question_id] = {
              question_id: answer.question_id,
              answer: answer.answer || '',
              score: answerScore,
              notes: answer.notes || ''
            };
          }
        });
        console.log(`Processed ${Object.keys(answersByQuestionId).length} answers`);
      } else {
        console.warn('No answers found in submission data');
      }
      
      setAnswersRecord(answersByQuestionId);
      
      // Process conditional logic to determine which questions should be visible
      // Convert Answer objects to strings for processConditionalLogic
      const answerStrings: Record<number, string> = {};
      Object.entries(answersByQuestionId).forEach(([questionId, answerObj]) => {
        answerStrings[Number(questionId)] = typeof answerObj === 'string' ? answerObj : answerObj.answer || '';
      });
      
      const newVisibilityMap = processConditionalLogic(formData, answerStrings);
      setVisibilityMap(newVisibilityMap);
      
      // Calculate scores
      const { totalScore, categoryScores } = calculateFormScore(formData, answersByQuestionId);
      
      // Prepare form render data for display
      const renderData = prepareFormForRender(
        formData,
        answersByQuestionId,
        newVisibilityMap,
        categoryScores,
        totalScore
      );
      
      console.log('Form data ready for rendering:', {
        id: renderData.id,
        name: renderData.name,
        categoriesCount: renderData.categories?.length,
        questionsCount: renderData.categories?.reduce((count: number, cat: any) => 
          count + cat.questions.length, 0),
        categories: renderData.categories?.map(cat => cat.name)
      });
      
      setSubmission(submissionData);
      setFormRenderData(renderData);
      setError(null);
      setLoading(false);
    } catch (err: any) {
      console.error('Error processing submission data:', err);
      const errorMsg = err.message || 'Failed to process submission data';
      setError(errorMsg);
      if (onError) onError(errorMsg);
      setLoading(false);
    }
  };

  // Effect to fetch data if not provided
  useEffect(() => {
    const fetchSubmission = async () => {
      try {
        if (!submissionId && !formId) return;
        
        setLoading(true);
        
        if (submissionId) {
          // Fetch submission data with full form structure
          const response = await apiClient.get(`/qa/completed/${submissionId}?includeFullForm=true`);
          if (!response.data) {
            throw new Error('No data received from API');
          }
          
          // Log to verify the form structure
          console.log('Received submission with form structure:', {
            id: response.data.id,
            hasFullForm: !!response.data.form,
            categoryCount: response.data.form?.categories?.length || 0,
            categoryNames: response.data.form?.categories?.map((c: any) => c.name) || []
          });
          
          processSubmissionData(response.data);
        } else if (formId) {
          // If we only have a formId, create an empty submission with the form data
          const formData = await fetchFormData(formId);
          
          // Log to verify we have the correct structure
          console.log('Fetched form structure directly:', {
            id: formData.id,
            categoryCount: formData.categories?.length || 0,
            categoryNames: formData.categories?.map((c: any) => c.name) || []
          });
          
          const emptySubmission = {
            id: 0,
            form_id: formId,
            form: formData,
            answers: [],
            total_score: 0
          };
          
          processSubmissionData(emptySubmission);
        }
      } catch (err: any) {
        console.error('Error fetching data:', err);
        const errorMsg = err.response?.data?.message || 'Failed to load data';
        setError(errorMsg);
        if (onError) onError(errorMsg);
        setLoading(false);
      }
    };
    
    fetchSubmission();
  }, [submissionId, formId]);

  // Empty change handlers for the read-only FormRenderer
  const handleAnswerChange = () => {};
  const handleNotesChange = () => {};

  if (loading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-blue"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 p-4 rounded-lg border border-red-200 text-red-700">
        <p>{error}</p>
      </div>
    );
  }

  if (!formRenderData) {
    return (
      <div className="bg-orange-50 p-4 rounded-lg border border-orange-200 text-orange-700">
        <p>No form data available.</p>
      </div>
    );
  }

  return (
    <div className="completed-form-container">
      {/* Form Header */}
      <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6 mb-6">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-800">
            {formRenderData.name}
          </h2>
          {form && (
            <div className="text-sm text-gray-500 bg-gray-50 px-3 py-1 rounded-full">
              Version {(form as any).version || 1}
            </div>
          )}
        </div>
      </div>

      {/* Form Content */}
      <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
        {/* Use the same FormRenderer that's used in the QA manual review form */}
        <FormRenderer
          formRenderData={formRenderData}
          isDisabled={true} // Make the form read-only
          onAnswerChange={handleAnswerChange}
          onNotesChange={handleNotesChange}
        />
      </div>
      
      {/* Display score summary if requested */}
      {showScore && formRenderData.totalScore !== undefined && (
        <div className="mt-6 bg-white rounded-lg shadow-md border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Score Summary</h3>
          
          {/* Total Score */}
          <div className="flex items-center mb-6">
            <div className={`text-3xl font-bold ${
              formRenderData.totalScore >= 90 ? 'text-green-600' : 
              formRenderData.totalScore >= 70 ? 'text-blue-600' : 
              formRenderData.totalScore >= 50 ? 'text-yellow-600' : 'text-red-600'
            }`}>
              {formRenderData.totalScore.toFixed(1)}%
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CompletedFormRenderer; 