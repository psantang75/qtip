/**
 * Shared TypeScript interfaces for form rendering data.
 * Imported by both the data-prep layer (formRenderPrep.ts)
 * and the React component layer (formRendererComponents.tsx).
 */

export interface QuestionRenderData {
  id: number;
  text: string;
  type: 'yes_no' | 'scale' | 'text' | 'info' | 'info_block' | 'radio' | 'sub_category' | 'n_a' | 'multi_select';
  isConditional: boolean;
  isVisible: boolean;
  isNaAllowed?: boolean;
  isRequired?: boolean;
  isCritical?: boolean;
  /**
   * Question role surfaced to the renderer so role=ROLLUP questions can be
   * rendered read-only with the "Auto-computed" badge. Defaults to DETAIL
   * for any question that doesn't declare a role.
   */
  role?: 'DETAIL' | 'ROLLUP';
  /**
   * Short human-readable reason produced by rollupEngine.deriveRollupAnswers
   * (e.g. "Auto-NO: sub-question Q99283 (and possibly others) answered NO.").
   * Only set when `role === 'ROLLUP'` and the caller has run the engine.
   */
  rollupReason?: string;
  weight?: number;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  currentValue?: string;
  notes?: string;
  score?: number;
  maxScore?: number;
  radio_options?: Array<{
    option_text: string;
    option_value: string;
    score?: number;
    has_free_text?: boolean;
  }>;
  conditionalLogic?: {
    targetQuestionId?: number;
    conditionType?: string;
    targetValue?: string;
    excludeIfUnmet?: boolean;
  };
  conditions?: Array<{
    id?: number;
    targetQuestionId: number;
    conditionType: string;
    targetValue?: string;
    logicalOperator?: 'AND' | 'OR';
    groupId?: number;
    sortOrder?: number;
  }>;
}

export interface CategoryRenderData {
  id: number;
  name: string;
  description?: string;
  weight: number;
  weightPercentage: string;
  score?: {
    raw: number;
    weighted: number;
    percentage: string;
  };
  questions: QuestionRenderData[];
  allQuestions: QuestionRenderData[];
}

export interface FormRenderData {
  id: number;
  name: string;
  interactionType: string;
  totalScore: number;
  categories: CategoryRenderData[];
  visibleQuestions: Record<number, boolean>;
  categoryScores?: Record<number, {
    raw: number;
    weighted: number;
    earnedPoints?: number;
    possiblePoints?: number;
    trainingPenaltyApplied?: boolean;
  }>;
}
