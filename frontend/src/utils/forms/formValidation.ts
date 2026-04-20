/**
 * Form Validation
 * 
 * This module handles validation of form structure, ensuring forms 
 * meet requirements before saving or submitting.
 */

import type { Form } from '../../types/form.types';
import { hasCircularDependencies } from './formConditions';

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
  const validTypes = ['CALL', 'TICKET', 'EMAIL', 'CHAT', 'UNIVERSAL'];
  if (!validTypes.includes(form.interaction_type)) {
    errors.push('Invalid interaction type');
  }
  
  // Check categories
  if (!form.categories || form.categories.length === 0) {
    errors.push('Form must have at least one category');
  } else {
    // Check category weights
    const totalWeight = form.categories.reduce((sum: number, cat) => sum + cat.weight, 0);
    if (Math.abs(totalWeight - 1.0) > 0.01) {
      errors.push('Category weights must sum to 1.0');
    }
    
    // Check questions in each category
    form.categories.forEach((category) => {
      if (!category.questions || category.questions.length === 0) {
        errors.push(`Category "${category.category_name}" must have at least one question`);
      }
      
      // Check question validity
      category.questions.forEach((question) => {
        if (!question.question_text || question.question_text.length < 1 || question.question_text.length > 1000) {
          errors.push('Question text must be between 1 and 1000 characters');
        }
        
        const validQuestionTypes = ['YES_NO', 'SCALE', 'TEXT', 'INFO_BLOCK'];
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

/**
 * Validate that a form's metadata fields meet requirements
 */
export const validateMetadataFields = (form: Form): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  // Check for required metadata fields based on interaction type
  const requiredFields = {
    call: ['Call ID', 'Agent', 'Call Date'],
    ticket: ['Ticket ID', 'Agent', 'Ticket Date'],
    email: ['Email ID', 'Agent', 'Email Date'],
    chat: ['Chat ID', 'Agent', 'Chat Date'],
    universal: ['Interaction ID', 'Agent', 'Date']
  };

  const FIELD_ALIASES: Record<string, string[]> = { agent: ['agent', 'csr'] }
  
  const formFields = form.metadata_fields.map(f => f.field_name);
  const interactionType = form.interaction_type as keyof typeof requiredFields;
  
  requiredFields[interactionType].forEach(fieldName => {
    const aliases = FIELD_ALIASES[fieldName.toLowerCase()] ?? [fieldName.toLowerCase()]
    if (!formFields.some(f => aliases.some(a => f.toLowerCase().includes(a)))) {
      errors.push(`Missing required metadata field: ${fieldName}`);
    }
  });
  
  // Check for duplicate field names
  const fieldNames = form.metadata_fields.map(f => f.field_name.toLowerCase());
  const duplicates = fieldNames.filter((name, index) => fieldNames.indexOf(name) !== index);
  
  if (duplicates.length > 0) {
    errors.push(`Duplicate metadata field names: ${duplicates.join(', ')}`);
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Validate individual form answer
 */
export const validateAnswer = (
  answer: string, 
  questionType: string
): { valid: boolean; error?: string } => {
  
  switch (questionType) {
    case 'YES_NO':
      if (!['yes', 'no', 'na'].includes(answer)) {
        return { valid: false, error: 'Answer must be "yes", "no", or "na"' };
      }
      break;
    
    case 'SCALE':
      const num = parseInt(answer, 10);
      if (isNaN(num) || num < 0) {
        return { valid: false, error: 'Scale answer must be a number 0 or greater' };
      }
      break;
  }
  
  return { valid: true };
}; 