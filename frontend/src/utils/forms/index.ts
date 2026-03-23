/**
 * Form Utilities
 * 
 * This module re-exports all form-related utilities from their individual files.
 * This provides a clean, organized structure while maintaining simple imports.
 */

// Form conditional logic
export {
  processConditionalLogic,
  hasCircularDependencies,
  findQuestionById
} from './formConditions';

// Form scoring logic
export {
  calculateFormScore,
  getQuestionScore,
  getMaxPossibleScore
} from './scoringAdapter';

// Form building and structure
export {
  createEmptyForm,
  getDefaultMetadataFields,
  addCategory,
  addQuestion,
  updateQuestion,
  normalizeWeights
} from './formBuilder';

// Form validation 
export {
  validateForm,
  validateMetadataFields,
  validateAnswer
} from './formValidation';

// Form rendering - all components, types and utilities
export * from './formRenderer';

// Named exports of components
export { default as CompletedFormRenderer } from './completedFormRenderer'; 