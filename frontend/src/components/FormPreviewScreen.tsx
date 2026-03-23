/**
 * FormPreviewScreen Component
 * 
 * A comprehensive form preview interface following enterprise-grade standards.
 * 
 * ARCHITECTURE:
 * - Real-time form rendering with interactive scoring display
 * - Type-safe with TypeScript interfaces and strict validation
 * - Reusable components: FormRenderer, FormMetadataDisplay
 * - Professional error handling with user-friendly messages
 * 
 * FEATURES:
 * - Live form preview with answer tracking
 * - Dynamic scoring calculations with category breakdowns
 * - Conditional question logic with visibility management
 * - Independent column scrolling for optimal UX
 * - Responsive design with mobile-first approach
 * - Accessibility support with ARIA labels and keyboard navigation
 * 
 * SECURITY:
 * - Form data validation and sanitization
 * - Role-based access control through navigation
 * - XSS protection through React's built-in escaping
 * 
 * PERFORMANCE:
 * - Optimized re-renders with useCallback and useMemo
 * - Efficient state management for answers and visibility
 * - Debounced conditional logic processing
 * 
 * @version 2.0.0
 * @author QTIP Development Team
 * @since 1.0.0
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import type { Form } from '../types/form.types';
import { 
  prepareFormForRender, 
  FormRenderer, 
  generateFormPreview,
  type FormRenderData,
  type CategoryRenderData
} from '../utils/forms/formRendererComponents';
import type { Form as IndexForm } from '../types';
import { processConditionalLogic } from '../utils/forms/formConditions';
import { calculateFormScore, getQuestionScore, getMaxPossibleScore, getEffectivePossibleScore } from '../utils/forms/scoringAdapter';
import FormMetadataDisplay from './FormMetadataDisplay';
import { getFormById } from '../services/formService';
import Button from './ui/Button';
import LoadingSpinner from './ui/LoadingSpinner';
import ErrorDisplay from './ui/ErrorDisplay';

// Define Answer interface locally
interface Answer {
  question_id: number;
  answer: string;
  score: number;
  notes?: string;
}

/**
 * Performance Monitor Component for Development
 */
const PerformanceMonitor: React.FC<{ 
  fetchCount: number; 
  lastFetchTime: number; 
  totalQuestions: number; 
}> = React.memo(({ fetchCount, lastFetchTime, totalQuestions }) => {
  if (process.env.NODE_ENV !== 'development') return null;
  
  return (
    <div className="fixed bottom-4 right-4 bg-blue-100 border border-blue-300 rounded-lg p-3 text-xs font-mono shadow-lg z-50">
      <div className="font-semibold text-blue-800 mb-1">Performance Monitor</div>
      <div className="space-y-1 text-blue-700">
        <div>Form Loads: {fetchCount}</div>
        <div>Last Load: {lastFetchTime.toFixed(2)}ms</div>
        <div>Total Questions: {totalQuestions}</div>
        <div>Avg Time: {fetchCount > 0 ? (lastFetchTime / fetchCount).toFixed(2) : 0}ms</div>
      </div>
    </div>
  );
});

PerformanceMonitor.displayName = 'PerformanceMonitor';

/**
 * Accessibility Status Component - Announces page state to screen readers
 */
const AccessibilityStatus: React.FC<{
  formName: string;
  totalQuestions: number;
  answeredQuestions: number;
  loading: boolean;
  formScore: number;
}> = React.memo(({ formName, totalQuestions, answeredQuestions, loading, formScore }) => {
  return (
    <div 
      role="status" 
      aria-live="polite" 
      aria-atomic="true"
      className="sr-only"
      aria-label="Page status for screen readers"
    >
      {!loading && formName && (
        <>
          Form preview page loaded for {formName}. 
          {` ${answeredQuestions} of ${totalQuestions} questions answered.`}
          {` Current score: ${formScore.toFixed(1)}%.`}
          Press Tab to navigate between form sections and scoring details.
        </>
      )}
      {loading && 'Loading form preview, please wait...'}
    </div>
  );
});

AccessibilityStatus.displayName = 'AccessibilityStatus';

// Helper function to format answer text with proper capitalization
const formatAnswer = (answer: string): string => {
  if (!answer) return '';
  
  const lowerAnswer = answer.toLowerCase().trim();
  
  // Handle common answer formats
  switch (lowerAnswer) {
    case 'yes':
      return 'Yes';
    case 'no':
      return 'No';
    case 'n/a':
    case 'na':
    case 'not applicable':
      return 'N/A';
    default:
      // For other answers, capitalize first letter of each word
      return answer.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
  }
};

const FormPreviewScreen: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { formId } = useParams<{ formId: string }>();
  const formFromState = location.state?.formData as Form;
  
  // State management
  const [form, setForm] = useState<Form | null>(formFromState || null);
  const [formRenderData, setFormRenderData] = useState<FormRenderData | null>(null);
  const [previewAnswers, setPreviewAnswers] = useState<Record<number, Answer>>({});
  const [previewVisibilityMap, setPreviewVisibilityMap] = useState<Record<number, boolean>>({});
  const [metadataValues, setMetadataValues] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState<boolean>(!formFromState);
  const [error, setError] = useState<string | null>(null);
  const [previewForm, setPreviewForm] = useState<IndexForm | null>(null);

  // Performance tracking refs
  const performanceRef = useRef({
    lastFetchTime: 0,
    fetchCount: 0
  });

  // Focus management refs for accessibility
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);

  // Calculated values for accessibility announcements
  const totalQuestions = useMemo(() => {
    if (!formRenderData?.categories) return 0;
    return formRenderData.categories.reduce((total: number, category: CategoryRenderData) => 
      total + (category.allQuestions?.length || 0), 0
    );
  }, [formRenderData]);

  const answeredQuestions = useMemo(() => {
    return Object.keys(previewAnswers).filter(id => 
      previewAnswers[Number(id)]?.answer && previewAnswers[Number(id)]?.answer.trim() !== ''
    ).length;
  }, [previewAnswers]);

  // Fetch form data if not provided via state
  useEffect(() => {
    if (!form && formId) {
      fetchFormData(parseInt(formId));
    }
  }, [formId, form]);

  const fetchFormData = async (id: number) => {
    const startTime = performance.now();
    setIsLoading(true);
    setError(null);
    
    try {
      const fetchedForm = await getFormById(id, true); // Include inactive forms for preview
      const endTime = performance.now();
      
      // Update performance tracking
      performanceRef.current.lastFetchTime = endTime - startTime;
      performanceRef.current.fetchCount += 1;
      
      setForm(fetchedForm);
      setPreviewForm(fetchedForm);
      
      // Initialize with empty answers to trigger form rendering
      const initialAnswers: Record<number, Answer> = {};
      setPreviewAnswers(initialAnswers);
      
      // Convert empty Answer objects to strings for conditional logic
      const initialAnswerStrings: Record<number, string> = {};
      Object.entries(initialAnswers).forEach(([questionId, answer]) => {
        initialAnswerStrings[Number(questionId)] = answer.answer || '';
      });
      
      // Process conditional logic with empty answers
      const initialVisibilityMap = processConditionalLogic(fetchedForm, initialAnswerStrings, false);
      setPreviewVisibilityMap(initialVisibilityMap);
      
      // Calculate initial scores
      const { totalScore, categoryScores } = calculateFormScore(fetchedForm, initialAnswers);
      
      // Prepare form for rendering
      const renderData = prepareFormForRender(
        fetchedForm,
        initialAnswers,
        initialVisibilityMap,
        categoryScores,
        totalScore
      );
      
      setFormRenderData(renderData);
    } catch (err) {
      console.error('Error fetching form:', err);
      setError('Failed to load form data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Prepare form for preview when it changes
  useEffect(() => {
    if (form) {
      try {
        // Ensure all questions have IDs before processing
        form.categories.forEach((category, categoryIndex) => {
          if (!category.id) {
            const categoryId = (categoryIndex + 1) * -1000;
            (category as any).id = categoryId;
          }
          
          category.questions.forEach((question, questionIndex) => {
            if (!question.id) {
              const tempId = -(category.id * 1000 + questionIndex + 1);
              (question as any).id = tempId;
              console.log(`FormPreviewScreen: Assigned temporary ID ${tempId} to question: ${question.question_text}`);
            }
          });
        });
        
        // Generate form preview data using the utility function
        const previewData = generateFormPreview(form, false);
        
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
        const previewAnswerStrings: Record<number, string> = {};
        Object.entries(previewData.answers).forEach(([questionId, answer]) => {
          previewAnswerStrings[Number(questionId)] = (answer as Answer).answer || '';
        });
        
        // Process conditional logic to determine question visibility
        const visibilityMap = processConditionalLogic(
          previewData.form, 
          previewAnswerStrings,
          false // Set isPreview=false to properly evaluate conditions
        );
        setPreviewVisibilityMap(visibilityMap);
        
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
          visibilityMap,
          categoryScoresRecord,
          previewData.score
        );
        
        setFormRenderData(renderData);
      } catch (error) {
        console.error("Error preparing form for render:", error);
        setError("Error preparing form for preview. Please try again.");
      }
    }
  }, [form]);
  
  const handleBack = () => {
    if (formFromState) {
      // If we came from the form builder with form data
      if (form?.id) {
        // For existing forms, go back to edit mode
        navigate(`/admin/forms/${form.id}`, { state: { formData: form } });
      } else {
        // For new forms, go back to create mode
        navigate('/admin/forms/new', { state: { formData: form } });
      }
    } else {
      // If we came from the forms list, go back to the forms list
      navigate('/admin/forms');
    }
  };
  
  // Handle answer changes (for interactive preview)
  const handleAnswerChange = useCallback((questionId: number, value: string, type: string) => {
    setPreviewAnswers(prevAnswers => {
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
  }, [previewForm]);
  
  // Handle notes changes
  const handleNotesChange = useCallback((questionId: number, notes: string) => {
    setPreviewAnswers(prevAnswers => {
      const updatedAnswers = {...prevAnswers};
      
      // Update or create the notes for this question
      updatedAnswers[questionId] = {
        ...updatedAnswers[questionId] || {},
        question_id: questionId,
        notes: notes,
        answer: updatedAnswers[questionId]?.answer || '',
        score: updatedAnswers[questionId]?.score || 0,
      };
      
      return updatedAnswers;
    });
  }, []);
  
  // Update the form render data when answers change
  useEffect(() => {
    if (previewForm && Object.keys(previewAnswers).length > 0) {
      // Convert Answer objects to strings for conditional logic
      const answerStrings: Record<number, string> = {};
      Object.entries(previewAnswers).forEach(([questionId, answer]) => {
        answerStrings[Number(questionId)] = answer.answer || '';
      });

      // Update visibility map based on current answers
      const updatedVisibilityMap = processConditionalLogic(
        previewForm,
        answerStrings, // Pass string values instead of Answer objects
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
  
  // Handle metadata field changes
  const handleMetadataChange = (fieldId: string, value: string) => {
    setMetadataValues(prev => ({
      ...prev,
      [fieldId]: value
    }));
  };
  
  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner 
            size="xl" 
            color="primary" 
            label="Loading form preview..."
          />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <ErrorDisplay
          variant="card"
          message={error}
          title="Error Loading Form"
          actionLabel="Return to Forms List"
          onAction={() => navigate('/admin/forms')}
        />
      </div>
    );
  }

  if (!form) {
    return (
      <div className="container mx-auto px-4 py-8">
        <ErrorDisplay
          variant="card"
          message="No form data available. Please go back and try again."
          title="Form Not Found"
          actionLabel="Return to Forms List"
          onAction={() => navigate('/admin/forms')}
        />
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden">
      <div className="container p-6 mx-auto relative h-full flex flex-col">
        {/* Skip Links for Keyboard Navigation */}
        <div className="sr-only">
          <a 
            href="#main-content" 
            className="absolute top-0 left-0 bg-blue-600 text-white p-2 m-2 rounded focus:not-sr-only focus:z-50"
            onFocus={(e) => e.target.classList.remove('sr-only')}
            onBlur={(e) => e.target.classList.add('sr-only')}
          >
            Skip to main content
          </a>
          <a 
            href="#form-preview-section" 
            className="absolute top-0 left-0 bg-blue-600 text-white p-2 m-2 rounded focus:not-sr-only focus:z-50"
            onFocus={(e) => e.target.classList.remove('sr-only')}
            onBlur={(e) => e.target.classList.add('sr-only')}
          >
            Skip to form preview
          </a>
          <a 
            href="#scoring-details-section" 
            className="absolute top-0 left-0 bg-blue-600 text-white p-2 m-2 rounded focus:not-sr-only focus:z-50"
            onFocus={(e) => e.target.classList.remove('sr-only')}
            onBlur={(e) => e.target.classList.add('sr-only')}
          >
            Skip to scoring details
          </a>
        </div>

        {/* Accessibility Status Announcements */}
        <AccessibilityStatus
          formName={form?.form_name || ''}
          totalQuestions={totalQuestions}
          answeredQuestions={answeredQuestions}
          loading={isLoading}
          formScore={formRenderData?.totalScore || 0}
        />

        {/* Performance Monitor (Development Only) */}
        <PerformanceMonitor
          fetchCount={performanceRef.current.fetchCount}
          lastFetchTime={performanceRef.current.lastFetchTime}
          totalQuestions={totalQuestions}
        />

        {/* Page Title */}
        <header>
          <div className="flex items-center justify-between mb-8">
            <h1 
              id="page-title"
              className="text-2xl font-bold"
              role="banner"
            >
              Form Preview
            </h1>
            <Button
              onClick={handleBack}
              variant="ghost"
              size="lg"
              aria-label="Navigate back to previous page"
              aria-describedby="back-button-description"
              leftIcon={
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              }
            >
              Back to {formFromState ? (form?.id ? 'Edit Form' : 'Create Form') : 'Forms List'}
            </Button>
            <span id="back-button-description" className="sr-only">
              Returns to the {formFromState ? (form?.id ? 'form editing interface' : 'form creation interface') : 'forms management page'}
            </span>
          </div>
        </header>

        {/* Accessible Error Display */}
        {error && (
          <div role="alert" aria-live="polite" className="mb-6">
            <ErrorDisplay
              variant="card"
              message={error}
              title="Error"
              dismissible={true}
              onDismiss={() => setError(null)}
              className="mb-6"
            />
          </div>
        )}

        {/* Main Content Area */}
        <main id="main-content" role="main" className="flex-1 min-h-0 flex flex-col">
          {/* Loading State Announcement */}
          {isLoading && (
            <div 
              role="status" 
              aria-live="polite" 
              aria-label="Loading form preview"
              className="sr-only"
            >
              Loading form preview, please wait...
            </div>
          )}

          {/* Form Header */}
          {form && (
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6 mb-6 flex-shrink-0">
              <div className="flex justify-between items-center">
                <h2 className="text-3xl font-bold text-gray-800">
                  {form.form_name}
                </h2>
                <div className="text-sm text-gray-500 bg-gray-50 px-3 py-1 rounded-full">
                  Version {form.version || 1}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1 min-h-0">
            {/* Form Preview Section */}
            <section 
              id="form-preview-section"
              className="lg:col-span-1 min-h-0"
              aria-labelledby="form-preview-heading"
              role="region"
            >
              <h3 id="form-preview-heading" className="sr-only">
                Interactive Form Preview
              </h3>
              <div className="h-full overflow-y-auto pr-4">
                {/* Display Metadata Fields if form is CALL type */}
                {form?.interaction_type === 'CALL' && form.metadata_fields && form.metadata_fields.length > 0 && (
                  <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6 mb-8">
                    <FormMetadataDisplay
                      metadataFields={form.metadata_fields}
                      values={metadataValues}
                      onChange={handleMetadataChange}
                      readonly={false}
                      currentUser={{ id: 1, username: 'Preview User' }}
                    />
                  </div>
                )}
                
                <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
                  {formRenderData ? (
                    <FormRenderer 
                      formRenderData={formRenderData}
                      isDisabled={false}
                      onAnswerChange={handleAnswerChange}
                      onNotesChange={handleNotesChange}
                    />
                  ) : (
                    <div className="py-4 text-center text-gray-500">Loading form preview...</div>
                  )}
                </div>
              </div>
            </section>

            {/* Scoring Details Section */}
            <section
              id="scoring-details-section"
              className="lg:col-span-1 min-h-0"
              aria-labelledby="scoring-details-heading"
              role="region"
            >
              <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6 h-full overflow-y-auto">
                <h3 id="scoring-details-heading" className="text-lg font-semibold text-gray-800 mb-4">
                  Scoring Details
                </h3>
                
                {formRenderData && formRenderData.categories ? (
                  <div className="space-y-6">
                    {/* Overall Form Score - Prominent Display */}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
                      <h4 className="text-sm font-semibold text-gray-700 mb-2">Overall Form Score</h4>
                      <div className={`text-3xl font-bold mb-2 ${
                        (formRenderData.totalScore || 0) >= 90 ? 'text-green-600' : 
                        (formRenderData.totalScore || 0) >= 70 ? 'text-blue-600' : 
                        (formRenderData.totalScore || 0) >= 50 ? 'text-yellow-600' : 'text-red-600'
                      }`}>
                        {(formRenderData.totalScore || 0).toFixed(2)}%
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full ${
                            (formRenderData.totalScore || 0) >= 90 ? 'bg-green-600' : 
                            (formRenderData.totalScore || 0) >= 70 ? 'bg-blue-600' : 
                            (formRenderData.totalScore || 0) >= 50 ? 'bg-yellow-600' : 'bg-red-600'
                          }`} 
                          style={{ width: `${Math.min(100, formRenderData.totalScore || 0)}%` }}
                        ></div>
                      </div>
                    </div>

                    {/* Question Scores Table */}
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">Question Scores</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border border-gray-200 rounded-lg">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium text-gray-700 border-b w-3/5"></th>
                              <th className="px-1 py-2 text-center font-medium text-gray-700 border-b w-16">Answer</th>
                              <th className="px-1 py-2 text-center font-medium text-gray-700 border-b w-12">Score</th>
                              <th className="px-1 py-2 text-center font-medium text-gray-700 border-b w-14">Possible</th>
                              <th className="px-1 py-2 text-center font-medium text-gray-700 border-b w-16">
                                <div className="break-words">Weighted Score</div>
                              </th>
                              <th className="px-1 py-2 text-center font-medium text-gray-700 border-b w-16">
                                <div className="break-words">Weighted Possible</div>
                              </th>
                              <th className="px-1 py-2 text-center font-medium text-gray-700 border-b w-12">Visible</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(formRenderData.categories || []).map((category: CategoryRenderData, catIdx: number) => {
                              // Filter questions for this category
                              const filteredQuestions = (category.allQuestions || [])
                                .filter((question: any) => {
                                  // Exclude non-scoring question types from scoring table
                                  const questionType = (question.type || question.question_type || '').toLowerCase();
                                  return questionType !== 'text' && 
                                         questionType !== 'sub_category' && 
                                         questionType !== 'info_block';
                                });

                              // Only render category if it has scoring questions
                              if (filteredQuestions.length === 0) return null;

                              return (
                                <React.Fragment key={`category-${category.id || catIdx}`}>
                                  {/* Category Header Row */}
                                  <tr className="bg-gray-50 border-b-2 border-gray-200">
                                    <td colSpan={7} className="px-3 py-3 font-semibold text-gray-800 text-sm">
                                      <div className="flex justify-between items-center">
                                        <span>{category.name || 'Unnamed Category'}</span>
                                        <span className="text-xs font-normal text-gray-600">
                                          Weight: {(category.weight * 100).toFixed(0)}%
                                        </span>
                                      </div>
                                    </td>
                                  </tr>
                                  
                                  {/* Questions for this category */}
                                  {filteredQuestions.map((question: any, qIdx: number) => {
                                    const answer = previewAnswers?.[question.id];
                                    const isVisible = previewVisibilityMap?.[question.id] !== false;
                                    const questionScore = Number(answer?.score) || 0;
                                    
                                    // Get the max possible score from the original form structure, not the rendered one
                                    // Use the same logic as the scoring calculation
                                    let maxScore = 0;
                                    if (isVisible) {
                                      // Find the original question in the form structure
                                      let originalQuestion = null;
                                      for (const formCategory of form?.categories || []) {
                                        const foundQuestion = formCategory.questions?.find(q => q.id === question.id);
                                        if (foundQuestion) {
                                          originalQuestion = foundQuestion;
                                          break;
                                        }
                                      }
                                      
                                      if (originalQuestion) {
                                        // Check for N/A answers first
                                        const hasNaAnswer = answer && (answer.answer?.toLowerCase() === 'na' || answer.answer?.toLowerCase() === 'n/a');
                                        const isNaAllowed = (originalQuestion as any).is_na_allowed;
                                        
                                        if (hasNaAnswer && isNaAllowed) {
                                          maxScore = 0; // N/A answers get 0 possible points
                                        } else {
                                          maxScore = getMaxPossibleScore(originalQuestion);
                                        }
                                      }
                                    }
                                    
                                    const categoryWeight = Number(category.weight) || 0;
                                    const weightedScore = isVisible ? (questionScore * categoryWeight) : 0;
                                    const weightedPossible = maxScore * categoryWeight;
                                    
                                    return (
                                      <tr key={`${category.id || 'cat'}-${question.id || qIdx}`} className="border-b last:border-b-0 hover:bg-gray-50">
                                        <td className="px-3 py-2 text-gray-600 w-3/5" title={question.text || 'No question text'}>
                                          <div className="break-words pl-4">{question.text || 'No question text'}</div>
                                        </td>
                                        <td className="px-1 py-2 text-center text-gray-600 w-16">
                                          {isVisible && answer?.answer ? formatAnswer(answer.answer) : ''}
                                        </td>
                                        <td className="px-1 py-2 text-center text-gray-600 w-12">{isVisible ? questionScore : 0}</td>
                                        <td className="px-1 py-2 text-center text-gray-600 w-14">{maxScore}</td>
                                        <td className="px-1 py-2 text-center text-gray-600 w-16">
                                          <div className="break-words">{weightedScore.toFixed(2)}</div>
                                        </td>
                                        <td className="px-1 py-2 text-center text-gray-600 w-16">
                                          <div className="break-words">{weightedPossible.toFixed(2)}</div>
                                        </td>
                                        <td className="px-1 py-2 text-center w-12">
                                          <span className="text-xs text-gray-600">
                                            {isVisible ? 'Yes' : 'No'}
                                          </span>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Category Scores Table */}
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">Category Scores</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border border-gray-200 rounded-lg">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-2 py-2 text-left font-medium text-gray-700 border-b">Category</th>
                              <th className="px-2 py-2 text-center font-medium text-gray-700 border-b">Earned Points</th>
                              <th className="px-2 py-2 text-center font-medium text-gray-700 border-b">Possible Points</th>
                              <th className="px-2 py-2 text-center font-medium text-gray-700 border-b">Category Score</th>
                              <th className="px-2 py-2 text-center font-medium text-gray-700 border-b">Category Weight</th>
                              <th className="px-2 py-2 text-center font-medium text-gray-700 border-b">Weighted Score</th>
                              <th className="px-2 py-2 text-center font-medium text-gray-700 border-b">Weighted Possible</th>
                              <th className="px-2 py-2 text-center font-medium text-gray-700 border-b">Score</th>
                            </tr>
                          </thead>
                          <tbody>
                             {(() => {
                               // Calculate totals for the final row using CORRECT scoring algorithm
                               let totalEarnedPoints = 0;
                               let totalPossiblePoints = 0;
                               let totalWeightedNumerator = 0;  // earnedPoints * weight
                               let totalWeightedDenominator = 0; // possiblePoints * weight
                               
                               const categoryRows = (formRenderData.categories || []).map((category: CategoryRenderData, idx: number) => {
                                 const categoryScore = formRenderData.categoryScores?.[category.id];
                                 const earnedPoints = Number(categoryScore?.earnedPoints) || 0;
                                 const possiblePoints = Number(categoryScore?.possiblePoints) || 0;
                                 const categoryScorePercent = possiblePoints > 0 ? (earnedPoints / possiblePoints) * 100 : 0;
                                 const categoryWeight = Number(category.weight) || 0;
                                 const categoryWeightPercent = categoryWeight * 100;
                                 
                                 // CORRECT calculation: weight should be decimal (0.5), not percentage (50%)
                                 const weightedNumerator = earnedPoints * categoryWeight;
                                 const weightedDenominator = possiblePoints * categoryWeight;
                                 
                                 // Add to totals (exclude categories with zero possible points)
                                 if (possiblePoints > 0) {
                                   totalEarnedPoints += earnedPoints;
                                   totalPossiblePoints += possiblePoints;
                                   totalWeightedNumerator += weightedNumerator;
                                   totalWeightedDenominator += weightedDenominator;
                                 }
                                 
                                 return (
                                   <tr key={`cat-${category.id || idx}`} className="border-b">
                                     <td className="px-2 py-2 text-gray-600">{category.name || 'Unnamed Category'}</td>
                                     <td className="px-2 py-2 text-center text-gray-600">{earnedPoints}</td>
                                     <td className="px-2 py-2 text-center text-gray-600">{possiblePoints}</td>
                                     <td className="px-2 py-2 text-center text-gray-600">{categoryScorePercent.toFixed(0)}%</td>
                                     <td className="px-2 py-2 text-center text-gray-600">{categoryWeightPercent.toFixed(0)}%</td>
                                     <td className="px-2 py-2 text-center text-gray-600">{weightedNumerator.toFixed(2)}</td>
                                     <td className="px-2 py-2 text-center text-gray-600">{weightedDenominator.toFixed(2)}</td>
                                     <td className="px-2 py-2 text-center text-gray-600"></td>
                                   </tr>
                                 );
                               });
                               
                               // Calculate final score using CORRECT algorithm: (weighted numerator / weighted denominator) * 100
                               const finalScore = totalWeightedDenominator > 0 ? (totalWeightedNumerator / totalWeightedDenominator) * 100 : 0;
                               
                               return [
                                 ...categoryRows,
                                 // Totals Row
                                 <tr key="totals" className="bg-gray-50 font-medium border-t-2">
                                   <td className="px-2 py-2 text-gray-800">TOTALS</td>
                                   <td className="px-2 py-2 text-center text-gray-800"></td>
                                   <td className="px-2 py-2 text-center text-gray-800"></td>
                                   <td className="px-2 py-2 text-center text-gray-800"></td>
                                   <td className="px-2 py-2 text-center text-gray-800"></td>
                                   <td className="px-2 py-2 text-center text-gray-800">{totalWeightedNumerator.toFixed(2)}</td>
                                   <td className="px-2 py-2 text-center text-gray-800">{totalWeightedDenominator.toFixed(2)}</td>
                                   <td className="px-2 py-2 text-center text-gray-800 font-bold">{finalScore.toFixed(2)}%</td>
                                 </tr>
                               ];
                             })()}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* How Scoring Works */}
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">How Scoring Works</h4>
                      <ul className="text-xs text-gray-600 space-y-2">
                        <li>• <strong>Excluded Questions:</strong> N/A answers and hidden conditional questions are excluded.</li>
                        <li>• <strong>Category Scoring:</strong> Each category is scored separately based on answered questions.</li>
                        <li>• <strong>Category Weighting:</strong> Each category contributes to the final score based on its assigned weight percentage.</li>
                        <li>• <strong>Final Score:</strong> The total weighted points divided by the sum of all weighted possible points.</li>
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-gray-500">
                    <p>No scoring data available</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
};

export default FormPreviewScreen; 