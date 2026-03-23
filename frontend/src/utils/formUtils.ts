/**
 * Form Utilities
 * 
 * This module provides shared utilities for handling form logic across the app:
 * - Form processing and rendering
 * - Conditional logic processing
 * - Score calculation
 * 
 * Used by form builder, form preview, and QA audit components
 */

import { 
  Form, 
  Category, 
  Question, 
  Answer, 
  MetadataField,
  FormSubmission 
} from '../types';
import { hasCircularDependencies, processConditionalLogic } from './forms';

// processConditionalLogic is now imported from './forms' to avoid duplication

/**
 * Calculate scores for a form submission based on answers and form structure
 */
export const calculateFormScore = (
  form: Form,
  answers: Record<number, Answer>
): { 
  totalScore: number, 
  categoryScores: Record<number, { raw: number, weighted: number }> 
} => {
  const categoryScores: Record<number, { raw: number, weighted: number }> = {};
  let totalScore = 0;
  
  // Process each category
  form.categories.forEach(category => {
    let earnedPoints = 0;
    let possiblePoints = 0;
    
    // Process each question in the category
    category.questions.forEach(question => {
      // Skip non-scoring question types
      if (question.question_type === 'INFO_BLOCK' || question.question_type === 'TEXT') {
        return;
      }
      
      const answer = answers[question.id];
      
      // Skip if no answer or N/A
      if (!answer || answer.score === question.score_na) {
        return;
      }
      
      // Check if question should be included based on conditional logic
      // Convert Answer objects to strings for conditional logic
      const answerStrings: Record<number, string> = {};
      Object.entries(answers).forEach(([questionId, answer]) => {
        answerStrings[Number(questionId)] = answer.answer || '';
      });
      const visibilityMap = processConditionalLogic(form, answerStrings);
      if (!visibilityMap[question.id]) {
        return;
      }
      
      // Add points
      earnedPoints += answer.score;
            possiblePoints += question.question_type === 'YES_NO'
        ? question.score_if_yes 
        : question.max_scale;
    });
    
    // Calculate category score
    const rawScore = possiblePoints > 0 ? (earnedPoints / possiblePoints) * 100 : 0;
    const weightedScore = rawScore * category.weight;
    
    categoryScores[category.id] = {
      raw: rawScore,
      weighted: weightedScore
    };
    
    totalScore += weightedScore;
  });
  
  return {
    totalScore,
    categoryScores
  };
};

/**
 * Process a form to generate a preview with sample answers
 */
export const generateFormPreview = (form: Form): FormSubmission => {
  // Create sample answers for preview
  const sampleAnswers: Record<number, Answer> = {};
  
  form.categories.forEach(category => {
    category.questions.forEach(question => {
      if (question.question_type === 'YES_NO') {
        sampleAnswers[question.id] = {
          question_id: question.id,
          answer: 'yes',
          score: question.score_if_yes,
          notes: ''
        };
      } else if (question.question_type === 'SCALE') {
        sampleAnswers[question.id] = {
          question_id: question.id,
          answer: question.max_scale.toString(),
          score: question.max_scale,
          notes: ''
        };
      } else {
        sampleAnswers[question.id] = {
          question_id: question.id,
          answer: question.question_type === 'TEXT' ? 'Sample text answer' : '',
          score: 0,
          notes: ''
        };
      }
    });
  });
  
  // Process conditional logic
  // Convert Answer objects to strings for conditional logic
  const answerStrings: Record<number, string> = {};
  Object.entries(sampleAnswers).forEach(([questionId, answer]) => {
    answerStrings[Number(questionId)] = answer.answer || '';
  });
  const visibilityMap = processConditionalLogic(form, answerStrings);
  
  // Calculate scores for the preview
  const { totalScore, categoryScores } = calculateFormScore(form, sampleAnswers);
  
  return {
    form_id: form.id || 0,
    submitted_by: 0, // Default value for preview
    status: 'preview',
    total_score: totalScore,
    form,
    answers: Object.values(sampleAnswers), // Convert Record<number, Answer> to Answer[]
    visibilityMap,
    score: totalScore,
    categoryScores: Object.values(categoryScores).map((score, index) => ({
      categoryId: index,
      categoryName: `Category ${index + 1}`,
      earnedPoints: 0,
      possiblePoints: 0,
      rawScore: score.raw,
      weightedScore: score.weighted
    }))
  };
};

/**
 * Get the appropriate scoring for a question based on answer
 */
export const getQuestionScore = (question: Question, answer: string): number => {
  switch (question.question_type) {
    case 'YES_NO':
      return answer === 'yes' ? question.score_if_yes : answer === 'no' ? question.score_if_no : question.score_na;
    case 'SCALE':
      return answer ? parseInt(answer, 10) : 0;
    default:
      return 0;
  }
};

// hasCircularDependencies is now imported from './forms' to avoid duplication

/**
 * Validate form structure, category weights, and conditional logic
 */
export const validateForm = (form: Form): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  // Check form name
  if (!form.form_name || form.form_name.length < 1 || form.form_name.length > 255) {
    errors.push('Form name must be between 1 and 255 characters');
  }
  
  // Check interaction type
  const validTypes = ['call', 'ticket', 'email', 'chat', 'universal'];
  if (!validTypes.includes(form.interaction_type)) {
    errors.push('Invalid interaction type');
  }
  
  // Check categories
  if (!form.categories || form.categories.length === 0) {
    errors.push('Form must have at least one category');
  } else {
    // Check category weights
    const totalWeight = form.categories.reduce((sum, cat) => sum + cat.weight, 0);
    if (Math.abs(totalWeight - 1.0) > 0.01) {
      errors.push('Category weights must sum to 1.0');
    }
    
    // Check questions in each category
    form.categories.forEach(category => {
      if (!category.questions || category.questions.length === 0) {
        errors.push(`Category "${category.category_name}" must have at least one question`);
      }
      
      // Check question validity
      category.questions.forEach(question => {
        if (!question.question_text || question.question_text.length < 1 || question.question_text.length > 1000) {
          errors.push('Question text must be between 1 and 1000 characters');
        }
        
        const validQuestionTypes = ['yes_no', 'scale', 'text', 'info'];
        if (!validQuestionTypes.includes(question.question_type)) {
          errors.push(`Invalid question type for "${question.question_text}"`);
        }
      });
    });
  }
  
  // Check for circular dependencies
  if (hasCircularDependencies(form)) {
    errors.push('Form has circular dependencies in conditional logic');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
};

export default {
  calculateFormScore,
  generateFormPreview,
  getQuestionScore,
  validateForm
}; 