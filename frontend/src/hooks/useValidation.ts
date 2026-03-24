import { useMemo } from 'react';
import { z } from 'zod';

/**
 * Common validation patterns using Zod
 */
export const validationSchemas = {
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
  phone: () => z.string().regex(
    /^[\+]?[1-9][\d\s\-\(\)\.]{7,17}$/, 
    'Please enter a valid phone number (e.g., +1-555-123-4567, (555) 123-4567, or 5551234567)'
  ),
  url: () => z.string().url('Please enter a valid URL'),
  
  // User-specific validations
  username: () => z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be less than 50 characters')
    .regex(/^[a-zA-Z0-9_\s-]+$/, 'Username can only contain letters, numbers, spaces, underscores, and hyphens'),
  
  password: () => z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/, 'Password must contain at least one special character'),
  
  // QTIP-specific validations
  qaScore: () => z.number()
    .min(0, 'Score must be at least 0')
    .max(100, 'Score must be at most 100'),
  
  // Fixed roleId validation to handle empty strings properly
  roleId: () => z.string()
    .refine(val => val !== '', 'Please select a valid role')
    .transform(val => parseInt(val, 10))
    .refine(val => !isNaN(val) && val >= 1 && val <= 6, 'Please select a valid role'),
  
  // Fixed departmentId validation to handle empty strings properly  
  departmentId: () => z.string()
    .refine(val => val !== '', 'Please select a valid department')
    .transform(val => parseInt(val, 10))
    .refine(val => !isNaN(val) && val >= 1, 'Please select a valid department'),
  
  goalTarget: () => z.number()
    .min(0, 'Goal target must be at least 0')
    .max(100, 'Goal target must be at most 100'),
  
  // Date validations
  dateString: () => z.string().refine(date => !isNaN(Date.parse(date)), 'Please enter a valid date'),
  futureDate: () => z.string().refine(date => new Date(date) > new Date(), 'Date must be in the future'),
  pastDate: () => z.string().refine(date => new Date(date) < new Date(), 'Date must be in the past'),
  
  // File validations
  fileSize: (maxSizeInMB: number) => z.instanceof(File)
    .refine(file => file.size <= maxSizeInMB * 1024 * 1024, `File size must be less than ${maxSizeInMB}MB`),
  
  fileType: (allowedTypes: string[]) => z.instanceof(File)
    .refine(file => allowedTypes.includes(file.type), `File type must be one of: ${allowedTypes.join(', ')}`),
};

/**
 * Common form validation schemas for QTIP
 */
export const formSchemas = {
  // User management
  createUser: z.object({
    username: validationSchemas.username(),
    email: validationSchemas.email(),
    password: validationSchemas.password(),
    first_name: validationSchemas.string(1, 100),
    last_name: validationSchemas.string(1, 100),
    role_id: validationSchemas.roleId(),
    department_id: validationSchemas.departmentId(),
    is_active: validationSchemas.boolean().optional(),
  }),
  
  updateUser: z.object({
    username: validationSchemas.username().optional(),
    email: validationSchemas.email().optional(),
    first_name: validationSchemas.string(1, 100).optional(),
    last_name: validationSchemas.string(1, 100).optional(),
    role_id: validationSchemas.roleId().optional(),
    department_id: validationSchemas.departmentId().optional(),
    is_active: validationSchemas.boolean().optional(),
  }),
  
  // Authentication
  login: z.object({
    email: validationSchemas.email(),
    password: validationSchemas.string(1, 255),
    rememberMe: validationSchemas.boolean().optional(),
  }),
  
  changePassword: z.object({
    currentPassword: validationSchemas.string(1, 255),
    newPassword: validationSchemas.password(),
    confirmPassword: validationSchemas.string(1, 255),
  }).refine(data => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  }),
  
  // Performance Goals
  performanceGoal: z.object({
    goal_type: z.enum(['qa_score', 'call_volume', 'resolution_time']),
    target_value: validationSchemas.goalTarget(),
    scope: z.enum(['global', 'department', 'individual']),
    department_id: validationSchemas.departmentId().nullable().optional(),
    description: validationSchemas.string(0, 500).nullable().optional(),
    is_active: validationSchemas.boolean().optional(),
  }),
  
  // Department management
  department: z.object({
    name: validationSchemas.string(1, 100),
    description: validationSchemas.string(0, 500).optional(),
    is_active: validationSchemas.boolean().optional(),
  }),
  
  // QA Form
  qaForm: z.object({
    title: validationSchemas.string(1, 200),
    description: validationSchemas.string(0, 1000).optional(),
    is_active: validationSchemas.boolean().optional(),
  }),
  
  // QA Question
  qaQuestion: z.object({
    text: validationSchemas.string(1, 500),
    question_type: z.enum(['yes_no', 'scale', 'text', 'multiple_choice']),
    max_scale: validationSchemas.number(1, 10).optional(),
    score_if_yes: validationSchemas.qaScore().optional(),
    score_if_no: validationSchemas.qaScore().optional(),
    score_na: validationSchemas.qaScore().optional(),
    weight: validationSchemas.number(0, 100).optional(),
    is_required: validationSchemas.boolean().optional(),
  }),
  
  // Contact/Profile
  profile: z.object({
    first_name: validationSchemas.string(1, 100),
    last_name: validationSchemas.string(1, 100),
    email: validationSchemas.email(),
    phone: validationSchemas.phone().optional(),
  }),
};

/**
 * Hook for creating dynamic validation schemas
 */
export const useValidation = () => {
  const schemas = useMemo(() => validationSchemas, []);
  const forms = useMemo(() => formSchemas, []);
  
  const createSchema = useMemo(() => (schemaDefinition: Record<string, z.ZodTypeAny>) => {
    return z.object(schemaDefinition);
  }, []);
  
  const validateSync = useMemo(() => <T>(schema: z.ZodSchema<T>, data: unknown) => {
    try {
      return {
        success: true as const,
        data: schema.parse(data),
        errors: null,
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors: Record<string, string> = {};
        error.issues.forEach(err => {
          const field = err.path.join('.');
          fieldErrors[field] = err.message;
        });
        
        return {
          success: false as const,
          data: null,
          errors: fieldErrors,
        };
      }
      
      return {
        success: false as const,
        data: null,
        errors: { general: 'Validation failed' },
      };
    }
  }, []);
  
  const validateAsync = useMemo(() => async <T>(schema: z.ZodSchema<T>, data: unknown) => {
    try {
      const result = await schema.parseAsync(data);
      return {
        success: true as const,
        data: result,
        errors: null,
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors: Record<string, string> = {};
        error.issues.forEach(err => {
          const field = err.path.join('.');
          fieldErrors[field] = err.message;
        });
        
        return {
          success: false as const,
          data: null,
          errors: fieldErrors,
        };
      }
      
      return {
        success: false as const,
        data: null,
        errors: { general: 'Validation failed' },
      };
    }
  }, []);
  
  return {
    schemas,
    forms,
    createSchema,
    validateSync,
    validateAsync,
  };
}; 