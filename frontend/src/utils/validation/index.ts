/**
 * Unified Validation System
 * 
 * This module provides a consolidated validation architecture that unifies:
 * - Zod-based validation (from useValidation.ts)
 * - Custom form validation (from formValidation.ts)
 * - Generic validation (from validation.ts)
 * - Backend validation patterns
 * 
 * All validation logic is now centralized for consistency across the application.
 */

import { z } from 'zod';
import type { Form, FormQuestion, Answer } from '../../types';

// Re-export core validation types for backward compatibility
export type ValidationResult = {
  isValid: boolean;
  errors: Record<string, string[]>;
};

export type ValidationRule = {
  validate: (value: any) => { isValid: boolean; errors: string[] };
};

/**
 * Core validation schemas using Zod for type safety and consistency
 */
export const ValidationSchemas = {
  // Basic types
  string: (min = 1, max = 255) => z.string().min(min, `Must be at least ${min} characters`).max(max, `Must be less than ${max} characters`),
  number: (min?: number, max?: number) => {
    let schema = z.number();
    if (min !== undefined) schema = schema.min(min, `Must be at least ${min}`);
    if (max !== undefined) schema = schema.max(max, `Must be at most ${max}`);
    return schema;
  },
  boolean: () => z.boolean(),
  
  // Common patterns
  email: () => z.string().email('Please enter a valid email address'),
  password: () => z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one lowercase letter, one uppercase letter, and one number'),
  
  // QTIP-specific validations
  qaScore: () => z.number().min(0, 'Score must be at least 0').max(100, 'Score must be at most 100'),
  roleId: () => z.string()
    .refine(val => val !== '', 'Please select a valid role')
    .transform(val => parseInt(val, 10))
    .refine(val => !isNaN(val) && val >= 1 && val <= 6, 'Please select a valid role'),
  departmentId: () => z.string()
    .refine(val => val !== '', 'Please select a valid department')
    .transform(val => parseInt(val, 10))
    .refine(val => !isNaN(val) && val > 0, 'Please select a valid department'),
};

/**
 * Form-specific validation schemas
 */
export const FormValidationSchemas = {
  // Form structure validation
  form: z.object({
    form_name: ValidationSchemas.string(1, 255),
    interaction_type: z.enum(['CALL', 'TICKET', 'EMAIL', 'CHAT', 'UNIVERSAL']).optional(),
    is_active: ValidationSchemas.boolean(),
    categories: z.array(z.object({
      category_name: ValidationSchemas.string(1, 255),
      weight: ValidationSchemas.number(0, 1),
      questions: z.array(z.any()).min(1, 'Each category must have at least one question')
    })).min(1, 'Form must have at least one category'),
  }),
  
  // Question validation
  question: z.object({
    question_text: ValidationSchemas.string(1, 1000),
    question_type: z.enum(['YES_NO', 'SCALE', 'N_A', 'TEXT', 'INFO_BLOCK', 'RADIO', 'SUB_CATEGORY']),
    weight: ValidationSchemas.number(0, 100),
    scale_min: ValidationSchemas.number().optional(),
    scale_max: ValidationSchemas.number().optional(),
    yes_value: ValidationSchemas.number().optional(),
    no_value: ValidationSchemas.number().optional(),
    na_value: ValidationSchemas.number().optional(),
  }),
  
  // Answer validation
  answer: z.object({
    question_id: ValidationSchemas.number(1),
    answer: ValidationSchemas.string(0, 1000),
    notes: ValidationSchemas.string(0, 2000).optional(),
    score: ValidationSchemas.number(0).optional(),
  }),
};

/**
 * Unified form validation function
 */
export const validateForm = (form: Form): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  try {
    // Validate basic form structure
    FormValidationSchemas.form.parse(form);
  } catch (error) {
    if (error instanceof z.ZodError) {
      errors.push(...error.errors.map(err => `${err.path.join('.')}: ${err.message}`));
    }
  }
  
  // Validate category weights sum to 1.0
  const totalWeight = form.categories.reduce((sum, cat) => sum + cat.weight, 0);
  if (Math.abs(totalWeight - 1.0) > 0.01) {
    errors.push('Category weights must sum to 1.0');
  }
  
  // Validate circular dependencies
  if (hasCircularDependencies(form)) {
    errors.push('Form has circular dependencies in conditional logic');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Check for circular dependencies in conditional logic
 */
function hasCircularDependencies(form: Form): boolean {
  const dependencies = new Map<number, number[]>();
  
  // Build dependency graph
  form.categories.forEach(category => {
    category.questions.forEach(question => {
      if (question.id && question.conditions) {
        const deps = question.conditions.map(c => c.target_question_id);
        dependencies.set(question.id, deps);
      }
    });
  });
  
  // Check for cycles using DFS
  const visited = new Set<number>();
  const recursionStack = new Set<number>();
  
  const hasCycle = (node: number): boolean => {
    if (recursionStack.has(node)) return true;
    if (visited.has(node)) return false;
    
    visited.add(node);
    recursionStack.add(node);
    
    const deps = dependencies.get(node) || [];
    for (const dep of deps) {
      if (hasCycle(dep)) return true;
    }
    
    recursionStack.delete(node);
    return false;
  };
  
  for (const questionId of dependencies.keys()) {
    if (hasCycle(questionId)) return true;
  }
  
  return false;
}

/**
 * Generic validation function for backward compatibility
 */
export const validate = (data: Record<string, any>, rules: Record<string, ValidationRule[]>): ValidationResult => {
  const errors: Record<string, string[]> = {};
  
  for (const [field, fieldRules] of Object.entries(rules)) {
    const value = data[field];
    const fieldErrors: string[] = [];
    
    for (const rule of fieldRules) {
      const result = rule.validate(value);
      if (!result.isValid) {
        fieldErrors.push(...result.errors);
      }
    }
    
    if (fieldErrors.length > 0) {
      errors[field] = fieldErrors;
    }
  }
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

// Export validation schemas for individual use
export { ValidationSchemas as Schemas, FormValidationSchemas as FormSchemas };

// Legacy exports for backward compatibility
export const validationSchemas = ValidationSchemas;
export const formSchemas = FormValidationSchemas; 