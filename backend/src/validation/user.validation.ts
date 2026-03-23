import { z } from 'zod';

/**
 * User Validation Schemas
 * Type-safe validation for all user operations using Zod
 */

// Base user schema
export const UserSchema = z.object({
  id: z.number().int().positive().optional(),
  username: z.string().min(3, 'username must be at least 3 characters').max(50, 'username must be less than 50 characters'),
  email: z.string().email('Invalid email format').max(100, 'Email must be less than 100 characters'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(255, 'Password too long')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/, 'Password must contain at least one special character'),
  firstName: z.string().min(1, 'First name is required').max(50, 'First name must be less than 50 characters'),
  lastName: z.string().min(1, 'Last name is required').max(50, 'Last name must be less than 50 characters'),
  department_id: z.number().int().positive('Department ID must be a positive integer').optional(),
  role: z.enum(['admin', 'manager', 'qa', 'csr', 'trainer'], {
    errorMap: () => ({ message: 'Role must be one of: admin, manager, qa, csr, trainer' })
  }),
  is_active: z.boolean().default(true),
  created_at: z.date().optional(),
  updated_at: z.date().optional()
});

// Create user validation (registration)
export const CreateUserSchema = UserSchema.omit({
  id: true,
  created_at: true,
  updated_at: true
}).extend({
  confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

// Update user validation
export const UpdateUserSchema = UserSchema.partial().omit({
  id: true,
  created_at: true,
  updated_at: true,
  password: true // Password updates handled separately
});

// Login validation
export const LoginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required')
});

// Password change validation
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string()
    .min(8, 'New password must be at least 8 characters')
    .max(255, 'Password too long')
    .regex(/[A-Z]/, 'New password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'New password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'New password must contain at least one number')
    .regex(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/, 'New password must contain at least one special character'),
  confirmNewPassword: z.string()
}).refine((data) => data.newPassword === data.confirmNewPassword, {
  message: "New passwords don't match",
  path: ["confirmNewPassword"],
});

// Password reset validation
export const ResetPasswordSchema = z.object({
  email: z.string().email('Invalid email format')
});

export const ResetPasswordConfirmSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  newPassword: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(255, 'Password too long')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/, 'Password must contain at least one special character'),
  confirmPassword: z.string()
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

// User search/filter validation
export const UserSearchSchema = z.object({
  search: z.string().optional(),
  department: z.string().optional(),
  role: z.enum(['admin', 'manager', 'qa', 'csr', 'trainer']).optional(),
  is_active: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(10),
  sortBy: z.enum(['username', 'email', 'firstName', 'lastName', 'created_at']).default('created_at'),
  sort_order: z.enum(['asc', 'desc']).default('desc')
});

// User ID parameter validation
export const UserIdSchema = z.object({
  id: z.string().regex(/^\d+$/, 'User ID must be a number').transform(Number)
});

// Bulk user operations
export const BulkUserActionSchema = z.object({
  userIds: z.array(z.number().int().positive()).min(1, 'At least one user ID is required'),
  action: z.enum(['activate', 'deactivate', 'delete'], {
    errorMap: () => ({ message: 'Action must be one of: activate, deactivate, delete' })
  })
});

// User profile update (for self-service)
export const ProfileUpdateSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(50, 'First name must be less than 50 characters'),
  lastName: z.string().min(1, 'Last name is required').max(50, 'Last name must be less than 50 characters'),
  email: z.string().email('Invalid email format').max(100, 'Email must be less than 100 characters')
});

// Export types for use in services
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;
export type ResetPasswordConfirmInput = z.infer<typeof ResetPasswordConfirmSchema>;
export type UserSearchInput = z.infer<typeof UserSearchSchema>;
export type UserIdInput = z.infer<typeof UserIdSchema>;
export type BulkUserActionInput = z.infer<typeof BulkUserActionSchema>;
export type ProfileUpdateInput = z.infer<typeof ProfileUpdateSchema>;
export type UserData = z.infer<typeof UserSchema>;

/**
 * Validation middleware helper
 * Use this to validate request data in routes
 */
export function validateUserData<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; errors: z.ZodError } {
  const result = schema.safeParse(data);
  
  if (result.success) {
    return { success: true, data: result.data };
  } else {
    return { success: false, errors: result.error };
  }
}

/**
 * Format validation errors for API responses
 */
export function formatValidationErrors(errors: z.ZodError): Array<{ field: string; message: string }> {
  return errors.errors.map(error => ({
    field: error.path.join('.'),
    message: error.message
  }));
} 