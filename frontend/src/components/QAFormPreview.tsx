import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { HiOutlineArrowLeft } from 'react-icons/hi';
import type { Form } from '../types/form.types';
import { 
  prepareFormForRender, 
  FormRenderer, 
  generateFormPreview,
  type FormRenderData,
  type CategoryRenderData
} from '../utils/forms/formRendererComponents';
import type { Form as IndexForm, Answer } from '../types';
import { processConditionalLogic } from '../utils/forms/formConditions';
import { calculateFormScore, getQuestionScore } from '../utils/forms/scoringAdapter';
import { getFormById } from '../services/formService';
import axios from 'axios';

// Add User type to handle username display
interface User {
  id: number;
  username: string;
}

const QAFormPreview: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const formId = searchParams.get('formId');
  
  const [form, setForm] = useState<Form | null>(null);
  const [formRenderData, setFormRenderData] = useState<FormRenderData | null>(null);
  const [previewAnswers, setPreviewAnswers] = useState<Record<number, Answer>>({});
  const [previewVisibilityMap, setPreviewVisibilityMap] = useState<Record<number, boolean>>({});
  const [previewForm, setPreviewForm] = useState<IndexForm | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [createdByUser, setCreatedByUser] = useState<string>('');
  
  // Fetch form data when component mounts
  useEffect(() => {
    if (formId) {
      fetchFormData(Number(formId));
    } else {
      setError('No form ID provided. Please select a form to preview.');
      setIsLoading(false);
    }
  }, [formId]);
  
  // Fetch creator username if we have a user ID
  useEffect(() => {
    if (form && form.created_by && typeof form.created_by === 'number') {
      fetchUserInfo(form.created_by);
    }
  }, [form]);
  
  // Fetch user information to get username
  const fetchUserInfo = async (userId: number) => {
    try {
      // Make API call to get user information
      const response = await axios.get(`/api/users/${userId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      
      if (response.data && response.data.username) {
        setCreatedByUser(response.data.username);
      } else {
        setCreatedByUser(`User ${userId}`);
      }
    } catch (err) {
      console.error('Error fetching user data:', err);
      setCreatedByUser(`User ${userId}`); // Fallback
    }
  };
  
  // Fetch form data from API
  const fetchFormData = async (id: number) => {
    try {
      setIsLoading(true);
      
      // Get form data
      const formData = await getFormById(id, true); // Include inactive forms for QA preview
      setForm(formData);
      
      if (formData) {
        try {
          // First, create a mapping of original question objects to generated IDs
          const questionIdMap = new Map();
          formData.categories.forEach((category, catIdx) => {
            category.questions.forEach((question, qIdx) => {
              // Generate a temporary ID if one doesn't exist
              const tempId = question.id || (-1000 - (catIdx * 100 + qIdx));
              questionIdMap.set(question, tempId);
            });
          });
          
          // Ensure all questions have IDs for preview
          const formWithIds = {
            ...formData as any,
            categories: (formData as any).categories.map((category: any, catIdx: number) => ({
              ...category,
              questions: category.questions.map((question: any, qIdx: number) => {
                // Use the previously mapped ID
                const tempId = questionIdMap.get(question);
                
                // For conditional questions, find the target question and use its mapped ID
                let targetQuestionId = undefined;
                if (question.is_conditional) {
                  // Try to find the target question by its ID first
                  if (question.conditional_question_id) {
                    // Find the original question object
                    const targetQuestion = formData.categories
                      .flatMap(cat => cat.questions)
                      .find(q => q.id === question.conditional_question_id);
                    
                    if (targetQuestion) {
                      // Get the mapped ID
                      targetQuestionId = questionIdMap.get(targetQuestion);
                    }
                  } 
                  // If we have a direct reference to another question's index
                  else if (question.conditional_target_index !== undefined) {
                    targetQuestionId = -1000 - question.conditional_target_index;
                  }
                  // Fallback if no target was found
                  else if (catIdx > 0 && qIdx > 0) {
                    // Default to the previous question as target if all else fails
                    const prevQuestion = category.questions[qIdx - 1];
                    if (prevQuestion) {
                      targetQuestionId = questionIdMap.get(prevQuestion);
                    }
                  }
                }
                
                return {
                  ...question,
                  // Ensure each question has a proper ID
                  id: tempId,
                  // Ensure conditional logic fields are properly set
                  conditional_logic: question.is_conditional ? {
                    target_question_id: targetQuestionId || -1000, // Use properly mapped ID or fallback
                    condition_type: (question.condition_type || 'equals').toLowerCase(),
                    target_value: question.conditional_value || 'YES', // Default to YES if not specified
                    exclude_if_unmet: false // Add required field
                  } : undefined,
                  // Also keep the original properties to ensure compatibility with different code paths
                  conditional_question_id: targetQuestionId || question.conditional_question_id
                };
              })
            }))
          };
          
          // Generate form preview data
          const previewData = generateFormPreview(formWithIds, false);
          
          // Store preview data in state
          setPreviewForm(previewData.form);
          
          // Convert answers to Record<number, Answer> format if needed
          const answersRecord: Record<number, Answer> = Array.isArray(previewData.answers)
            ? previewData.answers.reduce((acc, answer) => {
                acc[answer.question_id] = {
                  question_id: answer.question_id,
                  answer: answer.answer || '',
                  score: answer.score || 0,
                  notes: answer.notes || ''
                };
                return acc;
              }, {} as Record<number, Answer>)
            : Object.entries(previewData.answers).reduce((acc, [questionId, answer]) => {
                acc[Number(questionId)] = {
                  question_id: Number(questionId),
                  answer: answer.answer || '',
                  score: answer.score || 0,
                  notes: answer.notes || ''
                };
                return acc;
              }, {} as Record<number, Answer>);
          
          setPreviewAnswers(answersRecord);
          
          // Convert Answer objects to strings for conditional logic
          const answerStrings: Record<number, string> = {};
          Object.entries(answersRecord).forEach(([questionId, answer]) => {
            answerStrings[Number(questionId)] = answer.answer || '';
          });
          
          // Process conditional logic without forcibly showing all questions
          // This allows conditional questions to show/hide based on answers
          const allVisibleMap = processConditionalLogic(
            previewData.form, 
            answerStrings,
            false // Set isPreview=false to properly evaluate conditions
          );
          
          setPreviewVisibilityMap(allVisibleMap);
          
          // Convert CategoryScore[] to the expected Record format
          const categoryScoresRecord: Record<number, { 
            raw: number; 
            weighted: number; 
            earnedPoints?: number; 
            possiblePoints?: number; 
          }> = Array.isArray(previewData.categoryScores) 
            ? previewData.categoryScores.reduce((acc, catScore) => {
                acc[Number(catScore.categoryId)] = {
                  raw: catScore.rawScore,
                  weighted: catScore.weightedScore,
                  earnedPoints: catScore.earnedPoints,
                  possiblePoints: catScore.possiblePoints
                };
                return acc;
              }, {} as Record<number, { raw: number; weighted: number; earnedPoints?: number; possiblePoints?: number; }>)
            : previewData.categoryScores;
          
          // Prepare form for rendering
          const renderData = prepareFormForRender(
            previewData.form,
            answersRecord,
            allVisibleMap, // Use our visibility map that shows all questions
            categoryScoresRecord,
            previewData.score
          );
          
          setFormRenderData(renderData);
        } catch (error) {
          console.error("Error preparing form for render:", error);
          setError("Failed to prepare form for preview. There might be an issue with the form structure.");
        }
      }
      
      setIsLoading(false);
    } catch (err) {
      console.error('Error fetching form data:', err);
      setError('Failed to load form data. Please try again.');
      setIsLoading(false);
    }
  };
  
  // Navigate back to form library
  const handleBack = () => {
    navigate('/qa/form-library');
  };
  
  // Handle answer changes (for interactive preview)
  const handleAnswerChange = (questionId: number, value: string, type: string) => {
    // Update the answers state
    setPreviewAnswers(prevAnswers => {
      // Create a copy of the current answers
      const updatedAnswers = {...prevAnswers};
      
      // Find the question to calculate its score
      const question = previewForm?.categories
        .flatMap(cat => cat.questions)
        .find(q => q.id === questionId);
      
      // Calculate score for this answer using our scoring adapter
      const score = question ? getQuestionScore(question, value) : 0;
      
      // Update or create the answer for this question
      updatedAnswers[questionId] = {
        ...updatedAnswers[questionId] || {},
        question_id: questionId,
        answer: value,
        score: score,
        notes: updatedAnswers[questionId]?.notes || '',
      };
      
      return updatedAnswers;
    });
  };
  
  // Handle notes changes
  const handleNotesChange = (questionId: number, notes: string) => {
    // Update the answers state
    setPreviewAnswers(prevAnswers => {
      // Create a copy of the current answers
      const updatedAnswers = {...prevAnswers};
      
      // Update or create the notes for this question
      updatedAnswers[questionId] = {
        ...updatedAnswers[questionId] || {},
        question_id: questionId,
        notes: notes,
        // Keep existing answer and score, or set defaults
        answer: updatedAnswers[questionId]?.answer || '',
        score: updatedAnswers[questionId]?.score || 0,
      };
      
      return updatedAnswers;
    });
  };
  
  // Update the form render data when answers change
  useEffect(() => {
    if (previewForm && Object.keys(previewAnswers).length > 0) {
      // Convert Answer objects to strings for conditional logic
      const updatedAnswerStrings: Record<number, string> = {};
      Object.entries(previewAnswers).forEach(([questionId, answer]) => {
        updatedAnswerStrings[Number(questionId)] = answer.answer || '';
      });
      
      // Update visibility map based on current answers
      const updatedVisibilityMap = processConditionalLogic(
        previewForm,
        updatedAnswerStrings,
        false // Always use false to properly apply conditional logic
      );
      
      setPreviewVisibilityMap(updatedVisibilityMap);
      
      // Calculate scores with the updated answers
      const { totalScore, categoryScores } = calculateFormScore(previewForm, previewAnswers);
      
      // Re-prepare the form with the updated answers, visibility, and scores
      const updatedRenderData = prepareFormForRender(
        previewForm,
        previewAnswers,
        updatedVisibilityMap,
        categoryScores,
        totalScore
      );
      
      setFormRenderData(updatedRenderData);
    }
  }, [previewAnswers, previewForm]);
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-neutral-100">
        <div className="animate-spin h-12 w-12 text-primary-blue">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      </div>
    );
  }
  
  // Format date helper function - Only show date without time
  const formatDate = (dateString?: string | Date) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString(); // Only date without time
  };
  
  return (
    <div className="container p-6 mx-auto relative">
      {/* Title and back button */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">Form Preview</h1>
        <button 
          onClick={handleBack}
          className="flex items-center text-primary-blue hover:text-primary-blue-dark"
        >
          <HiOutlineArrowLeft className="h-5 w-5 mr-1" />
          Back to Form Library
        </button>
      </div>
      
      {error && (
        <div className="p-4 mb-6 text-red-700 bg-red-100 rounded-md">
          {error}
          <button 
            className="float-right font-bold" 
            onClick={() => setError(null)}
            aria-label="Close error message"
          >
            &times;
          </button>
        </div>
      )}
      
      {form && (
        <div className="mb-4 bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold">{form.form_name}</h2>
            <div className="text-gray-600 text-sm bg-gray-50 px-3 py-1 rounded-full">
              Version {form.version}
            </div>
          </div>
          
          <hr className="my-4 border-gray-200" />
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-600">
                <span className="font-medium">Form Status:</span> 
                <span className={`ml-2 inline-block px-2 py-1 text-sm rounded-full text-gray-800`}>
                  {form.is_active ? 'Active' : 'Inactive'}
                </span>
              </p>
              
              {form.interaction_type && (
                <p className="text-sm text-gray-600 mt-2">
                  <span className="font-medium">Form Type:</span>
                  <span className="ml-2 inline-block px-2 py-1 text-sm rounded-full text-gray-800">
                    {form.interaction_type === 'UNIVERSAL' ? 'Universal' : 
                     form.interaction_type === 'CALL' ? 'Call' : 
                     form.interaction_type === 'TICKET' ? 'Ticket' : 
                     form.interaction_type === 'EMAIL' ? 'Email' : 
                     form.interaction_type === 'CHAT' ? 'Chat' : 
                     form.interaction_type}
                  </span>
                </p>
              )}
            </div>
            
            <div className="text-right">
              {form?.created_by && (
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Created By:</span> {
                    createdByUser || String(form.created_by)
                  }
                </p>
              )}
              
              <p className="text-sm text-gray-600 mt-2">
                <span className="font-medium">Created Date:</span> {formatDate(form?.created_at)}
              </p>
            </div>
          </div>
        </div>
      )}
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Form Preview */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
            {formRenderData ? (
              <FormRenderer 
                formRenderData={formRenderData}
                isDisabled={true}
                onAnswerChange={handleAnswerChange}
                onNotesChange={handleNotesChange}
              />
            ) : !isLoading && !error && (
              <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                <p className="mb-2">No form content available</p>
                <p className="text-sm text-gray-400">This form has no content or could not be displayed</p>
              </div>
            )}
          </div>
        </div>

        {/* Scoring Panel */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6 sticky top-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Form Structure</h3>
            
            {formRenderData ? (
              <div>
                {/* Category Weights */}
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Category Weights</h4>
                  <div className="space-y-2">
                    {formRenderData.categories.map((category) => (
                      <div key={category.id} className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">{category.name}</span>
                        <span className="text-sm font-medium">{(category.weight * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* Question Count by Type */}
                <div className="border-t border-gray-200 pt-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Question Types</h4>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {Array.from(new Set(formRenderData.categories.flatMap(cat => 
                      cat.allQuestions.map(q => q.type)
                    ))).map((type) => (
                      <span key={type} className="px-2 py-1 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-800">
                        {type}
                      </span>
                    ))}
                  </div>
                </div>
                
                {/* Form Summary Stats */}
                <div className="border-t border-gray-200 pt-4 mt-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Form Summary</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Categories</span>
                      <span className="text-sm font-medium">{formRenderData.categories.length}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Total Questions</span>
                      <span className="text-sm font-medium">
                        {formRenderData.categories.reduce((sum, cat) => sum + cat.allQuestions.length, 0)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Conditional Questions</span>
                      <span className="text-sm font-medium">
                        {formRenderData.categories.reduce((sum, cat) => 
                          sum + cat.allQuestions.filter(q => q.isConditional).length, 0)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-4 text-center text-gray-500">No form data available</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default QAFormPreview; 