/**
 * Form Conditional Logic Processing
 * 
 * Handles the evaluation and processing of conditional logic for form questions.
 * Determines which questions should be visible based on answers to other questions.
 */

import type { Form, FormQuestionCondition, FormQuestion } from '../../types/form.types';

// Development-only logging utility
const devLog = (message: string, ...args: any[]) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[CONDITIONAL LOGIC] ${message}`, ...args);
  }
};

// Development-only warning utility
const devWarn = (message: string, ...args: any[]) => {
  if (process.env.NODE_ENV === 'development') {
    console.warn(`[CONDITIONAL LOGIC WARNING] ${message}`, ...args);
  }
};

/**
 * Main function to process conditional logic for a form
 * @param form - The form structure with categories and questions
 * @param answers - Current answers provided by the user (Record<questionId, answerValue>)
 * @param isPreview - Whether this is a preview mode (shows all questions)
 * @returns Object mapping question IDs to their visibility status
 */
export const processConditionalLogic = (
  form: Form,
  answers: Record<number, string>,
  isPreview: boolean = false
): Record<number, boolean> => {
  const visibilityMap: Record<number, boolean> = {};

  // In preview mode, show all questions
  if (isPreview) {
    devLog('Preview mode: showing all questions regardless of conditions');
    form.categories.forEach(category => {
      category.questions.forEach(question => {
        if (question.id) {
          visibilityMap[question.id] = true;
        }
      });
    });
    return visibilityMap;
  }

  devLog('Processing conditional logic with answers:', answers);

  // Assign temporary IDs to questions without IDs (for new forms)
  form.categories.forEach((category, categoryIndex) => {
    // Assign category ID if missing
    if (!category.id) {
      const categoryId = (categoryIndex + 1) * -1000;
      (category as any).id = categoryId;
    }
    
    category.questions.forEach((question, questionIndex) => {
      const q = question as unknown as FormQuestion;
      if (!q.id) {
        const tempId = -(category.id * 1000 + questionIndex + 1);
        (q as any).id = tempId;
        devLog(`Assigned temporary ID ${tempId} to question: ${q.question_text}`);
      }
    });
  });

  // Create a mapping of all questions by ID for quick lookup
  const questionsById = new Map<number, FormQuestion>();
  form.categories.forEach(category => {
    category.questions.forEach(question => {
      const q = question as unknown as FormQuestion;
      if (q.id) {
        questionsById.set(q.id, q);
      }
    });
  });

  // Process each question's conditional logic
  form.categories.forEach(category => {
    category.questions.forEach(question => {
      const q = question as unknown as FormQuestion;
      
      // Set default visibility
      let isVisible = true;

      // Handle questions with conditional logic
      if (q.is_conditional && q.conditions && q.conditions.length > 0) {
        // Filter out conditions with invalid target questions
        const validConditions = q.conditions.filter(condition => {
          const isValid = questionsById.has(condition.target_question_id);
          if (!isValid) {
            devWarn(`Invalid target question ID ${condition.target_question_id} for question ${q.id}, making question always visible`);
          }
          return isValid;
        });

        if (validConditions.length === 0) {
          // No valid conditions, make question visible by default
          devLog(`Question ${q.id} has only invalid conditions, making it visible by default`);
          isVisible = true;
        } else {
          // Evaluate conditional logic
          isVisible = evaluateConditionalLogic(validConditions, answers);
        }
      } else if (q.is_conditional && (!q.conditions || q.conditions.length === 0)) {
        // Question is marked as conditional but has no conditions
        devWarn(`Question ${q.id} is marked is_conditional=true but has no conditions array`);
        isVisible = true;
      }

      // Store visibility result
      if (q.id) {
        visibilityMap[q.id] = isVisible;
      }
    });
  });

  return visibilityMap;
};

/**
 * Evaluates conditional logic for a question
 */
const evaluateConditionalLogic = (
  conditions: FormQuestionCondition[],
  answers: Record<number, string>
): boolean => {
  if (conditions.length === 0) {
    return true;
  }

  // Group conditions by group_id
  const conditionGroups = conditions.reduce((groups, condition) => {
    const groupId = condition.group_id || 0;
    if (!groups[groupId]) {
      groups[groupId] = [];
    }
    groups[groupId].push(condition);
    return groups;
  }, {} as Record<number, FormQuestionCondition[]>);

  // Evaluate each group (AND within group, OR between groups)
  const groupResults = Object.entries(conditionGroups).map(([groupId, conditions]) => {
    devLog(`Processing condition group ${groupId} with ${conditions.length} conditions`);
    
    // All conditions in a group must be true (AND logic)
    const groupResult = conditions.every(condition => {
      return evaluateSingleCondition(condition, answers);
    });
    
    devLog(`Group ${groupId} result: ${groupResult}`);
    return groupResult;
  });

  // At least one group must be true (OR logic between groups)
  const finalResult = groupResults.some(result => result);
  devLog(`Final visibility result: ${finalResult}`);
  
  return finalResult;
};

/**
 * Evaluates a single condition
 */
const evaluateSingleCondition = (
  condition: FormQuestionCondition,
  answers: Record<number, string>
): boolean => {
  const { target_question_id: targetQuestionId, condition_type: conditionType, target_value: targetValue } = condition;
  
  devLog(`Processing condition (target=${targetQuestionId}, type=${conditionType}, value=${targetValue})`);
  
  if (!targetQuestionId) {
    devLog(`Target question ${targetQuestionId} doesn't exist`);
    return false;
  }

  const targetAnswer = answers[targetQuestionId];
  
  if (targetAnswer === undefined || targetAnswer === null) {
    // No answer provided for target question
    if (conditionType === 'NOT_EXISTS') {
      return true;
    }
    devLog(`No answer for target question ${targetQuestionId}`);
    return false;
  }

  devLog(`Evaluating condition: Q${targetQuestionId} ${conditionType} "${targetValue}". Current value: "${targetAnswer}"`);
  
  // Normalize values for comparison
  const normalizedTargetAnswer = String(targetAnswer).trim().toLowerCase();
  const normalizedTargetValue = String(targetValue || '').trim().toLowerCase();
  
  // Handle different condition types
  let conditionMet = false;
  
  switch (conditionType) {
    case 'EQUALS':
      // Special handling for YES/NO questions
      const isYesValue = ['yes', 'true', '1', 'on'].includes(normalizedTargetAnswer);
      const isNoValue = ['no', 'false', '0', 'off'].includes(normalizedTargetAnswer);
      const expectedYes = ['yes', 'true', '1', 'on'].includes(normalizedTargetValue);
      const expectedNo = ['no', 'false', '0', 'off'].includes(normalizedTargetValue);
      
      if ((isYesValue && expectedYes) || (isNoValue && expectedNo)) {
        conditionMet = true;
      } else {
        conditionMet = normalizedTargetAnswer === normalizedTargetValue;
      }
      break;
      
    case 'NOT_EQUALS':
      conditionMet = normalizedTargetAnswer !== normalizedTargetValue;
      break;
      
    case 'EXISTS':
      conditionMet = normalizedTargetAnswer !== '';
      break;
      
    case 'NOT_EXISTS':
      conditionMet = normalizedTargetAnswer === '';
      break;
      
    default:
      devWarn(`Unknown condition type: ${conditionType}`);
      conditionMet = false;
  }
  
  devLog(`Condition met: ${conditionMet}`);
  return conditionMet;
};

/**
 * Check if a form has circular dependencies in its conditional logic
 */
export const hasCircularDependencies = (form: Form): boolean => {
  const dependencies = new Map<number, number[]>();
  
  // Build dependency graph
  form.categories.forEach(category => {
    category.questions.forEach(question => {
      const q = question as unknown as FormQuestion;
      if (q.id && q.conditions) {
        const deps = q.conditions.map(c => c.target_question_id);
        dependencies.set(q.id, deps);
      }
    });
  });
  
  // Check for cycles using DFS
  const visited = new Set<number>();
  const recursionStack = new Set<number>();
  
  const hasCycle = (node: number): boolean => {
    if (recursionStack.has(node)) {
      return true; // Found a cycle
    }
    
    if (visited.has(node)) {
      return false; // Already processed
    }
    
    visited.add(node);
    recursionStack.add(node);
    
    const deps = dependencies.get(node) || [];
    for (const dep of deps) {
      if (hasCycle(dep)) {
        return true;
      }
    }
    
    recursionStack.delete(node);
    return false;
  };
  
  // Check all questions for cycles
  for (const questionId of dependencies.keys()) {
    if (hasCycle(questionId)) {
      return true;
    }
  }
  
  return false;
};

/**
 * Utility function to find a question by ID across all categories
 */
export const findQuestionById = (form: Form, questionId: number): FormQuestion | null => {
  for (const category of form.categories) {
    for (const question of category.questions) {
      const q = question as unknown as FormQuestion;
      if (q.id === questionId) {
        return q;
      }
    }
  }
  return null;
}; 