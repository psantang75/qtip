/**
 * Form Conditional Logic Processing
 * 
 * Handles the evaluation and processing of conditional logic for form questions.
 * Determines which questions should be visible based on answers to other questions.
 */

import type { Form, FormQuestionCondition, FormQuestion } from '../../types/form.types';

const devWarn = (message: string) => {
  if (import.meta.env.DEV) {
    console.warn(`[CONDITIONAL LOGIC] ${message}`);
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
    form.categories.forEach(category => {
      category.questions.forEach(question => {
        if (question.id) {
          visibilityMap[question.id] = true;
        }
      });
    });
    return visibilityMap;
  }

  // Assign temporary IDs to questions without IDs (for new forms)
  form.categories.forEach((category, categoryIndex) => {
    if (!category.id) {
      category.id = (categoryIndex + 1) * -1000;
    }
    category.questions.forEach((question, questionIndex) => {
      if (!question.id) {
        question.id = -(category.id! * 1000 + questionIndex + 1);
      }
    });
  });

  // Create a mapping of all questions by ID for quick lookup
  const questionsById = new Map<number, FormQuestion>();
  form.categories.forEach(category => {
    category.questions.forEach(question => {
      if (question.id) {
        questionsById.set(question.id, question);
      }
    });
  });

  // Process each question's conditional logic
  form.categories.forEach(category => {
    category.questions.forEach(question => {
      let isVisible = true;

      if (question.is_conditional && question.conditions && question.conditions.length > 0) {
        const validConditions = question.conditions.filter(condition => {
          const isValid = questionsById.has(condition.target_question_id);
          if (!isValid) {
            devWarn(`Invalid target question ID ${condition.target_question_id} for question ${question.id}, making question always visible`);
          }
          return isValid;
        });

        if (validConditions.length === 0) {
          isVisible = true;
        } else {
          isVisible = evaluateConditionalLogic(validConditions, answers);
        }
      } else if (question.is_conditional && (!question.conditions || question.conditions.length === 0)) {
        devWarn(`Question ${question.id} is marked is_conditional=true but has no conditions array`);
        isVisible = true;
      }

      if (question.id) {
        visibilityMap[question.id] = isVisible;
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
  const groupResults = Object.entries(conditionGroups).map(([, groupConditions]) => {
    return groupConditions.every(condition => evaluateSingleCondition(condition, answers));
  });

  return groupResults.some(result => result);
};

/**
 * Evaluates a single condition
 */
const evaluateSingleCondition = (
  condition: FormQuestionCondition,
  answers: Record<number, string>
): boolean => {
  const { target_question_id: targetQuestionId, condition_type: conditionType, target_value: targetValue } = condition;
  
  if (!targetQuestionId) {
    return false;
  }

  const targetAnswer = answers[targetQuestionId];
  
  if (targetAnswer === undefined || targetAnswer === null) {
    if (conditionType === 'NOT_EXISTS') {
      return true;
    }
    return false;
  }
  
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
      if (question.id === questionId) {
        return question;
      }
    }
  }
  return null;
}; 