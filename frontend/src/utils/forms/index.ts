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

// Form scoring logic — mirrors backend/src/utils/scoringUtil.ts for live preview.
export {
  calculateFormScore,
  getQuestionScore,
  getMaxPossibleScore
} from './scoringEngine';

// Roll-up answer derivation — pure transform that runs between
// processConditionalLogic and calculateFormScore. Mirrors
// backend/src/utils/rollupEngine.ts.
export { deriveRollupAnswers } from './rollupEngine';
export type { RollupNote, DeriveResult } from './rollupEngine';

// Form building and structure
export {
  createEmptyForm,
  getDefaultMetadataFields,
  addCategory,
  addQuestion,
  updateQuestion,
  normalizeWeights
} from './formBuilder';

// Audit-form metadata seeding — decides which fields keep their saved value
// and which are re-stamped for the current user.
export { buildInitialMetadata, metadataFieldKey } from './metadataSeed';
export type { MetadataPrefillMode } from './metadataSeed';

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