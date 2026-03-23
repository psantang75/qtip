import React, { useState, useEffect, useRef } from 'react';
import type { Form as FormType, FormCategory, FormQuestion, QuestionType } from '../types/form.types';
import FormMetadataDisplay from './FormMetadataDisplay';
import { processConditionalLogic } from '../utils/forms/formConditions'; 
import type { Form as IndexForm, Answer as IndexAnswer } from '../types';

interface FormPreviewModalProps {
  form: FormType;
  isOpen: boolean;
  onClose: () => void;
}

interface Answer {
  questionId: string;
  answer: string;
  score: number;
}

interface CategoryScore {
  categoryId: string;
  categoryName: string;
  earnedPoints: number;
  possiblePoints: number;
  rawScore: number;
  weightedScore: number;
}

// Convert FormType to IndexForm for use with utilities
const convertFormToIndexForm = (form: FormType): IndexForm => {
  return {
    id: form.id || 0,
    form_name: form.form_name,
    interaction_type: (form.interaction_type?.toUpperCase() as 'CALL' | 'TICKET' | 'EMAIL' | 'CHAT' | 'UNIVERSAL') || 'UNIVERSAL',
    is_active: form.is_active,
    categories: form.categories.map(category => ({
      id: category.id || 0,
      form_id: category.form_id || 0,
      category_name: category.category_name,
      weight: category.weight,
      sort_order: category.sort_order || 0,
      questions: category.questions.map(question => ({
        id: question.id || 0,
        category_id: question.category_id || 0,
        question_text: question.question_text,
        question_type: question.question_type.toUpperCase() as 'YES_NO' | 'SCALE' | 'TEXT' | 'INFO_BLOCK',
        weight: question.weight || 1, // Add required weight property
        sort_order: question.sort_order || 0,
        score_if_yes: question.yes_value,
        score_if_no: question.no_value,
        score_na: question.na_value,
        max_scale: question.scale_max,
        is_conditional: question.is_conditional || false,
        conditional_logic: question.is_conditional ? {
          target_question_id: question.conditional_question_id || 0,
          condition_type: question.condition_type?.toUpperCase() as 'EQUALS' | 'NOT_EQUALS' | 'EXISTS' | 'NOT_EXISTS' || 'EQUALS',
          target_value: question.conditional_value || '',
          exclude_if_unmet: question.exclude_if_unmet || false
        } : undefined
      }))
    })),
    metadata_fields: form.metadata_fields?.map(field => ({
      id: field.id || 0,
      form_id: field.form_id || 0,
      interaction_type: form.interaction_type || 'UNIVERSAL',
      field_name: field.field_name,
      field_type: field.field_type.toUpperCase() as 'TEXT' | 'DATE' | 'AUTO' | 'DROPDOWN',
      is_required: field.is_required,
      dropdown_source: field.dropdown_source || undefined, // Convert null to undefined
      sort_order: field.sort_order || 0
    })) || []
  };
};

const FormPreviewModal: React.FC<FormPreviewModalProps> = ({ form, isOpen, onClose }) => {
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [categoryScores, setCategoryScores] = useState<CategoryScore[]>([]);
  const [totalScore, setTotalScore] = useState<number>(0);
  const previousAnswers = useRef<Record<string, Answer>>({});
  const [visibilityMap, setVisibilityMap] = useState<Record<number, boolean>>({});
  
  // Convert form to IndexForm for compatibility with utilities
  const indexForm = convertFormToIndexForm(form);
  
  // Reset answers when form changes
  useEffect(() => {
    setAnswers({});
    
    // Initialize visibility map - all conditional questions are hidden by default
    const initialVisibilityMap: Record<number, boolean> = {};
    indexForm.categories.forEach((category) => {
      category.questions.forEach((question) => {
        // Only non-conditional questions are visible initially
        initialVisibilityMap[question.id] = !question.is_conditional;
      });
    });
    setVisibilityMap(initialVisibilityMap);
    
    // Force update visibility map immediately to ensure conditional logic is properly applied
    setTimeout(() => {
      updateVisibilityMap();
    }, 0);
  }, [form, indexForm]);
  
  // Update visibility map when answers change
  useEffect(() => {
    // Skip the initial render when answers are empty
    if (Object.keys(answers).length > 0) {
      updateVisibilityMap();
      calculateScores();
    }
    
    previousAnswers.current = answers;
  }, [answers, form, indexForm]);
  
  // Map component answers to the format expected by processConditionalLogic
  const mapAnswersForConditionalLogic = (): Record<number, IndexAnswer> => {
    const mappedAnswers: Record<number, IndexAnswer> = {};
    
    // Create a quick lookup map from string IDs to numeric question IDs
    const questionIdMap: Record<string, number> = {};
    
    // Build the ID map first to ensure we have all questions
    form.categories.forEach((category, catIdx) => {
      category.questions.forEach((question, qIdx) => {
        const stringId = `cat-${catIdx}-${qIdx}`;
        const numericId = question.id !== undefined ? question.id : -1000 - (catIdx * 100 + qIdx);
        questionIdMap[stringId] = numericId;
      });
    });
    
    console.log('Question ID mapping:', questionIdMap);
    
    // Convert string-based questionIds to numeric question ids
    Object.entries(answers).forEach(([questionId, answer]) => {
      // Use the mapping we just created instead of recreating the logic
      const numericId = questionIdMap[questionId];
      
      if (numericId !== undefined) {
        mappedAnswers[numericId] = {
          question_id: numericId,
          answer: answer.answer,
          score: answer.score,
          notes: ''
        };
      }
    });
    
    return mappedAnswers;
  };
  
  const updateVisibilityMap = () => {
    const mappedAnswers = mapAnswersForConditionalLogic();
    
    // Convert Answer objects to strings for processConditionalLogic
    const answerStrings: Record<number, string> = {};
    Object.entries(mappedAnswers).forEach(([questionId, answerObj]) => {
      answerStrings[Number(questionId)] = answerObj.answer || '';
    });
    
    // For debugging conditional logic
    console.log("Evaluating conditional logic with answers:", answerStrings);
    
    // Use false for isPreview to allow conditional logic to evaluate properly
    const updatedVisibilityMap = processConditionalLogic(indexForm, answerStrings, false);
    
    // Debug visibility changes
    console.log("Updated visibility map:", updatedVisibilityMap);
    
    // Find conditional questions for logging
    indexForm.categories.forEach(category => {
      category.questions.forEach(question => {
        if (question.is_conditional) {
          console.log(`Conditional question ${question.id} (${question.question_text}):`, 
            updatedVisibilityMap[question.id] ? "VISIBLE" : "HIDDEN",
            question.conditional_logic);
        }
      });
    });
    
    setVisibilityMap(updatedVisibilityMap);
    
    // Reset answers for questions that are now hidden
    const newAnswers = { ...answers };
    let hasChanges = false;
    
    form.categories.forEach((category, catIdx) => {
      category.questions.forEach((question, qIdx) => {
        const questionId = `cat-${catIdx}-${qIdx}`;
        if (question.id !== undefined && !updatedVisibilityMap[question.id] && questionId in newAnswers) {
          delete newAnswers[questionId];
          hasChanges = true;
          console.log(`Answer for hidden question ${questionId} removed`);
        }
      });
    });
    
    if (hasChanges) {
      setAnswers(newAnswers);
    }
  };
  
  const [, forceUpdateState] = useState<{}>();
  const forceUpdate = () => forceUpdateState({});
  
  const setAnswer = (questionId: string, answer: string, questionType: QuestionType) => {
    let score = 0;
    
    if (questionType === 'YES_NO') {
      const [categoryIndex, questionIndex] = questionId.replace('cat-', '').split('-').map(Number);
      if (form.categories[categoryIndex] && form.categories[categoryIndex].questions[questionIndex]) {
        const question = form.categories[categoryIndex].questions[questionIndex];
        
        if (answer === 'YES') {
          score = question.yes_value ?? 1;
        } else if (answer === 'NO') {
          score = question.no_value ?? 0;
        }
      }
    } else if (questionType === 'SCALE') {
      score = parseInt(answer) || 0;
    } else if (questionType === 'RADIO') {
      const [categoryIndex, questionIndex] = questionId.replace('cat-', '').split('-').map(Number);
      if (form.categories[categoryIndex] && form.categories[categoryIndex].questions[questionIndex]) {
        const question = form.categories[categoryIndex].questions[questionIndex];
        const option = question.radio_options?.find(opt => opt.option_value === answer);
        if (option) {
          score = option.score || 0;
        }
      }
    }
    
    // Set answers and immediately trigger visibility update for conditionals
    const newAnswer = { questionId, answer, score };
    console.log(`Setting answer for ${questionId}:`, newAnswer);
    
    // Get numeric question ID for logging dependency information
    const [categoryIndex, questionIndex] = questionId.replace('cat-', '').split('-').map(Number);
    if (form.categories[categoryIndex] && form.categories[categoryIndex].questions[questionIndex]) {
      const question = form.categories[categoryIndex].questions[questionIndex];
      
      // Log if this answer might affect any conditional questions
      form.categories.forEach((category) => {
        category.questions.forEach((q) => {
          if (q.is_conditional && q.conditional_question_id === question.id) {
            console.log(`This answer might affect conditional question ${q.id} (${q.question_text})`);
            console.log(` - Condition: ${q.condition_type} "${q.conditional_value}"`);
            console.log(` - New answer: "${answer}"`);
            if (q.condition_type === 'EQUALS') {
              const matched = answer.toUpperCase() === (q.conditional_value || '').toUpperCase();
              console.log(` - Expected match: ${matched}`);
            }
          }
        });
      });
    }
    
    setAnswers(prev => {
      const updated = {
        ...prev,
        [questionId]: newAnswer
      };
      
      // We need to use setTimeout to ensure the state update happens before we use it
      setTimeout(() => {
        updateVisibilityMap();
      }, 0);
      
      return updated;
    });
  };
  
  const getAnswer = (questionId: string): Answer => {
    return answers[questionId] || { questionId, answer: '', score: 0 };
  };
  
  const isQuestionVisible = (question: FormQuestion, categoryIndex: number): boolean => {
    // Always show SUB_CATEGORY questions regardless of conditional logic
    if (question.question_type === 'SUB_CATEGORY') {
      return true;
    }
    
    // Check visibility map for conditional questions if the question has an ID
    return question.id === undefined || visibilityMap[question.id] !== false;
  };
  
  const calculateScores = () => {
    const newCategoryScores: CategoryScore[] = [];
    let newTotalScore = 0;
    
    console.log('Starting score calculation');
    
    form.categories.forEach((category, categoryIndex) => {
      let earnedPoints = 0;
      let possiblePoints = 0;
      
      console.log(`Category: ${category.category_name}, Weight: ${category.weight}`);
      
      category.questions.forEach((question, questionIndex) => {
        const questionId = `cat-${categoryIndex}-${questionIndex}`;
        
        // Skip INFO_BLOCK and TEXT questions (non-scorable)
        if (question.question_type === 'INFO_BLOCK' || question.question_type === 'TEXT' || question.question_type === 'SUB_CATEGORY') {
          console.log(`Question ${questionId} is non-scorable type, skipping`);
          return;
        }
        
        // Skip questions that are hidden by conditional logic entirely (from both numerator and denominator)
        if (!isQuestionVisible(question, categoryIndex)) {
          console.log(`Question ${questionId} hidden by conditional logic, completely excluding from score`);
          return;
        }
        
        const answer = getAnswer(questionId);
        
        console.log(`Question ${questionId}: ${question.question_text}`);
        console.log(`- Type: ${question.question_type}, Answer: ${answer.answer}, Score: ${answer.score}`);
        if (question.question_type === 'YES_NO') {
          console.log(`- YES value: ${question.yes_value ?? 1}`);
        }
        
        // Skip N/A answers entirely (from both numerator and denominator)
        if (answer.answer === 'N/A') {
          console.log(`- Answer is N/A, completely excluding from score`);
          return;
        }
        
        // Special handling for YES/NO questions with NO answer:
        // Add 0 to numerator but still include the question in denominator
        if (question.question_type === 'YES_NO' && answer.answer === 'NO') {
          console.log(`- Answer is NO for YES/NO question, adding 0 to numerator but including in denominator`);
          // Add to denominator but not to numerator (score of 0)
          possiblePoints += question.yes_value ?? 1;
          console.log(`- Adding ${question.yes_value ?? 1} to possible points`);
          return;
        }
        
        // If there's no answer yet, count as zero but include in possible points
        if (!answer.answer) {
          if (question.question_type === 'YES_NO') {
            possiblePoints += question.yes_value ?? 1;
            console.log(`- No answer yet. Adding ${question.yes_value ?? 1} to possible points`);
          } else if (question.question_type === 'SCALE') {
            possiblePoints += question.scale_max ?? 5;
            console.log(`- No answer yet. Adding ${question.scale_max ?? 5} to possible points`);
          } else if (question.question_type === 'RADIO') {
            const maxScore = Math.max(...(question.radio_options?.map(opt => opt.score ?? 0) || [0]));
            possiblePoints += maxScore;
            console.log(`- No answer yet. Adding max radio score ${maxScore} to possible points`);
          }
        } else {
          // Add the actual score to numerator
          earnedPoints += answer.score;
          console.log(`- Adding ${answer.score} to earned points`);
          
          // Add appropriate value to denominator
          if (question.question_type === 'YES_NO') {
            possiblePoints += question.yes_value ?? 1;
            console.log(`- Adding ${question.yes_value ?? 1} to possible points`);
          } else if (question.question_type === 'SCALE') {
            possiblePoints += question.scale_max ?? 5;
            console.log(`- Adding ${question.scale_max ?? 5} to possible points`);
          } else if (question.question_type === 'RADIO') {
            const maxScore = Math.max(...(question.radio_options?.map(opt => opt.score ?? 0) || [0]));
            possiblePoints += maxScore;
            console.log(`- Adding max radio score ${maxScore} to possible points`);
          }
        }
      });
      
      // Calculate category raw score (as percentage)
      const rawScore = possiblePoints > 0 ? (earnedPoints / possiblePoints) * 100 : 0;
      console.log(`Category ${category.category_name} totals: ${earnedPoints}/${possiblePoints} = ${rawScore.toFixed(2)}%`);
      
      // Calculate weighted score
      const weightedScore = rawScore * (parseFloat(category.weight?.toString()) || 0);
      console.log(`Weighted score: ${rawScore.toFixed(2)}% × ${(parseFloat(category.weight?.toString()) || 0).toFixed(2)} = ${weightedScore.toFixed(2)}%`);
      
      // Only add to total score if category has possible points (exclude zero-point categories)
      if (possiblePoints > 0) {
        newTotalScore += weightedScore;
      }
      
      // Save category score
      newCategoryScores.push({
        categoryId: `cat-${categoryIndex}`,
        categoryName: category.category_name,
        earnedPoints,
        possiblePoints,
        rawScore,
        weightedScore
      });
    });
    
    setCategoryScores(newCategoryScores);
    setTotalScore(newTotalScore);
  };
  
  // Add style to hide unwanted zeros
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      /* Hide any unwanted characters after the No label */
      input[type="radio"][value="NO"] + span::after,
      input[type="radio"][value="NO"] ~ span::after,
      input[type="radio"][value="NO"] + span + span,
      label:has(input[type="radio"][value="NO"])::after {
        display: none !important;
        content: none !important;
      }
    `;
    document.head.appendChild(style);
    
    return () => {
      document.head.removeChild(style);
    };
  }, []);
  
  if (!isOpen) return null;
  
  return (
    <div 
      className={`fixed inset-0 z-50 flex items-center justify-center ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'} transition-opacity duration-300`} 
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
    >
      <div className="relative flex flex-col w-full h-full max-w-4xl max-h-[90vh] bg-white rounded-lg shadow-xl overflow-hidden">
        <div className="flex-none bg-white border-b border-gray-200 p-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">{form.form_name}</h2>
            <div className="flex items-center space-x-3 mt-1">
              <div className="text-sm text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
                Version: {form.version || 1}
              </div>
              <div className="text-sm bg-blue-100 text-blue-800 px-3 py-1 rounded-full">
                {form.interaction_type === 'UNIVERSAL' ? 'Universal' : form.interaction_type}
              </div>
            </div>
          </div>
          
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400 p-1 rounded-full"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="flex-1 overflow-auto">
          <div className="flex h-full">
            <div className="flex-1 p-6 overflow-y-auto border-r border-gray-200">
              <div className="max-w-2xl mx-auto">
                <div className="bg-white rounded-lg shadow-md border border-gray-200 p-5 mb-6">
                  <div className="mb-3">
                    <h2 className="text-2xl font-bold text-gray-800 mb-2">{form.form_name}</h2>
                    <div className="flex items-center space-x-3">
                      <div className="text-sm font-medium text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
                        Version: {form.version || 1}
                      </div>
                      <div className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
                        {form.interaction_type === 'UNIVERSAL' ? 'Universal' : form.interaction_type}
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Display metadata fields for CALL interaction type */}
                {form.interaction_type === 'CALL' && form.metadata_fields && form.metadata_fields.length > 0 && (
                  <div className="bg-white rounded-lg shadow-md border border-gray-200 p-5 mb-6">
                    <FormMetadataDisplay
                      metadataFields={form.metadata_fields}
                      readonly={false}
                      values={Object.fromEntries(
                        form.metadata_fields.map(field => {
                          // Use field.field_name if field.id is 0 or falsy to avoid "0" keys
                          const fieldKey = (field.id && field.id !== 0) ? field.id.toString() : field.field_name;
                          return [
                            fieldKey,
                            ''
                          ];
                        })
                      )}
                      onChange={(fieldId, value) => console.log(`Field ${fieldId} changed to: ${value}`)}
                      currentUser={{ id: 1, username: 'QA Analyst' }}
                    />
                  </div>
                )}
                
                {form.categories.map((category, categoryIndex) => (
                  <div key={categoryIndex} className="bg-white rounded-lg shadow-md border border-gray-200 p-5 mb-6">
                    <div className="mb-4 pb-2 border-b border-gray-200">
                      <div className="flex flex-col space-y-2">
                        <h3 className="text-xl font-bold text-gray-800">
                          {category.category_name}
                        </h3>
                        <div className="text-sm font-medium text-gray-600 bg-gray-100 px-3 py-1 rounded-full self-start">
                          Weight: {(parseFloat(category.weight?.toString()) * 100 || 0).toFixed(0)}%
                        </div>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      {category.questions.map((question, questionIndex) => {
                        const questionId = `cat-${categoryIndex}-${questionIndex}`;
                        
                        if (!isQuestionVisible(question, categoryIndex)) {
                          return null;
                        }
                        
                        return (
                          <div key={questionIndex} className={`${question.question_type === 'SUB_CATEGORY' ? 'pb-2' : 'pb-5'} pt-3`}>
                            {question.question_type !== 'SUB_CATEGORY' && (
                              <div className="mb-2">
                                <div className="text-gray-800 font-medium text-base">{question.question_text}</div>
                              </div>
                            )}
                            
                            {question.question_type === 'YES_NO' && (
                              <div className="mt-1">
                                <div className="flex space-x-6">
                                  <label className="flex items-center cursor-pointer">
                                    <input
                                      type="radio"
                                      name={questionId}
                                      value="YES"
                                      checked={getAnswer(questionId).answer === 'YES'}
                                      onChange={() => setAnswer(questionId, 'YES', question.question_type)}
                                      className="h-[18px] w-[18px] text-primary-blue focus:ring-primary-blue"
                                    />
                                    <span className="ml-2 text-base text-gray-700">Yes</span>
                                  </label>
                                  
                                  <label 
                                    className="flex items-center cursor-pointer"
                                    style={{ 
                                      position: 'relative', 
                                      content: 'none',
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden'
                                    }} 
                                  >
                                    <input
                                      type="radio"
                                      name={questionId}
                                      value="NO"
                                      checked={getAnswer(questionId).answer === 'NO'}
                                      onChange={() => setAnswer(questionId, 'NO', question.question_type)}
                                      className="h-[18px] w-[18px] text-primary-blue focus:ring-primary-blue"
                                    />
                                    <span 
                                      className="ml-2 text-base text-gray-700"
                                      style={{ 
                                        position: 'relative',
                                        display: 'inline-block',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden'
                                      }}
                                    >
                                      &#78;&#111;
                                    </span>
                                  </label>
                                  
                                  {question.is_na_allowed && (
                                    <label className="flex items-center cursor-pointer">
                                      <input
                                        type="radio"
                                        name={questionId}
                                        value="N/A"
                                        checked={getAnswer(questionId).answer === 'N/A'}
                                        onChange={() => setAnswer(questionId, 'N/A', question.question_type)}
                                        className="h-[18px] w-[18px] text-primary-blue focus:ring-primary-blue"
                                      />
                                      <span className="ml-2 text-base text-gray-700">N/A</span>
                                    </label>
                                  )}
                                </div>
                              </div>
                            )}
                            
                            {question.question_type === 'SCALE' && (
                              <div className="mt-1">
                                <div className="flex flex-wrap justify-between mb-1 gap-1">
                                  {Array.from(
                                    { length: (question.scale_max || 5) - (question.scale_min || 1) + 1 },
                                    (_, i) => (question.scale_min || 1) + i
                                  ).map(value => (
                                    <label key={value} className="flex flex-col items-center p-2 cursor-pointer">
                                      <input
                                        type="radio"
                                        name={questionId}
                                        value={value.toString()}
                                        checked={getAnswer(questionId).answer === value.toString()}
                                        onChange={() => setAnswer(questionId, value.toString(), question.question_type)}
                                        className="h-[18px] w-[18px] text-primary-blue focus:ring-primary-blue"
                                      />
                                      <span className="mt-1 text-sm text-gray-600">{value}</span>
                                    </label>
                                  ))}
                                </div>
                                <div className="flex justify-between text-xs text-gray-500 px-3">
                                  <span>Low</span>
                                  <span>High</span>
                                </div>
                                
                                {question.is_na_allowed && (
                                  <div className="mt-3 border-t border-gray-100 pt-3">
                                    <label className="flex items-center cursor-pointer">
                                      <input
                                        type="radio"
                                        name={questionId}
                                        value="N/A"
                                        checked={getAnswer(questionId).answer === 'N/A'}
                                        onChange={() => setAnswer(questionId, 'N/A', question.question_type)}
                                        className="h-[18px] w-[18px] text-primary-blue focus:ring-primary-blue"
                                      />
                                      <span className="ml-2 text-base text-gray-700">Not Applicable</span>
                                    </label>
                                  </div>
                                )}
                              </div>
                            )}
                            
                            {question.question_type === 'RADIO' && (
                              <div className="mt-1 grid grid-cols-1 gap-2">
                                {question.radio_options?.map((option, optionIndex) => (
                                  <label key={optionIndex} className="flex items-center px-3 py-2 rounded-md hover:bg-gray-50 cursor-pointer">
                                    <input
                                      type="radio"
                                      name={questionId}
                                      value={option.option_value}
                                      checked={getAnswer(questionId).answer === option.option_value}
                                      onChange={() => setAnswer(questionId, option.option_value, question.question_type)}
                                      className="h-[18px] w-[18px] text-primary-blue focus:ring-primary-blue"
                                    />
                                    <span className="ml-2 text-base text-gray-700">{option.option_text}</span>
                                  </label>
                                ))}
                                
                                {question.is_na_allowed && (
                                  <label className="flex items-center px-3 py-2 rounded-md hover:bg-gray-50 cursor-pointer border-t border-gray-100">
                                    <input
                                      type="radio"
                                      name={questionId}
                                      value="N/A"
                                      checked={getAnswer(questionId).answer === 'N/A'}
                                      onChange={() => setAnswer(questionId, 'N/A', question.question_type)}
                                      className="h-[18px] w-[18px] text-primary-blue focus:ring-primary-blue"
                                    />
                                    <span className="ml-2 text-base text-gray-700">Not Applicable</span>
                                  </label>
                                )}
                              </div>
                            )}
                            
                            {question.question_type === 'TEXT' && (
                              <div className="mt-1">
                                <textarea
                                  value={getAnswer(questionId).answer}
                                  onChange={(e) => setAnswer(questionId, e.target.value, question.question_type)}
                                  placeholder="Enter notes here..."
                                  rows={3}
                                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-blue focus:border-primary-blue"
                                />
                              </div>
                            )}
                            
                            {question.question_type === 'INFO_BLOCK' && (
                              <div className="bg-blue-50 p-3 rounded text-sm text-blue-800">
                                {question.question_text}
                              </div>
                            )}
                            
                            {question.question_type === 'SUB_CATEGORY' && (
                              <div className="py-1">
                                <div className="font-bold text-gray-800 text-xl">{question.question_text}</div>
                                <hr className="mt-2 border-t border-gray-300" />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="w-72 bg-gray-50 p-4 overflow-y-auto">
              <div className="bg-white rounded-lg shadow-md border border-gray-200 p-4 mb-4">
                <h3 className="text-lg font-semibold mb-4 text-gray-800 border-b border-gray-200 pb-2">
                  Scoring Preview
                </h3>
                
                <div className="mb-6">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-medium">Total Score</h4>
                    <span className={`text-xl font-bold ${
                      totalScore >= 80 ? 'text-green-600' : 
                      totalScore >= 60 ? 'text-yellow-600' : 
                      'text-red-600'
                    }`}>
                      {totalScore.toFixed(1)}%
                    </span>
                  </div>
                  
                  <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div 
                      className={`h-2.5 rounded-full ${
                        totalScore >= 80 ? 'bg-green-600' : 
                        totalScore >= 60 ? 'bg-yellow-600' : 
                        'bg-red-600'
                      }`}
                      style={{ width: `${Math.min(totalScore, 100)}%` }}
                    ></div>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-gray-700 border-b border-gray-200 pb-2">
                    Category Scores
                  </h4>
                  
                  {categoryScores.map((catScore) => (
                    <div key={catScore.categoryId} className="border border-gray-200 bg-white rounded-md p-3 shadow-sm">
                      <div className="flex justify-between items-center mb-1">
                        <h5 className="font-medium text-sm">{catScore.categoryName}</h5>
                        <span className={`text-sm font-semibold ${
                          catScore.rawScore >= 80 ? 'text-green-600' : 
                          catScore.rawScore >= 60 ? 'text-yellow-600' : 
                          'text-red-600'
                        }`}>
                          {catScore.rawScore.toFixed(1)}%
                        </span>
                      </div>
                      
                      <div className="w-full bg-gray-200 rounded-full h-1.5 mb-2">
                        <div 
                          className={`h-1.5 rounded-full ${
                            catScore.rawScore >= 80 ? 'bg-green-600' : 
                            catScore.rawScore >= 60 ? 'bg-yellow-600' : 
                            'bg-red-600'
                          }`}
                          style={{ width: `${Math.min(catScore.rawScore, 100)}%` }}
                        ></div>
                      </div>
                      
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>Points: {catScore.earnedPoints}/{catScore.possiblePoints}</span>
                        <span className="bg-gray-100 px-2 py-1 rounded-full text-xs font-medium">
                          Weight: {(parseFloat(form.categories.find(c => c.category_name === catScore.categoryName)?.weight?.toString() || "0") || 0).toFixed(2)}
                        </span>
                      </div>
                      
                      <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>Weighted Score: {catScore.weightedScore.toFixed(1)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="bg-gray-100 p-4 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            Close Preview
          </button>
        </div>
      </div>
    </div>
  );
};

export default FormPreviewModal; 