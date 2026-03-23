/**
 * Input Validation Utilities
 * Provides comprehensive validation and sanitization for user inputs
 */

// Input sanitization
export const sanitizeInput = (input: string): string => {
  if (typeof input !== 'string') {
    return '';
  }
  
  // Remove potentially dangerous characters
  return input
    .replace(/[<>]/g, '') // Remove angle brackets (basic XSS protection)
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '') // Remove control characters
    .trim();
};

// Length validation
export const validateLength = (value: string, min: number = 0, max: number = 1000): boolean => {
  if (typeof value !== 'string') return false;
  const length = value.trim().length;
  return length >= min && length <= max;
};

// Email validation
export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && validateLength(email, 1, 254);
};

// Password validation
export const validatePassword = (password: string): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (!password || password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  
  if (password.length > 128) {
    errors.push('Password must be less than 128 characters long');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  
  if (!/\d/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

// Number validation
export const validateNumber = (value: string | number, min?: number, max?: number): boolean => {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  
  if (isNaN(num)) return false;
  if (min !== undefined && num < min) return false;
  if (max !== undefined && num > max) return false;
  
  return true;
};

// Integer validation
export const validateInteger = (value: string | number, min?: number, max?: number): boolean => {
  const num = typeof value === 'string' ? parseInt(value, 10) : value;
  
  if (!Number.isInteger(num)) return false;
  if (min !== undefined && num < min) return false;
  if (max !== undefined && num > max) return false;
  
  return true;
};

// Date validation
export const validateDate = (dateString: string): boolean => {
  if (!dateString) return false;
  
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime());
};

// Date range validation
export const validateDateRange = (startDate: string, endDate: string): boolean => {
  if (!validateDate(startDate) || !validateDate(endDate)) return false;
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  return start <= end;
};

// Form validation result interface
export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string[]>;
}

// Generic form validator
export const validateForm = (data: Record<string, any>, rules: Record<string, ValidationRule[]>): ValidationResult => {
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

// Validation rule interface
export interface ValidationRule {
  name: string;
  validate: (value: any) => { isValid: boolean; errors: string[] };
}

// Common validation rules
export const validationRules = {
  required: (fieldName: string): ValidationRule => ({
    name: 'required',
    validate: (value: any) => ({
      isValid: value !== null && value !== undefined && value !== '',
      errors: value === null || value === undefined || value === '' ? [`${fieldName} is required`] : []
    })
  }),
  
  email: (): ValidationRule => ({
    name: 'email',
    validate: (value: string) => ({
      isValid: !value || validateEmail(value),
      errors: !value || validateEmail(value) ? [] : ['Please enter a valid email address']
    })
  }),
  
  minLength: (min: number, fieldName: string): ValidationRule => ({
    name: 'minLength',
    validate: (value: string) => ({
      isValid: !value || value.length >= min,
      errors: !value || value.length >= min ? [] : [`${fieldName} must be at least ${min} characters long`]
    })
  }),
  
  maxLength: (max: number, fieldName: string): ValidationRule => ({
    name: 'maxLength',
    validate: (value: string) => ({
      isValid: !value || value.length <= max,
      errors: !value || value.length <= max ? [] : [`${fieldName} must be no more than ${max} characters long`]
    })
  }),
  
  numeric: (fieldName: string): ValidationRule => ({
    name: 'numeric',
    validate: (value: string | number) => ({
      isValid: !value || validateNumber(value),
      errors: !value || validateNumber(value) ? [] : [`${fieldName} must be a valid number`]
    })
  }),
  
  integer: (fieldName: string): ValidationRule => ({
    name: 'integer',
    validate: (value: string | number) => ({
      isValid: !value || validateInteger(value),
      errors: !value || validateInteger(value) ? [] : [`${fieldName} must be a valid integer`]
    })
  }),
  
  range: (min: number, max: number, fieldName: string): ValidationRule => ({
    name: 'range',
    validate: (value: string | number) => ({
      isValid: !value || validateNumber(value, min, max),
      errors: !value || validateNumber(value, min, max) ? [] : [`${fieldName} must be between ${min} and ${max}`]
    })
  }),
  
  custom: (validatorFn: (value: any) => boolean, errorMessage: string): ValidationRule => ({
    name: 'custom',
    validate: (value: any) => ({
      isValid: validatorFn(value),
      errors: validatorFn(value) ? [] : [errorMessage]
    })
  })
};

// Secure string comparison (timing-safe)
export const secureCompare = (a: string, b: string): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return result === 0;
};

// SQL injection prevention (basic)
export const preventSQLInjection = (input: string): string => {
  if (typeof input !== 'string') return '';
  
  // Remove or escape potentially dangerous SQL characters
  return input
    .replace(/'/g, "''") // Escape single quotes
    .replace(/;/g, '') // Remove semicolons
    .replace(/--/g, '') // Remove SQL comments
    .replace(/\/\*/g, '') // Remove SQL block comment start
    .replace(/\*\//g, ''); // Remove SQL block comment end
};

// Rate limiting utilities
export const createRateLimiter = (maxAttempts: number, windowMs: number) => {
  const attempts = new Map<string, { count: number; resetTime: number }>();
  
  return {
    isAllowed: (identifier: string): boolean => {
      const now = Date.now();
      const attempt = attempts.get(identifier);
      
      if (!attempt || now > attempt.resetTime) {
        attempts.set(identifier, { count: 1, resetTime: now + windowMs });
        return true;
      }
      
      if (attempt.count >= maxAttempts) {
        return false;
      }
      
      attempt.count++;
      return true;
    },
    
    getRemainingAttempts: (identifier: string): number => {
      const attempt = attempts.get(identifier);
      if (!attempt || Date.now() > attempt.resetTime) {
        return maxAttempts;
      }
      
      return Math.max(0, maxAttempts - attempt.count);
    },
    
    reset: (identifier: string): void => {
      attempts.delete(identifier);
    }
  };
}; 