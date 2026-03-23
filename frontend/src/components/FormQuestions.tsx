import React, { useState } from 'react';
import type { FormCategory, FormQuestion, QuestionType, ConditionType, RadioOption } from '../types/form.types';

interface FormQuestionsProps {
  categories: FormCategory[];
  onUpdateCategory: (categoryIndex: number, updatedCategory: FormCategory) => void;
}

const FormQuestions: React.FC<FormQuestionsProps> = ({ categories, onUpdateCategory }) => {
  const [selectedCategoryIndex, setSelectedCategoryIndex] = useState<number>(0);
  const [questionText, setQuestionText] = useState('');
  const [questionType, setQuestionType] = useState<QuestionType>('YES_NO');
  const [isNaAllowed, setIsNaAllowed] = useState(false);
  const [scaleMin, setScaleMin] = useState(1);
  const [scaleMax, setScaleMax] = useState(5);
  const [weight, setWeight] = useState('0');
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConditional, setIsConditional] = useState(false);
  const [conditionType, setConditionType] = useState<ConditionType>('EQUALS');
  const [conditionalQuestionId, setConditionalQuestionId] = useState<number | null>(null);
  const [conditionalValue, setConditionalValue] = useState('');
  const [excludeIfUnmet, setExcludeIfUnmet] = useState(false);
  // Radio options
  const [radioOptions, setRadioOptions] = useState<RadioOption[]>([]);
  const [newOptionText, setNewOptionText] = useState('');
  const [newOptionValue, setNewOptionValue] = useState('');
  const [newOptionScore, setNewOptionScore] = useState(0);
  const [newOptionHasFreeText, setNewOptionHasFreeText] = useState(false);

  const selectedCategory = categories[selectedCategoryIndex] || null;
  
  // Get all questions across all categories for conditional logic
  const allQuestions = categories.flatMap((cat, catIndex) => 
    cat.questions.map((q, qIndex) => ({ 
      // Generate stable, deterministic IDs for questions without real IDs
      id: q.id || -(catIndex * 1000 + qIndex + 1), // Negative IDs for temporary questions
      text: q.question_text, 
      type: q.question_type,
      categoryName: cat.category_name
    }))
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate input
    if (!questionText.trim()) {
      setError('Question text is required');
      return;
    }
    
    if (!selectedCategory) {
      setError('Please select a category');
      return;
    }
    
    let weightValue = parseFloat(weight);
    if (questionType !== 'INFO_BLOCK' && questionType !== 'TEXT' && questionType !== 'SUB_CATEGORY') {
      if (isNaN(weightValue) || weightValue < 0 || weightValue > 1) {
        setError('Weight must be a number between 0 and 1');
        return;
      }
    } else {
      weightValue = 0; // Info blocks, text questions, and subcategories have no weight
    }
    
    if (questionType === 'SCALE') {
      if (scaleMin >= scaleMax) {
        setError('Scale minimum must be less than maximum');
        return;
      }
    }

    if (questionType === 'RADIO' && radioOptions.length === 0) {
      setError('Radio questions must have at least one option');
      return;
    }
    
    const newQuestion: FormQuestion = {
      question_text: questionText,
      question_type: questionType,
      weight: weightValue,
      is_na_allowed: isNaAllowed,
      is_required: true,
      ...(questionType === 'SCALE' && { scale_min: scaleMin, scale_max: scaleMax }),
      is_conditional: isConditional,
      ...(isConditional && {
        condition_type: conditionType,
        conditional_question_id: conditionalQuestionId,
        conditional_value: conditionalValue,
        exclude_if_unmet: excludeIfUnmet
      }),
      ...(questionType === 'RADIO' && { radio_options: radioOptions })
    };
    
    const updatedCategory = { ...selectedCategory };
    
    if (editIndex !== null) {
      // Update existing question
      updatedCategory.questions = updatedCategory.questions.map((q, idx) => 
        idx === editIndex ? newQuestion : q
      );
    } else {
      // Add new question
      updatedCategory.questions = [...updatedCategory.questions, newQuestion];
    }
    
    onUpdateCategory(selectedCategoryIndex, updatedCategory);
    
    // Reset form
    resetForm();
  };

  const resetForm = () => {
    setQuestionText('');
    setQuestionType('YES_NO');
    setIsNaAllowed(false);
    setScaleMin(1);
    setScaleMax(5);
    setWeight('0');
    setEditIndex(null);
    setError(null);
    setIsConditional(false);
    setConditionType('EQUALS');
    setConditionalQuestionId(null);
    setConditionalValue('');
    setExcludeIfUnmet(false);
    setRadioOptions([]);
    setNewOptionText('');
    setNewOptionValue('');
    setNewOptionScore(0);
    setNewOptionHasFreeText(false);
  };

  const startEditing = (questionIndex: number) => {
    const question = selectedCategory?.questions[questionIndex];
    if (!question) return;
    
    setQuestionText(question.question_text);
    setQuestionType(question.question_type);
    setIsNaAllowed(question.is_na_allowed || false);
    setScaleMin(question.scale_min || 1);
    setScaleMax(question.scale_max || 5);
    setWeight(question.weight.toString());
    setIsConditional(question.is_conditional || false);
    setConditionType(question.condition_type || 'EQUALS');
    setConditionalQuestionId(question.conditional_question_id || null);
    setConditionalValue(question.conditional_value || '');
    setExcludeIfUnmet(question.exclude_if_unmet || false);
    setRadioOptions(question.radio_options || []);
    setEditIndex(questionIndex);
  };

  const removeQuestion = (questionIndex: number) => {
    if (!selectedCategory) return;
    
    const updatedCategory = { ...selectedCategory };
    updatedCategory.questions = updatedCategory.questions.filter((_, idx) => idx !== questionIndex);
    
    onUpdateCategory(selectedCategoryIndex, updatedCategory);
  };

  const addRadioOption = () => {
    if (!newOptionText || !newOptionValue) {
      setError('Radio option text and value are required');
      return;
    }

    const newOption: RadioOption = {
      option_text: newOptionText,
      option_value: newOptionValue,
      score: newOptionScore,
      has_free_text: newOptionHasFreeText
    };

    setRadioOptions([...radioOptions, newOption]);
    setNewOptionText('');
    setNewOptionValue('');
    setNewOptionScore(0);
    setNewOptionHasFreeText(false);
  };

  const removeRadioOption = (index: number) => {
    setRadioOptions(radioOptions.filter((_, idx) => idx !== index));
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-xl font-semibold mb-4 text-gray-800">Form Questions</h3>
      
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}
      
      <div className="mb-4">
        <label htmlFor="categorySelect" className="block text-sm font-medium text-gray-700 mb-1">
          Select Category
        </label>
        <select
          id="categorySelect"
          value={selectedCategoryIndex}
          onChange={(e) => {
            setSelectedCategoryIndex(Number(e.target.value));
            resetForm();
          }}
          className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {categories.map((category, index) => (
            <option key={index} value={index}>
              {category.category_name} ({category.questions.length} questions)
            </option>
          ))}
        </select>
      </div>
      
      {selectedCategory ? (
        <>
          <form onSubmit={handleSubmit} className="mb-6 border border-gray-200 p-4 rounded">
            <div className="mb-4">
              <label htmlFor="questionText" className="block text-sm font-medium text-gray-700 mb-1">
                Question Text*
              </label>
              <textarea
                id="questionText"
                value={questionText}
                onChange={(e) => setQuestionText(e.target.value)}
                placeholder="Enter question text"
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label htmlFor="questionType" className="block text-sm font-medium text-gray-700 mb-1">
                  Question Type*
                </label>
                <select
                  id="questionType"
                  value={questionType}
                  onChange={(e) => setQuestionType(e.target.value as QuestionType)}
                  className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="YES_NO">Yes/No</option>
                  <option value="SCALE">Scale</option>
                  <option value="TEXT">Text Input</option>
                  <option value="INFO_BLOCK">Information Block</option>
                  <option value="RADIO">Radio Options</option>
                  <option value="SUB_CATEGORY">Sub-Category</option>
                </select>
              </div>
              
              {questionType !== 'INFO_BLOCK' && questionType !== 'TEXT' && (
                <div>
                  <label htmlFor="weight" className="block text-sm font-medium text-gray-700 mb-1">
                    Weight*
                  </label>
                  <input
                    type="number"
                    id="weight"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    step="0.01"
                    min="0"
                    max="1"
                    className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Value between 0 and 1 (e.g., 0.5 for 50%)
                  </p>
                </div>
              )}
            </div>
            
            {questionType === 'INFO_BLOCK' && (
              <div className="mb-4">
                <label htmlFor="infoBlockText" className="block text-sm font-medium text-gray-700 mb-1">
                  Information Block Text*
                </label>
                <textarea
                  id="infoBlockText"
                  value={questionText}
                  onChange={(e) => setQuestionText(e.target.value)}
                  placeholder="Enter information text to display"
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-blue-50"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  This text will be displayed as an information block in the form.
                </p>
              </div>
            )}
            
            {(questionType === 'YES_NO' || questionType === 'SCALE') && (
              <div className="mb-4">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="isNaAllowed"
                    checked={isNaAllowed}
                    onChange={(e) => setIsNaAllowed(e.target.checked)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 rounded border-gray-300"
                  />
                  <label htmlFor="isNaAllowed" className="ml-2 block text-sm text-gray-700">
                    Allow N/A option
                  </label>
                </div>
                
                {isNaAllowed && (
                  <div className="mt-2 ml-6">
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="isConditional"
                        checked={isConditional}
                        onChange={(e) => setIsConditional(e.target.checked)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 rounded border-gray-300"
                      />
                      <label htmlFor="isConditional" className="ml-2 block text-sm text-gray-700">
                        Add conditional logic (show/hide other questions)
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {questionType === 'SCALE' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label htmlFor="scaleMin" className="block text-sm font-medium text-gray-700 mb-1">
                    Scale Minimum*
                  </label>
                  <input
                    type="number"
                    id="scaleMin"
                    value={scaleMin}
                    onChange={(e) => setScaleMin(Number(e.target.value))}
                    className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="scaleMax" className="block text-sm font-medium text-gray-700 mb-1">
                    Scale Maximum*
                  </label>
                  <input
                    type="number"
                    id="scaleMax"
                    value={scaleMax}
                    onChange={(e) => setScaleMax(Number(e.target.value))}
                    className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>
            )}
            
            {questionType === 'RADIO' && (
              <div className="mb-4 border-t border-gray-200 pt-4">
                <h4 className="text-md font-medium mb-2">Radio Options</h4>
                
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-2">
                  <div>
                    <label htmlFor="optionText" className="block text-xs font-medium text-gray-700 mb-1">
                      Option Text*
                    </label>
                    <input
                      type="text"
                      id="optionText"
                      value={newOptionText}
                      onChange={(e) => setNewOptionText(e.target.value)}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Option label"
                    />
                  </div>
                  <div>
                    <label htmlFor="optionValue" className="block text-xs font-medium text-gray-700 mb-1">
                      Option Value*
                    </label>
                    <input
                      type="text"
                      id="optionValue"
                      value={newOptionValue}
                      onChange={(e) => setNewOptionValue(e.target.value)}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Unique identifier"
                    />
                  </div>
                  <div>
                    <label htmlFor="optionScore" className="block text-xs font-medium text-gray-700 mb-1">
                      Score
                    </label>
                    <input
                      type="number"
                      id="optionScore"
                      value={newOptionScore}
                      onChange={(e) => setNewOptionScore(Number(e.target.value))}
                      step="0.1"
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Option score"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={addRadioOption}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      Add Option
                    </button>
                    <div className="ml-2 flex items-center">
                      <input
                        type="checkbox"
                        id="hasFreeText"
                        checked={newOptionHasFreeText}
                        onChange={(e) => setNewOptionHasFreeText(e.target.checked)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 rounded border-gray-300"
                      />
                      <label htmlFor="hasFreeText" className="ml-1 block text-xs text-gray-700">
                        Free text
                      </label>
                    </div>
                  </div>
                </div>
                
                {radioOptions.length > 0 ? (
                  <div className="mt-2 border border-gray-200 rounded p-2 bg-gray-50">
                    <h5 className="text-sm font-medium mb-1">Added Options:</h5>
                    <ul className="divide-y divide-gray-200">
                      {radioOptions.map((option, idx) => (
                        <li key={idx} className="py-2 flex justify-between items-center">
                          <div>
                            <span className="font-medium">{option.option_text}</span>
                            <span className="ml-2 text-sm text-gray-600">({option.option_value})</span>
                            <span className="ml-2 text-sm text-gray-600">Score: {option.score}</span>
                            {option.has_free_text && (
                              <span className="ml-2 text-xs text-blue-600">+Free text</span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeRadioOption(idx)}
                            className="text-red-600 hover:text-red-800"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="text-center py-2 text-gray-500 border border-dashed border-gray-300 rounded mt-2">
                    No options added yet. Add at least one option.
                  </div>
                )}
              </div>
            )}
            
            {isConditional && (
              <div className="mt-4 border-t border-gray-200 pt-4">
                <h4 className="text-md font-medium mb-2">Conditional Logic</h4>
                <p className="text-sm text-gray-600 mb-2">
                  This question will only be shown based on the answer to another question.
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label htmlFor="conditionalQuestionId" className="block text-sm font-medium text-gray-700 mb-1">
                      Source Question*
                    </label>
                    <select
                      id="conditionalQuestionId"
                      value={conditionalQuestionId || ''}
                      onChange={(e) => {
                        console.log('Selected conditional question ID:', e.target.value);
                        const selectedId = e.target.value ? Number(e.target.value) : null;
                        setConditionalQuestionId(selectedId);
                      }}
                      className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- Select Question --</option>
                      {allQuestions
                        .filter(q => q.type === 'YES_NO' || q.type === 'SCALE' || q.type === 'RADIO')
                        .map((q, idx) => (
                          <option key={idx} value={q.id}>
                            {q.categoryName}: {q.text.substring(0, 30)}{q.text.length > 30 ? '...' : ''}
                          </option>
                        ))}
                    </select>
                  </div>
                  
                  <div>
                    <label htmlFor="conditionType" className="block text-sm font-medium text-gray-700 mb-1">
                      Condition*
                    </label>
                    <select
                      id="conditionType"
                      value={conditionType}
                      onChange={(e) => setConditionType(e.target.value as ConditionType)}
                      className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="EQUALS">Equals</option>
                      <option value="NOT_EQUALS">Not Equals</option>
                    </select>
                  </div>
                </div>
                
                <div className="mb-4">
                  <label htmlFor="conditionalValue" className="block text-sm font-medium text-gray-700 mb-1">
                    Value*
                  </label>
                  <input
                    type="text"
                    id="conditionalValue"
                    value={conditionalValue}
                    onChange={(e) => setConditionalValue(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="YES, NO, or a scale/radio value"
                  />
                </div>
                
                <div className="mb-4">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="excludeIfUnmet"
                      checked={excludeIfUnmet}
                      onChange={(e) => setExcludeIfUnmet(e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 rounded border-gray-300"
                    />
                    <label htmlFor="excludeIfUnmet" className="ml-2 block text-sm text-gray-700">
                      Exclude from scoring if condition not met
                    </label>
                  </div>
                </div>
              </div>
            )}
            
            <div className="mt-4 flex space-x-2">
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {editIndex !== null ? 'Update Question' : 'Add Question'}
              </button>
              
              {editIndex !== null && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
          
          <div className="border-t border-gray-200 pt-4">
            <h4 className="text-lg font-medium mb-2">Questions in {selectedCategory.category_name}</h4>
            
            {selectedCategory.questions.length === 0 ? (
              <div className="text-center py-4 text-gray-500 border border-dashed border-gray-300 rounded">
                No questions added yet. Add questions to this category.
              </div>
            ) : (
              <div className="space-y-2">
                {selectedCategory.questions.map((question, idx) => (
                  <div key={idx} className="border border-gray-200 rounded p-3 hover:bg-gray-50">
                    <div className="flex justify-between">
                      <div>
                        <div className="text-gray-900 font-medium">{question.question_text}</div>
                        <div className="text-sm text-gray-600 mt-1">
                          <span className="font-medium mr-2">Type:</span>
                          {question.question_type}
                          {question.question_type === 'SCALE' && (
                            <span className="ml-1">
                              ({question.scale_min}-{question.scale_max})
                            </span>
                          )}
                          {question.question_type === 'RADIO' && (
                            <span className="ml-1">
                              ({question.radio_options?.length || 0} options)
                            </span>
                          )}
                          {question.is_na_allowed && <span className="ml-2">(N/A allowed)</span>}
                          {(question.question_type === 'YES_NO' || question.question_type === 'SCALE' || question.question_type === 'RADIO') && (
                            <span className="ml-2">
                              <span className="font-medium">Weight:</span> {question.weight.toFixed(2)}
                            </span>
                          )}
                          {question.is_conditional && (
                            <span className="ml-2 text-blue-600">Has conditional logic</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <button
                          type="button"
                          onClick={() => startEditing(idx)}
                          className="text-blue-600 hover:text-blue-800 mr-2"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => removeQuestion(idx)}
                          className="text-red-600 hover:text-red-900"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="text-center py-8 text-gray-500 border border-dashed border-gray-300 rounded">
          No categories available. Please add categories first.
        </div>
      )}
    </div>
  );
};

export default FormQuestions; 