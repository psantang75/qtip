/**
 * Form Renderer
 * 
 * This module handles form rendering data preparation AND React components.
 * It provides a complete, reusable form rendering solution that components
 * across the application can use for consistent form display.
 */

import React from 'react';
import type { Form, Question, Answer, Category, FormSubmission } from '../../types';
import type { FormQuestion } from '../../types/form.types';
import { processConditionalLogic } from './formConditions';
import { calculateFormScore } from './scoringAdapter';

/**
 * Generates preview data for a form with blank or sample values for showing in form preview
 * @param form The form to generate preview data for
 * @param withSampleAnswers Whether to include sample answers (default: false)
 */
export const generateFormPreview = (form: Form, withSampleAnswers: boolean = false): FormSubmission => {
  // Assign temporary IDs to questions without IDs (for new forms)
  form.categories.forEach((category, categoryIndex) => {
    // Assign category ID if missing
    if (!category.id) {
      const categoryId = (categoryIndex + 1) * -1000;
      (category as any).id = categoryId;
    }
    
    category.questions.forEach((question, questionIndex) => {
      if (!question.id) {
        const tempId = -(category.id * 1000 + questionIndex + 1);
        (question as any).id = tempId;
        console.log(`Assigned temporary ID ${tempId} to question: ${question.question_text}`);
      }
    });
  });

  // Create answers object (empty by default, sample if requested)
  const answers: Record<number, Answer> = {};
  
  if (withSampleAnswers) {
    // Create sample answers for preview
    form.categories.forEach((category) => {
      category.questions.forEach((question) => {
        if (!question.id) {
          console.warn('Question without ID found', question);
          return;
        }
        
        // Ensure the question has the expected properties by using type casting in a safe way
        const typedQuestion = question as any;
        const questionType = (typedQuestion.question_type || '').toLowerCase();
        
        if (questionType === 'YES_NO') {
          // Use exact values from database for scoring
          const yesValue = typedQuestion.yes_value !== undefined ? 
                         Number(typedQuestion.yes_value) : 
                         (typedQuestion.score_if_yes !== undefined ? 
                           Number(typedQuestion.score_if_yes) : 0);

          answers[question.id] = {
            question_id: question.id,
            answer: 'yes',
            score: yesValue, 
            notes: ''
          };
        } else if (questionType === 'SCALE') {
          answers[question.id] = {
            question_id: question.id,
            answer: String(typedQuestion.max_scale || typedQuestion.scale_max || 5),
            score: typedQuestion.max_scale || typedQuestion.scale_max || 5,
            notes: ''
          };
        } else if (questionType === 'text') {
          answers[question.id] = {
            question_id: question.id,
            answer: 'Sample text answer',
            score: 0,
            notes: ''
          };
        } else if (questionType === 'radio') {
          // For radio questions, select the highest scoring option by default
          const options = typedQuestion.radio_options || [];
          const highestScoringOption = options.reduce(
            (best: any, current: any) => (current.score || 0) > (best.score || 0) ? current : best,
            options[0]
          );
          
          answers[question.id] = {
            question_id: question.id,
            answer: highestScoringOption.option_value || highestScoringOption.option_text || '',
            score: highestScoringOption.score || 0,
            notes: ''
          };
        } else {
          // For info blocks and any other types
          answers[question.id] = {
            question_id: question.id,
            answer: '',
            score: 0,
            notes: ''
          };
        }
      });
    });
  }
  
  // Convert Answer objects to strings for conditional logic
  const answerStrings: Record<number, string> = {};
  Object.entries(answers).forEach(([questionId, answer]) => {
    answerStrings[Number(questionId)] = answer.answer || '';
  });
  
  // Let conditional logic determine which questions should be visible
  const visibilityMap = processConditionalLogic(form, answerStrings, false);
  
  // Log the initial visibility state for debugging
  console.log("Initial visibility map for preview:", visibilityMap);
  console.log("Answers for preview:", answers, withSampleAnswers ? "(with sample values)" : "(blank form)");
  
  // Calculate scores using the enhanced scoring utility for the preview
  const { totalScore, categoryScores } = calculateFormScore(form, answers);
  
  // Log the calculated scores for debugging
  console.log("Preview scores calculated:", { totalScore, categoryScores });
  
  return {
    form_id: form.id || 0,
    submitted_by: 0, // Default value for preview
    status: 'preview',
    total_score: totalScore,
    form,
    answers: Object.values(answers), // Convert Record<number, Answer> to Answer[]
    visibilityMap,
    score: totalScore,
    categoryScores: Object.values(categoryScores).map((score, index) => ({
      categoryId: index,
      categoryName: `Category ${index + 1}`,
      earnedPoints: score.earnedPoints || 0,
      possiblePoints: score.possiblePoints || 0,
      rawScore: score.raw,
      weightedScore: score.weighted
    }))
  };
};

/**
 * Question rendering data that components can use to render questions
 */
export interface QuestionRenderData {
  id: number;
  text: string;
  type: 'yes_no' | 'scale' | 'text' | 'info' | 'info_block' | 'radio' | 'sub_category' | 'n_a';
  isConditional: boolean;
  isVisible: boolean;
  isNaAllowed?: boolean;
  isRequired?: boolean;
  weight?: number;
  options?: Array<{
    value: string;
    label: string;
  }>;
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
  
  // Conditional logic metadata
  conditionalLogic?: {
    targetQuestionId?: number;
    conditionType?: string;
    targetValue?: string;
    excludeIfUnmet?: boolean;
  };
  
  // Complex conditional logic
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

/**
 * Category rendering data with questions for UI components
 */
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

/**
 * Form rendering data structure for UI components
 */
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

/**
 * Prepare question data for rendering
 */
export const prepareQuestionForRender = (
  question: FormQuestion | any,  // Accept any to handle both types
  currentAnswer?: Answer,
  isVisible: boolean = true
): QuestionRenderData => {
  // Normalize question type to lowercase for consistent comparison
  const questionType = (question.question_type || '').toLowerCase() as 'yes_no' | 'scale' | 'text' | 'info' | 'radio' | 'info_block' | 'sub_category';
  
  // Log visibility for conditional questions
  if (question.is_conditional) {
    console.log(`Preparing question ${question.id} (${question.question_text}) for render: visible=${isVisible}`);
  }
  
  const baseData: QuestionRenderData = {
    id: question.id || 0,
    text: question.question_text || '',
    type: questionType,
    isConditional: !!question.is_conditional,
    isVisible: isVisible,
    isNaAllowed: !!question.is_na_allowed,
    isRequired: !!question.is_required,
    weight: question.weight,
    currentValue: currentAnswer?.answer,
    notes: currentAnswer?.notes,
    score: currentAnswer?.score,
    
    // Include conditional logic metadata
    conditionalLogic: question.conditional_logic ? {
      targetQuestionId: question.conditional_logic.target_question_id,
      conditionType: question.conditional_logic.condition_type,
      targetValue: question.conditional_logic.target_value,
      excludeIfUnmet: question.conditional_logic.exclude_if_unmet
    } : (question.is_conditional ? {
      targetQuestionId: question.conditional_question_id,
      conditionType: question.condition_type,
      targetValue: question.conditional_value,
      excludeIfUnmet: question.exclude_if_unmet
    } : undefined),
    
    // Include complex conditional logic
    conditions: question.conditions ? question.conditions.map(condition => ({
      id: condition.id,
      targetQuestionId: condition.target_question_id,
      conditionType: condition.condition_type,
      targetValue: condition.target_value,
      logicalOperator: condition.logical_operator,
      groupId: condition.group_id,
      sortOrder: condition.sort_order
    })) : undefined
  };
  
  // Add type-specific properties
  switch (questionType) {
    case 'yes_no':
      // Make sure we use the exact values from the database for maxScore
      const yesScore = question.yes_value !== undefined ? 
                      Number(question.yes_value) : 
                      (question.score_if_yes !== undefined ?
                        Number(question.score_if_yes) : 1);  // Default to 1 for yes/no questions
      
      // Calculate actual score based on the answer
      let actualScore = currentAnswer?.score;
      
      // For yes answers with no score set, derive from the question's yes_value
      if (currentAnswer && 
          currentAnswer.answer && 
          currentAnswer.answer.toLowerCase() === 'yes' && 
          (actualScore === undefined || actualScore === 0)) {
        actualScore = yesScore;
      }
      
      return {
        ...baseData,
        options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' }
        ],
        maxScore: yesScore,
        score: actualScore
      };
      
    case 'scale':
      return {
        ...baseData,
        min: question.scale_min || 0,
        max: question.scale_max || question.max_scale || 5,
        maxScore: question.scale_max || question.max_scale || 5
      };
      
    case 'radio':
      // Check for radio options in different capitalization patterns
      const extractedOptions = question.radio_options || 
                              (question as any).RADIO_OPTIONS || 
                              (question as any).RadioOptions || [];
      
      if (extractedOptions.length === 0) {
        console.warn(`Radio question (id: ${question.id}) has no options:`, question);
      }
      
      return {
        ...baseData,
        radio_options: extractedOptions
      };
      
    default:
      return baseData;
  }
};

/**
 * Prepare category data for rendering
 */
export const prepareCategoryForRender = (
  category: Category,
  answers: Record<number, Answer>,
  visibilityMap: Record<number, boolean>,
  categoryScore?: { 
    raw: number; 
    weighted: number;
    earnedPoints?: number;
    possiblePoints?: number; 
    trainingPenaltyApplied?: boolean;
  },
  userRole?: number
): CategoryRenderData => {
  // Prepare all questions with their visibility status
  const allQuestionData = category.questions.map(question => {
    const questionData = prepareQuestionForRender(
      question, 
      answers[question.id], 
      !!visibilityMap[question.id]
    );
    
    // Special handling for radio questions to ensure options are passed through
    if (question.question_type?.toLowerCase() === 'radio' && (question as any).radio_options) {
      questionData.radio_options = (question as any).radio_options;
    }
    
    return questionData;
  });
  
  // Filter to only visible questions for display
  // For CSR users (role_id 3), also filter out questions where visible_to_csr is false
  const visibleQuestions = allQuestionData.filter(q => {
    if (!q.isVisible) return false;
    
    // If user is CSR and question has visible_to_csr set to false, hide it
    if (userRole === 3) {
      const originalQuestion = category.questions.find(oq => oq.id === q.id);
      if (originalQuestion && (originalQuestion as any).visible_to_csr === false) {
        return false;
      }
    }
    
    return true;
  });

  // Calculate total weight as a percentage for display
  const weight = category.weight || 1;
  const weightFormatted = category.weight === 1 ? '100%' : `${(weight * 100).toFixed(0)}%`;
  
  // Calculate raw percentage if we have points data
  const rawPercentage = categoryScore?.possiblePoints && categoryScore?.possiblePoints > 0
    ? (categoryScore.earnedPoints || 0) / categoryScore.possiblePoints * 100
    : categoryScore?.raw || 0;
  
  return {
    id: category.id || 0,
    name: category.category_name || '',
    description: category.description,
    weight,
    weightPercentage: weightFormatted,
    score: categoryScore ? {
      raw: categoryScore.raw || rawPercentage,
      weighted: categoryScore.weighted,
      percentage: `${(categoryScore.raw || rawPercentage).toFixed(1)}%`
    } : undefined,
    questions: visibleQuestions,
    allQuestions: allQuestionData
  };
};

/**
 * Prepare entire form for rendering
 */
export const prepareFormForRender = (
  form: Form,
  answers: Record<number, Answer>,
  visibilityMap: Record<number, boolean>,
  categoryScores?: Record<number, { 
    raw: number;
    weighted: number;
    earnedPoints?: number;
    possiblePoints?: number;
    trainingPenaltyApplied?: boolean;
  }>,
  totalScore?: number,
  userRole?: number
): FormRenderData => {
  // Ensure we have valid category data
  if (!form?.categories || !Array.isArray(form.categories)) {
    console.warn('Invalid form data provided to prepareFormForRender', form);
    return {
      id: form?.id || 0,
      name: form?.form_name || 'Unknown Form',
      interactionType: form?.interaction_type || 'UNIVERSAL',
      totalScore: 0,
      categories: [],
      visibleQuestions: {}
    };
  }

  // Ensure all categories and questions have IDs (for new forms)
  form.categories.forEach((category, index) => {
    if (!category.id) {
      const fallbackId = (index + 1) * -1000;
      console.warn(`Category without ID found at index ${index}, using fallback ID: ${fallbackId}`, category);
      // Assign ID directly to ensure consistency
      (category as any).id = fallbackId;
    }
    
    // Also ensure all questions in this category have IDs
    category.questions.forEach((question, questionIndex) => {
      if (!question.id) {
        const tempId = -(category.id * 1000 + questionIndex + 1);
        (question as any).id = tempId;
        console.warn(`Question without ID found, using temporary ID: ${tempId}`, question);
      }
    });
  });
  
  // Calculate total weights for normalization
  let totalWeight = 0;
  form.categories.forEach(cat => totalWeight += cat.weight || 0);
  
  // Normalize weights if needed
  const normalizedWeight = totalWeight > 0 ? totalWeight : 1;
  
  // Filter out categories with zero weight ONLY for CSRs (role_id 3)
  // All other roles (QA, managers, directors, trainers) should see all categories
  const visibleCategories = userRole === 3 
    ? form.categories.filter(category => (category.weight || 0) > 0)
    : form.categories;
  
  // Prepare each category data
  const categoryRenderData = visibleCategories.map(category => {
    // Find category score if available
    const categoryScore = category.id && categoryScores ? categoryScores[category.id] : undefined;
    
    // Prepare the category
    return prepareCategoryForRender(
      category,
      answers,
      visibilityMap,
      categoryScore,
      userRole
    );
  });
  
  return {
    id: form.id,
    name: form.form_name,
    interactionType: form.interaction_type,
    totalScore: totalScore || 0,
    categories: categoryRenderData,
    visibleQuestions: visibilityMap,
    categoryScores
  };
};

// Question Rendering Components

interface QuestionProps {
  question: QuestionRenderData;
  isDisabled?: boolean;
  onAnswerChange: (id: number, value: string, type: string) => void;
  onNotesChange: (id: number, notes: string) => void;
}

export const YesNoQuestion: React.FC<QuestionProps> = ({ 
  question, 
  isDisabled = false,
  onAnswerChange,
  onNotesChange
}) => {
  if (!question.isVisible) return null;
  
  const { id, text, currentValue } = question;
  
  // Determine options based on whether NA is allowed
  const options = [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' }
  ];
  
  // Only add N/A option if it's allowed for this question
  if (question.isNaAllowed) {
    options.push({ value: 'na', label: 'N/A' });
  }
  
  return (
    <div className="mb-4 p-3">
      <label className="block font-medium mb-2">{text}</label>
      <div className="flex gap-4">
        {options.map((option) => (
          <label key={option.value} className="inline-flex items-center">
            <input
              type="radio"
              name={`question_${id}`}
              value={option.value}
              checked={currentValue === option.value}
              onChange={() => onAnswerChange(id, option.value, 'yes_no')}
              className="mr-2"
              disabled={isDisabled}
            />
            {option.label}
          </label>
        ))}
      </div>
    </div>
  );
};

export const ScaleQuestion: React.FC<QuestionProps> = ({ 
  question, 
  isDisabled = false,
  onAnswerChange,
  onNotesChange
}) => {
  if (!question.isVisible) return null;
  
  const { id, text, min, max, currentValue } = question;
  
  return (
    <div className="mb-4 p-3">
      <label className="block font-medium mb-2">{text}</label>
      <div className="flex flex-wrap gap-3">
        {Array.from({length: (max || 5) + 1}, (_, i) => (
          <label key={i} className="inline-flex flex-col items-center">
            <input
              type="radio"
              name={`question_${id}`}
              value={i.toString()}
              checked={currentValue === i.toString()}
              onChange={() => onAnswerChange(id, i.toString(), 'scale')}
              className="mb-1"
              disabled={isDisabled}
            />
            {i}
          </label>
        ))}
      </div>
    </div>
  );
};

export const TextQuestion: React.FC<QuestionProps> = ({ 
  question, 
  isDisabled = false,
  onAnswerChange,
  onNotesChange
}) => {
  if (!question.isVisible) return null;
  
  const { id, text, currentValue } = question;
  
  return (
    <div className="mb-4 p-3">
      <label className="block font-medium mb-2">{text}</label>
      <textarea
        className="w-full border rounded-md p-2"
        value={currentValue || ''}
        onChange={(e) => onAnswerChange(id, e.target.value, 'text')}
        disabled={isDisabled}
      />
    </div>
  );
};

export const RadioQuestion: React.FC<QuestionProps> = ({ 
  question, 
  isDisabled = false,
  onAnswerChange,
  onNotesChange
}) => {
  if (!question.isVisible) return null;
  
  const { id, text, currentValue } = question;
  
  // Get radio options with fallbacks for different property naming conventions
  const radioOptions = question.radio_options || 
                       (question as any).RADIO_OPTIONS || 
                       (question as any).RadioOptions || 
                       [];
  
  if (radioOptions.length === 0) {
    console.warn(`Radio question ${id} has no options`);
    return <div className="mb-4 p-3 text-red-500">Error: No options available for this question.</div>;
  }
  
  const handleOptionSelect = (optionValue: string) => {
    onAnswerChange(id, optionValue, 'radio');
  };
  
  return (
    <div className="mb-4 p-3">
      <label className="block font-medium mb-2">{text}</label>
      <div className="space-y-2">
        {radioOptions.map((option: any) => {
          const optionValue = option.option_value || option.value || '';
          // Using String() to normalize comparison
          const normalizedCurrentValue = String(currentValue || '');
          const normalizedOptionValue = String(optionValue || '');
          const isSelected = normalizedCurrentValue === normalizedOptionValue;
          
          return (
            <label key={optionValue} className="block">
              <div className="flex items-center">
                <input
                  type="radio"
                  name={`question_${id}`}
                  value={optionValue}
                  checked={isSelected}
                  onChange={() => handleOptionSelect(optionValue)}
                  className="mr-2"
                  disabled={isDisabled}
                />
                {option.option_text || option.label}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
};

export const InfoQuestion: React.FC<QuestionProps> = ({ 
  question
}) => {
  if (!question.isVisible) return null;
  
  const { text } = question;
  
  return (
    <div className="mb-4 p-3">
      <div className="text-gray-800">{text}</div>
    </div>
  );
};

export const SubCategoryQuestion: React.FC<QuestionProps> = ({ 
  question
}) => {
  if (!question.isVisible) return null;
  
  const { text } = question;
  
  return (
    <div className="mb-4 mt-6">
      <h4 className="font-bold text-lg">{text}</h4>
      <hr className="mt-1 border-2 border-gray-400" />
    </div>
  );
};

// Question renderer that selects the appropriate component based on question type
export const QuestionRenderer: React.FC<QuestionProps> = (props) => {
  if (!props.question.isVisible) {
    return null;
  }
  
  // Add a div wrapper with an id for scrolling to specific questions
  return (
    <div id={`question-${props.question.id}`} className="mb-4 p-3 border border-gray-200 rounded transition-all">
      {props.question.type === 'yes_no' && <YesNoQuestion {...props} />}
      {props.question.type === 'scale' && <ScaleQuestion {...props} />}
      {props.question.type === 'text' && <TextQuestion {...props} />}
      {props.question.type === 'radio' && <RadioQuestion {...props} />}
      {(props.question.type === 'info' || props.question.type === 'info_block') && <InfoQuestion {...props} />}
      {props.question.type === 'sub_category' && <SubCategoryQuestion {...props} />}
    </div>
  );
};

// Category renderer
interface CategoryProps {
  category: CategoryRenderData;
  isDisabled?: boolean;
  onAnswerChange: (id: number, value: string, type: string) => void;
  onNotesChange: (id: number, notes: string) => void;
}

export const CategoryRenderer: React.FC<CategoryProps> = ({
  category,
  isDisabled = false,
  onAnswerChange,
  onNotesChange
}) => {
  return (
    <div className="mb-6">
      <h3 className="text-lg font-medium mb-2 bg-primary-blue text-white p-4 rounded-md">
        {category.name}
      </h3>
      {category.description && (
        <p className="text-sm text-gray-600 mb-3">{category.description}</p>
      )}
      {/* Fix the key prop issue by ensuring each QuestionRenderer has a unique key */}
      {category.questions.map((question, index) => (
        <QuestionRenderer 
          key={question.id || `question-${index}`}
          question={question} 
          isDisabled={isDisabled}
          onAnswerChange={onAnswerChange}
          onNotesChange={onNotesChange}
        />
      ))}
    </div>
  );
};

// Form renderer 
interface FormRendererProps {
  formRenderData: FormRenderData;
  isDisabled?: boolean;
  onAnswerChange: (id: number, value: string, type: string) => void;
  onNotesChange: (id: number, notes: string) => void;
}

export const FormRenderer: React.FC<FormRendererProps> = ({
  formRenderData,
  isDisabled = false,
  onAnswerChange,
  onNotesChange
}) => {
  return (
    <div className="mb-6 border-b pb-4">
      {formRenderData.categories.map((category, categoryIndex) => (
        <CategoryRenderer 
          key={category.id || `category-${categoryIndex}`}
          category={category}
          isDisabled={isDisabled}
          onAnswerChange={onAnswerChange}
          onNotesChange={onNotesChange}
        />
      ))}
    </div>
  );
};