import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { HiOutlineArrowLeft, HiOutlineDownload, HiOutlineDocumentText, HiOutlineSpeakerphone, HiArrowLeft, HiOutlineExclamationCircle, HiOutlineCheckCircle, HiOutlineXCircle, HiOutlinePencilAlt } from 'react-icons/hi';
import apiClient from '../services/apiClient';
import userService from '../services/userService';
import phoneSystemService from '../services/phoneSystemService';

import ScoreRenderer from '../utils/forms/scoreRenderer';
import { submitDispute, finalizeAudit, finalizeSubmission } from '../services/csrService';
import { useAuth } from '../contexts/AuthContext';
import Button from './ui/Button';
import ErrorDisplay from './ui/ErrorDisplay';
import LoadingSpinner from './ui/LoadingSpinner';
import Card from './ui/Card';
import Modal, { ModalFooter } from './ui/Modal';
import ErrorBoundary from './ui/ErrorBoundary';
import Input from './ui/Input';
import Select from './ui/Select';
import { FormField } from './forms/FormField';
import { parseScore, formatScore, getScoreColorClass } from '../utils/scoreUtils';
import { 
  processConditionalLogic,
  calculateFormScore, 
  prepareFormForRender,
  FormRenderer,
  type FormRenderData,
} from '../utils/forms';
import { submitFormReview } from '../utils/submissionUtils';
import { extractTranscriptText, formatTranscriptText } from '../utils/transcriptUtils';
import { isAuthenticationStatus, handleAuthenticationFailure } from '../utils/errorHandling';

// Define types
interface SubmissionDetails {
  id: number;
  form_id?: number;
  status?: string;
  form: {
    id: number;
    form_name: string;
    interaction_type: string;
    version: string;
    user_version?: number;
    user_version_date?: string;
  };
  scoreBreakdown?: any; // Backend score breakdown data
  metadata: {
    field_name: string;
    value: string;
  }[];
  calls: {
    call_id: string;
    call_date: string;
    customer_id: string;
    recording_url: string;
    transcript: string;
    duration: number;
  }[];
  answers: {
    question_id?: number;
    question_text: string;
    answer: string;
    notes: string;
    score?: number;
  }[];
  dispute: {
    id: number;
    reason: string;
    status: string;
    resolution_notes: string;
    attachment_url?: string;
    disputed_by_name?: string;
    created_at?: string;
    resolved_by_name?: string;
    resolved_at?: string;
  } | null;
  total_score?: number;
  score?: number; // CSR endpoint uses 'score' instead of 'total_score'
}

// Define some additional types to fix TypeScript errors
interface QuestionWithScore {
  id: number;
  text: string;
  answer: string;
  pointsEarned: number;
  pointsPossible: number;
}

interface CategoryScore {
  id: number;
  name: string;
  weight: number;
  pointsEarned: number;
  pointsPossible: number;
  weightedPointsEarned: number;
  weightedPointsPossible: number;
  score: number;
  subCategories: Record<string, QuestionWithScore[]>;
}

const QASubmissionDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isCSR = user?.role_id === 3; // Assuming role_id 3 is for CSR users
  const isManager = user?.role_id === 5; // Assuming role_id 5 is for Manager users
  
  // Detect if this is being used in manager context by checking URL path
  const isManagerView = window.location.pathname.includes('/manager/team-audits/');
  
  // Detect if this is being used in admin context by checking URL path
  const isAdminView = window.location.pathname.includes('/admin/completed-forms/');
  
  // Detect if this is being used in QA context by checking URL path
  const isQAView = window.location.pathname.includes('/qa/') || 
                   window.location.pathname.includes('/audit/') ||
                   window.location.pathname.includes('/submissions/');
  
  // Detect if this is being used in CSR context by checking URL path
  const isCSRView = window.location.pathname.includes('/csr/');
  
  // Detect if this is being used in trainer context by checking URL path
  const isTrainerView = window.location.pathname.includes('/trainer/completed-reviews/');
  
  // Check if we're in dispute resolution mode
  const urlParams = new URLSearchParams(window.location.search);
  const isDisputeResolutionMode = urlParams.get('mode') === 'dispute-resolution';
  const disputeId = urlParams.get('disputeId');
  
  // Helper function to get score value from submission (handles both total_score and score fields)
  const getSubmissionScore = (submission: SubmissionDetails | null): number | undefined => {
    if (!submission) return undefined;
    return submission.total_score !== undefined ? submission.total_score : submission.score;
  };
  
  const [submission, setSubmission] = useState<SubmissionDetails | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCall, setExpandedCall] = useState<string | null>(null);
  const [formData, setFormData] = useState<any>(null);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [showDisputeForm, setShowDisputeForm] = useState<boolean>(false);
  const [disputeText, setDisputeText] = useState<string>('');
  const [disputeFile, setDisputeFile] = useState<File | null>(null);
  const [isSubmittingDispute, setIsSubmittingDispute] = useState<boolean>(false);
  const [disputeError, setDisputeError] = useState<string | null>(null);

  // Add state for dispute resolution
  const [showDisputeResolutionForm, setShowDisputeResolutionForm] = useState(false);
  const [resolutionAction, setResolutionAction] = useState<'UPHELD' | 'REJECTED' | 'ADJUSTED'>('UPHELD');
  const [newScore, setNewScore] = useState<string>('');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [isResolvingDispute, setIsResolvingDispute] = useState(false);
  const [isApprovingReview, setIsApprovingReview] = useState(false);
  
  // Dispute resolution mode state
  const [disputeData, setDisputeData] = useState<any>(null);
  const [disputeResolutionNotes, setDisputeResolutionNotes] = useState('');
  const [isEditingForm, setIsEditingForm] = useState(false);
  const [editedAnswers, setEditedAnswers] = useState<Record<number, any>>({});
  const [isSavingResolution, setIsSavingResolution] = useState(false);
  const [isRejectingDispute, setIsRejectingDispute] = useState(false);
  
  // Form builder state for dispute resolution
  const [formRenderData, setFormRenderData] = useState<FormRenderData | null>(null);
  const [visibilityMap, setVisibilityMap] = useState<Record<number, boolean>>({});
  const [formScore, setFormScore] = useState<number>(0);

  // Call details state for audio and transcript
  const [callDetails, setCallDetails] = useState<any>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState<boolean>(false);

  // Fetch audio and transcript using conversation ID from metadata
  const fetchAudioAndTranscript = async (conversationId: string) => {
    if (!conversationId.trim()) {
      return;
    }

    setIsLoadingAudio(true);
    try {
      console.log(`[QASubmissionDetails] Fetching audio and transcript for conversation ID: ${conversationId}`);
      
      const result = await phoneSystemService.getAudioAndTranscriptByConversationId(conversationId.trim());
      
      if (result.audio || result.transcript) {
        console.log(`[QASubmissionDetails] Found data:`, {
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
          console.log(`[QASubmissionDetails] Audio URL retrieved successfully: ${result.audio.audio_url}`);
        }
        if (result.transcript) {
          console.log(`[QASubmissionDetails] Transcript retrieved successfully`);
        }
      } else {
        console.warn(`[QASubmissionDetails] No audio or transcript found for conversation ID: ${conversationId}`);
        // Clear audio URL and transcript if nothing found
        setCallDetails(prev => ({
          ...prev,
          audio_url: null,
          transcript: 'No transcript available'
        }));
      }
    } catch (error) {
      console.error(`[QASubmissionDetails] Error fetching audio and transcript:`, error);
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

  useEffect(() => {
    const fetchSubmissionDetails = async () => {
      setIsLoading(true);
      setError(null);
      
      // First try to get form ID directly from the URL query params
      const formIdFromQuery = new URLSearchParams(window.location.search).get('formId');
      
      if (formIdFromQuery) {
        // If we have formId in URL, fetch form directly
        try {
                  const formResponse = await apiClient.get(`/forms/${formIdFromQuery}`);
        setFormData(formResponse.data);
          
          // Create basic submission structure with this form
          const basicSubmission: SubmissionDetails = {
            id: Number(id) || 0,
            form_id: Number(formIdFromQuery),
            form: {
              id: Number(formIdFromQuery),
              form_name: formResponse.data.form_name || "Unknown Form",
              interaction_type: formResponse.data.interaction_type || "CALL",
              version: formResponse.data.version || "1.0"
            },
            metadata: [],
            calls: [],
            answers: [],
            dispute: null
          };
          
          setSubmission(basicSubmission);
          setIsLoading(false);
          return;
        } catch (formErr) {
          console.error("Error fetching form by ID from query param:", formErr);
          // Continue with normal flow if this fails
        }
      }
      
      // Normal flow - try to get submission data
      try {
        // Use different endpoint based on user context
        let endpoint: string;
        if (isManagerView) {
          endpoint = `/manager/team-audits/${id}`; // Manager-specific endpoint
        } else if (isAdminView) {
          endpoint = `/qa/completed/${id}?includeScores=true&includeQuestionScores=true&includeScoreDetails=true`; // Admin uses QA endpoint
        } else if (isCSR) {
          endpoint = `/csr/audits/${id}?t=${Date.now()}`; // CSR-specific endpoint with timestamp to bypass cache
        } else if (isTrainerView) {
          endpoint = `/trainer/completed/${id}?includeScores=true&includeQuestionScores=true&includeScoreDetails=true`; // Trainer-specific endpoint
        } else {
          endpoint = `/qa/completed/${id}?includeScores=true&includeQuestionScores=true&includeScoreDetails=true`; // QA endpoint
        }
        
        const submissionResponse = await apiClient.get(endpoint);
        const submissionData = submissionResponse.data;
        
        if (submissionData && submissionData.form && submissionData.form.id) {
          // Submission has form data, try to get complete form structure
          try {
            const formResponse = await apiClient.get(`/forms/${submissionData.form.id}?include_inactive=true`);
            setFormData(formResponse.data);
            
            const combinedSubmission = {
              ...submissionData,
              form: formResponse.data,
              form_id: formResponse.data.id
            };
            
            setSubmission(combinedSubmission);
            setIsLoading(false);
          } catch (formErr) {
            // Could not get form structure, continue with basic form data
            console.error("Error fetching complete form structure:", formErr);
            setSubmission(submissionData);
            setIsLoading(false);
          }
        } else {
          // Use submission data as is
          setSubmission(submissionData);
          setIsLoading(false);
        }
      } catch (submissionErr) {
        console.error("Error fetching submission:", submissionErr);
        setError("Failed to load submission details. The submission may not exist or you may not have permission to view it.");
        setIsLoading(false);
      }
    };

    if (id) {
      fetchSubmissionDetails();
    }
  }, [id, isCSR, isManagerView]);

  // Fetch dispute data when in dispute resolution mode
  useEffect(() => {
    const fetchDisputeData = async () => {
      if (isDisputeResolutionMode && disputeId && submission && formData) {
        try {
          const response = await apiClient.get(`/manager/disputes/${disputeId}`);
          setDisputeData(response.data);
          setIsEditingForm(true); // Enable editing mode
          
          // Initialize form builder with current answers
          initializeFormBuilder();
        } catch (err) {
          console.error('Error fetching dispute data:', err);
          setError('Failed to load dispute information');
        }
      }
    };

    fetchDisputeData();
  }, [isDisputeResolutionMode, disputeId, submission, formData]);

  // Fetch user data for metadata fields containing user IDs
  useEffect(() => {
    const fetchUserData = async () => {
      if (!submission?.metadata || submission.metadata.length === 0) return;
      
      // Look for fields that might contain user IDs
      const userIdFields = ['Reviewer Name', 'CSR', 'Reviewer Name ID', 'CSR ID', 'CSR Name ID'];
      const userIdsToFetch = new Set<number>();
      
      // Collect all unique user IDs
      submission.metadata.forEach(field => {
        if (userIdFields.includes(field.field_name) && field.value) {
          const userId = parseInt(field.value);
          if (!isNaN(userId)) {
            userIdsToFetch.add(userId);
          }
        }
      });
      
      // Fetch user data for all user IDs
      const userNamesMap: Record<string, string> = {};
      try {
        for (const userId of userIdsToFetch) {
          try {
            const userData = await userService.getUserById(userId);
            if (userData && userData.username) {
              userNamesMap[userId.toString()] = userData.username;
            }
          } catch (err) {
            console.error(`Error fetching user data for ID ${userId}:`, err);
          }
        }
        
        setUserNames(userNamesMap);
      } catch (err) {
        console.error('Error fetching user data:', err);
      }
    };
    
    fetchUserData();
  }, [submission?.metadata]);

  // Fetch audio and transcript when submission metadata contains conversation ID
  useEffect(() => {
    const fetchCallData = async () => {
      if (!submission) return;
      
      // For CSR users, check if calls data is already available
      if (isCSR && submission.calls && submission.calls.length > 0) {
        const call = submission.calls[0]; // Use the first call
        console.log(`[QASubmissionDetails] Found call data for CSR:`, call);
        
        // Set call details directly from the calls array
        setCallDetails({
          audio_url: call.recording_url || null,
          transcript: call.transcript || 'No transcript available',
          call_date: call.call_date || 'Date not available',
          duration: call.duration || 'Duration not available'
        });
        return;
      }
      
      // For other users, look for conversation ID in metadata
      if (!submission.metadata || submission.metadata.length === 0) return;
      
      const conversationFields = submission.metadata.filter(field => 
        field.field_name?.toLowerCase().includes('conversation') ||
        field.field_name?.toLowerCase().includes('call recording') ||
        field.field_name?.toLowerCase().includes('recording id')
      );
      
      if (conversationFields.length > 0) {
        const conversationId = conversationFields[0].value;
        if (conversationId && conversationId.trim()) {
          console.log(`[QASubmissionDetails] Found conversation ID in metadata: ${conversationId}`);
          await fetchAudioAndTranscript(conversationId);
        }
      }
    };
    
    fetchCallData();
  }, [submission, isCSR]);

  const handleBackToList = () => {
    // Check if coming from dispute history or disputes resolution
    const urlParams = new URLSearchParams(window.location.search);
    const source = urlParams.get('source');
    const returnTo = urlParams.get('returnTo');
    
    // Determine the return route based on user context and source
    if (isManagerView) {
      if (returnTo === 'disputes') {
        navigate('/manager/disputes');
      } else {
        navigate('/manager/team-audits');
      }
    } else if (isAdminView) {
      if (returnTo === 'disputes') {
        navigate('/admin/disputes');
      } else {
        navigate('/admin/completed-forms');
      }
    } else if (isQAView) {
      if (returnTo === 'disputes') {
        navigate('/qa/disputes');
      } else {
        navigate('/qa/completed-reviews');
      }
    } else if (isCSR) {
      if (source === 'disputes') {
        navigate('/dispute-history');
      } else {
        navigate('/my-audits');
      }
    } else {
      navigate('/qa/completed-reviews');
    }
  };

  const handleExportSubmission = async () => {
    try {
      const response = await apiClient.get(`/qa/completed/${id}/export`, {
        responseType: 'blob'
      });

      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `submission-${id}.csv`);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
    } catch (err) {
      console.error('Error exporting submission:', err);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const formatDateOnly = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric'
    });
  };

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const toggleCallExpand = (callId: string) => {
    if (expandedCall === callId) {
      setExpandedCall(null);
    } else {
      setExpandedCall(callId);
    }
  };

  // Get status badge color
  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'FINALIZED':
        return 'bg-green-100 text-green-800';
      case 'DISPUTED':
        return 'bg-amber-100 text-amber-800';
      case 'UPHELD':
        return 'bg-red-100 text-red-800';
      case 'REJECTED':
        return 'bg-gray-100 text-gray-800';
      case 'ADJUSTED':
        return 'bg-primary-blue/10 text-primary-blue';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  // Add new functions for dispute handling
  const handleOpenDisputeForm = () => {
    setShowDisputeForm(true);
  };

  const handleCloseDisputeForm = () => {
    setShowDisputeForm(false);
    setDisputeText('');
    setDisputeFile(null);
    setDisputeError(null);
  };

  const handleDisputeTextChange = (e: React.ChangeEvent<HTMLTextAreaElement> | any) => {
    const value = e.target ? e.target.value : e;
    setDisputeText(value);
  };

  const handleDisputeFileChange = (e: React.ChangeEvent<HTMLInputElement> | any) => {
    const files = e.target ? e.target.files : null;
    if (files && files[0]) {
      const file = files[0];
      
      // Validate file size (5MB = 5 * 1024 * 1024 bytes)
      const maxSize = 5 * 1024 * 1024;
      if (file.size > maxSize) {
        setDisputeError('File size cannot exceed 5MB');
        e.target.value = ''; // Clear the file input
        setDisputeFile(null);
        return;
      }
      
      // Validate file type
      const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
      if (!allowedTypes.includes(file.type)) {
        setDisputeError('Invalid file type. Only PDF, PNG, JPG files are allowed');
        e.target.value = ''; // Clear the file input
        setDisputeFile(null);
        return;
      }
      
      // Clear any previous file-related errors
      if (disputeError && (disputeError.includes('File size') || disputeError.includes('Invalid file type'))) {
        setDisputeError(null);
      }
      
      setDisputeFile(file);
    } else {
      setDisputeFile(null);
    }
  };

  const handleSubmitDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    
    setIsSubmittingDispute(true);
    setDisputeError(null);
    
    try {
      const formData = new FormData();
      formData.append('submission_id', id);
      formData.append('reason', disputeText);
      
      if (disputeFile) {
        formData.append('attachment', disputeFile);
      }
      
      // Submit the dispute
      await submitDispute(parseInt(id), formData);
      
      // Close the form and show success message
      setShowDisputeForm(false);
      
      // Reload the page to show updated status
      window.location.reload();
    } catch (error) {
      console.error('Error submitting dispute:', error);
      setDisputeError('Failed to submit dispute. Please try again later.');
    } finally {
      setIsSubmittingDispute(false);
    }
  };

  // Add dispute button to the header if CSR and dispute is possible, but not for managers
  // CSRs can only dispute if no dispute has ever been created for this review
  const canDispute = isCSR && 
                     !isManagerView && // Managers cannot dispute
                     submission && 
                     submission.form && 
                     submission.status === 'SUBMITTED' && // Can only dispute submitted reviews
                     !submission.dispute; // Cannot dispute if any dispute record exists

  // Initialize form builder for dispute resolution
  const initializeFormBuilder = () => {
    if (!formData || !submission) return;
    
    // Convert submission answers to the format expected by form builder
    const formBuilderAnswers: Record<number, any> = {};
    if (Array.isArray(submission.answers)) {
      submission.answers.forEach(answer => {
        if (answer.question_id) {
          formBuilderAnswers[answer.question_id] = {
            question_id: answer.question_id,
            answer: answer.answer || '',
            score: answer.score || 0,
            notes: answer.notes || ''
          };
        }
      });
    }
    
    setEditedAnswers(formBuilderAnswers);
    updateFormRenderData(formData, formBuilderAnswers);
  };

  // Update form render data with new answers
  const updateFormRenderData = (formData: any, currentAnswers: Record<number, any>) => {
    if (!formData) return;
    
    // Convert Answer objects to strings for conditional logic
    const answersForConditionalLogic: Record<number, string> = {};
    Object.entries(currentAnswers).forEach(([questionId, answer]) => {
      answersForConditionalLogic[Number(questionId)] = answer.answer || '';
    });
    
    const newVisibilityMap = processConditionalLogic(formData, answersForConditionalLogic);
    const { totalScore, categoryScores } = calculateFormScore(formData, currentAnswers);
    
    setFormScore(totalScore);
    setVisibilityMap(newVisibilityMap);
    
    const updatedRenderData = prepareFormForRender(
      formData,
      currentAnswers,
      newVisibilityMap,
      categoryScores,
      totalScore,
      user?.role_id
    );
    
    setFormRenderData(updatedRenderData);
  };

  // Handle answer changes using form builder logic
  const handleFormAnswerChange = (questionId: number, value: string, questionType: string) => {
    if (!formData) return;
    
    let score = 0;
    let foundQuestion;
    
    // Find the question in the form structure
    for (const category of formData.categories) {
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
      ...editedAnswers,
      [questionId]: {
        question_id: questionId,
        answer: value,
        score,
        notes: editedAnswers[questionId]?.notes || ''
      }
    };
    
    setEditedAnswers(newAnswers);
    updateFormRenderData(formData, newAnswers);
  };

  // Handle notes changes using form builder logic
  const handleFormNotesChange = (questionId: number, notes: string) => {
    if (!formData) return;
    
    const newAnswers = {
      ...editedAnswers,
      [questionId]: {
        ...editedAnswers[questionId],
        notes
      }
    };
    
    setEditedAnswers(newAnswers);
  };

  // Dispute resolution mode functions
  const handleAnswerChange = (questionId: number, field: string, value: any) => {
    setEditedAnswers(prev => ({
      ...prev,
      [questionId]: {
        ...prev[questionId],
        [field]: value
      }
    }));
  };

  // Handle reject dispute - only updates dispute status without form changes
  const handleRejectDispute = async () => {
    if (!disputeId || !disputeResolutionNotes.trim()) return;
    
    setIsRejectingDispute(true);
    
    try {
      const resolutionData = {
        resolution_action: 'REJECTED',
        resolution_notes: disputeResolutionNotes,
        // No updated_answers - we don't save form changes for reject
      };
      
      const response = await apiClient.put(`/manager/disputes/${disputeId}/resolve`, resolutionData);
      
      if (response.data.success) {
        // Navigate back to disputes list
        navigate('/manager/disputes', { 
          state: { message: 'Dispute rejected successfully' }
        });
      }
    } catch (error) {
      console.error('Error rejecting dispute:', error);
      // Could add error toast here
    } finally {
      setIsRejectingDispute(false);
    }
  };

  const handleSaveResolution = async () => {
    if (!disputeResolutionNotes.trim()) {
      setError('Resolution notes are required');
      return;
    }

    if (!disputeId || !submission) {
      setError('Missing required data for resolution');
      return;
    }

    setIsSavingResolution(true);
    try {
      // Prepare the resolution data with updated answers and score
      const resolutionData = {
        resolution_action: 'SCORE_ADJUSTED',
        resolution_notes: disputeResolutionNotes,
        updated_answers: editedAnswers,
        new_total_score: formScore
      };

      console.log('Saving resolution with data:', resolutionData);

      // Save the dispute resolution (this will update the submission and resolve the dispute)
      const response = await apiClient.put(`/manager/disputes/${disputeId}/resolve`, resolutionData);
      
      console.log('Resolution saved successfully:', response.data);

      // Navigate back to disputes list
      navigate('/manager/disputes');
    } catch (err) {
      console.error('Error saving resolution:', err);
      
      // Show more specific error message
      if (err.response?.data?.message) {
        setError(`Failed to save resolution: ${err.response.data.message}`);
      } else if (err.message) {
        setError(`Failed to save resolution: ${err.message}`);
      } else {
        setError('Failed to save resolution. Please try again.');
      }
    } finally {
      setIsSavingResolution(false);
    }
  };

  // Manager can resolve disputes if there's an open dispute
  const canResolveDispute = isManagerView && 
                           submission?.dispute && 
                           submission.dispute.status === 'OPEN';

  // CSRs can approve their own reviews if submission is in SUBMITTED status and not disputed
  const canApproveReview = isCSR && 
                          !isManagerView && // Not in manager view
                          submission && 
                          submission.status !== 'FINALIZED' && 
                          submission.status !== 'DISPUTED';

  // Manager dispute resolution handlers
  const handleOpenDisputeResolution = () => {
    setShowDisputeResolutionForm(true);
    setNewScore(getSubmissionScore(submission)?.toString() || '');
  };

  const handleCloseDisputeResolution = () => {
    setShowDisputeResolutionForm(false);
    setResolutionAction('UPHELD');
    setNewScore('');
    setResolutionNotes('');
    setResolutionError(null);
  };

  const handleResolutionActionChange = (e: React.ChangeEvent<HTMLSelectElement> | any) => {
    const value = e.target ? e.target.value : e;
    setResolutionAction(value as 'UPHELD' | 'REJECTED' | 'ADJUSTED');
  };

  const handleNewScoreChange = (e: React.ChangeEvent<HTMLInputElement> | any) => {
    const value = e.target ? e.target.value : e;
    setNewScore(value);
  };

  const handleResolutionNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement> | any) => {
    const value = e.target ? e.target.value : e;
    setResolutionNotes(value);
  };

  const handleResolveDispute = async (action: 'UPHELD' | 'REJECTED' | 'ADJUSTED') => {
    if (!submission?.dispute?.id) return;
    
    setIsResolvingDispute(true);
    setResolutionError(null);
    
    try {
      const endpoint = isManagerView 
        ? `/api/manager/disputes/${submission.dispute.id}/resolve`
        : `/api/disputes/${submission.dispute.id}/resolve`;
        
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          action,
          resolution_notes: action === 'ADJUSTED' ? resolutionNotes : `Dispute ${action.toLowerCase()} by manager`,
          new_score: action === 'ADJUSTED' ? parseFloat(newScore) : undefined
        })
      });

      if (!response.ok) {
        // Check for authentication errors (401)
        if (isAuthenticationStatus(response.status)) {
          handleAuthenticationFailure();
          return;
        }
        
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to resolve dispute');
      }

      // Refresh the submission data to get updated dispute status
      window.location.reload();
    } catch (error) {
      console.error('Error resolving dispute:', error);
      setResolutionError(error instanceof Error ? error.message : 'Failed to resolve dispute');
    } finally {
      setIsResolvingDispute(false);
    }
  };

  const handleSubmitResolution = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (resolutionAction === 'ADJUSTED' && (!newScore || isNaN(parseFloat(newScore)))) {
      setResolutionError('Please enter a valid score for adjustment');
      return;
    }
    
    await handleResolveDispute(resolutionAction);
  };

  // Add handler for approving review
  const handleApproveReview = async () => {
    if (!id) return;
    
    setIsApprovingReview(true);
    
    try {
      // Use the correct finalization function based on user role
      // CSR uses finalizeAudit, QA/Manager uses finalizeSubmission
      const finalizeFunction = isCSR ? finalizeAudit : finalizeSubmission;
      const finalizeData = {
        acknowledged: true
      };
      
      console.log('Accept Review Debug Info:', {
        submissionId: parseInt(id),
        userRole: user?.role_id,
        userRoleName: user?.role_id,
        isCSR: isCSR,
        isManager: isManager,
        isManagerView: isManagerView,
        isQAView: isQAView,
        isCSRView: isCSRView,
        currentPath: window.location.pathname,
        submissionStatus: submission?.status,
        finalizeFunction: isCSR ? 'finalizeAudit (CSR endpoint)' : 'finalizeSubmission (QA endpoint)',
        finalizeData: finalizeData,
        note: 'CSR endpoint expects {acknowledged: true}'
      });
      
      // Make API call
      await finalizeFunction(parseInt(id), finalizeData);
      
      // Update the submission state immediately
      if (submission) {
        submission.status = 'FINALIZED';
        // Trigger a re-render by updating the submission state
        setSubmission({ ...submission });
      }
      
      console.log('Review accepted and finalized successfully');
      
    } catch (error: any) {
      console.error('Error approving review:', error);
      
      // Log detailed error information
      if (error.response) {
        console.error('Server response:', error.response.data);
        console.error('Server status:', error.response.status);
        console.error('Server headers:', error.response.headers);
        
        // Show specific server error message if available
        const serverMessage = error.response.data?.message || error.response.data?.error || 'Unknown server error';
        setError(`Failed to accept review: ${serverMessage}`);
      } else if (error.request) {
        console.error('No response received:', error.request);
        setError('Failed to accept review: No response from server. Please check your connection.');
      } else {
        console.error('Request setup error:', error.message);
        setError(`Failed to accept review: ${error.message}`);
      }
    } finally {
      setIsApprovingReview(false);
    }
  };

  if (isLoading) {
    return (
      <div className="container p-6 mx-auto relative" role="main" aria-live="polite">
        <div className="flex justify-center items-center py-20">
          <LoadingSpinner size="lg" color="primary" label="Loading submission details..." aria-label="Loading review details" />
        </div>
      </div>
    );
  }

  if (error || !submission) {
    return (
      <div className="container p-6 mx-auto relative" role="main" aria-live="assertive">
        <div className="max-w-3xl mx-auto">
          <ErrorDisplay
            variant="page"
            size="lg"
            title="Error Loading Details"
            message={error || 'Unable to load submission details'}
          />
          
          <div className="mt-8 text-center">
            <p className="text-gray-600 mb-4">This could be due to:</p>
            <ul className="text-gray-600 text-left max-w-md mx-auto list-disc pl-4 mb-6">
              <li>Server error or maintenance</li>
              <li>The submission ID ({id}) doesn't exist</li>
              <li>Network connection issues</li>
              <li>You don't have permission to view this submission</li>
            </ul>
            
            <div className="flex justify-center space-x-4">
              <Button
                variant="primary"
                onClick={() => window.location.reload()}
              >
                Try Again
              </Button>
              
              <Button
                variant="secondary"
                onClick={handleBackToList}
              >
                Back to Completed Reviews
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="container p-6 mx-auto relative" role="main">
        {/* Header Section */}
      <div className="mb-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-neutral-900">
            {isManagerView ? 'Team Review Details' : 
             isCSR ? 'Review Details' : 
             'Completed Reviews Form Detail'}
          </h1>
          <div className="flex items-center space-x-4">
            <Button 
              variant="ghost"
              onClick={handleBackToList}
              leftIcon={<HiOutlineArrowLeft className="h-5 w-5" />}
              className="text-primary-blue hover:text-primary-blue-dark hover:bg-primary-blue/10"
              aria-label={`Go back to ${isManagerView ? 
                (new URLSearchParams(window.location.search).get('returnTo') === 'disputes' ? 'dispute resolution' : 'team reviews') :
                isAdminView ? (new URLSearchParams(window.location.search).get('returnTo') === 'disputes' ? 'dispute resolution' : 'completed forms') :
                isQAView ? (new URLSearchParams(window.location.search).get('returnTo') === 'disputes' ? 'dispute resolution' : 'completed reviews') :
                isCSR ? (new URLSearchParams(window.location.search).get('source') === 'disputes' ? 'my disputes' : 'my reviews') :
                'completed reviews'}`}
            >
              {isManagerView ? 
                (new URLSearchParams(window.location.search).get('returnTo') === 'disputes' ? 'Back to Dispute Resolution' : 'Back to Team Reviews') :
                isAdminView ? (new URLSearchParams(window.location.search).get('returnTo') === 'disputes' ? 'Back to Dispute Resolution' : 'Back to Completed Forms') :
                isQAView ? (new URLSearchParams(window.location.search).get('returnTo') === 'disputes' ? 'Back to Dispute Resolution' : 'Back to Completed Reviews') :
                isCSR ? (new URLSearchParams(window.location.search).get('source') === 'disputes' ? 'Back to My Disputes' : 'Back to My Reviews') :
                'Back to Completed Reviews'}
            </Button>
          </div>
        </div>
      </div>

      {/* Dispute Resolution Panel - Only show in dispute resolution mode */}
      {isDisputeResolutionMode && disputeData && (
        <div className="mb-8">
          <Card variant="bordered" padding="lg">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-neutral-900">
                Dispute Resolution Mode
              </h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <span className="text-sm font-medium text-neutral-500">Dispute #{disputeData.dispute_id}</span>
                <p className="text-sm text-neutral-600">Submitted by {disputeData.csr_name}</p>
              </div>
              <div>
                <span className="text-sm font-medium text-neutral-500">Current Score:</span>
                <span className="ml-2 text-sm text-neutral-600">{disputeData.total_score}%</span>
              </div>
            </div>
            
            <div className="mb-4">
              <h3 className="text-sm font-medium text-neutral-500 mb-2">Dispute Reason:</h3>
              <div className="bg-gray-50 p-3 rounded border border-gray-200">
                <p className="text-sm text-gray-700">{disputeData.reason}</p>
              </div>
            </div>
            
            <div className="border-t border-gray-200 pt-4">
              <h3 className="text-sm font-medium text-neutral-500 mb-2">Resolution Notes (Required):</h3>
              <textarea
                value={disputeResolutionNotes}
                onChange={(e) => setDisputeResolutionNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder="Explain your resolution decision and any changes made..."
              />
            </div>
            
            <div className="flex justify-end space-x-3 mt-4">
              <Button
                variant="secondary"
                onClick={() => navigate('/manager/disputes')}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleRejectDispute}
                loading={isRejectingDispute}
                disabled={!disputeResolutionNotes.trim()}
              >
                Reject Dispute
              </Button>
              <Button
                variant="primary"
                onClick={handleSaveResolution}
                loading={isSavingResolution}
                disabled={!disputeResolutionNotes.trim()}
              >
                Adjust Score
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Form Title Section */}
      <div className="mb-8">
        <Card variant="bordered" padding="lg">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <h2 className="text-xl font-bold text-gray-800">
                {submission.form.form_name}
              </h2>
              <div className="text-sm text-gray-500 bg-gray-50 px-3 py-1 rounded-full">
                Version {submission.form.user_version || submission.form.version}
              </div>
            </div>
            <div className="flex items-center space-x-3">
              {canDispute && (
                <Button 
                  variant="primary"
                  onClick={handleOpenDisputeForm}
                  size="sm"
                  aria-label="Submit a dispute for this review"
                >
                  Submit Dispute
                </Button>
              )}
              {canApproveReview && (
                <Button 
                  variant="primary"
                  onClick={handleApproveReview}
                  disabled={isApprovingReview}
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
                  aria-label={isApprovingReview ? 'Accepting review in progress' : 'Accept and finalize this review'}
                >
                  {isApprovingReview ? 'Accepting...' : 'Accept Review'}
                </Button>
              )}
              {!canDispute && !canApproveReview && (
                <div className="text-base text-neutral-500">
                  Status: {submission.status ? submission.status.charAt(0).toUpperCase() + submission.status.slice(1).toLowerCase() : 'Completed'}
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Main content - split screen layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column - Metadata & Calls - 4 columns on large screens */}
        <div className="lg:col-span-4 space-y-8 lg:sticky lg:top-4 lg:self-start lg:pr-4">
          {/* Form Details - Combined Form Information and Metadata */}
          <Card variant="bordered" padding="lg">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-neutral-900">Form Details</h2>
            </div>
            
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-neutral-500">Submission ID:</span>
                <span className="font-medium">{submission.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Form ID:</span>
                <span className="font-medium">{submission.form.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Interaction Type:</span>
                <span className="font-medium">{submission.form.interaction_type}</span>
              </div>
              
              {/* Metadata Fields */}
              {submission.metadata.length > 0 && (
                <>
                  <div className="border-t border-gray-200 my-3"></div>
                  {submission.metadata.map((field, index) => {
                    // Determine if this field contains a user ID that we need to display as a name
                    let fieldValue = field.value;
                    const userIdFields = ['Reviewer Name', 'CSR', 'Reviewer Name ID', 'CSR ID', 'CSR Name ID'];
                    
                    // If this is a user ID field and we have the name, display the name
                    if (userIdFields.includes(field.field_name) && userNames[fieldValue]) {
                      fieldValue = userNames[fieldValue];
                    }
                    
                    // Apply date formatting for Review Date field
                    if (field.field_name === 'Review Date' && fieldValue) {
                      // Display the date as-is since it's already in YYYY-MM-DD format
                      // No timezone conversion needed
                    }
                    
                    // Display field name and value
                    return (
                      <div key={index} className="flex justify-between">
                        <span className="text-neutral-500">{field.field_name}:</span>
                        <span className="font-medium">{fieldValue}</span>
                      </div>
                    );
                  })}
                </>
              )}
              
              {submission.metadata.length === 0 && (
                <div className="flex justify-between">
                  <span className="text-neutral-500">Metadata:</span>
                  <span className="text-neutral-500">No metadata available</span>
                </div>
              )}
            </div>
          </Card>
          
          {/* Call Details */}
          <Card variant="bordered" padding="lg">
            <h2 className="text-lg font-semibold mb-4 text-neutral-900">Call Details</h2>
            
            {submission.calls && submission.calls.length > 0 ? (
              <div className="space-y-6">
                {submission.calls.map((call, index) => (
                  <div key={call.call_id || index} className="border border-gray-200 rounded-lg p-4">
                    <div className="mb-4">
                      <h3 className="font-medium text-base mb-2 text-neutral-900">
                        Call {index + 1}
                      </h3>
                      
                      {/* Conversation ID below call header */}
                      {call.call_id && (
                        <div className="mb-4 text-sm">
                          <span className="text-neutral-500">Conversation ID: </span>
                          <span className="font-medium">{call.call_id}</span>
                        </div>
                      )}
                      
                      {/* Call Information - Only show call date */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 text-sm">
                        {call.call_date && (
                          <div>
                            <span className="text-neutral-500">Call Date: </span>
                            <span className="font-medium">{formatDateOnly(call.call_date)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Audio Section */}
                    <div className="mb-4">
                      <h4 className="font-medium text-sm mb-2 text-neutral-700">Audio</h4>
                      <div className="border border-gray-200 p-3 rounded-md bg-gray-50">
                        {call.recording_url ? (
                          <div>
                            <audio controls className="w-full">
                              <source src={call.recording_url} type="audio/mpeg" />
                              Your browser does not support the audio element.
                            </audio>
                          </div>
                        ) : (
                          <p className="text-gray-600 text-sm">
                            No audio available
                          </p>
                        )}
                      </div>
                    </div>
                    
                    {/* Transcript Section */}
                    <div>
                      <h4 className="font-medium text-sm mb-2 text-neutral-700">Transcript</h4>
                      <div className="border border-gray-200 p-3 rounded-md max-h-60 overflow-y-auto">
                        {call.transcript ? (
                          <div 
                            className="text-gray-800 text-sm whitespace-pre-wrap break-words leading-relaxed"
                            dangerouslySetInnerHTML={{ __html: formatTranscriptText(call.transcript) }}
                          />
                        ) : (
                          <p className="text-gray-600 text-sm">No transcript available</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {/* Audio Section */}
                <div>
                  <h3 className="font-medium text-base mb-2 text-neutral-900">Audio</h3>
                  <div className="border border-gray-200 p-4 rounded-md bg-gray-50">
                    {isLoadingAudio ? (
                      <div className="flex items-center justify-center py-4">
                        <LoadingSpinner size="sm" color="primary" />
                        <span className="ml-2 text-gray-600">Loading audio...</span>
                      </div>
                    ) : callDetails?.audio_url ? (
                      <div>
                        <audio controls className="w-full">
                          <source src={callDetails.audio_url} type="audio/mpeg" />
                          Your browser does not support the audio element.
                        </audio>
                      </div>
                    ) : (
                      <p className="text-gray-600">
                        No audio available
                      </p>
                    )}
                  </div>
                </div>
                
                {/* Transcript Section */}
                <div>
                  <h3 className="font-medium text-base mb-2 text-neutral-900">Transcript</h3>
                  <div className="border border-gray-200 p-4 rounded-md max-h-80 overflow-y-auto">
                    {isLoadingAudio ? (
                      <div className="flex items-center justify-center py-4">
                        <LoadingSpinner size="sm" color="primary" />
                        <span className="ml-2 text-gray-600">Loading transcript...</span>
                      </div>
                    ) : callDetails?.transcript ? (
                      <p className="text-gray-800 whitespace-pre-wrap">{formatTranscriptText(callDetails.transcript)}</p>
                    ) : (
                      <p className="text-gray-600">No transcript available</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </Card>

          {/* Dispute Information (if applicable) - Hide during dispute resolution mode */}
          {submission.dispute && !isDisputeResolutionMode && (
            <Card variant="bordered" padding="lg">
              <h2 className="text-lg font-semibold mb-4 text-neutral-900">Dispute Information</h2>
              
              <div className="space-y-4">
                <div>
                  <span className="text-neutral-500 font-medium">Status: </span>
                  <span className="text-neutral-500">{submission.dispute.status.charAt(0).toUpperCase() + submission.dispute.status.slice(1).toLowerCase()}</span>
                </div>
                
                <div>
                  <h3 className="font-medium text-base mb-2 text-neutral-900">Dispute Reason</h3>
                  <div className="bg-neutral-50 p-3 rounded-md">
                    <p className="text-neutral-500">{submission.dispute.reason}</p>
                  </div>
                </div>
                
                {/* Supporting Evidence/Attachment */}
                {submission.dispute.attachment_url && (
                  <div>
                    <h3 className="font-medium text-base mb-2 text-neutral-900">Supporting Evidence</h3>
                    <div className="bg-neutral-50 p-3 rounded-md">
                        <div className="flex items-center space-x-3">
                          <HiOutlineDocumentText className="h-6 w-6 text-blue-600" />
                          <div className="flex-1">
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  if (!submission.dispute.id) {
                                    alert('Cannot download attachment: Dispute ID is missing.');
                                    return;
                                  }
                                  
                                  // Use API endpoint to download attachment (like coaching sessions)
                                  const response = await apiClient.get(`/disputes/${submission.dispute.id}/attachment`, {
                                    responseType: 'blob'
                                  });
                                  
                                  const blob = response.data;
                                  const url = window.URL.createObjectURL(blob);
                                  const link = document.createElement('a');
                                  link.href = url;
                                  link.download = submission.dispute.attachment_url!.split('/').pop() || 'attachment';
                                  document.body.appendChild(link);
                                  link.click();
                                  document.body.removeChild(link);
                                  window.URL.revokeObjectURL(url);
                                } catch (error: any) {
                                  console.error('Download failed:', error);
                                  alert('Failed to download attachment. Please try again.');
                                }
                              }}
                              className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline cursor-pointer text-left"
                            >
                              {submission.dispute.attachment_url.split('/').pop() || 'Attachment'}
                            </button>
                            <p className="text-xs text-neutral-500 mt-1">
                              Supporting evidence uploaded with dispute
                            </p>
                          </div>
                        </div>
                    </div>
                  </div>
                )}
                
                {submission.dispute.disputed_by_name && (
                  <div>
                    <p className="text-neutral-500 mb-1">Disputed By:</p>
                    <p className="text-neutral-900">{submission.dispute.disputed_by_name}</p>
                  </div>
                )}
                
                {/* Dispute Resolution Notes Area */}
                <div>
                  <h3 className="font-medium text-base mb-2 text-neutral-900">Dispute Resolution Notes</h3>
                  {submission.dispute.resolution_notes ? (
                    <div className="bg-neutral-50 p-3 rounded-md">
                      <p className="text-neutral-500">{submission.dispute.resolution_notes}</p>
                    </div>
                  ) : submission.dispute.status === 'OPEN' ? (
                    <div className="bg-neutral-50 p-3 rounded-md">
                      <p className="text-neutral-500">Under manager review.</p>
                    </div>
                  ) : (
                    <div className="bg-neutral-50 p-3 rounded-md">
                      <p className="text-neutral-500">No resolution notes available</p>
                    </div>
                  )}
                </div>
                
                {submission.dispute.resolved_by_name && (
                  <div>
                    <p className="text-neutral-500 mb-1">Resolved By:</p>
                    <p className="text-neutral-900">{submission.dispute.resolved_by_name}</p>
                  </div>
                )}
                
                {submission.dispute.resolved_at && (
                  <div>
                    <p className="text-neutral-500 mb-1">Resolved:</p>
                    <p className="text-neutral-900">{formatDate(submission.dispute.resolved_at)}</p>
                  </div>
                )}
                
                {/* Manager Resolution Actions - Only show if not in dispute resolution mode */}
                {isManagerView && submission.dispute.status === 'OPEN' && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <p className="text-neutral-500 mb-3 font-medium">Manager Actions:</p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button
                        onClick={() => handleResolveDispute('UPHELD')}
                        variant="primary"
                        disabled={isResolvingDispute}
                        className="bg-green-600 hover:bg-green-700"
                        aria-label="Uphold the dispute and keep the current score"
                      >
                        <HiOutlineCheckCircle className="w-4 h-4 mr-2" />
                        Uphold Dispute
                      </Button>
                      <Button
                        onClick={() => handleResolveDispute('REJECTED')}
                        variant="destructive"
                        disabled={isResolvingDispute}
                        aria-label="Reject the dispute and maintain the original review result"
                      >
                        <HiOutlineXCircle className="w-4 h-4 mr-2" />
                        Reject Dispute
                      </Button>
                      <Button
                        onClick={() => setShowDisputeResolutionForm(true)}
                        variant="primary"
                        disabled={isResolvingDispute}
                        aria-label="Adjust the review score to resolve the dispute"
                      >
                        <HiOutlinePencilAlt className="w-4 h-4 mr-2" />
                        Adjust Score
                      </Button>
                    </div>
                    {resolutionError && (
                      <ErrorDisplay 
                        message={resolutionError} 
                        variant="inline" 
                        className="mt-2" 
                      />
                    )}
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
        
        {/* Right Column - Form Answers - 8 columns on large screens */}
        <div className="lg:col-span-8">
          {/* Overall Score Summary Section - Show for all users with score data, prioritize CSR view */}
          {getSubmissionScore(submission) !== undefined && (
            <Card variant="bordered" className="p-6 mb-8">
              <div className="flex items-center mb-4 border-b pb-4">
                <h2 className="text-lg font-semibold text-neutral-900">Overall Score Summary</h2>
              </div>
              
              <div className="flex flex-col items-center justify-center py-4">
                <div className={`text-5xl font-bold mb-2 ${getScoreColorClass(getSubmissionScore(submission), 'text')}`}>
                  {formatScore(getSubmissionScore(submission), 2)}
                </div>
                <div className="text-neutral-500">Final Score</div>
              </div>
            </Card>
          )}
          
          {/* Detailed Score Summary Section / Editable Form */}
          {formData && (
            <Card variant="bordered" className="p-6 mb-8">
              {isDisputeResolutionMode ? (
                <div>
                  <div className="flex items-center mb-6">
                    <h2 className="text-lg font-semibold text-neutral-900">Edit Review Form</h2>
                    <div className="ml-auto bg-gray-100 text-gray-800 px-3 py-1 rounded-full text-sm">
                      Editing Mode
                    </div>
                  </div>
                  
                  {/* Show editable form using FormRenderer */}
                  {formRenderData ? (
                    <div className="mb-6">
                      <FormRenderer
                        formRenderData={formRenderData}
                        isDisabled={false}
                        onAnswerChange={handleFormAnswerChange}
                        onNotesChange={handleFormNotesChange}
                      />
                      
                      {/* Show current score */}
                      <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-medium text-gray-700">Updated Total Score:</span>
                          <span className="text-2xl font-bold text-gray-800">{formScore.toFixed(1)}%</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      Loading form for editing...
                    </div>
                  )}
                </div>
              ) : (
                <ScoreRenderer 
                  formData={formData} 
                  answers={Array.isArray(submission.answers) ? 
                    submission.answers.reduce((acc, answer) => {
                      if (answer.question_id) {
                        acc[answer.question_id] = answer;
                      }
                      return acc;
                    }, {} as Record<number, any>) 
                    : {}}
                  backendScore={getSubmissionScore(submission)} 
                  userRole={user?.role_id}
                  scoreBreakdown={submission.scoreBreakdown}
                />
              )}
            </Card>
          )}
        </div>
      </div>

      {/* Dispute Form Modal */}
      <Modal 
        isOpen={showDisputeForm} 
        onClose={handleCloseDisputeForm}
        title="Submit Dispute"
        size="lg"
      >
        <form onSubmit={handleSubmitDispute} className="space-y-4">
          <FormField
            name="disputeReason"
            type="textarea"
            label="Reason for Dispute"
            value={disputeText}
            onChange={handleDisputeTextChange}
            placeholder="Explain why you are disputing this review..."
            maxLength={1000}
            required
            helpText={`Maximum 1000 characters. ${1000 - disputeText.length} characters remaining.`}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Upload Supporting Evidence (Optional)
            </label>
            <div className="relative">
              <input
                type="file"
                name="disputeFile"
                onChange={handleDisputeFileChange}
                accept=".pdf,.png,.jpg,.jpeg"
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
              {disputeFile && (
                <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded-md">
                  <p className="text-sm text-green-800">
                    <span className="font-medium">Selected file:</span> {disputeFile.name}
                  </p>
                  <p className="text-xs text-green-600">
                    Size: {(disputeFile.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Supported formats: PDF, PNG, JPG (Max 5MB)
            </p>
          </div>

          {disputeError && (
            <ErrorDisplay 
              message={disputeError} 
              variant="inline" 
            />
          )}

          <ModalFooter>
            <Button 
              type="button"
              variant="ghost"
              onClick={handleCloseDisputeForm}
              disabled={isSubmittingDispute}
            >
              Cancel
            </Button>
            <Button 
              type="submit"
              variant="primary"
              disabled={isSubmittingDispute || !disputeText.trim()}
            >
              {isSubmittingDispute && <LoadingSpinner size="sm" className="mr-2" />}
              Submit Dispute
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* Dispute Resolution Modal */}
      <Modal 
        isOpen={showDisputeResolutionForm} 
        onClose={handleCloseDisputeResolution}
        title="Resolve Dispute"
        size="lg"
      >
        <form onSubmit={handleSubmitResolution} className="space-y-4">
          <Select
            label="Resolution Action"
            value={resolutionAction}
            onChange={handleResolutionActionChange}
            options={[
              { value: 'UPHELD', label: 'Uphold Dispute' },
              { value: 'REJECTED', label: 'Reject Dispute' },
              { value: 'ADJUSTED', label: 'Adjust Score' }
            ]}
            required
          />

          {resolutionAction === 'ADJUSTED' && (
            <Input
              type="number"
              label="New Score"
              value={newScore}
              onChange={handleNewScoreChange}
              min="0"
              max="100"
              step="0.01"
              required
            />
          )}

          <FormField
            name="resolutionNotes"
            type="textarea"
            label="Resolution Notes"
            value={resolutionNotes}
            onChange={handleResolutionNotesChange}
            placeholder="Enter resolution notes..."
            required
          />

          {resolutionError && (
            <ErrorDisplay 
              message={resolutionError} 
              variant="inline" 
            />
          )}

          <ModalFooter>
            <Button 
              type="button"
              variant="ghost"
              onClick={handleCloseDisputeResolution}
              disabled={isResolvingDispute}
            >
              Cancel
            </Button>
            <Button 
              type="submit"
              variant="primary"
              disabled={isResolvingDispute || !resolutionAction.trim() || !resolutionNotes.trim()}
            >
              {isResolvingDispute && <LoadingSpinner size="sm" className="mr-2" />}
              Submit Resolution
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
    </ErrorBoundary>
  );
};

export default QASubmissionDetails; 