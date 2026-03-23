import submissionService from '../services/submissionService';
import type { User } from '../services/authService';
import axios from 'axios';
import { handleErrorIfAuthentication } from './errorHandling';

// Define Answer interface locally since it's not available in types
interface AnswerType {
  answer: string;
  notes?: string;
}

export interface SubmissionData {
  form_id: number;
  call_id?: number | null;
  submitted_by: number;
  status: 'DRAFT' | 'SUBMITTED' | 'DISPUTED' | 'FINALIZED';
  answers: {
    question_id: number;
    answer: string;
    notes?: string;
  }[];
  metadata?: Array<{
    field_id: string | number;
    value: string;
  }>;
}

/**
 * Prepare submission data from answers and form details
 */
export function prepareSubmissionData(
  formId: string | number,
  callId: string | number | null,
  user: User,
  answers: Record<number, AnswerType>,
  status: 'DRAFT' | 'SUBMITTED' = 'SUBMITTED',
  metadata?: Record<string, string>
): SubmissionData {
  // Transform metadata from record to array format if provided
  const formattedMetadata = metadata
    ? Object.entries(metadata).map(([fieldId, value]) => {
        // Extract numeric ID if the field ID is in the format "field_XXX"
        let processedFieldId: string | number = fieldId;
        const fieldMatch = fieldId.match(/^field_(\d+)$/);
        
        if (fieldMatch) {
          // If it's in the field_XXX format, extract the numeric part
          processedFieldId = parseInt(fieldMatch[1]);
        } else if (!isNaN(parseInt(fieldId))) {
          // If it's a numeric string, convert to number
          processedFieldId = parseInt(fieldId);
        }
        
        // Process value specifically for date fields to ensure proper format
        let processedValue = value;
        
        // Simple date detection - can be expanded for more comprehensive validation
        const isLikelyDate = value && (
          value.match(/^\d{4}-\d{2}-\d{2}$/) || // YYYY-MM-DD
          value.match(/^\d{2}\/\d{2}\/\d{4}$/) || // MM/DD/YYYY
          value.match(/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/) // Various date formats
        );
        
        if (isLikelyDate) {
          try {
            // Handle YYYY-MM-DD format directly without timezone conversion
            if (value.match(/^\d{4}-\d{2}-\d{2}$/)) {
              // Already in correct format, use as-is
              processedValue = value;
              console.log(`Date already in YYYY-MM-DD format: ${value}`);
            } else {
              // Attempt to normalize other date formats to YYYY-MM-DD for database storage
              const dateObj = new Date(value);
              if (!isNaN(dateObj.getTime())) {
                const year = dateObj.getFullYear();
                const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                const day = String(dateObj.getDate()).padStart(2, '0');
                processedValue = `${year}-${month}-${day}`;
                console.log(`Normalized date value from ${value} to ${processedValue}`);
              }
            }
          } catch (e) {
            console.warn(`Failed to normalize date: ${value}`, e);
            // Keep original value if date processing fails
          }
        }
        
        console.log(`Formatting metadata: ${fieldId} -> ${processedFieldId} = ${processedValue}`);
        
        return {
          field_id: processedFieldId,
          value: processedValue
        };
      })
    : undefined;

  // Log the formatted metadata
  if (formattedMetadata) {
    console.log('Formatted metadata array for submission:', formattedMetadata);
    
    // Verify if review date is in the metadata
    const reviewDateField = formattedMetadata.find(item => 
      (typeof item.field_id === 'string' && 
        item.field_id.toLowerCase().includes('date')) || 
      (typeof item.field_id === 'number' && 
        item.value && item.value.match(/^\d{4}-\d{2}-\d{2}$/))
    );
    
    if (reviewDateField) {
      console.log('Review date found in metadata:', reviewDateField);
    } else {
      console.warn('No review date found in metadata!');
    }
  }

  return {
    form_id: Number(formId),
    call_id: callId ? Number(callId) : null,
    submitted_by: user.id, // Using user.id instead of userId
    status,
    answers: Object.entries(answers).map(([questionId, answer]) => ({
      question_id: Number(questionId),
      answer: answer.answer,
      notes: answer.notes || ''
    })),
    metadata: formattedMetadata
  };
}

/**
 * Submit a form review
 */
export async function submitFormReview(
  formId: string | number,
  callId: string | number | null,
  user: User, 
  answers: Record<number, AnswerType>,
  onSuccess?: (response: any) => void,
  onError?: (error: any) => void,
  metadata?: Record<string, string>
): Promise<boolean> {
  try {
    const submissionData = prepareSubmissionData(
      formId,
      callId,
      user,
      answers,
      'SUBMITTED',
      metadata
    );

    const response = await submissionService.submitAudit(submissionData);
    
    if (onSuccess) {
      onSuccess(response);
    }
    
    return true;
  } catch (error: any) {
    console.error('Error submitting review:', error);
    
    // Check for authentication errors (401) - let the axios interceptor handle redirect
    if (handleErrorIfAuthentication(error)) {
      return false;
    }
    
    // Handle specific 400 error for unanswered required questions
    if (error.response?.status === 400 && error.response?.data?.unanswered) {
      const unansweredQuestions = error.response.data.unanswered;
      const unansweredDetails = error.response.data.unansweredDetails || [];
      
      console.error('Missing required answers for questions:', unansweredQuestions);
      
      if (onError) {
        // Generate a user-friendly error message
        let errorMessage = 'Please answer all required questions:';
        if (unansweredDetails.length > 0) {
          errorMessage += '\n' + unansweredDetails
            .map((q: { id: number; question_text: string }) => `- ${q.question_text || `Question ${q.id}`}`)
            .join('\n');
        } else {
          errorMessage += ' ' + unansweredQuestions.join(', ');
        }
        
        onError({
          ...error,
          unansweredQuestions,
          unansweredDetails,
          isValidationError: true,
          message: errorMessage
        });
      }
    } else if (onError) {
      onError(error);
    }
    
    return false;
  }
}

/**
 * Save a form review as draft
 */
export async function saveFormReviewDraft(
  formId: string | number,
  callId: string | number | null,
  user: User,
  answers: Record<number, AnswerType>,
  onSuccess?: (response: any) => void,
  onError?: (error: any) => void,
  metadata?: Record<string, string>
): Promise<boolean> {
  try {
    const submissionData = prepareSubmissionData(
      formId,
      callId,
      user,
      answers,
      'DRAFT',
      metadata
    );

    const response = await submissionService.saveDraft(submissionData);
    
    if (onSuccess) {
      onSuccess(response);
    }
    
    return true;
  } catch (error: any) {
    console.error('Error saving review draft:', error);
    
    // Check for authentication errors (401) - let the axios interceptor handle redirect
    if (handleErrorIfAuthentication(error)) {
      return false;
    }
    
    if (onError) {
      onError(error);
    }
    
    return false;
  }
}

/**
 * Manager update to an existing review
 */
export async function updateFormReview(
  submissionId: number,
  formId: string | number,
  callId: string | number | null,
  user: User,
  answers: Record<number, AnswerType>,
  onSuccess?: (response: any) => void,
  onError?: (error: any) => void
): Promise<boolean> {
  try {
    const submissionData = prepareSubmissionData(formId, callId, user, answers, 'SUBMITTED');

    // Use the dedicated service method for updating submissions
    const response = await submissionService.updateSubmission(submissionId, {
      ...submissionData,
      updated_by: user.id,
      updated_at: new Date().toISOString()
    });
    
    if (onSuccess) {
      onSuccess(response);
    }
    
    return true;
  } catch (error) {
    console.error('Error updating review:', error);
    
    if (onError) {
      onError(error);
    }
    
    return false;
  }
}

/**
 * Create a snapshot of a form's current score state
 * Used when managers need to save the state of a form at a specific point
 */
export async function createScoreSnapshot(
  submissionId: number,
  user: User,
  onSuccess?: (response: any) => void,
  onError?: (error: any) => void
): Promise<boolean> {
  try {
    // Use the dedicated service method for creating score snapshots
    const response = await submissionService.createScoreSnapshot(submissionId, {
      created_by: user.id,
      created_at: new Date().toISOString()
    });
    
    if (onSuccess) {
      onSuccess(response);
    }
    
    return true;
  } catch (error) {
    console.error('Error creating score snapshot:', error);
    
    if (onError) {
      onError(error);
    }
    
    return false;
  }
}

/**
 * Manager function to finalize a review after disputes are resolved
 */
export async function finalizeFormReview(
  submissionId: number,
  user: User,
  finalScore?: number, // Optional final score adjustment
  comments?: string,
  onSuccess?: (response: any) => void,
  onError?: (error: any) => void
): Promise<boolean> {
  try {
    // Use the QA endpoint for manager/admin finalization
    const api = axios.create({
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    
    const response = await api.put(`/api/qa/submissions/${submissionId}/finalize`, {
      finalized_by: user.id,
      final_score: finalScore,
      comments,
      finalized_at: new Date().toISOString()
    });
    
    if (onSuccess) {
      onSuccess(response.data);
    }
    
    return true;
  } catch (error) {
    console.error('Error finalizing review:', error);
    
    if (onError) {
      onError(error);
    }
    
    return false;
  }
}

/**
 * Validate if all required questions are answered
 * Returns { isValid: boolean, unansweredQuestions: number[] }
 */
export function validateAnswers(
  formCategories: Array<{
    questions?: Array<{
      id?: number;
      question_type?: string;
    }>;
  }>,
  answers: Record<number, AnswerType>,
  visibilityMap?: Record<number, boolean>
): { isValid: boolean; unansweredQuestions: number[] } {
  if (!formCategories || formCategories.length === 0) {
    return { isValid: true, unansweredQuestions: [] };
  }

  const requiredQuestions: number[] = [];
  const answeredQuestionIds = Object.keys(answers)
    .map(Number)
    .filter(qId => {
      const answer = answers[qId];
      return answer && answer.answer && answer.answer.trim() !== '';
    });

  // Find all required questions from the form structure
  formCategories.forEach(category => {
    if (category.questions) {
      category.questions
        .filter(q => {
          // Questions that need an answer (not info blocks, text, etc.)
          const nonInputTypes = ['INFO_BLOCK', 'TEXT', 'SUB_CATEGORY', 'INFO'];
          const questionType = (q.question_type || '').toUpperCase();
          
          // Check if question is visible (if visibility map is provided)
          const isVisible = !visibilityMap || visibilityMap[q.id] !== false;
          
          return q.id && !nonInputTypes.includes(questionType) && isVisible;
        })
        .forEach(q => {
          // For now, treat all visible questions as required if they have an ID
          if (q.id) {
            requiredQuestions.push(q.id);
          }
        });
    }
  });

  // Find which required questions haven't been answered
  const unansweredQuestions = requiredQuestions.filter(
    qId => !answeredQuestionIds.includes(qId)
  );

  return {
    isValid: unansweredQuestions.length === 0,
    unansweredQuestions
  };
} 