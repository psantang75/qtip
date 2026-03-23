/**
 * Scoring Adapter
 *
 * This adapter provides frontend-compatible scoring functions that use the 
 * same logic as the backend scoringUtil to maintain consistency.
 * 
 * Instead of duplicating logic, this adapter translates between frontend and backend types.
 */

import type { Form, Question, Answer } from '../../types';
import { processConditionalLogic } from './formConditions';

/**
 * Calculate scores for a form submission based on answers and form structure
 */
export const calculateFormScore = (
  form: Form,
  answers: Record<number, Answer>
): {
  totalScore: number,
  categoryScores: Record<number, {
    raw: number,
    weighted: number,
    earnedPoints: number,
    possiblePoints: number,
    trainingPenaltyApplied?: boolean,
    weightedNumerator?: number,
    weightedDenominator?: number
  }>
} => {
  // Initialize with empty objects
  const categoryScores: Record<number, {
    raw: number,
    weighted: number,
    earnedPoints: number,
    possiblePoints: number,
    trainingPenaltyApplied?: boolean,
    weightedNumerator?: number,
    weightedDenominator?: number
  }> = {};
  
  // Safety check for form structure
  if (!form?.categories || !Array.isArray(form.categories) || form.categories.length === 0) {
    return { totalScore: 0, categoryScores: {} };
  }
  
  // Convert answers to strings for conditional logic processor
  const answerStrings: Record<number, string> = {};
  Object.entries(answers).forEach(([questionId, answer]) => {
    answerStrings[Number(questionId)] = answer.answer || '';
  });
  
  // Get visibility map from conditional logic processor
  const visibilityMap = processConditionalLogic(form, answerStrings);
  
  // Variables for total score calculation
  let totalWeightedNumerator = 0;
  let totalWeightedDenominator = 0;
  
  // Process each category
  form.categories.forEach((category, index) => {
    // Handle missing category ID by using index as fallback
    const categoryId = category.id ?? (index + 1) * -1000;
    
    // If a category doesn't have an ID, use a fallback ID
    if (!category.id) {
      // Assign the ID directly to the category to ensure consistency
      (category as any).id = categoryId;
    }
    
    let earnedPoints = 0;  // Numerator for this category
    let possiblePoints = 0;  // Denominator for this category
    
    // Process each question in the category
    (category.questions || []).forEach((question, questionIndex) => {
      // For questions without IDs (new forms), generate a temporary ID
      if (!question.id) {
        const tempId = -(categoryId * 1000 + questionIndex + 1);
        // Assign the temporary ID to ensure consistency
        (question as any).id = tempId;
      }
      
      // This allows us to access extended question types that might not be in the type definition
      const questionType = (question as any).question_type?.toLowerCase?.() || question.question_type;
      
      // Skip non-scoring question types
      if (
        questionType === 'info_block' ||
        questionType === 'text' ||
        questionType === 'sub_category'
      ) {
        return;
      }
      
      // Skip if question is not visible due to conditional logic (remove from both numerator and denominator)
      if (!visibilityMap[question.id]) {
        return;
      }
      
      const answer = answers[question.id];
      
      // Check for NA answers - they should be completely excluded from scoring (from both numerator and denominator)
      if (answer && (answer.answer?.toLowerCase() === 'na' || answer.answer?.toLowerCase() === 'n/a')) {
        const isNaAllowed = (question as any).is_na_allowed;
        
        if (isNaAllowed) {
          return;
        }
      }
      
      // Get max possible score for this question
      const possibleScore = getMaxPossibleScore(question);
      
      // Add to the denominator (total possible points)
      possiblePoints += possibleScore;
      
      // If no answer provided, don't add to numerator but keep in denominator
      if (!answer) {
        return;
      }
      
      // Calculate points for this question and add to numerator
      const answerScore = getQuestionScore(question, answer.answer || '');
      earnedPoints += answerScore;
    });
    
    // Calculate raw category score (0-100) if there are any possible points
    // This is the unweighted percentage score for the category
    const rawScore = possiblePoints > 0 ? (earnedPoints / possiblePoints) * 100 : 0;
    
    // Get category weight
    const categoryWeight = category.weight || 0;
    
    // Calculate weighted numerator and denominator
    // Category weight is already a decimal (0.15 for 15%), so use it directly
    const weightedNumerator = earnedPoints * categoryWeight;
    const weightedDenominator = possiblePoints * categoryWeight;
    
    // Store category scores with all calculation details
    categoryScores[categoryId] = {
      raw: rawScore,  // Unweighted percentage (0-100)
      weighted: rawScore * categoryWeight, // Weighted percentage contribution
      earnedPoints,  // Raw numerator
      possiblePoints, // Raw denominator
      weightedNumerator, // Numerator adjusted by weight
      weightedDenominator // Denominator adjusted by weight
    };
    
    // Only add to weighted totals if category has possible points (exclude zero-point categories)
    if (possiblePoints > 0) {
      totalWeightedNumerator += weightedNumerator;
      totalWeightedDenominator += weightedDenominator;
    }
  });
  
  // Calculate total score as ratio of weighted numerators to weighted denominators
  let totalScore = 0;
  if (totalWeightedDenominator > 0) {
    totalScore = (totalWeightedNumerator / totalWeightedDenominator) * 100;
  }
  
  // Round total score to 2 decimal places for display
  totalScore = Math.round(totalScore * 100) / 100;
  

  
  return {
    totalScore,
    categoryScores
  };
};

/**
 * Get the appropriate scoring for a question based on answer
 */
export const getQuestionScore = (question: Question, answer: string): number => {
  // If the answer is empty, return 0
  if (!answer) return 0;
  
  // This allows us to access extended question types that might not be in the type definition
  const questionType = (question as any).question_type?.toLowerCase?.() || question.question_type;
  const answerLower = answer.toLowerCase();
  

  
  switch (questionType.toLowerCase()) {
    case 'yes_no':
      if (answerLower === 'yes' || answer === 'true') {
        // Always use the stored yes value from the database
        const yesScore = (question as any).yes_value !== undefined ? 
                        Number((question as any).yes_value) : 
                        ((question as any).score_if_yes !== undefined ? 
                          Number((question as any).score_if_yes) : 0);
        
        return yesScore;
      } else if (answerLower === 'no' || answer === 'false') {
        const noScore = (question as any).no_value !== undefined ? 
                       Number((question as any).no_value) : 
                       ((question as any).score_if_no !== undefined ? 
                         Number((question as any).score_if_no) : 0);
        
        return noScore;
      } else if (answerLower === 'n/a' || answerLower === 'na') {
        // NA answers should not contribute to scoring
        return 0;
      }
      return 0;
      
    case 'scale':
      const numericAnswer = parseInt(answer, 10);
      if (!isNaN(numericAnswer)) {
        return numericAnswer;
      }
      return 0;
      
    case 'radio':
      // For radio questions, try to find the selected option and get its score
      const radioOptions = (question as any).radio_options || [];
      if (radioOptions.length > 0) {
        const selectedOption = radioOptions.find((opt: any) => 
          opt.option_value === answer || opt.option_text === answer
        );
        return selectedOption?.score || 0;
      }
      return 0;
    
    default:
      return 0;
  }
};

/**
 * Get maximum possible score for a question
 */
export const getMaxPossibleScore = (question: Question): number => {
  // This allows us to access extended question types that might not be in the type definition
  const questionType = (question as any).question_type?.toLowerCase?.() || question.question_type;
  

  
  switch (questionType.toLowerCase()) {
    case 'yes_no':
      // Always use the stored yes value from the database
      const yesValueCheck = (question as any).yes_value !== undefined;
      const yesValueNumber = Number((question as any).yes_value);
      
      const maxScore = yesValueCheck ? 
                      yesValueNumber : 
                      ((question as any).score_if_yes !== undefined ?
                        Number((question as any).score_if_yes) : 0);
      
      return maxScore;
      
    case 'scale':
      return (question as any).max_scale || (question as any).scale_max || 5;
      
    case 'radio':
      // For radio questions, find the highest scoring option
      const radioOptions = (question as any).radio_options || [];
      if (radioOptions.length > 0) {
        const highestScore = Math.max(...radioOptions.map((opt: any) => opt.score || 0));
        return highestScore;
      }
      return 0;
      
    default:
      return 0;
  }
};

/**
 * Get effective possible score for a question based on its answer
 * Returns 0 ONLY if the question should be excluded from scoring (N/A answers, hidden questions, etc.)
 * This matches the scoring calculation logic exactly
 */
export const getEffectivePossibleScore = (
  question: Question, 
  answer: Answer | undefined, 
  isVisible: boolean
): number => {
  // This allows us to access extended question types that might not be in the type definition
  const questionType = (question as any).question_type?.toLowerCase?.() || question.question_type;
  
  // Skip non-scoring question types (these never contribute to scoring)
  if (
    questionType === 'info_block' ||
    questionType === 'text' ||
    questionType === 'sub_category'
  ) {
    return 0;
  }
  
  // If question is not visible due to conditional logic, exclude from scoring
  if (!isVisible) {
    return 0;
  }
  
  // Check for NA answers - they should be completely excluded from scoring (both numerator and denominator)
  if (answer && (answer.answer?.toLowerCase() === 'na' || answer.answer?.toLowerCase() === 'n/a')) {
    const isNaAllowed = (question as any).is_na_allowed;
    
    if (isNaAllowed) {
      return 0;
    }
  }
  
  // For all other cases (including unanswered questions), show the full possible score
  // This matches the scoring calculation where unanswered questions still contribute to the denominator
  return getMaxPossibleScore(question);
}; 