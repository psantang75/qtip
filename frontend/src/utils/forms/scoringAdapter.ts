/**
 * Scoring Adapter
 *
 * This adapter provides frontend-compatible scoring functions that use the 
 * same logic as the backend scoringUtil to maintain consistency.
 * 
 * Instead of duplicating logic, this adapter translates between frontend and backend types.
 */

import type { Form, Answer, FormQuestion, RadioOption } from '../../types/form.types';
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
  const categoryScores: Record<number, {
    raw: number,
    weighted: number,
    earnedPoints: number,
    possiblePoints: number,
    trainingPenaltyApplied?: boolean,
    weightedNumerator?: number,
    weightedDenominator?: number
  }> = {};
  
  if (!form?.categories || !Array.isArray(form.categories) || form.categories.length === 0) {
    return { totalScore: 0, categoryScores: {} };
  }
  
  const answerStrings: Record<number, string> = {};
  Object.entries(answers).forEach(([questionId, answer]) => {
    answerStrings[Number(questionId)] = answer.answer || '';
  });
  
  const visibilityMap = processConditionalLogic(form, answerStrings);
  
  let totalWeightedNumerator = 0;
  let totalWeightedDenominator = 0;
  
  form.categories.forEach((category, index) => {
    const categoryId = category.id ?? (index + 1) * -1000;
    
    if (!category.id) {
      category.id = categoryId;
    }
    
    let earnedPoints = 0;
    let possiblePoints = 0;
    
    (category.questions || []).forEach((question, questionIndex) => {
      if (!question.id) {
        question.id = -(categoryId * 1000 + questionIndex + 1);
      }
      
      const questionType = question.question_type.toLowerCase();
      
      if (
        questionType === 'info_block' ||
        questionType === 'text' ||
        questionType === 'sub_category'
      ) {
        return;
      }
      
      if (!visibilityMap[question.id]) {
        return;
      }
      
      const answer = answers[question.id];
      
      if (answer && (answer.answer?.toLowerCase() === 'na' || answer.answer?.toLowerCase() === 'n/a')) {
        if (question.is_na_allowed) {
          return;
        }
      }
      
      const possibleScore = getMaxPossibleScore(question);
      possiblePoints += possibleScore;
      
      if (!answer) {
        return;
      }
      
      const answerScore = getQuestionScore(question, answer.answer || '');
      earnedPoints += answerScore;
    });
    
    const rawScore = possiblePoints > 0 ? (earnedPoints / possiblePoints) * 100 : 0;
    const categoryWeight = category.weight || 0;
    const weightedNumerator = earnedPoints * categoryWeight;
    const weightedDenominator = possiblePoints * categoryWeight;
    
    categoryScores[categoryId] = {
      raw: rawScore,
      weighted: rawScore * categoryWeight,
      earnedPoints,
      possiblePoints,
      weightedNumerator,
      weightedDenominator
    };
    
    if (possiblePoints > 0) {
      totalWeightedNumerator += weightedNumerator;
      totalWeightedDenominator += weightedDenominator;
    }
  });
  
  let totalScore = 0;
  if (totalWeightedDenominator > 0) {
    totalScore = (totalWeightedNumerator / totalWeightedDenominator) * 100;
  }
  
  totalScore = Math.round(totalScore * 100) / 100;

  return { totalScore, categoryScores };
};

/**
 * Get the appropriate scoring for a question based on answer
 */
export const getQuestionScore = (question: FormQuestion, answer: string): number => {
  if (!answer) return 0;
  
  const questionType = question.question_type.toLowerCase();
  const answerLower = answer.toLowerCase();
  
  switch (questionType) {
    case 'yes_no':
      if (answerLower === 'yes' || answer === 'true') {
        return question.yes_value !== undefined
          ? Number(question.yes_value)
          : (question.score_if_yes !== undefined ? Number(question.score_if_yes) : 0);
      } else if (answerLower === 'no' || answer === 'false') {
        return question.no_value !== undefined
          ? Number(question.no_value)
          : (question.score_if_no !== undefined ? Number(question.score_if_no) : 0);
      }
      return 0;
      
    case 'scale': {
      const numericAnswer = parseInt(answer, 10);
      return !isNaN(numericAnswer) ? numericAnswer : 0;
    }
      
    case 'radio': {
      const radioOptions = question.radio_options || [];
      const selectedOption = radioOptions.find((opt: RadioOption) =>
        opt.option_value === answer || opt.option_text === answer
      );
      return selectedOption?.score || 0;
    }

    case 'multi_select': {
      const multiOptions = question.radio_options || [];
      if (multiOptions.length > 0 && answer) {
        const selected = answer.split(',').map((v: string) => v.trim()).filter(Boolean);
        return selected.reduce((sum: number, val: string) => {
          const opt = multiOptions.find((o: RadioOption) => o.option_value === val || o.option_text === val);
          return sum + (opt?.score || 0);
        }, 0);
      }
      return 0;
    }
    
    default:
      return 0;
  }
};

/**
 * Get maximum possible score for a question
 */
export const getMaxPossibleScore = (question: FormQuestion): number => {
  const questionType = question.question_type.toLowerCase();
  
  switch (questionType) {
    case 'yes_no':
      return question.yes_value !== undefined
        ? Number(question.yes_value)
        : (question.score_if_yes !== undefined ? Number(question.score_if_yes) : 0);
      
    case 'scale':
      return question.max_scale ?? question.scale_max ?? 5;
      
    case 'radio': {
      const radioOptions = question.radio_options || [];
      if (radioOptions.length > 0) {
        return Math.max(...radioOptions.map((opt: RadioOption) => opt.score || 0));
      }
      return 0;
    }

    case 'multi_select': {
      const multiOpts = question.radio_options || [];
      return multiOpts.reduce((sum: number, opt: RadioOption) => sum + Math.max(0, opt.score || 0), 0);
    }
      
    default:
      return 0;
  }
};

/**
 * Get effective possible score for a question based on its answer
 * Returns 0 ONLY if the question should be excluded from scoring (N/A answers, hidden questions, etc.)
 */
export const getEffectivePossibleScore = (
  question: FormQuestion,
  answer: Answer | undefined,
  isVisible: boolean
): number => {
  const questionType = question.question_type.toLowerCase();
  
  if (
    questionType === 'info_block' ||
    questionType === 'text' ||
    questionType === 'sub_category'
  ) {
    return 0;
  }
  
  if (!isVisible) {
    return 0;
  }
  
  if (answer && (answer.answer?.toLowerCase() === 'na' || answer.answer?.toLowerCase() === 'n/a')) {
    if (question.is_na_allowed) {
      return 0;
    }
  }
  
  return getMaxPossibleScore(question);
};
