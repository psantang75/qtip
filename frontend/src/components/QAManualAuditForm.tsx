import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { HiOutlineArrowLeft } from 'react-icons/hi';
import NavigationPrompt from './NavigationPrompt';
import submissionService from '../services/submissionService';
import { getFormById } from '../services/formService';
import phoneSystemService from '../services/phoneSystemService';
import MultipleCallSelector from './MultipleCallSelector';
import type { Form, FormCategory, FormQuestion, QuestionType } from '../types/form.types';
import { 
  processConditionalLogic,
  calculateFormScore, 
  generateFormPreview, 
  prepareFormForRender,
  FormRenderer,
  type FormRenderData,
  type QuestionRenderData,
  getMaxPossibleScore,
} from '../utils/forms';
import { ScoreRenderer } from '../utils/forms/scoreRenderer';
import { submitFormReview, saveFormReviewDraft, validateAnswers } from '../utils/submissionUtils';
import type { Form as FormType } from '../types';
import FormMetadataDisplay from './FormMetadataDisplay';
import { extractTranscriptText, formatTranscriptText } from '../utils/transcriptUtils';
import { handleErrorIfAuthentication } from '../utils/errorHandling';

// Define AnswerType interface locally since it's not exported from types
interface AnswerType {
  question_id: number;
  answer: string;
  score: number;
  notes: string;
}

interface Call {
  id: number;
  call_id: string;
  csr_id: number;
  customer_id: string | null;
  call_date: string;
  duration: number;
  recording_url: string | null;
  transcript: string | null;
  csr_name?: string;
  customer_name?: string;
}

interface ManualAuditDetails {
  formId: number;
  formName: string;
  csrName: string;
  callId: string;
  callDate: string;
  transcript: string;
  audioUrl: string;
}

// Constants
const DEFAULT_FORM_NAME = 'QA Review Form';
const SCROLL_HIGHLIGHT_DURATION = 3000;

const QAManualAuditForm: React.FC = () => {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const formId = searchParams.get('formId');
  const callId = searchParams.get('callId');
  const csrId = searchParams.get('csrId');
  const navigate = useNavigate();
  const { user } = useAuth();
  
  // Form state
  const [auditDetails, setAuditDetails] = useState<ManualAuditDetails | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const [score, setScore] = useState<number>(0);
  const [hasChanges, setHasChanges] = useState<boolean>(false);
  const [answers, setAnswers] = useState<Record<number, AnswerType>>({});
  const [callDetails, setCallDetails] = useState<any>(null);
  const [visibilityMap, setVisibilityMap] = useState<Record<number, boolean>>({});
  const [formRenderData, setFormRenderData] = useState<FormRenderData | null>(null);
  const [categoryScores, setCategoryScores] = useState<Record<number, { raw: number; weighted: number }>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [missingQuestions, setMissingQuestions] = useState<number[]>([]);
  const [metadataValues, setMetadataValues] = useState<Record<string, string>>({});
  const [metadataFieldIds, setMetadataFieldIds] = useState<{
    auditorField?: number;
    auditDateField?: number;
    csrField?: number;
  }>({});
  const [isLoadingAudio, setIsLoadingAudio] = useState<boolean>(false);
  
  // Add state for multiple calls
  const [selectedCalls, setSelectedCalls] = useState<Call[]>([]);

  // Scroll to and highlight a missing question
  const scrollToQuestion = (questionId: number) => {
    const questionElement = document.getElementById(`question-${questionId}`);
    if (questionElement) {
      questionElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      questionElement.classList.add('bg-red-50', 'border-red-300');
      setTimeout(() => {
        questionElement.classList.remove('bg-red-50', 'border-red-300');
      }, SCROLL_HIGHLIGHT_DURATION);
    }
  };

  // Format date as YYYY-MM-DD for form inputs
  const formatDate = (date: Date | string): string => {
    let dateObj: Date;
    
    if (typeof date === 'string') {
      dateObj = new Date(date);
    } else {
      dateObj = date;
    }
    
    if (isNaN(dateObj.getTime())) {
      return '';
    }
    
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
  };

  // Fetch audio URL from PhoneSystem database
  const fetchAudioUrl = async (recordingId: string) => {
    if (!recordingId.trim()) {
      return;
    }

    setIsLoadingAudio(true);
    try {
      console.log(`[QAManualAuditForm] Fetching audio and transcript for conversation ID: ${recordingId}`);
      
      const result = await phoneSystemService.getAudioAndTranscriptByConversationId(recordingId.trim());
      
      if (result.audio || result.transcript) {
        console.log(`[QAManualAuditForm] Found data:`, {
          audioFound: !!result.audio,
          transcriptFound: !!result.transcript
        });
        
        // Update call details with the retrieved audio URL and transcript
        const processedTranscript = extractTranscriptText(result.transcript?.transcript);
        setCallDetails(prev => ({
          ...prev,
          audio_url: result.audio?.audio_url || null,
          transcript: processedTranscript,
          call_date: prev?.call_date || 'Date not available',
          duration: prev?.duration || 'Duration not available'
        }));
        
        // Show success message
        if (result.audio) {
          console.log(`[QAManualAuditForm] Audio URL retrieved successfully: ${result.audio.audio_url}`);
        }
        if (result.transcript) {
          console.log(`[QAManualAuditForm] Transcript retrieved successfully`);
        }
      } else {
        console.warn(`[QAManualAuditForm] No audio or transcript found for conversation ID: ${recordingId}`);
        // Clear audio URL and transcript if nothing found
        setCallDetails(prev => ({
          ...prev,
          audio_url: null,
          transcript: 'No transcript available'
        }));
      }
    } catch (error) {
      console.error(`[QAManualAuditForm] Error fetching audio and transcript:`, error);
      // Clear audio URL and transcript on error
      setCallDetails(prev => ({
        ...prev,
        audio_url: null,
        transcript: 'Error loading transcript'
      }));
    } finally {
      setIsLoadingAudio(false);
    }
  };

  // Initialize form data and setup
  useEffect(() => {
    if (!formId) {
      navigate('/qa/manual-reviews');
      return;
    }
    
    const fetchData = async () => {
      try {
        setLoading(true);
        
        if (formId) {
          const fetchedFormData = await getFormById(Number(formId));
          setForm(fetchedFormData);
          
          // Initialize form with empty answers
          const formForUtilities = fetchedFormData as unknown as FormType;
          const emptyAnswers: Record<number, AnswerType> = {};
          
          // Convert empty Answer objects to strings for conditional logic (will be empty)
          const emptyAnswerStrings: Record<number, string> = {};
          Object.entries(emptyAnswers).forEach(([questionId, answer]) => {
            emptyAnswerStrings[Number(questionId)] = answer.answer || '';
          });
          
          const initialVisibilityMap = processConditionalLogic(formForUtilities, emptyAnswerStrings);
          const { totalScore, categoryScores } = calculateFormScore(formForUtilities, emptyAnswers);
          
          setAnswers(emptyAnswers);
          setVisibilityMap(initialVisibilityMap);
          setCategoryScores(categoryScores);
          setScore(totalScore);
          
          const renderData = prepareFormForRender(
            formForUtilities,
            emptyAnswers,
            initialVisibilityMap,
            categoryScores,
            totalScore
          );
          
          setFormRenderData(renderData);
          
          // Initialize metadata values with auto-populated values
          const initialMetadataValues: Record<string, string> = {};
          const today = new Date().toISOString().split('T')[0];
          
          if (fetchedFormData.metadata_fields) {
            fetchedFormData.metadata_fields.forEach(field => {
              const fieldKey = (field.id && field.id !== 0) ? field.id.toString() : field.field_name;
              
              // Auto-populate fields based on their type and name
              if (field.field_type === 'AUTO') {
                if ((field.field_name === 'Reviewer Name' || field.field_name === 'Auditor Name') && user) {
                  initialMetadataValues[fieldKey] = user.username;
                } else if (field.field_name === 'Review Date' || field.field_name === 'Audit Date') {
                  initialMetadataValues[fieldKey] = today;
                }
              }
            });
          }
          
          setMetadataValues(initialMetadataValues);
          
          setAuditDetails({
            formId: Number(formId),
            formName: fetchedFormData?.form_name || DEFAULT_FORM_NAME,
            csrName: 'N/A',
            callId: callId || 'N/A',
            callDate: 'N/A',
            transcript: '',
            audioUrl: ''
          });
        }
        
        // Fetch call details if callId is provided
        if (callId) {
          try {
            // TODO: Replace with actual API call when call service is implemented
            // const callData = await callService.getCallById(callId);
            // setCallDetails(callData);
            
            setCallDetails({
              id: Number(callId),
              call_id: callId,
              csr_id: csrId || '',
              call_date: new Date().toISOString().split('T')[0],
              duration: 0,
              transcript: '',
              audio_url: null
            });
          } catch (error) {
            console.error('Error fetching call details:', error);
          }
        }
        
        setLoading(false);
      } catch (error) {
        console.error('Error fetching form data:', error);
        setLoading(false);
      }
    };
    
    fetchData();
  }, [formId, callId, csrId, navigate, user]);

  // Handle answer changes and score calculation
  const handleAnswerChange = (questionId: number, value: string, questionType: string) => {
    if (!form) return;
    
    let score = 0;
    let foundQuestion;
    
    // Find the question in the form structure
    for (const category of form.categories) {
      const question = category.questions.find((q: any) => q.id === questionId);
      if (question) {
        foundQuestion = question;
        break;
      }
    }
    
    if (!foundQuestion) return;
    
    // Calculate score based on question type and answer
    if (questionType === 'yes_no') {
      score = value.toLowerCase() === 'yes'
        ? (typeof foundQuestion.yes_value === 'number' ? foundQuestion.yes_value : 0)
        : value.toLowerCase() === 'no'
          ? (typeof foundQuestion.no_value === 'number' ? foundQuestion.no_value : 0)
          : 0;
    } else if (questionType === 'scale') {
      score = parseInt(value) || 0;
    } else if (questionType === 'radio' && foundQuestion.radio_options) {
      const option = foundQuestion.radio_options.find((opt: any) => opt.option_value === value);
      if (option) score = option.score || 0;
    }
    
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
    setHasChanges(true);
    updateFormRenderData(form, newAnswers);
  };

  // Handle notes changes
  const handleNotesChange = (questionId: number, notes: string) => {
    if (!form) return;
    
    const newAnswers = {
      ...answers,
      [questionId]: {
        ...answers[questionId],
        notes
      }
    };
    
    setAnswers(newAnswers);
    setHasChanges(true);
  };

  // Update form render data with new answers
  const updateFormRenderData = (formData: any, currentAnswers: Record<number, AnswerType>) => {
    if (!formData) return;
    
    const formForUtilities = formData as unknown as FormType;
    
    // Convert Answer objects to strings for conditional logic
    const answersForConditionalLogic: Record<number, string> = {};
    Object.entries(currentAnswers).forEach(([questionId, answer]) => {
      answersForConditionalLogic[Number(questionId)] = answer.answer || '';
    });
    
    const newVisibilityMap = processConditionalLogic(formForUtilities, answersForConditionalLogic);
    const { totalScore, categoryScores } = calculateFormScore(formForUtilities, currentAnswers);
    
    setScore(totalScore);
    setCategoryScores(categoryScores);
    
    const updatedRenderData = prepareFormForRender(
      formForUtilities,
      currentAnswers,
      newVisibilityMap,
      categoryScores,
      totalScore
    );
    
    setVisibilityMap(newVisibilityMap);
    setFormRenderData(updatedRenderData);
  };

  // Handle call selection change
  const handleCallsChange = (calls: Call[]) => {
    setSelectedCalls(calls);
    setHasChanges(true);
  };

  // Navigation handlers
  const handleBackToManualReview = () => {
    navigate('/qa/manual-reviews');
  };

  // Submit completed review
  const handleSubmit = () => {
    if (!form || !formId || !user) return;
    
    setLoading(true);
    setErrorMessage(null);
    setMissingQuestions([]);

    // Validate metadata fields first
    if (form.metadata_fields && form.metadata_fields.length > 0) {
      console.log('[QAManualAuditForm] Form metadata fields:', form.metadata_fields);
      console.log('[QAManualAuditForm] Current metadata values:', metadataValues);
      
      const missingMetadataFields: string[] = [];
      
      form.metadata_fields.forEach(field => {
        if (field.is_required) {
          const fieldKey = (field.id && field.id !== 0) ? field.id.toString() : field.field_name;
          const fieldValue = metadataValues[fieldKey];
          
          console.log(`[QAManualAuditForm] Checking field: ${field.field_name} (key: ${fieldKey}, value: ${fieldValue})`);
          
          if (!fieldValue || fieldValue.toString().trim() === '') {
            missingMetadataFields.push(field.field_name);
          }
        }
      });

      if (missingMetadataFields.length > 0) {
        setErrorMessage(`Please fill in all required form details:\n${missingMetadataFields.map(field => `- ${field}`).join('\n')}`);
        setLoading(false);
        return;
      }
    }

    // Validate answers before submission
    const validation = validateAnswers(form.categories, answers, visibilityMap);
    
    if (!validation.isValid) {
      const questionMap = new Map();
      form.categories.forEach(category => {
        category.questions?.forEach(question => {
          if (question.id) {
            questionMap.set(question.id, question.question_text);
          }
        });
      });
      
      const missingQuestions = validation.unansweredQuestions.map(qId => {
        const questionText = questionMap.get(qId) || `Question ${qId}`;
        return `- ${questionText}`;
      }).join('\n');
      
      setErrorMessage(`Please answer all required questions:\n${missingQuestions}`);
      setMissingQuestions(validation.unansweredQuestions);
      setLoading(false);
      
      if (validation.unansweredQuestions.length > 0) {
        setTimeout(() => {
          scrollToQuestion(validation.unansweredQuestions[0]);
        }, 100);
      }
      
      return;
    }
    
    // Submit the review with metadata values and multiple calls
    console.log('[QAManualAuditForm] Submitting with metadata values:', metadataValues);
    console.log('[QAManualAuditForm] Submitting with selected calls:', selectedCalls);
    
    // Extract Customer ID from metadata
    let customerIdFromMetadata = null;
    if (form && form.metadata_fields && metadataValues) {
      // Find the Customer ID field by name
      const customerIdField = form.metadata_fields.find(field => 
        field.field_name === 'Customer ID' || 
        field.field_name?.toLowerCase().includes('customer id') ||
        field.field_name?.toLowerCase().includes('customer')
      );
      
      if (customerIdField) {
        const fieldKey = (customerIdField.id && customerIdField.id !== 0) ? customerIdField.id.toString() : customerIdField.field_name;
        customerIdFromMetadata = metadataValues[fieldKey];
        console.log(`[QAManualAuditForm] Found Customer ID from metadata: ${customerIdFromMetadata}`);
      }
    }
    
    // Prepare submission data with multiple calls
    const submissionData = {
      form_id: Number(formId),
      call_id: callId ? Number(callId) : null,
      call_ids: selectedCalls.map(call => call.id), // Add multiple call IDs
      call_data: selectedCalls.map(call => ({ // Add call data for virtual calls
        call_id: call.call_id,
        csr_id: call.csr_id,
        customer_id: customerIdFromMetadata || call.customer_id, // Use metadata customer ID if available
        call_date: call.call_date,
        duration: call.duration,
        recording_url: call.recording_url,
        transcript: call.transcript
      })),
      submitted_by: user.id,
      answers: Object.entries(answers).map(([questionId, answer]) => ({
        question_id: Number(questionId),
        answer: answer.answer,
        notes: answer.notes || ''
      })),
      metadata: Object.entries(metadataValues).map(([fieldId, value]) => ({
        field_id: fieldId,
        value: value
      }))
    };

    // Use the submission service directly instead of submitFormReview utility
    submissionService.submitAudit(submissionData)
      .then((response) => {
        setHasChanges(false);
        navigate('/qa/manual-reviews', { 
          state: { message: 'Manual review submitted successfully!' }
        });
      })
      .catch((error) => {
        console.error('Error submitting review:', error);
        
        // Check for authentication errors (401) - let the axios interceptor handle redirect
        if (handleErrorIfAuthentication(error)) {
          return;
        }
        
        if (error.response?.data?.unanswered) {
          setErrorMessage('Please answer all required questions before submitting.');
          setMissingQuestions(error.response.data.unanswered);
          setTimeout(() => {
            scrollToQuestion(error.response.data.unanswered[0]);
          }, 100);
        } else {
          setErrorMessage('Failed to submit review. Please try again.');
        }
      })
      .finally(() => {
        setLoading(false);
      });
  };

     // Save draft
   const handleSaveDraft = () => {
     if (!form || !formId || !user) return;
     
     setLoading(true);
     
     // Prepare draft data with multiple calls
     const draftData = {
       form_id: Number(formId),
       call_id: callId ? Number(callId) : null,
       call_ids: selectedCalls.map(call => call.id), // Add multiple call IDs
       submitted_by: user.id,
       answers: Object.entries(answers).map(([questionId, answer]) => ({
         question_id: Number(questionId),
         answer: answer.answer,
         notes: answer.notes || ''
       })),
       metadata: Object.entries(metadataValues).map(([fieldId, value]) => ({
         field_id: fieldId,
         value: value
       }))
     };

    // Use the submission service directly
    submissionService.saveDraft(draftData)
      .then((response) => {
        setHasChanges(false);
        navigate('/qa/manual-reviews', { 
          state: { message: 'Manual review draft saved successfully!' }
        });
      })
      .catch((error) => {
        console.error('Error saving draft:', error);
        
        // Check for authentication errors (401) - let the axios interceptor handle redirect
        if (handleErrorIfAuthentication(error)) {
          return;
        }
        
        setErrorMessage('Failed to save draft. Please try again.');
      })
      .finally(() => {
        setLoading(false);
      });
   };

  // Loading state
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
    <div className="container p-6 mx-auto">
      <NavigationPrompt 
        when={hasChanges} 
        message="You have unsaved changes. Are you sure you want to leave this page?"
      />
      
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center">
          <h1 className="text-2xl font-bold text-neutral-900 mr-4">Manual QA Review</h1>
        </div>
        <div className="flex items-center">
          <button 
            onClick={handleBackToManualReview}
            className="flex items-center text-primary-blue hover:text-primary-blue-dark transition-colors"
          >
            <HiOutlineArrowLeft className="h-5 w-5 mr-1" />
            Back to Manual Review
          </button>
        </div>
      </div>
      
      {/* Main Content - Two Column Layout */}
      <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-200px)]">
        {/* Left Column - Form Details and Call Details */}
        <div className="lg:w-1/2 flex-1 flex flex-col">
          <div className="card bg-white h-full flex flex-col">
                         <div className="flex-1 overflow-y-auto pr-2">
               {/* Form Details Section */}
               {form && form.metadata_fields && form.metadata_fields.length > 0 && (
                 <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
                   <h2 className="text-xl font-semibold text-neutral-900 mb-4">Form Details</h2>
                   <FormMetadataDisplay
                     metadataFields={form.metadata_fields}
                     values={Object.fromEntries(
                       form.metadata_fields.map(field => {
                         // Use field.field_name if field.id is 0 or falsy
                         const fieldKey = (field.id && field.id !== 0) ? field.id.toString() : field.field_name;
                         const valueKey = (field.id && field.id !== 0) ? field.id.toString() : field.field_name;
                         return [
                           fieldKey,
                           metadataValues[valueKey] || ''
                         ];
                       })
                     )}
                     onChange={async (fieldId, value) => {
                       // Use the same logic as the values mapping to ensure consistency
                       setMetadataValues({
                         ...metadataValues,
                         [fieldId]: value
                       });
                       
                       // Check if this is a Call Conversation ID field and fetch audio
                       const field = form.metadata_fields.find(f => {
                         const fieldKey = (f.id && f.id !== 0) ? f.id.toString() : f.field_name;
                         return fieldKey === fieldId;
                       });
                       
                       if (field && (
                         field.field_name?.toLowerCase().includes('conversation') ||
                         field.field_name?.toLowerCase().includes('call recording') ||
                         field.field_name?.toLowerCase().includes('recording id')
                       )) {
                         const conversationId = value.trim();
                         if (conversationId) {
                           await fetchAudioUrl(conversationId);
                         } else {
                           // Clear audio URL when conversation ID is cleared
                           setCallDetails(prev => ({
                             ...prev,
                             audio_url: null
                           }));
                         }
                       }
                     }}
                     readonly={false}
                     currentUser={user ? { id: user.id, username: user.username } : undefined}
                   />
                 </div>
               )}
               
               {/* Call Details Section */}
               <div className="bg-white rounded-lg border border-gray-200 p-5">
                 <h2 className="text-xl font-semibold text-neutral-900 mb-4">Call Details</h2>
                 
                 {/* Multiple Call Selector */}
                 <div className="mb-6">
                   <MultipleCallSelector
                     selectedCalls={selectedCalls}
                     onCallsChange={handleCallsChange}
                     disabled={loading}
                   />
                 </div>
               </div>
            </div>
          </div>
        </div>
        
        {/* Right Column - Review Form */}
        <div className="lg:w-1/2 flex-1 flex flex-col">
          <div className="card bg-white h-full flex flex-col">
            {/* Form Header */}
            <div className="flex-shrink-0">
              <h2 className="text-2xl font-bold text-neutral-900 mb-8 text-center">
                {form?.form_name || DEFAULT_FORM_NAME}
              </h2>
            </div>
            
            {/* Form Content */}
            <div className="flex-1 overflow-y-auto pr-2">
              {formRenderData ? (
                <>
                  <div className="mb-6">
                    <FormRenderer
                      formRenderData={formRenderData}
                      isDisabled={false}
                      onAnswerChange={handleAnswerChange}
                      onNotesChange={handleNotesChange}
                    />
                  </div>
                </>
              ) : (
                <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 rounded-md">
                  <p>No form data available. Please try again.</p>
                </div>
              )}
            </div>
            
            {/* Form Footer */}
            <div className="flex-shrink-0 mt-6 pt-4 border-t border-gray-200">
              <div className="flex justify-end items-center mb-4">
                <button 
                  className="bg-primary-blue text-white py-2 px-4 rounded hover:bg-primary-blue-dark transition-colors"
                  onClick={handleSubmit}
                  disabled={loading}
                >
                  {loading ? 'Submitting...' : 'Submit Review'}
                </button>
              </div>
              
              {/* Error Display */}
              {errorMessage && (
                <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded">
                  <p className="font-bold">Error:</p>
                  <div>
                    {errorMessage.split('\n').map((line, i) => {
                      if (line.startsWith('- ')) {
                        const questionMatch = missingQuestions[i - 1];
                        if (questionMatch) {
                          return (
                            <p 
                              key={i} 
                              className="mb-1 cursor-pointer hover:underline" 
                              onClick={() => scrollToQuestion(questionMatch)}
                            >
                              {line} <span className="text-xs">(click to scroll)</span>
                            </p>
                          );
                        }
                      }
                      return <p key={i} className="mb-1">{line}</p>;
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QAManualAuditForm; 