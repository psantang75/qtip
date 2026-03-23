import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { Quiz, QuizQuestion } from '../../types/course.types';

interface QuizFormProps {
  quiz: Quiz;
  onQuizChange: (quiz: Quiz) => void;
}

const QuizForm: React.FC<QuizFormProps> = ({ quiz, onQuizChange }) => {
  const [isAddingQuestion, setIsAddingQuestion] = useState(false);
  const [editingQuestionIndex, setEditingQuestionIndex] = useState<number | null>(null);

  const {
    register: registerQuiz,
    handleSubmit: handleQuizSubmit,
    formState: { errors: quizErrors },
  } = useForm<Quiz>({
    defaultValues: quiz,
  });

  const {
    register: registerQuestion,
    handleSubmit: handleQuestionSubmit,
    reset: resetQuestion,
    formState: { errors: questionErrors },
  } = useForm<QuizQuestion>({
    defaultValues: {
      question_text: '',
      options: ['', '', '', ''],
      correct_option: 1,
    },
  });

  const onQuizDetailsSubmit = (data: Quiz) => {
    onQuizChange({
      ...quiz,
      quiz_title: data.quiz_title,
      pass_score: data.pass_score,
    });
  };

  const onQuestionSubmit = (data: QuizQuestion) => {
    const newQuestions = [...quiz.questions];
    
    if (editingQuestionIndex !== null) {
      // Edit existing question
      newQuestions[editingQuestionIndex] = data;
    } else {
      // Add new question
      newQuestions.push(data);
    }

    onQuizChange({
      ...quiz,
      questions: newQuestions,
    });

    // Reset form and close modal
    resetQuestion({
      question_text: '',
      options: ['', '', '', ''],
      correct_option: 1,
    });
    setIsAddingQuestion(false);
    setEditingQuestionIndex(null);
  };

  const handleEditQuestion = (index: number) => {
    const question = quiz.questions[index];
    resetQuestion(question);
    setEditingQuestionIndex(index);
    setIsAddingQuestion(true);
  };

  const handleDeleteQuestion = (index: number) => {
    const newQuestions = quiz.questions.filter((_, i) => i !== index);
    onQuizChange({
      ...quiz,
      questions: newQuestions,
    });
  };

  const handleAddQuestion = () => {
    resetQuestion({
      question_text: '',
      options: ['', '', '', ''],
      correct_option: 1,
    });
    setEditingQuestionIndex(null);
    setIsAddingQuestion(true);
  };

  const handleCancelQuestion = () => {
    setIsAddingQuestion(false);
    setEditingQuestionIndex(null);
    resetQuestion({
      question_text: '',
      options: ['', '', '', ''],
      correct_option: 1,
    });
  };

  return (
    <div className="space-y-6">
      {/* Quiz Details */}
      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Quiz Details</h3>
        
        <form onSubmit={handleQuizSubmit(onQuizDetailsSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Quiz Title *
            </label>
            <input
              type="text"
              {...registerQuiz('quiz_title', {
                required: 'Quiz title is required',
                maxLength: {
                  value: 100,
                  message: 'Quiz title must be 100 characters or less',
                },
              })}
              defaultValue={quiz.quiz_title}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              placeholder="Enter quiz title"
            />
            {quizErrors.quiz_title && (
              <p className="mt-1 text-sm text-red-600">{quizErrors.quiz_title.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Pass Score (%) *
            </label>
            <input
              type="number"
              {...registerQuiz('pass_score', {
                required: 'Pass score is required',
                min: { value: 0, message: 'Pass score must be at least 0' },
                max: { value: 100, message: 'Pass score must be at most 100' },
              })}
              defaultValue={quiz.pass_score}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              min="0"
              max="100"
              placeholder="80"
            />
            {quizErrors.pass_score && (
              <p className="mt-1 text-sm text-red-600">{quizErrors.pass_score.message}</p>
            )}
          </div>

          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Update Quiz Details
          </button>
        </form>
      </div>

      {/* Questions Section */}
      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-gray-900">Quiz Questions</h3>
          <button
            onClick={handleAddQuestion}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
          >
            Add Question
          </button>
        </div>

        {/* Questions List */}
        {quiz.questions.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 rounded-lg border border-gray-200">
            <p className="text-gray-500">No questions added yet. Click "Add Question" to get started.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {quiz.questions.map((question, index) => (
              <div key={index} className="border border-gray-200 rounded-lg p-4">
                <div className="flex justify-between items-start mb-2">
                  <h4 className="font-medium text-gray-900">Question {index + 1}</h4>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleEditQuestion(index)}
                      className="text-indigo-600 hover:text-indigo-900 text-sm"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteQuestion(index)}
                      className="text-red-600 hover:text-red-900 text-sm"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                
                <p className="text-gray-700 mb-3">{question.question_text}</p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {question.options.map((option, optionIndex) => (
                    <div
                      key={optionIndex}
                      className={`p-2 rounded border text-sm ${
                        question.correct_option === optionIndex + 1
                          ? 'bg-green-50 border-green-200 text-green-800'
                          : 'bg-gray-50 border-gray-200 text-gray-700'
                      }`}
                    >
                      <span className="font-medium">
                        {String.fromCharCode(65 + optionIndex)}.
                      </span>{' '}
                      {option}
                      {question.correct_option === optionIndex + 1 && (
                        <span className="ml-2 text-green-600 font-medium">(Correct)</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Question Modal */}
      {isAddingQuestion && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-900">
                {editingQuestionIndex !== null ? 'Edit Question' : 'Add Question'}
              </h2>
              <button
                onClick={handleCancelQuestion}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleQuestionSubmit(onQuestionSubmit)} className="space-y-4">
              {/* Question Text */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Question Text *
                </label>
                <textarea
                  {...registerQuestion('question_text', {
                    required: 'Question text is required',
                    maxLength: {
                      value: 255,
                      message: 'Question text must be 255 characters or less',
                    },
                  })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter your question"
                />
                {questionErrors.question_text && (
                  <p className="mt-1 text-sm text-red-600">{questionErrors.question_text.message}</p>
                )}
              </div>

              {/* Options */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Answer Options *
                </label>
                <div className="space-y-2">
                  {[0, 1, 2, 3].map((optionIndex) => (
                    <div key={optionIndex}>
                      <input
                        type="text"
                        {...registerQuestion(`options.${optionIndex}` as const, {
                          required: 'All options are required',
                          maxLength: {
                            value: 255,
                            message: 'Option must be 255 characters or less',
                          },
                        })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        placeholder={`Option ${String.fromCharCode(65 + optionIndex)}`}
                      />
                      {questionErrors.options?.[optionIndex] && (
                        <p className="mt-1 text-sm text-red-600">
                          {questionErrors.options[optionIndex]?.message}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Correct Option */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Correct Answer *
                </label>
                <select
                  {...registerQuestion('correct_option', {
                    required: 'Correct option is required',
                    min: { value: 1, message: 'Please select a valid option' },
                    max: { value: 4, message: 'Please select a valid option' },
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value={1}>Option A</option>
                  <option value={2}>Option B</option>
                  <option value={3}>Option C</option>
                  <option value={4}>Option D</option>
                </select>
                {questionErrors.correct_option && (
                  <p className="mt-1 text-sm text-red-600">{questionErrors.correct_option.message}</p>
                )}
              </div>

              {/* Form Actions */}
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={handleCancelQuestion}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  {editingQuestionIndex !== null ? 'Update Question' : 'Add Question'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default QuizForm; 