/**
 * Main types export file
 * 
 * This file re-exports all type definitions from specific type modules.
 * All form-related types are now standardized in form.types.ts to match database schema exactly.
 */

// Export all form-related types (standardized to match database schema)
export * from './form.types';

// Export other domain-specific types
export * from './csr.types';
export * from './performance.types';

// Temporarily comment out trainer.types to avoid conflicts with csr.types
// export * from './trainer.types';

// Re-export standardized submission interfaces from form.types.ts
export type { Answer, FormSubmission, CategoryScore, CreateSubmissionDTO, SubmissionStatus } from './form.types'; 