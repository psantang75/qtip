/**
 * FormService
 * 
 * Business logic layer for QA form management operations.
 * Handles form creation, retrieval, updates, validation, and lifecycle management.
 * Extracted from form.controller.ts for Clean Architecture implementation.
 */

import { 
  CreateFormDTO, 
  FormWithCategories, 
  FormCategoryWithQuestions, 
  FormQuestion, 
  RadioOption, 
  CreateFormMetadataFieldDTO, 
  FormQuestionCondition 
} from '../models';
import { MySQLFormRepository } from '../repositories/MySQLFormRepository';

/**
 * Custom error class for form service business logic errors
 */
export class FormServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400,
    public details?: any
  ) {
    super(message);
    this.name = 'FormServiceError';
  }
}

/**
 * Interface for form service operations
 */
export interface IFormService {
  createForm(formData: CreateFormDTO, created_by: number): Promise<{ form_id: number; message: string }>;
  getForms(activeOnly?: boolean, page?: number, limit?: number): Promise<{
    forms: FormWithCategories[];
    pagination?: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }>;
  getFormById(form_id: number, includeInactive?: boolean): Promise<FormWithCategories>;
  updateForm(form_id: number, formData: CreateFormDTO, updatedBy: number): Promise<{ form_id: number; message: string }>;
  deactivateForm(form_id: number, updatedBy: number): Promise<{ message: string }>;
  validateFormStructure(formData: CreateFormDTO): Promise<void>;
}

/**
 * FormService implementation
 */
export class FormService implements IFormService {
  constructor(private formRepository: MySQLFormRepository) {}

  /**
   * Create a new QA form with categories and questions
   */
  async createForm(formData: CreateFormDTO, created_by: number): Promise<{ form_id: number; message: string }> {
    try {
      // Validate form structure
      await this.validateFormStructure(formData);

      // Set default values
      const normalizedFormData = this.normalizeFormData(formData, created_by);

      // Delegate to repository for database operations
      const form_id = await this.formRepository.createForm(normalizedFormData);

      return {
        form_id,
        message: 'Form created successfully'
      };
    } catch (error) {
      if (error instanceof FormServiceError) {
        throw error;
      }
      throw new FormServiceError(
        'Failed to create form: ' + (error as Error).message,
        'FORM_CREATION_ERROR',
        500
      );
    }
  }

  /**
   * Get all forms with optional filtering and pagination
   */
  async getForms(activeOnly?: boolean, page?: number, limit?: number): Promise<{
    forms: FormWithCategories[];
    pagination?: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    try {
      const result = await this.formRepository.getForms(activeOnly, page, limit);
      
      return {
        forms: result.forms,
        pagination: result.pagination
      };
    } catch (error) {
      throw new FormServiceError(
        'Failed to retrieve forms: ' + (error as Error).message,
        'FORM_RETRIEVAL_ERROR',
        500
      );
    }
  }

  /**
   * Get form by ID with complete structure
   */
  async getFormById(form_id: number, includeInactive: boolean = false): Promise<FormWithCategories> {
    try {
      if (!form_id || form_id <= 0) {
        throw new FormServiceError(
          'Invalid form ID provided',
          'INVALID_FORM_ID',
          400
        );
      }

      const form = await this.formRepository.getFormById(form_id, includeInactive);
      
      if (!form) {
        throw new FormServiceError(
          'Form not found',
          'FORM_NOT_FOUND',
          404
        );
      }

      return form;
    } catch (error) {
      if (error instanceof FormServiceError) {
        throw error;
      }
      throw new FormServiceError(
        'Failed to retrieve form: ' + (error as Error).message,
        'FORM_RETRIEVAL_ERROR',
        500
      );
    }
  }

  /**
   * Update existing form (creates new version)
   */
  async updateForm(form_id: number, formData: CreateFormDTO, updatedBy: number): Promise<{ form_id: number; message: string }> {
    try {
      // Validate form exists
      const existingForm = await this.getFormById(form_id, true);
      
      // Validate form structure
      await this.validateFormStructure(formData);

      // Set updated values
      const normalizedFormData = this.normalizeFormData(formData, updatedBy);

      // Delegate to repository for database operations
      const newFormId = await this.formRepository.updateForm(form_id, normalizedFormData);

      return {
        form_id: newFormId,
        message: 'Form updated successfully (new version created)'
      };
    } catch (error) {
      if (error instanceof FormServiceError) {
        throw error;
      }
      throw new FormServiceError(
        'Failed to update form: ' + (error as Error).message,
        'FORM_UPDATE_ERROR',
        500
      );
    }
  }

  /**
   * Deactivate form
   */
  async deactivateForm(form_id: number, updatedBy: number): Promise<{ message: string }> {
    try {
      console.log('[FORM SERVICE] Starting form deactivation:', {
        form_id,
        updatedBy,
        timestamp: new Date().toISOString()
      });

      // Validate form exists
      console.log('[FORM SERVICE] Checking if form exists...');
      const existingForm = await this.getFormById(form_id, true);
      
      console.log('[FORM SERVICE] Form found:', {
        id: existingForm.id,
        name: existingForm.form_name,
        is_active: existingForm.is_active,
        version: existingForm.version
      });
      
      if (!existingForm.is_active) {
        console.log('[FORM SERVICE] Form is already inactive');
        throw new FormServiceError(
          'Form is already inactive',
          'FORM_ALREADY_INACTIVE',
          400
        );
      }

      console.log('[FORM SERVICE] Calling repository to deactivate form...');
      await this.formRepository.deactivateForm(form_id, updatedBy);
      
      console.log('[FORM SERVICE] Form deactivated successfully');

      return {
        message: 'Form deactivated successfully'
      };
    } catch (error) {
      console.error('[FORM SERVICE] Error in deactivateForm:', {
        error: error,
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        form_id,
        updatedBy
      });
      
      if (error instanceof FormServiceError) {
        throw error;
      }
      throw new FormServiceError(
        'Failed to deactivate form: ' + (error as Error).message,
        'FORM_DEACTIVATION_ERROR',
        500
      );
    }
  }

  /**
   * Validate form structure and business rules
   */
  async validateFormStructure(formData: CreateFormDTO): Promise<void> {
    // Validate form name
    if (!formData.form_name || formData.form_name.trim().length === 0) {
      throw new FormServiceError(
        'Form name is required',
        'INVALID_FORM_NAME',
        400
      );
    }

    // Validate interaction type
    const validInteractionTypes = ['CALL', 'TICKET', 'EMAIL', 'CHAT', 'UNIVERSAL'];
    if (formData.interaction_type && !validInteractionTypes.includes(formData.interaction_type)) {
      throw new FormServiceError(
        'Invalid interaction type. Must be one of: ' + validInteractionTypes.join(', '),
        'INVALID_INTERACTION_TYPE',
        400
      );
    }

    // Validate categories
    if (!formData.categories || formData.categories.length === 0) {
      throw new FormServiceError(
        'At least one category is required',
        'NO_CATEGORIES',
        400
      );
    }

    // Validate category weights sum to 1.0
    const totalWeight = formData.categories.reduce((sum, category) => sum + (category.weight || 0), 0);
    if (Math.abs(totalWeight - 1.0) > 0.01) {
      throw new FormServiceError(
        'Category weights must sum to 1.0',
        'INVALID_CATEGORY_WEIGHTS',
        400,
        { currentSum: totalWeight }
      );
    }

    // Validate each category
    for (const category of formData.categories) {
      await this.validateCategory(category);
    }
  }

  /**
   * Validate individual category structure
   */
  private async validateCategory(category: any): Promise<void> {
    // Validate category name
    if (!category.category_name || category.category_name.trim().length === 0) {
      throw new FormServiceError(
        'Category name is required',
        'INVALID_CATEGORY_NAME',
        400
      );
    }

    // Validate category weight (allow 0 to 1 inclusive)
    if (category.weight === undefined || category.weight < 0 || category.weight > 1) {
      throw new FormServiceError(
        'Category weight must be between 0 and 1 (inclusive)',
        'INVALID_CATEGORY_WEIGHT',
        400
      );
    }

    // Validate questions
    if (!category.questions || category.questions.length === 0) {
      throw new FormServiceError(
        `Category "${category.category_name}" must have at least one question`,
        'NO_CATEGORY_QUESTIONS',
        400
      );
    }

    // Validate each question
    for (const question of category.questions) {
      await this.validateQuestion(question, category.category_name);
    }
  }

  /**
   * Validate individual question structure
   */
  private async validateQuestion(question: any, category_name: string): Promise<void> {
    // Validate question text
    if (!question.question_text || question.question_text.trim().length === 0) {
      throw new FormServiceError(
        `All questions in category "${category_name}" must have text`,
        'INVALID_QUESTION_TEXT',
        400
      );
    }

    // Validate question type
    const validQuestionTypes = ['YES_NO', 'SCALE', 'TEXT', 'INFO_BLOCK', 'RADIO', 'SUB_CATEGORY', 'N_A'];
    if (!question.question_type || !validQuestionTypes.includes(question.question_type)) {
      throw new FormServiceError(
        'Invalid question type. Must be one of: ' + validQuestionTypes.join(', '),
        'INVALID_QUESTION_TYPE',
        400
      );
    }

    // Validate scale questions
    if (question.question_type === 'SCALE') {
      if (question.scale_min === undefined || 
          question.scale_max === undefined || 
          question.scale_min >= question.scale_max) {
        throw new FormServiceError(
          'Scale questions must have valid min/max values with min < max',
          'INVALID_SCALE_RANGE',
          400,
          { question: question.question_text }
        );
      }
    }

    // Validate radio questions
    if (question.question_type === 'RADIO') {
      if (!question.radio_options || question.radio_options.length === 0) {
        throw new FormServiceError(
          'Radio questions must have at least one option',
          'NO_RADIO_OPTIONS',
          400,
          { question: question.question_text }
        );
      }
    }

    // Validate conditional logic
    if (question.is_conditional || question.conditions) {
      await this.validateQuestionConditions(question, category_name);
    }
  }

  /**
   * Validate question conditional logic
   */
  private async validateQuestionConditions(question: any, category_name: string): Promise<void> {
    // Handle legacy conditional format conversion
    if (question.is_conditional && !question.conditions) {
      question.conditions = [{
        target_question_id: question.conditional_question_id || 0,
        condition_type: question.condition_type || 'EQUALS',
        target_value: question.conditional_value
      }];
    }

    if (question.conditions && question.conditions.length > 0) {
      const validConditionTypes = ['EQUALS', 'NOT_EQUALS', 'EXISTS', 'NOT_EXISTS'];
      
      for (const condition of question.conditions) {
        if (!condition.condition_type || !validConditionTypes.includes(condition.condition_type)) {
          throw new FormServiceError(
            'Invalid condition type. Must be one of: ' + validConditionTypes.join(', '),
            'INVALID_CONDITION_TYPE',
            400,
            { question: question.question_text }
          );
        }

        if (!condition.target_question_id) {
          throw new FormServiceError(
            'Conditional questions must specify a target question ID',
            'MISSING_TARGET_QUESTION',
            400,
            { question: question.question_text }
          );
        }
      }
    }
  }

  /**
   * Normalize form data with defaults
   */
  private normalizeFormData(formData: CreateFormDTO, user_id: number): CreateFormDTO {
    return {
      ...formData,
      interaction_type: formData.interaction_type || 'CALL',
      created_by: formData.created_by || user_id,
      is_active: formData.is_active !== undefined ? formData.is_active : true
    };
  }
} 