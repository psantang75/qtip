import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { HiOutlineArrowLeft, HiOutlineFlag } from 'react-icons/hi';
import NavigationPrompt from './NavigationPrompt';
import submissionService from '../services/submissionService';
import { getFormById } from '../services/formService';
import type { Form, FormCategory, FormQuestion } from '../types/form.types';
import { 
  processConditionalLogic,
  calculateFormScore, 
  prepareFormForRender,
  FormRenderer
} from '../utils/forms';
import { formatTranscriptText } from '../utils/transcriptUtils';
import type { Form as StandardForm, Answer, Question, Category } from '../types';

interface AuditDetails {
  id: number;
  callId: number;
  formId: number;
  csrName: string;
  formName: string;
  callDate: string;
  transcript: string;
  audioUrl: string;
}

// Helper function to convert from backend Form type to the standard Form type used by form utilities
const convertToStandardForm = (backendForm: Form): StandardForm => {
  return {
    id: backendForm.id || 0,
    form_name: backendForm.form_name,
    interaction_type: (backendForm.interaction_type || 'universal').toLowerCase() as any,
    is_active: backendForm.is_active,
    metadata_fields: [],
    categories: backendForm.categories.map((category: FormCategory): Category => ({
      id: category.id || 0,
      form_id: backendForm.id || 0,
      category_name: category.category_name,
      weight: category.weight,
      sort_order: category.sort_order || 0,
      questions: category.questions.map((question: FormQuestion): Question => ({
        id: question.id || 0,
        category_id: category.id || 0,
        question_text: question.question_text,
        question_type: question.question_type.toLowerCase() as any,
        weight: question.weight,
        sort_order: question.sort_order || 0,
        score_if_yes: question.yes_value,
        score_if_no: question.no_value,
        score_na: question.na_value,
        max_scale: question.scale_max,
        is_conditional: question.is_conditional || false,
        conditional_logic: question.is_conditional ? {
          target_question_id: question.conditional_question_id || 0,
          condition_type: (question.condition_type || 'equals').toLowerCase() as any,
          target_value: question.conditional_value || '',
          exclude_if_unmet: false
        } : undefined
      }))
    }))
  };
};

const QAAssignedReviews: React.FC = () => {
  const { auditId } = useParams<{ auditId: string }>();
  const [searchParams] = useSearchParams();
  const formId = searchParams.get('formId');
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [auditDetails, setAuditDetails] = useState<AuditDetails | null>(null);
  const [backendForm, setBackendForm] = useState<Form | null>(null);
  const [standardForm, setStandardForm] = useState<StandardForm | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isFlagged, setIsFlagged] = useState<boolean>(false);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [visibleQuestions, setVisibleQuestions] = useState<Record<number, boolean>>({});
  const [formRenderData, setFormRenderData] = useState<any>(null);
  const [hasChanges, setHasChanges] = useState<boolean>(false);

  // Add debugging for component mounting
  useEffect(() => {
    console.log('QAAssignedReviews mounted with auditId:', auditId, 'formId:', formId);
    
    if (!auditId || !formId) {
      console.error('Missing required parameters: auditId or formId');
      navigate('/qa/assigned-reviews');
      return;
    }
    
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch the form from the database using formService
        if (formId) {
          const formData = await getFormById(Number(formId));
          setBackendForm(formData);
          console.log('Fetched form data:', formData);
          
          // Convert backend form to the standard format
          const convertedForm = convertToStandardForm(formData);
          setStandardForm(convertedForm);
          
          // Initialize visibility map
          const initialVisibilityMap: Record<number, boolean> = {};
          formData.categories.forEach(category => {
            category.questions.forEach(question => {
              if (question.id !== undefined) {
                initialVisibilityMap[question.id] = !question.is_conditional;
              }
            });
          });
          setVisibleQuestions(initialVisibilityMap);
          
          // Create initial form render data
          const renderData = prepareFormForRender(
            convertedForm,
            {}, // Empty answers initially
            initialVisibilityMap,
            {}, // No category scores initially
            0   // Initial total score
          );
          setFormRenderData(renderData);
        }
        
        // Mock call data for now
        setTimeout(() => {
          setAuditDetails({
            id: Number(auditId),
            callId: Number(auditId),
            formId: Number(formId),
            csrName: 'John Doe',
            formName: backendForm?.form_name || 'Form',
            callDate: '2023-05-15',
            transcript: 'This is a sample transcript for the call...',
            audioUrl: 'https://example.com/audio.mp3'
          });
          setLoading(false);
        }, 1000);
      } catch (error) {
        console.error('Error fetching data:', error);
        setLoading(false);
      }
    };
    
    fetchData();

    return () => {
      console.log('QAAssignedReviews component unmounting');
    };
  }, [auditId, formId, navigate, user]);

  // Handle answer changes
  const handleAnswerChange = (questionId: number, value: string, questionType: string) => {
    if (!standardForm || !backendForm) return;
    
    // Find the question in the backend form
    let foundQuestion: FormQuestion | undefined;
    
    for (const category of backendForm.categories) {
      const question = category.questions.find(q => q.id === questionId);
      if (question) {
        foundQuestion = question;
        break;
      }
    }
    
    if (!foundQuestion) return;
    
    // Calculate score based on question type and answer
    let score = 0;
    
    if (questionType.toLowerCase() === 'yes_no') {
      score = value === 'yes' 
        ? (foundQuestion.yes_value || 0) 
        : value === 'no' 
          ? (foundQuestion.no_value || 0) 
          : (foundQuestion.na_value || 0);
    } else if (questionType.toLowerCase() === 'scale') {
      score = parseInt(value) || 0;
    }
    
    // Update answer
    const newAnswers = {
      ...answers,
      [questionId]: {
        question_id: questionId,
        answer: value,
        score,
        notes: answers[questionId]?.notes || ''
      }
    };
    setAnswers(newAnswers);
    
    // Convert Answer objects to strings for conditional logic
    const answersForConditionalLogic: Record<number, string> = {};
    Object.entries(newAnswers).forEach(([questionId, answer]) => {
      answersForConditionalLogic[Number(questionId)] = answer.answer || '';
    });
    
    // Update visible questions based on conditional logic
    const newVisibleQuestions = processConditionalLogic(standardForm, answersForConditionalLogic);
    setVisibleQuestions(newVisibleQuestions);
    
    // Calculate scores
    const { totalScore, categoryScores } = calculateFormScore(standardForm, newAnswers);
    
    // Update form render data
    const updatedRenderData = prepareFormForRender(
      standardForm,
      newAnswers,
      newVisibleQuestions,
      categoryScores,
      totalScore
    );
    setFormRenderData(updatedRenderData);
    
    setHasChanges(true);
  };

  // Handle notes changes
  const handleNotesChange = (questionId: number, notes: string) => {
    if (answers[questionId]) {
      const updatedAnswer = {
        ...answers[questionId],
        notes
      };
      
      setAnswers({
        ...answers,
        [questionId]: updatedAnswer
      });
      setHasChanges(true);
    }
  };

  const handleBackToDashboard = () => {
    navigate('/qa/assigned-reviews');
  };

  const handleFlagForReview = () => {
    setIsFlagged(!isFlagged);
    // In a real application, this would make an API call
    console.log(`Audit ${auditId} ${isFlagged ? 'unflagged' : 'flagged'} for review`);
  };

  const handleSubmit = () => {
    // In a real application, this would submit the form data to the server
    console.log('Submitting review with answers:', answers);
    console.log('Total score:', formRenderData?.totalScore || 0);
    navigate('/qa/dashboard');
  };

  if (loading) {
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

  return (
    <div className="container p-6 mx-auto relative">
      <NavigationPrompt 
        when={hasChanges} 
        message="You have unsaved changes. Are you sure you want to leave this page?"
      />
      
      {/* Toolbar */}
      <div className="flex justify-between items-center mb-6">
        <button 
          onClick={handleBackToDashboard}
          className="flex items-center text-primary-blue hover:text-primary-blue-dark"
        >
          <HiOutlineArrowLeft className="h-5 w-5 mr-1" />
          Back to Dashboard
        </button>
        <div className="flex items-center">
          <button 
            onClick={handleFlagForReview}
            className={`flex items-center ${isFlagged ? 'text-red-600 hover:text-red-700' : 'text-gray-500 hover:text-gray-700'} mr-4`}
          >
            <HiOutlineFlag className="h-5 w-5 mr-1" />
            {isFlagged ? 'Flagged for Review' : 'Flag for Review'}
          </button>
          <button
            onClick={() => {
              console.log('Loading next audit...');
              // In a real app, this would fetch the next audit ID from the API
              // For demo purposes, we'll just increment the current ID
              const nextAuditId = Number(auditId) + 1;
              navigate(`/qa/assigned-reviews/${nextAuditId}`);
            }}
            className="text-primary-blue hover:text-primary-blue-dark"
          >
            Next Audit
          </button>
        </div>
      </div>
      
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">QA Assigned Review</h1>
        <p className="mt-2 text-neutral-700">
          Audit ID: {auditDetails?.id} | CSR: {auditDetails?.csrName}
        </p>
      </div>
      
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left panel - Call Details */}
        <div className="lg:w-1/2 flex-1">
          <div className="card bg-white h-full">
            <h2 className="text-xl font-semibold text-neutral-900 mb-4">Call Details</h2>
            <div className="mb-4">
              <p><strong>Call ID:</strong> {auditDetails?.callId}</p>
              <p><strong>CSR:</strong> {auditDetails?.csrName}</p>
              <p><strong>Date:</strong> {auditDetails?.callDate}</p>
            </div>
            <div className="mb-4">
              <h3 className="font-medium text-lg mb-2">Audio</h3>
              <div className="border p-4 rounded-md bg-gray-50">
                <p>Audio player would go here</p>
              </div>
            </div>
            <div>
              <h3 className="font-medium text-lg mb-2">Transcript</h3>
              <div className="border p-4 rounded-md max-h-80 overflow-y-auto">
                <div 
                  className="whitespace-pre-wrap break-words leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: formatTranscriptText(auditDetails?.transcript) }}
                />
              </div>
            </div>
          </div>
        </div>
        
        {/* Right panel - Review Form */}
        <div className="lg:w-1/2 flex-1">
          <div className="card bg-white p-6 h-full">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-neutral-900">Review Form</h2>
              {formRenderData && (
                <div className="text-lg font-medium">
                  Score: <span className="text-primary-blue">{formRenderData.totalScore.toFixed(1)}%</span>
                </div>
              )}
            </div>
            
            {/* Form content using the new FormRenderer */}
            {formRenderData && (
              <FormRenderer
                formRenderData={formRenderData}
                onAnswerChange={handleAnswerChange}
                onNotesChange={handleNotesChange}
                isDisabled={false}
              />
            )}
            
            <div className="mt-6 flex justify-end">
              <button
                onClick={handleSubmit}
                className="bg-primary-blue hover:bg-primary-blue-dark text-white px-6 py-2 rounded-md transition"
              >
                Submit Review
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QAAssignedReviews; 