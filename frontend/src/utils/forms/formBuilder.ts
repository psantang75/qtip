/**
 * Form Builder
 * 
 * This module handles the creation and modification of form structures.
 */

import type { Form, FormCategory, FormQuestion, FormMetadataField } from '../../types/form.types';
import { validateForm } from './formValidation';

/**
 * Create a new empty form with default values
 */
export const createEmptyForm = (): Form => {
  return {
    id: 0, // Will be assigned by the backend
    form_name: '',
    interaction_type: 'CALL',
    is_active: true,
    metadata_fields: getDefaultMetadataFields('call'),
    categories: []
  };
};

/**
 * Get default metadata fields based on interaction type
 */
export const getDefaultMetadataFields = (interactionType: string): FormMetadataField[] => {
  const baseFields: Partial<FormMetadataField>[] = [
    {
      field_name: 'Auditor Name',
      field_type: 'TEXT',
      is_required: true,
      sort_order: 1
    },
    {
      field_name: 'Review Date',
      field_type: 'DATE',
      is_required: true,
      sort_order: 2
    },
    {
      field_name: 'CSR',
      field_type: 'DROPDOWN',
      is_required: true,
      sort_order: 3
    }
  ];
  
  // Add type-specific fields
  let typeFields: Partial<MetadataField>[] = [];
  
  switch (interactionType) {
    case 'call':
      typeFields = [
        {
          field_name: 'Call ID',
          field_type: 'TEXT',
          is_required: true,
          sort_order: 4
        },
        {
          field_name: 'Call Date',
          field_type: 'DATE',
          is_required: true,
          sort_order: 5
        },
        {
          field_name: 'Customer ID',
          field_type: 'TEXT',
          is_required: false,
          sort_order: 6
        }
      ];
      break;
    case 'ticket':
      typeFields = [
        {
          field_name: 'Ticket ID',
          field_type: 'TEXT',
          is_required: true,
          sort_order: 4
        },
        {
          field_name: 'Ticket Date',
          field_type: 'DATE',
          is_required: true,
          sort_order: 5
        }
      ];
      break;
    case 'email':
    case 'chat':
    default:
      typeFields = [
        {
          field_name: 'Interaction ID',
          field_type: 'TEXT',
          is_required: true,
          sort_order: 4
        },
        {
          field_name: 'Date',
          field_type: 'DATE',
          is_required: true,
          sort_order: 5
        }
      ];
  }
  
  // Combine and add temporary IDs (real IDs will be assigned by backend)
  return [...baseFields, ...typeFields].map((field, index) => ({
    id: -(index + 1), // Temporary negative ID 
    form_id: 0,       // Will be assigned by backend
    ...field
  })) as FormMetadataField[];
};

/**
 * Add a new category to a form
 */
export const addCategory = (form: Form, categoryName: string, weight: number = 0.1): Form => {
  // Calculate next sort order
  const nextSortOrder = form.categories.length > 0 
    ? Math.max(...form.categories.map(c => c.sort_order)) + 1 
    : 1;
  
  // Create new category with temporary ID
  const newCategory: FormCategory = {
    id: -(form.categories.length + 1), // Temporary negative ID
    form_id: form.id,
    category_name: categoryName,
    weight: weight,
    sort_order: nextSortOrder,
    questions: []
  };
  
  // Return updated form with new category
  return {
    ...form,
    categories: [...form.categories, newCategory]
  };
};

/**
 * Add a new question to a category
 */
export const addQuestion = (
  form: Form, 
  categoryId: number, 
  questionText: string,
  questionType: 'YES_NO' | 'SCALE' | 'TEXT' | 'INFO_BLOCK' = 'YES_NO'
): Form => {
  // Find the category
  const categoryIndex = form.categories.findIndex(c => c.id === categoryId);
  if (categoryIndex === -1) {
    throw new Error(`Category with ID ${categoryId} not found`);
  }
  
  const category = form.categories[categoryIndex];
  
  // Calculate next sort order
  const nextSortOrder = category.questions.length > 0
    ? Math.max(...category.questions.map(q => q.sort_order)) + 1
    : 1;
  
  // Set default scoring values based on question type
  const scoringDefaults = {
    yes_no: {
      score_if_yes: 5,
      score_if_no: 0,
      score_na: undefined
    },
    scale: {
      max_scale: 5
    },
    text: {},
    info: {}
  };
  
  // Create new question with temporary ID
  const newQuestion: FormQuestion = {
    id: -(Date.now()), // Temporary unique negative ID based on timestamp
    category_id: categoryId,
    question_text: questionText,
    question_type: questionType,
    sort_order: nextSortOrder,
    is_conditional: false,
    ...scoringDefaults[questionType]
  };
  
  // Update the category with the new question
  const updatedCategory = {
    ...category,
    questions: [...category.questions, newQuestion]
  };
  
  // Return updated form
  const updatedCategories = [...form.categories];
  updatedCategories[categoryIndex] = updatedCategory;
  
  return {
    ...form,
    categories: updatedCategories
  };
};

/**
 * Update existing question properties
 */
export const updateQuestion = (
  form: Form,
  categoryId: number,
  questionId: number,
  updates: Partial<Question>
): Form => {
  // Find the category
  const categoryIndex = form.categories.findIndex(c => c.id === categoryId);
  if (categoryIndex === -1) {
    throw new Error(`Category with ID ${categoryId} not found`);
  }
  
  const category = form.categories[categoryIndex];
  
  // Find the question
  const questionIndex = category.questions.findIndex(q => q.id === questionId);
  if (questionIndex === -1) {
    throw new Error(`Question with ID ${questionId} not found in category ${categoryId}`);
  }
  
  // Update the question
  const updatedQuestion = {
    ...category.questions[questionIndex],
    ...updates
  };
  
  // Update the category with the modified question
  const updatedQuestions = [...category.questions];
  updatedQuestions[questionIndex] = updatedQuestion;
  
  const updatedCategory = {
    ...category,
    questions: updatedQuestions
  };
  
  // Return updated form
  const updatedCategories = [...form.categories];
  updatedCategories[categoryIndex] = updatedCategory;
  
  return {
    ...form,
    categories: updatedCategories
  };
};

/**
 * Normalize all category weights to sum to 1.0
 */
export const normalizeWeights = (form: Form): Form => {
  // Handle the case with no categories
  if (form.categories.length === 0) {
    return form;
  }
  
  // Calculate current total weight
  const totalWeight = form.categories.reduce((sum, category) => sum + category.weight, 0);
  
  // Skip if total is already 1.0 (with small margin for floating point errors)
  if (Math.abs(totalWeight - 1.0) < 0.001) {
    return form;
  }
  
  // Normalize weights
  const normalizedCategories = form.categories.map(category => ({
    ...category,
    weight: category.weight / totalWeight
  }));
  
  return {
    ...form,
    categories: normalizedCategories
  };
}; 