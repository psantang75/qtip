/**
 * SinglePageFormBuilder Component
 * 
 * A comprehensive form builder interface following enterprise-grade standards.
 * 
 * ARCHITECTURE:
 * - Separation of concerns: FormBuilder (main logic) + specialized sub-components
 * - Type-safe with TypeScript interfaces and strict validation
 * - Reusable components: FormField, Button, ErrorDisplay, Modal, LoadingSpinner
 * - Professional error handling with user-friendly messages
 * 
 * FEATURES:
 * - Dynamic form creation with categories and questions
 * - Advanced conditional logic with multiple operators
 * - Real-time validation with field-level error feedback
 * - Form preview and versioning capabilities
 * - Responsive design with mobile-first approach
 * - Accessibility support with ARIA labels and keyboard navigation
 * 
 * SECURITY:
 * - Input validation and sanitization
 * - XSS protection through React's built-in escaping
 * - Form data validation before submission
 * 
 * PERFORMANCE:
 * - Optimized re-renders with useCallback and useMemo
 * - Efficient state management
 * - Component memoization for complex nested structures
 * 
 * @version 2.0.0
 * @author QTIP Development Team
 * @since 1.0.0
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { 
  HiChevronUp, 
  HiChevronDown, 
  HiCheck, 
  HiExclamation,
  HiInformationCircle,
  HiPlus,
  HiX
} from 'react-icons/hi';
import type { Form, FormCategory, FormQuestion, RadioOption, InteractionType, FormMetadataField, FormQuestionCondition } from '../types/form.types';
import { createForm, getFormById, updateForm, deactivateForm } from '../services/formService';
import FormMetadata from './FormMetadata';
import { FormField } from './forms/FormField';
import Button from './ui/Button';
import ErrorDisplay from './ui/ErrorDisplay';
import LoadingSpinner from './ui/LoadingSpinner';

/**
 * Form validation interface for comprehensive error tracking
 */
interface FormErrors {
  form?: string;
  form_name?: string;
  categories?: string;
  questions?: string;
  [key: string]: string | undefined;
}

/**
 * Performance tracking interface for development monitoring
 */
interface PerformanceTracker {
  lastSaveTime: number;
  saveCount: number;
  lastLoadTime: number;
  loadCount: number;
}

/**
 * Memoized Category Component for performance optimization
 */
const CategoryBuilder = React.memo<{
  category: FormCategory;
  categoryIndex: number;
  totalCategories: number;
  totalWeight: number;
  onCategoryNameChange: (index: number, name: string) => void;
  onCategoryWeightChange: (index: number, weight: number) => void;
  onRemoveCategory: (index: number) => void;
  onMoveCategoryUp: (index: number) => void;
  onMoveCategoryDown: (index: number) => void;
  onAddQuestion: (categoryIndex: number) => void;
  onQuestionChange: (categoryIndex: number, questionIndex: number, question: FormQuestion) => void;
  onRemoveQuestion: (categoryIndex: number, questionIndex: number) => void;
  onMoveQuestionUp: (categoryIndex: number, questionIndex: number) => void;
  onMoveQuestionDown: (categoryIndex: number, questionIndex: number) => void;
  onAddRadioOption: (categoryIndex: number, questionIndex: number) => void;
  onUpdateRadioOption: (categoryIndex: number, questionIndex: number, optionIndex: number, option: RadioOption) => void;
  onRemoveRadioOption: (categoryIndex: number, questionIndex: number, optionIndex: number) => void;
  onAddCondition: (categoryIndex: number, questionIndex: number) => void;
  onUpdateCondition: (categoryIndex: number, questionIndex: number, conditionIndex: number, updates: Partial<FormQuestionCondition>) => void;
  onRemoveCondition: (categoryIndex: number, questionIndex: number, conditionIndex: number) => void;
  onAddConditionGroup: (categoryIndex: number, questionIndex: number) => void;
}>(({ 
  category, 
  categoryIndex, 
  totalCategories, 
  totalWeight,
  onCategoryNameChange,
  onCategoryWeightChange,
  onRemoveCategory,
  onMoveCategoryUp,
  onMoveCategoryDown,
  onAddQuestion,
  onQuestionChange,
  onRemoveQuestion,
  onMoveQuestionUp,
  onMoveQuestionDown,
  onAddRadioOption,
  onUpdateRadioOption,
  onRemoveRadioOption,
  onAddCondition,
  onUpdateCondition,
  onRemoveCondition,
  onAddConditionGroup
}) => {
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Validation for category fields
  const validateCategoryName = useCallback((name: string): string => {
    if (!name || name.trim().length < 2) {
      return 'Category name must be at least 2 characters long';
    }
    if (name.length > 100) {
      return 'Category name must be less than 100 characters';
    }
    return '';
  }, []);

  const validateWeight = useCallback((weight: number): string => {
    if (weight < 0 || weight > 1) {
      return 'Weight must be between 0 and 1 (inclusive)';
    }
    if (totalWeight > 1.01) {
      return 'Total category weights exceed 1.0';
    }
    return '';
  }, [totalWeight]);

  // Handle category name change with validation
  const handleCategoryNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const error = validateCategoryName(value);
    setErrors(prev => ({ ...prev, category_name: error }));
    onCategoryNameChange(categoryIndex, value);
  }, [categoryIndex, onCategoryNameChange, validateCategoryName]);

  // Handle weight change with validation
  const handleWeightChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value) || 0;
    const error = validateWeight(value);
    setErrors(prev => ({ ...prev, weight: error }));
    onCategoryWeightChange(categoryIndex, value);
  }, [categoryIndex, onCategoryWeightChange, validateWeight]);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden shadow-sm transition-all hover:shadow-md">
      {/* Category header */}
      <div className="p-4 border-b border-gray-200 relative" style={{ backgroundColor: 'rgba(0, 174, 239, 0.6)' }}>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mb-4">
          <div className="md:col-span-6">
            <FormField
              name={`category_name_${categoryIndex}`}
              type="text"
              label="Category Name"
              value={category.category_name}
              onChange={handleCategoryNameChange}
              error={errors.category_name}
              required
              placeholder="Enter category name"
              helpText="Category name will be displayed as section header in the form"
            />
          </div>
          <div className="md:col-span-2">
            <FormField
              name={`category_weight_${categoryIndex}`}
              type="number"
              label="Weight (0-1)"
              value={category.weight.toString()}
              onChange={handleWeightChange}
              error={errors.weight}
              required
              placeholder="e.g., 0.25"
              min="0"
              max="1"
              step="0.05"
              helpText="Weight must sum to 1.0 across all categories. Individual categories can be 0."
            />
          </div>
          <div className="md:col-span-4 flex items-end space-x-1 justify-end mb-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onMoveCategoryUp(categoryIndex)}
              disabled={categoryIndex === 0}
              aria-label="Move category up"
              className={categoryIndex === 0 ? 'opacity-50 cursor-not-allowed' : ''}
            >
              <HiChevronUp className="h-5 w-5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onMoveCategoryDown(categoryIndex)}
              disabled={categoryIndex === totalCategories - 1}
              aria-label="Move category down"
              className={categoryIndex === totalCategories - 1 ? 'opacity-50 cursor-not-allowed' : ''}
            >
              <HiChevronDown className="h-5 w-5" />
            </Button>
          </div>
        </div>
        {/* Delete category button */}
        <div className="text-right">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => onRemoveCategory(categoryIndex)}
            aria-label={`Delete category: ${category.category_name || 'Unnamed category'}`}
          >
            Delete Category
          </Button>
        </div>
      </div>
      
      {/* Questions section */}
      <div className="p-5 bg-white">
        {category.questions.length === 0 ? (
          <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg bg-gray-50">
            <Button
              onClick={() => onAddQuestion(categoryIndex)}
              variant="primary"
              size="sm"
              aria-label={`Add first question to ${category.category_name || 'this category'}`}
            >
              Add First Question
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            {category.questions.map((question, questionIndex) => (
              <QuestionBuilder
                key={questionIndex}
                question={question}
                questionIndex={questionIndex}
                categoryIndex={categoryIndex}
                category={category}
                totalQuestions={category.questions.length}
                onQuestionChange={onQuestionChange}
                onRemoveQuestion={onRemoveQuestion}
                onMoveQuestionUp={onMoveQuestionUp}
                onMoveQuestionDown={onMoveQuestionDown}
                onAddRadioOption={onAddRadioOption}
                onUpdateRadioOption={onUpdateRadioOption}
                onRemoveRadioOption={onRemoveRadioOption}
                onAddCondition={onAddCondition}
                onUpdateCondition={onUpdateCondition}
                onRemoveCondition={onRemoveCondition}
                onAddConditionGroup={onAddConditionGroup}
              />
            ))}
            
            {/* Add Question button */}
            <div className="text-center mt-6">
              <Button
                onClick={() => onAddQuestion(categoryIndex)}
                variant="primary"
                size="sm"
                aria-label={`Add another question to ${category.category_name || 'this category'}`}
              >
                Add Another Question
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

CategoryBuilder.displayName = 'CategoryBuilder';

/**
 * Memoized Question Component for performance optimization
 */
const QuestionBuilder = React.memo<{
  question: FormQuestion;
  questionIndex: number;
  categoryIndex: number;
  category: FormCategory;
  totalQuestions: number;
  onQuestionChange: (categoryIndex: number, questionIndex: number, question: FormQuestion) => void;
  onRemoveQuestion: (categoryIndex: number, questionIndex: number) => void;
  onMoveQuestionUp: (categoryIndex: number, questionIndex: number) => void;
  onMoveQuestionDown: (categoryIndex: number, questionIndex: number) => void;
  onAddRadioOption: (categoryIndex: number, questionIndex: number) => void;
  onUpdateRadioOption: (categoryIndex: number, questionIndex: number, optionIndex: number, option: RadioOption) => void;
  onRemoveRadioOption: (categoryIndex: number, questionIndex: number, optionIndex: number) => void;
  onAddCondition: (categoryIndex: number, questionIndex: number) => void;
  onUpdateCondition: (categoryIndex: number, questionIndex: number, conditionIndex: number, updates: Partial<FormQuestionCondition>) => void;
  onRemoveCondition: (categoryIndex: number, questionIndex: number, conditionIndex: number) => void;
  onAddConditionGroup: (categoryIndex: number, questionIndex: number) => void;
}>(({ 
  question, 
  questionIndex, 
  categoryIndex, 
  category,
  totalQuestions,
  onQuestionChange,
  onRemoveQuestion,
  onMoveQuestionUp,
  onMoveQuestionDown,
  onAddRadioOption,
  onUpdateRadioOption,
  onRemoveRadioOption,
  onAddCondition,
  onUpdateCondition,
  onRemoveCondition,
  onAddConditionGroup
}) => {
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Question validation
  const validateQuestionText = useCallback((text: string): string => {
    if (!text || text.trim().length < 3) {
      return 'Question text must be at least 3 characters long';
    }
    if (text.length > 255) {
      return 'Question text must be less than 255 characters';
    }
    return '';
  }, []);

  // Question type options
  const questionTypeOptions = useMemo(() => [
    { value: 'YES_NO', label: 'Yes/No' },
    { value: 'TEXT', label: 'Text Input' },
    { value: 'RADIO', label: 'Radio Options' },
    { value: 'SUB_CATEGORY', label: 'Sub-Category' }
  ], []);

  // Handle question text change
  const handleQuestionTextChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const error = validateQuestionText(value);
    setErrors(prev => ({ ...prev, question_text: error }));
    onQuestionChange(categoryIndex, questionIndex, { ...question, question_text: value });
  }, [categoryIndex, questionIndex, question, onQuestionChange, validateQuestionText]);

  // Handle question type change
  const handleQuestionTypeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as any;
    onQuestionChange(categoryIndex, questionIndex, { ...question, question_type: value });
  }, [categoryIndex, questionIndex, question, onQuestionChange]);

  return (
    <div className={`border border-gray-200 rounded-md p-4 shadow-sm hover:shadow transition-all ${question.question_type === 'SUB_CATEGORY' ? 'bg-gray-100' : 'bg-white'}`}>
      {/* Question section */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mb-3">
        {/* Question text */}
        <div className="md:col-span-5">
          <FormField
            name={`question_text_${categoryIndex}_${questionIndex}`}
            type="text"
            label="Question Text"
            value={question.question_text}
            onChange={handleQuestionTextChange}
            error={errors.question_text}
            required
            placeholder="Enter question text"
          />
        </div>
        
        {/* Question type */}
        <div className="md:col-span-2">
          <FormField
            name={`question_type_${categoryIndex}_${questionIndex}`}
            type="select"
            label="Type"
            value={question.question_type}
            onChange={handleQuestionTypeChange}
            options={questionTypeOptions}
            required
          />
        </div>

        {/* YES/NO specific options */}
        {question.question_type === 'YES_NO' && (
          <>
            <div className="md:col-span-1">
              <FormField
                name={`yes_value_${categoryIndex}_${questionIndex}`}
                type="number"
                label="Yes Value"
                value={(question.yes_value ?? 1).toString()}
                onChange={(e) => onQuestionChange(categoryIndex, questionIndex, { 
                  ...question, 
                  yes_value: e.target.value === '' ? 1 : parseInt(e.target.value)
                })}
              />
            </div>
            <div className="md:col-span-1">
              <FormField
                name={`no_value_${categoryIndex}_${questionIndex}`}
                type="number"
                label="No Value"
                value={(question.no_value ?? 0).toString()}
                onChange={(e) => onQuestionChange(categoryIndex, questionIndex, { 
                  ...question, 
                  no_value: e.target.value === '' ? 0 : parseInt(e.target.value)
                })}
              />
            </div>
          </>
        )}
        
        {/* Action buttons for question */}
        <div className="md:col-span-3 flex items-end space-x-1 justify-end mb-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onMoveQuestionUp(categoryIndex, questionIndex)}
            disabled={questionIndex === 0}
            aria-label="Move question up"
          >
            <HiChevronUp className="h-5 w-5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onMoveQuestionDown(categoryIndex, questionIndex)}
            disabled={questionIndex === totalQuestions - 1}
            aria-label="Move question down"
          >
            <HiChevronDown className="h-5 w-5" />
          </Button>
        </div>
      </div>
      
      {/* Options section */}
      <div className="flex flex-wrap justify-between gap-4 mb-3 bg-gray-50 p-3 rounded-md border border-gray-100">
        {(question.question_type === 'YES_NO' || question.question_type === 'SCALE' || question.question_type === 'RADIO' || question.question_type === 'SUB_CATEGORY') && (
          <FormField
            name={`isConditional-${categoryIndex}-${questionIndex}`}
            type="checkbox"
            label="Use conditional logic"
            value={question.is_conditional || false}
            onChange={(e) => onQuestionChange(categoryIndex, questionIndex, { 
              ...question, 
              is_conditional: e.target.checked 
            })}
            size="sm"
            className="flex items-center"
          />
        )}
        
        {/* N/A option for YES_NO questions */}
        {question.question_type === 'YES_NO' && (
          <FormField
            name={`isNaAllowed-${categoryIndex}-${questionIndex}`}
            type="checkbox"
            label='Allow "Not Applicable" option'
            value={question.is_na_allowed || false}
            onChange={(e) => onQuestionChange(categoryIndex, questionIndex, { 
              ...question, 
              is_na_allowed: e.target.checked 
            })}
            size="sm"
            className="flex items-center"
          />
        )}
        
        {/* Visible to CSR checkbox - applies to all question types */}
        <FormField
          name={`visibleToCSR-${categoryIndex}-${questionIndex}`}
          type="checkbox"
          label="Visible to CSR"
          value={question.visible_to_csr === false ? false : true}
          onChange={(e) => onQuestionChange(categoryIndex, questionIndex, { 
            ...question, 
            visible_to_csr: e.target.checked 
          })}
          size="sm"
          className="flex items-center"
        />
      </div>
      
      {/* Conditional Logic Section */}
      {question.is_conditional && (
        <ConditionalLogicBuilder
          question={question}
          questionIndex={questionIndex}
          categoryIndex={categoryIndex}
          category={category}
          onAddCondition={onAddCondition}
          onUpdateCondition={onUpdateCondition}
          onRemoveCondition={onRemoveCondition}
          onAddConditionGroup={onAddConditionGroup}
        />
      )}
      
      {/* Radio options section */}
      {question.question_type === 'RADIO' && (
        <RadioOptionsBuilder
          question={question}
          questionIndex={questionIndex}
          categoryIndex={categoryIndex}
          onAddRadioOption={onAddRadioOption}
          onUpdateRadioOption={onUpdateRadioOption}
          onRemoveRadioOption={onRemoveRadioOption}
        />
      )}
      
      {/* Delete question button */}
      <div className="mb-3 text-right">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => onRemoveQuestion(categoryIndex, questionIndex)}
          aria-label={`Delete question: ${question.question_text || 'Unnamed question'}`}
        >
          Delete Question
        </Button>
      </div>
    </div>
  );
});

QuestionBuilder.displayName = 'QuestionBuilder';

/**
 * Memoized Conditional Logic Component for performance optimization
 */
const ConditionalLogicBuilder = React.memo<{
  question: FormQuestion;
  questionIndex: number;
  categoryIndex: number;
  category: FormCategory;
  onAddCondition: (categoryIndex: number, questionIndex: number) => void;
  onUpdateCondition: (categoryIndex: number, questionIndex: number, conditionIndex: number, updates: Partial<FormQuestionCondition>) => void;
  onRemoveCondition: (categoryIndex: number, questionIndex: number, conditionIndex: number) => void;
  onAddConditionGroup: (categoryIndex: number, questionIndex: number) => void;
}>(({ 
  question, 
  questionIndex, 
  categoryIndex, 
  category,
  onAddCondition,
  onUpdateCondition,
  onRemoveCondition,
  onAddConditionGroup
}) => {
  // Helper function to get stable condition index using a more reliable method
  const getConditionIndex = useCallback((condition: FormQuestionCondition): number => {
    if (!question.conditions) return 0;
    
    // Use a combination of properties to identify the condition uniquely
    const index = question.conditions.findIndex(c => 
      c.target_question_id === condition.target_question_id &&
      c.condition_type === condition.condition_type &&
      c.target_value === condition.target_value &&
      c.group_id === condition.group_id &&
      c.sort_order === condition.sort_order
    );
    
    console.log(`🔍 CONDITION INDEX DEBUG: Looking for condition:`, {
      target_question_id: condition.target_question_id,
      condition_type: condition.condition_type,
      target_value: condition.target_value,
      group_id: condition.group_id,
      sort_order: condition.sort_order,
      logical_operator: condition.logical_operator
    });
    
    console.log(`🔍 CONDITION INDEX DEBUG: Found at index ${index} in conditions:`, question.conditions.map((c, i) => ({
      index: i,
      target_question_id: c.target_question_id,
      group_id: c.group_id,
      sort_order: c.sort_order,
      logical_operator: c.logical_operator,
      id: c.id
    })));
    
    console.log(`🔍 CONDITION INDEX DEBUG: The condition at index ${index} has logical_operator: ${question.conditions[index]?.logical_operator}`);
    
    return index >= 0 ? index : 0;
  }, [question.conditions]);

  // Helper function to find target question by ID
  const findTargetQuestion = useCallback((targetId: number) => {
    // First try to find by exact ID match
    let targetQuestion = category.questions.find(q => q.id === targetId);
    
    // If not found, try the generated ID pattern
    if (!targetQuestion) {
      for (let idx = 0; idx < questionIndex; idx++) {
        const generatedId = -(categoryIndex * 1000 + idx + 1);
        if (targetId === generatedId) {
          targetQuestion = category.questions[idx];
          break;
        }
      }
    }
    
    return targetQuestion;
  }, [category.questions, questionIndex, categoryIndex]);

  return (
    <div className="bg-blue-50 p-4 rounded-md mt-0 mb-4 border border-blue-100">
      <div className="flex justify-between items-center mb-3">
        <h4 className="text-sm font-medium text-blue-800 flex items-center">
          <HiInformationCircle className="h-4 w-4 mr-1.5" />
          Conditional Logic Settings
        </h4>

        <div className="flex space-x-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => onAddCondition(categoryIndex, questionIndex)}
          >
            Add Condition
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onAddConditionGroup(categoryIndex, questionIndex)}
          >
            Add OR Group
          </Button>
        </div>
      </div>

      {/* Show if there are no conditions yet */}
      {(!question.conditions || question.conditions.length === 0) && (
        <div className="bg-white p-3 rounded border border-blue-200 text-sm text-gray-500 text-center">
          No conditions added yet. Click "Add Condition" to create a rule.
        </div>
      )}

      {/* Show if we have conditions */}
      {question.conditions && question.conditions.length > 0 && (
        <div className="space-y-4">
          {/* Get unique group IDs and sort them */}
          {Array.from(new Set(question.conditions.map(c => c.group_id))).sort((a, b) => a - b).map((groupId) => {
            // Get conditions for this group and sort by sort_order
            const groupConditions = question.conditions?.filter(c => c.group_id === groupId)
              .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)) || [];
            
            // Fix for OR conditions in groups where the first condition has logical_operator: "OR"
            // This handles the case where an OR condition was saved with sort_order: 1
            if (groupConditions.length > 1 && groupConditions[0].logical_operator === "OR") {
              // If the first condition in the group has logical_operator: "OR",
              // it means this group should be treated as an OR group
              groupConditions.forEach((condition, index) => {
                if (index === 1) {
                  // The second condition in an OR group should display "OR"
                  condition.logical_operator = "OR";
                }
              });
            }
            
            console.log(`🔍 GROUP DEBUG: Group ${groupId} conditions:`, groupConditions.map(c => ({
              id: c.id,
              logical_operator: c.logical_operator,
              sort_order: c.sort_order,
              target_value: c.target_value
            })));
            
            return (
              <div key={`group-${groupId}`} className="bg-white p-3 rounded border border-blue-200">
                {groupId > 0 && (
                  <div className="mb-2 pb-2 border-b border-blue-100 text-center">
                    <span className="inline-block px-3 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-full">
                      OR
                    </span>
                  </div>
                )}
                
                {groupConditions.map((condition, condIndex) => {
                  const stableIndex = getConditionIndex(condition);
                  
                  console.log(`🔍 UI RENDERING DEBUG: Rendering condition ${condIndex} in group ${groupId}:`, {
                    stableIndex,
                    target_question_id: condition.target_question_id,
                    group_id: condition.group_id,
                    sort_order: condition.sort_order,
                    logical_operator: condition.logical_operator,
                    id: condition.id
                  });
                  
                  return (
                    <div key={`condition-${stableIndex}-${groupId}`} className={`grid grid-cols-1 md:grid-cols-10 gap-4 items-center ${condIndex > 0 ? 'mt-2 pt-2 border-t border-blue-50' : ''}`}>
                      {/* Logical operator for conditions after the first in a group */}
                      <div className="md:col-span-1 flex justify-center">
                        {condIndex > 0 ? (
                          <FormField
                            name={`logical_operator_${categoryIndex}_${questionIndex}_${stableIndex}`}
                            type="select"
                            label=""
                            value={(() => {
                              const value = condition.logical_operator || 'AND';
                              console.log(`🔍 LOGICAL OPERATOR DEBUG: Condition ${stableIndex} in group ${groupId}: original=${JSON.stringify(condition.logical_operator)}, final=${JSON.stringify(value)}`);
                              console.log(`🔍 LOGICAL OPERATOR DEBUG: This is condition ${condIndex} in group ${groupId}, stableIndex=${stableIndex}`);
                              console.log(`🔍 LOGICAL OPERATOR DEBUG: Condition object:`, {
                                id: condition.id,
                                logical_operator: condition.logical_operator,
                                sort_order: condition.sort_order,
                                target_value: condition.target_value
                              });
                              return value;
                            })()}
                            onChange={(e) => {
                              console.log(`🔍 LOGICAL OPERATOR CHANGE: Condition ${stableIndex} in group ${groupId}: changing to ${e.target.value}`);
                              console.log(`🔍 LOGICAL OPERATOR CHANGE: This is condition ${condIndex} in group ${groupId}, stableIndex=${stableIndex}`);
                              console.log(`🔍 LOGICAL OPERATOR CHANGE: Condition object:`, {
                                id: condition.id,
                                logical_operator: condition.logical_operator,
                                sort_order: condition.sort_order,
                                target_value: condition.target_value
                              });
                              onUpdateCondition(
                                categoryIndex,
                                questionIndex,
                                stableIndex,
                                { logical_operator: e.target.value as 'AND' | 'OR' }
                              );
                            }}
                            options={[
                              { value: 'AND', label: 'AND' },
                              { value: 'OR', label: 'OR' }
                            ]}
                            className="text-xs"
                          />
                        ) : (
                          <div className="text-xs text-gray-400 text-center">-</div>
                        )}
                      </div>
                      
                      {/* Target Question */}
                      <div className="md:col-span-3">
                        <FormField
                          name={`target_question_${categoryIndex}_${questionIndex}_${stableIndex}`}
                          type="select"
                          label=""
                          value={condition.target_question_id?.toString() || ''}
                          onChange={(e) => onUpdateCondition(
                            categoryIndex,
                            questionIndex,
                            stableIndex,
                            { target_question_id: parseInt(e.target.value) }
                          )}
                          options={[
                            { value: '', label: '-- Select Question --' },
                            ...category.questions.slice(0, questionIndex).map((q, idx) => {
                              const generatedId = q.id || -(categoryIndex * 1000 + idx + 1);
                              return {
                                value: generatedId.toString(),
                                label: q.question_text.length > 25 
                                  ? `${q.question_text.substring(0, 25)}...` 
                                  : q.question_text
                              };
                            })
                          ]}
                        />
                      </div>
                      
                      {/* Condition Type */}
                      <div className="md:col-span-2">
                        <FormField
                          name={`condition_type_${categoryIndex}_${questionIndex}_${stableIndex}`}
                          type="select"
                          label=""
                          value={condition.condition_type || 'EQUALS'}
                          onChange={(e) => onUpdateCondition(
                            categoryIndex,
                            questionIndex,
                            stableIndex,
                            { condition_type: e.target.value as any }
                          )}
                          options={[
                            { value: 'EQUALS', label: 'Equals' },
                            { value: 'NOT_EQUALS', label: 'Not Equals' },
                            { value: 'EXISTS', label: 'Exists' },
                            { value: 'NOT_EXISTS', label: 'Not Exists' }
                          ]}
                        />
                      </div>
                      
                      {/* Condition Value */}
                      <div className="md:col-span-3">
                        {condition.condition_type !== 'EXISTS' && condition.condition_type !== 'NOT_EXISTS' && (
                          <FormField
                            name={`condition_value_${categoryIndex}_${questionIndex}_${stableIndex}`}
                            type="select"
                            label=""
                            value={condition.target_value || ''}
                            onChange={(e) => onUpdateCondition(
                              categoryIndex,
                              questionIndex,
                              stableIndex,
                              { target_value: e.target.value }
                            )}
                            options={[
                              { value: '', label: '-- Select Value --' },
                              // Dynamic options based on target question type
                              ...((() => {
                                const targetQuestion = findTargetQuestion(condition.target_question_id);
                                
                                if (targetQuestion?.question_type === 'YES_NO') {
                                  return [
                                    { value: 'YES', label: 'Yes' },
                                    { value: 'NO', label: 'No' }
                                  ];
                                } else if (targetQuestion?.question_type === 'RADIO' && targetQuestion.radio_options) {
                                  return targetQuestion.radio_options.map(opt => ({
                                    value: opt.option_value,
                                    label: opt.option_text
                                  }));
                                }
                                return [];
                              })())
                            ]}
                          />
                        )}
                      </div>
                      
                      {/* Remove condition button */}
                      <div className="md:col-span-1 flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onRemoveCondition(
                            categoryIndex,
                            questionIndex,
                            stableIndex
                          )}
                          aria-label="Remove condition"
                        >
                          <HiX className="h-5 w-5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

ConditionalLogicBuilder.displayName = 'ConditionalLogicBuilder';

/**
 * Memoized Radio Options Component for performance optimization
 */
const RadioOptionsBuilder = React.memo<{
  question: FormQuestion;
  questionIndex: number;
  categoryIndex: number;
  onAddRadioOption: (categoryIndex: number, questionIndex: number) => void;
  onUpdateRadioOption: (categoryIndex: number, questionIndex: number, optionIndex: number, option: RadioOption) => void;
  onRemoveRadioOption: (categoryIndex: number, questionIndex: number, optionIndex: number) => void;
}>(({ 
  question, 
  questionIndex, 
  categoryIndex,
  onAddRadioOption,
  onUpdateRadioOption,
  onRemoveRadioOption
}) => {
  return (
    <div className="mt-3 mb-3 border-t border-gray-200 pt-3">
      <div className="flex justify-between items-center mb-3">
        <h4 className="text-sm font-medium text-gray-700 flex items-center">
          <HiInformationCircle className="h-4 w-4 mr-1.5 text-gray-500" />
          Radio Options
        </h4>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => onAddRadioOption(categoryIndex, questionIndex)}
        >
          <HiPlus className="h-4 w-4 mr-1" />
          Add Option
        </Button>
      </div>
      
      {(!question.radio_options || question.radio_options.length === 0) ? (
        <div className="text-center py-3 border border-dashed border-gray-200 rounded-md bg-gray-50">
          <p className="text-gray-500 text-sm mb-2">No options added yet</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onAddRadioOption(categoryIndex, questionIndex)}
          >
            Add First Option
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {question.radio_options.map((option, optionIndex) => (
            <div key={optionIndex} className="border border-gray-200 rounded-md p-2 bg-gray-50 hover:bg-white transition-colors">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-1">
                <div className="md:col-span-5">
                  <FormField
                    name={`option_text_${categoryIndex}_${questionIndex}_${optionIndex}`}
                    type="text"
                    label="Option Text"
                    value={option.option_text}
                    onChange={(e) => onUpdateRadioOption(
                      categoryIndex,
                      questionIndex,
                      optionIndex,
                      { ...option, option_text: e.target.value }
                    )}
                    placeholder="Display text"
                    className="text-sm"
                  />
                </div>
                <div className="md:col-span-4">
                  <FormField
                    name={`option_value_${categoryIndex}_${questionIndex}_${optionIndex}`}
                    type="text"
                    label="Value"
                    value={option.option_value}
                    onChange={(e) => onUpdateRadioOption(
                      categoryIndex,
                      questionIndex,
                      optionIndex,
                      { ...option, option_value: e.target.value }
                    )}
                    placeholder="Internal value"
                    className="text-sm"
                  />
                </div>
                <div className="md:col-span-2">
                  <FormField
                    name={`option_score_${categoryIndex}_${questionIndex}_${optionIndex}`}
                    type="number"
                    label="Score"
                    value={option.score.toString()}
                    onChange={(e) => onUpdateRadioOption(
                      categoryIndex,
                      questionIndex,
                      optionIndex,
                      { ...option, score: e.target.value === '' ? 0 : parseInt(e.target.value) }
                    )}
                    placeholder="Score"
                    className="text-sm"
                  />
                </div>
                <div className="md:col-span-1 flex items-end justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemoveRadioOption(categoryIndex, questionIndex, optionIndex)}
                    aria-label="Remove option"
                                      >
                     <HiX className="h-4 w-4" />
                    </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

RadioOptionsBuilder.displayName = 'RadioOptionsBuilder';

/**
 * Performance Monitor Component for Development
 */
const PerformanceMonitor: React.FC<{ 
  saveCount: number; 
  lastSaveTime: number; 
  loadCount: number;
  lastLoadTime: number;
}> = React.memo(({ saveCount, lastSaveTime, loadCount, lastLoadTime }) => {
  if (process.env.NODE_ENV !== 'development') return null;
  
  return (
    <div className="fixed bottom-4 right-4 bg-blue-100 border border-blue-300 rounded-lg p-3 text-xs font-mono shadow-lg z-50">
      <div className="font-semibold text-blue-800 mb-1">Form Builder Performance</div>
      <div className="space-y-1 text-blue-700">
        <div>Saves: {saveCount} ({lastSaveTime.toFixed(2)}ms)</div>
        <div>Loads: {loadCount} ({lastLoadTime.toFixed(2)}ms)</div>
        <div>Categories: {document.querySelectorAll('[data-category]').length}</div>
        <div>Questions: {document.querySelectorAll('[data-question]').length}</div>
      </div>
    </div>
  );
});

PerformanceMonitor.displayName = 'PerformanceMonitor';

const SinglePageFormBuilder: React.FC = () => {
  const navigate = useNavigate();
  const { formId } = useParams<{ formId: string }>();
  const location = useLocation();
  
  const [form, setForm] = useState<Form>({
    form_name: '',
    interaction_type: 'CALL',
    is_active: true,
    version: 1,
    categories: [],
    metadata_fields: [],
    user_version: 0,
    user_version_date: ''
  });
  
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isWeightModalOpen, setIsWeightModalOpen] = useState(false);
  const [tempWeights, setTempWeights] = useState<number[]>([]);
  
  // Effect to populate tempWeights when modal opens
  useEffect(() => {
    if (isWeightModalOpen && form.categories.length > 0) {
      const currentWeights = form.categories.map(cat => Number(cat.weight) || 0);
      console.log('🔍 useEffect: Setting tempWeights to:', currentWeights);
      setTempWeights(currentWeights);
    }
  }, [isWeightModalOpen, form.categories]);
  
  // Performance tracking
  const performanceRef = useRef<PerformanceTracker>({
    lastSaveTime: 0,
    saveCount: 0,
    lastLoadTime: 0,
    loadCount: 0
  });
  
  // Focus management for accessibility
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  
  // Memoized total weight calculation for performance
  const totalWeight = useMemo((): number => {
    return form.categories.reduce((sum, cat) => sum + (Number(cat.weight) || 0), 0);
  }, [form.categories]);
  
  // Memoized weight validation
  const weightSumValid = useMemo((): boolean => {
    return totalWeight > 0.99 && totalWeight < 1.01;
  }, [totalWeight]);
  
  // Optimized form validation with useCallback
  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {};
    
    // Form name validation
    if (!form.form_name || form.form_name.trim().length < 3) {
      newErrors.form_name = 'Form name must be at least 3 characters long';
    }
    
    // User version validation
    if (form.user_version === undefined || form.user_version === null || form.user_version <= 0) {
      newErrors.user_version = 'User version is required and must be greater than 0';
    }
    
    // User version date validation
    if (!form.user_version_date || form.user_version_date.trim() === '') {
      newErrors.user_version_date = 'User version date is required';
    }
    
    // Categories validation
    if (form.categories.length === 0) {
      newErrors.categories = 'At least one category is required';
    }
    
    // Category weight validation
    if (!weightSumValid && form.categories.length > 0) {
      newErrors.categories = 'Category weights must sum to 1.0';
    }
    
    // Questions validation
    const hasQuestions = form.categories.some(cat => cat.questions.length > 0);
    if (!hasQuestions) {
      newErrors.questions = 'At least one question is required';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [form.form_name, form.categories, form.user_version, form.user_version_date, weightSumValid]);
  
  // Load existing form when editing or duplicating
  useEffect(() => {
    // Check for duplicate parameter in URL
    const searchParams = new URLSearchParams(location.search);
    const duplicateFormId = searchParams.get('duplicate');
    
    // Check if we have form data from preview
    const previewFormData = location.state?.formData;
    if (previewFormData) {
      // Normalize preview form data - ensure is_conditional is set for questions with conditions
      // and restore proper question IDs for conditional logic
      const normalizedPreviewData = {
        ...previewFormData,
        categories: previewFormData.categories.map((category, categoryIndex) => ({
          ...category,
          questions: category.questions.map((question, questionIndex) => {
            // Ensure question has a proper ID for conditional logic
            const questionId = question.id || -(categoryIndex * 1000 + questionIndex + 1);
            
            return {
              ...question,
              id: questionId,
              // Set is_conditional to true if the question has conditions
              is_conditional: question.conditions && question.conditions.length > 0 ? true : (question.is_conditional || false)
            };
          })
        }))
      };
      
      setForm(normalizedPreviewData);
      return;
    }
    
    if (duplicateFormId) {
      // Load the form to duplicate
      duplicateExistingForm(parseInt(duplicateFormId));
    } else if (formId) {
      // Load existing form for editing
      loadForm(parseInt(formId));
    }
  }, [formId, location.search, location.state]);
  

  
  // Optimized load form function with performance tracking
  const loadForm = useCallback(async (id: number) => {
    const startTime = performance.now();
    try {
      setIsLoading(true);
      setErrors({});
      
      const formData = await getFormById(id, true); // Include inactive forms for editing
      
      // Debug: Log the logical operators from the database
      formData.categories.forEach((category, catIndex) => {
        category.questions.forEach((question, qIndex) => {
          if (question.conditions && question.conditions.length > 0) {
            console.log(`🔍 LOADING DEBUG: Question ${qIndex} conditions:`, question.conditions.map(c => ({
              id: c.id,
              logical_operator: c.logical_operator,
              group_id: c.group_id,
              sort_order: c.sort_order
            })));
          }
        });
      });
      
      // Normalize form data - ensure is_conditional is set for questions with conditions
      const normalizedFormData = {
        ...formData,
        // Ensure user_version fields have default values if not present
        user_version: formData.user_version || 0,
        user_version_date: formData.user_version_date ? 
          formData.user_version_date.split('T')[0] : '',
        // Normalize metadata fields - convert is_required integers to booleans
        metadata_fields: formData.metadata_fields?.map(field => ({
          ...field,
          is_required: Boolean(field.is_required) // Convert 0/1 to false/true
        })) || [],
        categories: formData.categories.map(category => ({
          ...category,
          questions: category.questions.map(question => {
            
            return {
              ...question,
              // Set is_conditional to true if the question has conditions
              is_conditional: question.conditions && question.conditions.length > 0 ? true : (question.is_conditional || false),
              // Normalize visible_to_csr: convert 0/1 to boolean, default to true
              visible_to_csr: (() => {
                const value = (question as any).visible_to_csr;
                if (typeof value === 'number') {
                  return value !== 0;
                }
                if (typeof value === 'string') {
                  return value !== '0' && value !== 'false';
                }
                return value !== false;
              })()
            };
          })
        }))
      };
      
      setForm(normalizedFormData);
      
      // Update performance tracking
      const endTime = performance.now();
      performanceRef.current.lastLoadTime = endTime - startTime;
      performanceRef.current.loadCount += 1;
      
    } catch (error: any) {
      console.error('Error loading form:', error);
      
      // Display more specific error message
      let errorMessage = 'Failed to load form data';
      if (error.message) {
        errorMessage = error.message;
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      }
      
      setErrors({ form: errorMessage });
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  // New function to handle form duplication with performance tracking
  const duplicateExistingForm = useCallback(async (id: number) => {
    const startTime = performance.now();
    try {
      setIsLoading(true);
      setErrors({});
      
      const formData = await getFormById(id, true); // Include inactive forms for duplication
      
      // Create a new form based on the existing one
      const duplicatedForm = {
        ...formData,
        id: undefined, // Remove the ID to create a new form
        form_name: `Copy of ${formData.form_name}`, // Modify the name
        // Reset user_version fields for the new form
        user_version: 0,
        user_version_date: '',
        // Explicitly handle metadata fields
        metadata_fields: formData.metadata_fields?.map(field => ({
          ...field,
          id: undefined,
          form_id: undefined,
          is_required: Boolean(field.is_required) // Convert 0/1 to false/true
        })) || [],
        // Normalize categories and questions - ensure is_conditional is set
        categories: formData.categories.map(category => ({
          ...category,
          questions: category.questions.map(question => {
            
            return {
              ...question,
              // Set is_conditional to true if the question has conditions
              is_conditional: question.conditions && question.conditions.length > 0 ? true : (question.is_conditional || false),
              // Normalize visible_to_csr: convert 0/1 to boolean, default to true
              visible_to_csr: (() => {
                const value = (question as any).visible_to_csr;
                if (typeof value === 'number') {
                  return value !== 0;
                }
                if (typeof value === 'string') {
                  return value !== '0' && value !== 'false';
                }
                return value !== false;
              })()
            };
          })
        }))
      };
      
      setForm(duplicatedForm);
      
      // Update performance tracking
      const endTime = performance.now();
      performanceRef.current.lastLoadTime = endTime - startTime;
      performanceRef.current.loadCount += 1;
      
    } catch (error) {
      console.error('Error loading form to duplicate:', error);
      setErrors({ form: 'Failed to load form data for duplication' });
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  // Form name and active state handlers with useCallback
  const handleFormNameChange = useCallback((value: string) => {
    setForm(prev => ({ ...prev, form_name: value }));
    setErrors(prev => ({ ...prev, form_name: undefined }));
  }, []);
  
  const handleIsActiveChange = useCallback((value: boolean) => {
    setForm(prev => ({ ...prev, is_active: value }));
  }, []);
  
  const handleInteractionTypeChange = useCallback((value: InteractionType) => {
    setForm(prev => ({ ...prev, interaction_type: value }));
  }, []);
  
  // Add handler for metadata fields with useCallback
  const handleMetadataFieldsChange = useCallback((fields: FormMetadataField[]) => {
    setForm(prev => ({ ...prev, metadata_fields: fields }));
  }, []);
  
  // Category handlers with useCallback optimization
  const handleAddCategory = useCallback(() => {
    setForm(prev => {
      const newCategory: FormCategory = {
        id: -(prev.categories.length + 1), // Generate unique negative ID
        category_name: '',
        weight: 0,
        questions: []
      };
      
      return {
        ...prev,
        categories: [...prev.categories, newCategory]
      };
    });
  }, []);
  
  const handleCategoryNameChange = useCallback((index: number, name: string) => {
    setForm(prev => {
      const updatedCategories = [...prev.categories];
      updatedCategories[index] = { ...updatedCategories[index], category_name: name };
      return { ...prev, categories: updatedCategories };
    });
    setErrors(prev => ({ ...prev, categories: undefined }));
  }, []);
  
  const handleCategoryWeightChange = useCallback((index: number, weight: number) => {
    setForm(prev => {
      const updatedCategories = [...prev.categories];
      updatedCategories[index] = { ...updatedCategories[index], weight };
      return { ...prev, categories: updatedCategories };
    });
  }, []);
  
  const handleRemoveCategory = useCallback((index: number) => {
    setForm(prev => {
      const updatedCategories = prev.categories.filter((_, i) => i !== index);
      return { ...prev, categories: updatedCategories };
    });
  }, []);
  
  // New handlers for moving categories up and down with useCallback
  const handleMoveCategoryUp = useCallback((index: number) => {
    if (index === 0) return; // Can't move the first item up
    
    setForm(prev => {
      const updatedCategories = [...prev.categories];
      // Swap with the category above
      [updatedCategories[index], updatedCategories[index - 1]] = 
      [updatedCategories[index - 1], updatedCategories[index]];
      return { ...prev, categories: updatedCategories };
    });
  }, []);
  
  const handleMoveCategoryDown = useCallback((index: number) => {
    if (index === form.categories.length - 1) return; // Can't move the last item down
    
    setForm(prev => {
      const updatedCategories = [...prev.categories];
      // Swap with the category below
      [updatedCategories[index], updatedCategories[index + 1]] = 
      [updatedCategories[index + 1], updatedCategories[index]];
      return { ...prev, categories: updatedCategories };
    });
  }, [form.categories.length]);
  
  // Question handlers with useCallback optimization
  const handleAddQuestion = useCallback((categoryIndex: number) => {
    setForm(prev => {
      const currentCategory = prev.categories[categoryIndex];
      if (!currentCategory) {
        console.error(`Category at index ${categoryIndex} not found`);
        return prev;
      }
      
      const newQuestion: FormQuestion = {
        id: -(categoryIndex * 1000 + currentCategory.questions.length + 1), // Generate unique negative ID
        question_text: '',
        question_type: 'YES_NO',
        weight: 1, // Default weight is 1 for all questions (not used for scoring)
        is_na_allowed: false,
        yes_value: 1,
        no_value: 0,
        is_conditional: false,
        // Set default values for scale questions
        scale_min: 1,
        scale_max: 5,
        radio_options: [],
        // Initialize conditions array
        conditions: []
      };
      
      const updatedCategories = [...prev.categories];
      updatedCategories[categoryIndex] = {
        ...updatedCategories[categoryIndex],
        questions: [...updatedCategories[categoryIndex].questions, newQuestion]
      };
      return { ...prev, categories: updatedCategories };
    });
  }, []);
  
  const handleQuestionChange = useCallback((categoryIndex: number, questionIndex: number, question: FormQuestion) => {
    // If switching to a SCALE question type, ensure it has default min/max values
    if (question.question_type === 'SCALE') {
      if (question.scale_min === undefined) question.scale_min = 1;
      if (question.scale_max === undefined) question.scale_max = 5;
    }
    
    // If is_conditional is being set to false, clear the conditions array
    if (question.is_conditional === false) {
      question.conditions = [];
    }
    
    setForm(prev => {
      const updatedCategories = [...prev.categories];
      const updatedQuestions = [...updatedCategories[categoryIndex].questions];
      updatedQuestions[questionIndex] = question;
      updatedCategories[categoryIndex] = {
        ...updatedCategories[categoryIndex],
        questions: updatedQuestions
      };
      return { ...prev, categories: updatedCategories };
    });
    setErrors(prev => ({ ...prev, questions: undefined }));
  }, []);
  
  const handleRemoveQuestion = useCallback((categoryIndex: number, questionIndex: number) => {
    setForm(prev => {
      const updatedCategories = [...prev.categories];
      const updatedQuestions = updatedCategories[categoryIndex].questions.filter((_, i) => i !== questionIndex);
      updatedCategories[categoryIndex] = {
        ...updatedCategories[categoryIndex],
        questions: updatedQuestions
      };
      return { ...prev, categories: updatedCategories };
    });
  }, []);
  
  // New handlers for moving questions up and down with useCallback
  const handleMoveQuestionUp = useCallback((categoryIndex: number, questionIndex: number) => {
    if (questionIndex === 0) return; // Can't move the first item up
    
    setForm(prev => {
      const updatedCategories = [...prev.categories];
      const updatedQuestions = [...updatedCategories[categoryIndex].questions];
      // Swap with the question above
      [updatedQuestions[questionIndex], updatedQuestions[questionIndex - 1]] = 
      [updatedQuestions[questionIndex - 1], updatedQuestions[questionIndex]];
      updatedCategories[categoryIndex] = {
        ...updatedCategories[categoryIndex],
        questions: updatedQuestions
      };
      return { ...prev, categories: updatedCategories };
    });
  }, []);
  
  const handleMoveQuestionDown = useCallback((categoryIndex: number, questionIndex: number) => {
    if (questionIndex === form.categories[categoryIndex].questions.length - 1) return; // Can't move the last item down
    
    setForm(prev => {
      const updatedCategories = [...prev.categories];
      const updatedQuestions = [...updatedCategories[categoryIndex].questions];
      // Swap with the question below
      [updatedQuestions[questionIndex], updatedQuestions[questionIndex + 1]] = 
      [updatedQuestions[questionIndex + 1], updatedQuestions[questionIndex]];
      updatedCategories[categoryIndex] = {
        ...updatedCategories[categoryIndex],
        questions: updatedQuestions
      };
      return { ...prev, categories: updatedCategories };
    });
  }, [form.categories]);
  
  // Radio option handlers with useCallback optimization
  const handleAddRadioOption = useCallback((categoryIndex: number, questionIndex: number) => {
    setForm(prev => {
      const updatedCategories = [...prev.categories];
      const question = updatedCategories[categoryIndex].questions[questionIndex];
      
      // Create new radio option
      const newOption: RadioOption = {
        option_text: '',
        option_value: '',
        score: 0,
        has_free_text: false
      };
      
      // Add to existing options or create new array
      const updatedOptions = question.radio_options ? [...question.radio_options, newOption] : [newOption];
      
      // Update the question with new options array
      const updatedQuestions = [...updatedCategories[categoryIndex].questions];
      updatedQuestions[questionIndex] = {
        ...question,
        radio_options: updatedOptions
      };
      
      updatedCategories[categoryIndex] = {
        ...updatedCategories[categoryIndex],
        questions: updatedQuestions
      };
      
      return { ...prev, categories: updatedCategories };
    });
  }, []);
  
  const handleUpdateRadioOption = useCallback((
    categoryIndex: number, 
    questionIndex: number, 
    optionIndex: number, 
    updatedOption: RadioOption
  ) => {
    setForm(prev => {
      const updatedCategories = [...prev.categories];
      const question = updatedCategories[categoryIndex].questions[questionIndex];
      
      if (question.radio_options) {
        const updatedOptions = [...question.radio_options];
        updatedOptions[optionIndex] = updatedOption;
        
        const updatedQuestions = [...updatedCategories[categoryIndex].questions];
        updatedQuestions[questionIndex] = {
          ...question,
          radio_options: updatedOptions
        };
        
        updatedCategories[categoryIndex] = {
          ...updatedCategories[categoryIndex],
          questions: updatedQuestions
        };
      }
      
      return { ...prev, categories: updatedCategories };
    });
  }, []);
  
  const handleRemoveRadioOption = useCallback((categoryIndex: number, questionIndex: number, optionIndex: number) => {
    setForm(prev => {
      const updatedCategories = [...prev.categories];
      const question = updatedCategories[categoryIndex].questions[questionIndex];
      
      if (question.radio_options) {
        const updatedOptions = question.radio_options.filter((_, idx) => idx !== optionIndex);
        
        const updatedQuestions = [...updatedCategories[categoryIndex].questions];
        updatedQuestions[questionIndex] = {
          ...question,
          radio_options: updatedOptions
        };
        
        updatedCategories[categoryIndex] = {
          ...updatedCategories[categoryIndex],
          questions: updatedQuestions
        };
      }
      
      return { ...prev, categories: updatedCategories };
    });
  }, []);
  
  // Conditional logic handlers with useCallback optimization
  const handleAddCondition = useCallback((categoryIndex: number, questionIndex: number) => {
    setForm(prev => {
      const updatedCategories = [...prev.categories];
      const question = updatedCategories[categoryIndex].questions[questionIndex];
      
      // Initialize conditions array if it doesn't exist
      if (!question.conditions) {
        question.conditions = [];
      }

      // Determine the next group ID to use or use the default group 0
      const groupId = question.conditions.length > 0 
        ? (question.conditions[question.conditions.length - 1].group_id || 0)
        : 0;
        
      // Find current highest sort order in this group
      const highestSortOrder = question.conditions
        .filter(c => c.group_id === groupId)
        .reduce((max, c) => Math.max(max, c.sort_order || 0), -1);
      
      // Create a new condition with safe defaults
      const newCondition: FormQuestionCondition = {
        question_id: question.id,
        target_question_id: 0, // Will be selected by user
        condition_type: 'EQUALS',
        target_value: '',
        logical_operator: 'AND', // Default logical operator
        group_id: groupId,
        sort_order: highestSortOrder + 1
      };
      
      // Update the question with the new condition
      const updatedQuestions = [...updatedCategories[categoryIndex].questions];
      updatedQuestions[questionIndex] = {
        ...question,
        is_conditional: true, // Ensure conditional flag is set
        conditions: [...question.conditions, newCondition]
      };
      
      updatedCategories[categoryIndex] = {
        ...updatedCategories[categoryIndex],
        questions: updatedQuestions
      };
      
      return { ...prev, categories: updatedCategories };
    });
  }, []);
  
  const handleUpdateCondition = useCallback((
    categoryIndex: number, 
    questionIndex: number, 
    conditionIndex: number, 
    updates: Partial<FormQuestionCondition>
  ) => {
    setForm(prev => {
      const updatedCategories = [...prev.categories];
      const question = updatedCategories[categoryIndex].questions[questionIndex];
      
      if (question.conditions && conditionIndex >= 0 && conditionIndex < question.conditions.length) {
        const updatedConditions = [...question.conditions];
        const existingCondition = updatedConditions[conditionIndex];
        
        // Preserve existing values and only update the provided fields
        updatedConditions[conditionIndex] = {
          ...existingCondition,
          ...updates,
          // Ensure question_id is always set correctly
          question_id: question.id
        };
        
        const updatedQuestions = [...updatedCategories[categoryIndex].questions];
        updatedQuestions[questionIndex] = {
          ...question,
          conditions: updatedConditions
        };
        
        updatedCategories[categoryIndex] = {
          ...updatedCategories[categoryIndex],
          questions: updatedQuestions
        };
      }
      
      return { ...prev, categories: updatedCategories };
    });
  }, []);
  
  const handleRemoveCondition = useCallback((categoryIndex: number, questionIndex: number, conditionIndex: number) => {
    setForm(prev => {
      const updatedCategories = [...prev.categories];
      const question = updatedCategories[categoryIndex].questions[questionIndex];
      
      if (question.conditions && conditionIndex >= 0 && conditionIndex < question.conditions.length) {
        const removedCondition = question.conditions[conditionIndex];
        const updatedConditions = question.conditions.filter((_, idx) => idx !== conditionIndex);
        
        // Reorder sort_order for remaining conditions in the same group
        if (removedCondition) {
          const sameGroupConditions = updatedConditions.filter(c => c.group_id === removedCondition.group_id);
          sameGroupConditions.forEach((condition, idx) => {
            condition.sort_order = idx;
          });
        }
        
        const updatedQuestions = [...updatedCategories[categoryIndex].questions];
        updatedQuestions[questionIndex] = {
          ...question,
          conditions: updatedConditions,
          // If all conditions are removed, set is_conditional to false
          is_conditional: updatedConditions.length > 0
        };
        
        updatedCategories[categoryIndex] = {
          ...updatedCategories[categoryIndex],
          questions: updatedQuestions
        };
      }
      
      return { ...prev, categories: updatedCategories };
    });
  }, []);
  
  const handleAddConditionGroup = useCallback((categoryIndex: number, questionIndex: number) => {
    setForm(prev => {
      const updatedCategories = [...prev.categories];
      const question = updatedCategories[categoryIndex].questions[questionIndex];
      
      // Initialize conditions array if it doesn't exist
      const currentConditions = question.conditions || [];
      
      // Find the max group ID and add 1 to create a new group
      const maxGroupId = currentConditions.length > 0 ? 
        Math.max(...currentConditions.map(c => c.group_id || 0)) : -1;
      const newGroupId = maxGroupId + 1;
      
      // Create new condition in the new group
      const newCondition: FormQuestionCondition = {
        question_id: question.id,
        target_question_id: 0, // Will be set by user
        condition_type: 'EQUALS',
        target_value: '',
        logical_operator: 'AND', // Default logical operator (first condition in group doesn't use this)
        group_id: newGroupId,
        sort_order: 0 // First condition in new group
      };
      
      // Update the question with the new condition
      const updatedQuestions = [...updatedCategories[categoryIndex].questions];
      updatedQuestions[questionIndex] = {
        ...question,
        is_conditional: true, // Ensure conditional flag is set
        conditions: [...currentConditions, newCondition]
      };
      
      updatedCategories[categoryIndex] = {
        ...updatedCategories[categoryIndex],
        questions: updatedQuestions
      };
      
      return { ...prev, categories: updatedCategories };
    });
  }, []);
  
  // Function to preprocess form data before saving - ensure conditions are properly formatted
  const preprocessFormForSave = useCallback((formData: Form): Form => {
    console.log('🔍 PREPROCESSING START: Original form data:', JSON.stringify(formData, null, 2));
    
    // Process the form data to ensure conditions are properly formatted
    const processedForm: Form = {
      ...formData,
      categories: formData.categories.map((category, categoryIndex) => ({
        ...category,
        questions: category.questions.map((question, questionIndex) => {
          // If is_conditional is false, ensure conditions array is empty
          if (!question.is_conditional) {
            return {
              ...question,
              conditions: []
            };
          }
          
          if (question.conditions && question.conditions.length > 0) {
            console.log(`🔍 PROCESSING CONDITIONS for Question ${questionIndex}:`, question.conditions);
            
            const processedConditions = question.conditions.map(condition => {
              const originalTargetId = condition.target_question_id;
              console.log(`🔍 CONDITION: Original target ID = ${originalTargetId}, type = ${condition.condition_type}, value = ${condition.target_value}`);
              
              // Keep the original target question ID - the backend can now handle negative IDs properly
              console.log(`🔍 KEEPING ORIGINAL: Question ${question.id} condition target ${originalTargetId} (backend will handle mapping)`);
              return condition;
            });
            
            console.log(`🔍 PROCESSED CONDITIONS for Question ${questionIndex}:`, processedConditions);
            
            return {
              ...question,
              conditions: processedConditions
            };
          }
          
          return question;
        })
      }))
    };
    
    console.log('🔍 PREPROCESSING END: Processed form data:', JSON.stringify(processedForm, null, 2));
    
    return processedForm;
  }, []);

  // Optimized save form function with performance tracking
  const handleSaveForm = useCallback(async () => {
    // If we're deactivating an existing form, skip validation since we're only changing the active status
    if (!form.id || form.is_active) {
      if (!validateForm()) return;
    }
    
    const startTime = performance.now();
    try {
      setIsSubmitting(true);
      // Don't clear errors here - they're already set by validateForm()
      // setErrors({});
      
      // Debug: Log metadata fields being sent
      console.log('🔍 SAVE DEBUG: Metadata fields being sent:', form.metadata_fields);
      console.log('🔍 SAVE DEBUG: Metadata fields with sort_order:', form.metadata_fields?.map(f => ({ name: f.field_name, sort_order: f.sort_order })));
      
      // Preprocess form data to handle conditional logic target question ID mapping
      const processedForm = preprocessFormForSave(form);
      console.log('🔍 SAVE DEBUG: Processed form for conditional logic:', processedForm);
      
      // Debug: Log the logical operators being sent to backend
      console.log('🔍 SAVE DEBUG: Logical operators being sent to backend:');
      processedForm.categories.forEach((category, catIndex) => {
        category.questions.forEach((question, qIndex) => {
          if (question.conditions && question.conditions.length > 0) {
            console.log(`🔍 SAVE DEBUG: Question ${qIndex} conditions:`, question.conditions.map(c => ({
              id: c.id,
              logical_operator: c.logical_operator,
              group_id: c.group_id,
              sort_order: c.sort_order
            })));
          }
        });
      });
      
      // Log form complexity for debugging
      const totalQuestions = processedForm.categories.reduce((sum, cat) => sum + (cat.questions?.length || 0), 0);
      const totalConditions = processedForm.categories.reduce((sum, cat) => 
        sum + (cat.questions?.reduce((qSum, q) => qSum + (q.conditions?.length || 0), 0) || 0), 0);
      
      console.log('🔍 SAVE DEBUG: Form complexity:', {
        categories: processedForm.categories.length,
        totalQuestions,
        totalConditions,
        metadataFields: processedForm.metadata_fields?.length || 0,
        formDataSize: JSON.stringify(processedForm).length
      });
      
      let savedForm;
      if (form.id) {
        // Check if form is being made inactive
        if (!form.is_active) {
          // Deactivate existing form (does not create new version)
          console.log('🔍 SAVE DEBUG: Deactivating existing form with ID:', form.id);
          await deactivateForm(form.id);
          savedForm = { message: 'Form deactivated successfully' };
        } else {
          // Update existing form (creates new version)
          console.log('🔍 SAVE DEBUG: Updating existing form with ID:', form.id);
          savedForm = await updateForm(form.id, processedForm);
        }
      } else {
        // Create new form
        console.log('🔍 SAVE DEBUG: Creating new form');
        savedForm = await createForm(processedForm);
      }
      
      console.log('🔍 SAVE DEBUG: Form save successful:', savedForm);
      
      setSuccessMessage(
        form.id 
          ? (!form.is_active 
              ? 'Form deactivated successfully' 
              : `Form updated successfully as version ${savedForm.version || 'new version'}`)
          : 'Form created successfully'
      );
      
      // Update performance tracking
      const endTime = performance.now();
      performanceRef.current.lastSaveTime = endTime - startTime;
      performanceRef.current.saveCount += 1;
      
      console.log(`🔍 SAVE DEBUG: Save completed in ${(endTime - startTime).toFixed(2)}ms`);
      
      // Navigate to forms list after a short delay to show success message
      setTimeout(() => {
        navigate('/admin/forms');
      }, 2000);
      
    } catch (error: any) {
      console.error('Error saving form:', error);
      
      // Display a more specific error message if available
      if (error.message && typeof error.message === 'string') {
        setErrors({ form: `Error: ${error.message}` });
      } else {
        setErrors({ form: 'Failed to save form. Please check the form data and try again.' });
      }
      
      // Additional logging to help debugging
      if (error.response) {
        console.error('Server response:', error.response.data);
        console.error('Server status:', error.response.status);
        console.error('Server headers:', error.response.headers);
        
        // For deactivation errors, show more specific information
        if (!form.is_active && form.id) {
          console.error('Deactivation error details:', {
            formId: form.id,
            isActive: form.is_active,
            serverResponse: error.response.data,
            serverStatus: error.response.status
          });
        }
      }
      
      // Log the form data that caused the error for debugging
      console.error('Form data that caused error:', {
        formId: form.id,
        formName: form.form_name,
        isActive: form.is_active,
        action: !form.is_active && form.id ? 'deactivate' : 'update/create',
        categoriesCount: form.categories.length,
        totalQuestions: form.categories.reduce((sum, cat) => sum + (cat.questions?.length || 0), 0)
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [form, validateForm, navigate, preprocessFormForSave]);
  
  const handleCancel = useCallback(() => {
    navigate('/admin/forms');
  }, [navigate]);
  
  // Function to open the preview with useCallback
  const handleOpenPreview = useCallback(() => {
    // Navigate to the preview screen with the form data
    if (form.id) {
      navigate(`/admin/forms/${form.id}/preview`, { 
        state: { formData: form }
      });
    } else {
      navigate('/admin/forms/preview', { 
        state: { formData: form }
      });
    }
  }, [form, navigate]);
  
  // Add handlers for the new fields
  const handleUserVersionChange = useCallback((value: number) => {
    setForm(prev => ({ ...prev, user_version: value }));
  }, []);
  
  const handleUserVersionDateChange = useCallback((value: string) => {
    setForm(prev => ({ ...prev, user_version_date: value }));
  }, []);
  
  // Weight modal handlers
  const handleOpenWeightModal = useCallback(() => {
    console.log('🔍 Opening weight modal');
    setIsWeightModalOpen(true);
  }, []);
  
  const handleCloseWeightModal = useCallback(() => {
    setIsWeightModalOpen(false);
    setTempWeights([]);
  }, []);
  
  const handleTempWeightChange = useCallback((index: number, value: number) => {
    setTempWeights(prev => {
      const newWeights = [...prev];
      newWeights[index] = value;
      return newWeights;
    });
  }, []);
  
  const handleUpdateWeights = useCallback(() => {
    setForm(prev => {
      const updatedCategories = prev.categories.map((cat, index) => ({
        ...cat,
        weight: tempWeights[index] || 0
      }));
      return { ...prev, categories: updatedCategories };
    });
    setIsWeightModalOpen(false);
    setTempWeights([]);
  }, [tempWeights]);
  
  // Set default user version date for new forms
  useEffect(() => {
    // Only set default date if this is a new form (no formId, no duplicate, no preview data)
    const searchParams = new URLSearchParams(location.search);
    const duplicateFormId = searchParams.get('duplicate');
    const previewFormData = location.state?.formData;
    
    if (!formId && !duplicateFormId && !previewFormData) {
      setForm(prev => {
        // Only update if the date is empty
        if (!prev.user_version_date) {
          return {
            ...prev,
            user_version_date: new Date().toISOString().split('T')[0]
          };
        }
        return prev;
      });
    }
  }, [formId, location.search, location.state]);
  
  return (
    <div className="container p-6 mx-auto relative">
      {/* Skip Links for Keyboard Navigation */}
      <div className="sr-only">
        <a 
          href="#main-content" 
          className="absolute top-0 left-0 bg-blue-600 text-white p-2 m-2 rounded focus:not-sr-only focus:z-50"
          onFocus={(e) => e.target.classList.remove('sr-only')}
          onBlur={(e) => e.target.classList.add('sr-only')}
        >
          Skip to main content
        </a>
        <a 
          href="#form-builder-section" 
          className="absolute top-0 left-0 bg-blue-600 text-white p-2 m-2 rounded focus:not-sr-only focus:z-50"
          onFocus={(e) => e.target.classList.remove('sr-only')}
          onBlur={(e) => e.target.classList.add('sr-only')}
        >
          Skip to form builder
        </a>
      </div>

      {/* Page Header with proper heading hierarchy */}
      <header>
        <h1 
          id="page-title"
          className="mb-8 text-2xl font-bold"
          role="banner"
        >
          {form.id ? 'Edit Form' : 'Create New Form'}
        </h1>
      </header>

      {/* Main Content Area */}
      <main id="main-content" tabIndex={-1}>
      
      {/* Accessible Success Display */}
      {successMessage && (
        <div role="alert" aria-live="polite" className="mb-6">
          <ErrorDisplay
            variant="card"
            message={successMessage}
            title="Success"
            dismissible={true}
            onDismiss={() => setSuccessMessage(null)}
            className="mb-6 bg-green-50 border-green-500 text-green-700"
          />
        </div>
      )}
      
      {/* Accessible Error Display */}
      {errors.form && (
        <div role="alert" aria-live="polite" className="mb-6">
          <ErrorDisplay
            variant="card"
            message={errors.form}
            title="Error"
            dismissible={true}
            onDismiss={() => setErrors(prev => ({ ...prev, form: '' }))}
            className="mb-6"
          />
        </div>
      )}
      
      {/* Form content */}
      <div className="bg-white rounded-lg shadow-md border border-gray-200 mb-8 overflow-hidden">
        {/* Form metadata section */}
        <FormMetadata
          formName={form.form_name}
          isActive={form.is_active}
          version={form.version || 1}
          interactionType={form.interaction_type}
          metadataFields={form.metadata_fields}
          userVersion={form.user_version}
          userVersionDate={form.user_version_date}
          onFormNameChange={handleFormNameChange}
          onIsActiveChange={handleIsActiveChange}
          onInteractionTypeChange={handleInteractionTypeChange}
          onMetadataFieldsChange={handleMetadataFieldsChange}
          onUserVersionChange={handleUserVersionChange}
          onUserVersionDateChange={handleUserVersionDateChange}
          error={errors.form_name}
          userVersionError={errors.user_version}
          userVersionDateError={errors.user_version_date}
        />
      </div>
      
      {/* Accessible Form Builder Section */}
      <section 
        id="form-builder-section"
        aria-labelledby="form-builder-heading"
        role="region"
      >
        <h2 id="form-builder-heading" className="sr-only">
          Form Builder - Categories and Questions
        </h2>
        
        <div className="bg-white rounded-lg shadow-md border border-gray-200 mb-8 overflow-hidden">
          <div className="p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-xl font-semibold text-gray-800">Categories & Questions</h3>
              </div>
              <div className="flex items-center bg-gray-50 px-4 py-2 rounded-md border border-gray-100">
                <span className={`text-sm font-medium ${weightSumValid ? 'text-green-600' : 'text-yellow-600'} flex items-center`}>
                  {weightSumValid ? (
                    <HiCheck className="h-4 w-4 mr-1 text-green-500" />
                  ) : (
                    <HiExclamation className="h-4 w-4 mr-1 text-yellow-500" />
                  )}
                  Total weight: {typeof totalWeight === 'number' ? totalWeight.toFixed(2) : '0.00'}
                  {!weightSumValid && ' (Should sum to 1.0)'}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="ml-3"
                  aria-label="Edit category weights"
                  onClick={handleOpenWeightModal}
                >
                  Edit Weight
                </Button>
              </div>
            </div>
            
            {/* Accessible Error Displays */}
            {errors.categories && (
              <div role="alert" aria-live="polite" className="mb-4">
                <ErrorDisplay
                  variant="card"
                  message={errors.categories}
                  title="Category Error"
                  dismissible={true}
                  onDismiss={() => setErrors(prev => ({ ...prev, categories: '' }))}
                  className="mb-4"
                />
              </div>
            )}
            
            {errors.questions && (
              <div role="alert" aria-live="polite" className="mb-4">
                <ErrorDisplay
                  variant="card"
                  message={errors.questions}
                  title="Question Error"
                  dismissible={true}
                  onDismiss={() => setErrors(prev => ({ ...prev, questions: '' }))}
                  className="mb-4"
                />
              </div>
            )}
          
          {/* Show when no categories exist */}
          {form.categories.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-lg bg-gray-50">
              <Button
                onClick={handleAddCategory}
                variant="primary"
                size="lg"
                aria-label="Add the first category to this form"
              >
                Add First Category
              </Button>
            </div>
          ) : (
            <div className="space-y-6">
              {form.categories.map((category, categoryIndex) => (
                <CategoryBuilder
                  key={categoryIndex}
                  category={category}
                  categoryIndex={categoryIndex}
                  totalCategories={form.categories.length}
                  totalWeight={totalWeight}
                  onCategoryNameChange={handleCategoryNameChange}
                  onCategoryWeightChange={handleCategoryWeightChange}
                  onRemoveCategory={handleRemoveCategory}
                  onMoveCategoryUp={handleMoveCategoryUp}
                  onMoveCategoryDown={handleMoveCategoryDown}
                  onAddQuestion={handleAddQuestion}
                  onQuestionChange={handleQuestionChange}
                  onRemoveQuestion={handleRemoveQuestion}
                  onMoveQuestionUp={handleMoveQuestionUp}
                  onMoveQuestionDown={handleMoveQuestionDown}
                  onAddRadioOption={handleAddRadioOption}
                  onUpdateRadioOption={handleUpdateRadioOption}
                  onRemoveRadioOption={handleRemoveRadioOption}
                  onAddCondition={handleAddCondition}
                  onUpdateCondition={handleUpdateCondition}
                  onRemoveCondition={handleRemoveCondition}
                  onAddConditionGroup={handleAddConditionGroup}
                />
              ))}
              
              {/* Add Category button below the categories list */}
              <div className="text-center mt-8">
                <Button
                  onClick={handleAddCategory}
                  variant="primary"
                  size="lg"
                  aria-label="Add another category to this form"
                >
                  Add Another Category
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
      </section>
      
      {/* Form actions */}
      <div className="flex justify-between bg-gray-50 p-5 rounded-lg border border-gray-200 shadow-sm">
        <Button
          type="button"
          onClick={handleCancel}
          variant="ghost"
          size="lg"
          disabled={isSubmitting || isLoading}
          aria-label="Cancel form creation and return to forms list"
        >
          Cancel
        </Button>
        
        <div className="space-x-4 flex">
          <Button
            type="button"
            onClick={handleOpenPreview}
            variant="secondary"
            size="lg"
            disabled={form.categories.length === 0 || isSubmitting || isLoading}
            aria-label="Preview the form before saving"
          >
            Preview Form
          </Button>
          
          <Button
            type="button"
            onClick={handleSaveForm}
            variant="primary"
            size="lg"
            disabled={isSubmitting || isLoading}
            loading={isSubmitting}
            aria-label={form.id ? (form.is_active ? 'Save changes as new form version' : 'Deactivate this form') : 'Create new form'}
          >
            {form.id ? (form.is_active ? 'Save as New Version' : 'Deactivate Form') : 'Create Form'}
          </Button>
        </div>
      </div>
      
      {/* Loading Overlay */}
      {isLoading && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 shadow-xl">
            <div className="flex items-center space-x-3">
              <LoadingSpinner size="md" />
              <span className="text-gray-700 font-medium">Loading form data...</span>
            </div>
          </div>
        </div>
      )}
      
      {/* Performance Monitor (Development Only) */}
      <PerformanceMonitor
        saveCount={performanceRef.current.saveCount}
        lastSaveTime={performanceRef.current.lastSaveTime}
        loadCount={performanceRef.current.loadCount}
        lastLoadTime={performanceRef.current.lastLoadTime}
      />
      
      {/* Weight Edit Modal */}
      {isWeightModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Edit Category Weights</h3>
              <button
                onClick={handleCloseWeightModal}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close modal"
              >
                <HiX className="h-6 w-6" />
              </button>
            </div>
            
            <div className="space-y-4 mb-6">
              {form.categories.map((category, index) => {
                const currentValue = tempWeights[index] || 0;
                console.log(`🔍 Modal rendering: Category ${index} "${category.category_name}" - tempWeights[${index}] = ${tempWeights[index]}, currentValue = ${currentValue}`);
                return (
                  <div key={`weight-${category.id}-${index}`} className="flex items-center space-x-4">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {category.category_name || `Category ${index + 1}`}
                      </label>
                    </div>
                    <div className="w-80">
                      <FormField
                        name={`temp_weight_${category.id}_${index}`}
                        type="number"
                        value={tempWeights[index]?.toString() || category.weight}
                        onChange={(e) => handleTempWeightChange(index, parseFloat(e.target.value) || 0)}
                        min="0"
                        max="1"
                        step="0.05"
                        placeholder="0.00"
                        className="text-xl font-medium"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            
            <div className="bg-gray-50 p-4 rounded-md mb-4">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-700">Total Weight:</span>
                <span className={`text-sm font-medium ${(() => {
                  const total = tempWeights.reduce((sum, weight) => sum + (Number(weight) || 0), 0);
                  return total > 0.99 && total < 1.01 ? 'text-green-600' : 'text-yellow-600';
                })()}`}>
                  {(() => {
                    const total = tempWeights.reduce((sum, weight) => sum + (Number(weight) || 0), 0);
                    return total.toFixed(2);
                  })()}
                  {(() => {
                    const total = tempWeights.reduce((sum, weight) => sum + (Number(weight) || 0), 0);
                    return !(total > 0.99 && total < 1.01) ? ' (Should sum to 1.0)' : '';
                  })()}
                </span>
              </div>
            </div>
            
            <div className="flex justify-end space-x-3">
              <Button
                type="button"
                variant="ghost"
                onClick={handleCloseWeightModal}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={handleUpdateWeights}
                disabled={(() => {
                  const total = tempWeights.reduce((sum, weight) => sum + (Number(weight) || 0), 0);
                  return total < 0.99 || total > 1.01;
                })()}
              >
                Update Weights
              </Button>
            </div>
          </div>
        </div>
      )}
      
      </main>
    </div>
  );
};

export default SinglePageFormBuilder;