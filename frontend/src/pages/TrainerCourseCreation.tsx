import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useAuth } from '../contexts/AuthContext';
import { courseService } from '../services/courseService';
import PageTable from '../components/course/PageTable';
import PageForm from '../components/course/PageForm';
import QuizForm from '../components/course/QuizForm';
import type { Course, CoursePage, Quiz, CourseCreatePayload } from '../types/course.types';

const CourseCreationWizard: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [isPageFormOpen, setIsPageFormOpen] = useState(false);
  const [editingPageIndex, setEditingPageIndex] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Course state
  const [courseData, setCourseData] = useState<Course>({
    course_name: '',
    description: '',
    is_draft: true,
    pages: [],
    quiz: {
      quiz_title: '',
      pass_score: 80,
      questions: [],
    },
  });

  // Form for metadata step
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Pick<Course, 'course_name' | 'description'>>({
    defaultValues: {
      course_name: courseData.course_name,
      description: courseData.description,
    },
  });

  const steps = [
    { number: 1, name: 'Metadata', description: 'Course details' },
    { number: 2, name: 'Pages', description: 'Course content' },
    { number: 3, name: 'Quiz', description: 'Assessment' },
    { number: 4, name: 'Review', description: 'Final review' },
  ];

  const canProceedToNextStep = () => {
    switch (currentStep) {
      case 1:
        return courseData.course_name.trim() !== '';
      case 2:
        return courseData.pages.length > 0;
      case 3:
        return courseData.quiz.quiz_title.trim() !== '' && courseData.quiz.questions.length > 0;
      default:
        return true;
    }
  };

  const handleMetadataSubmit = (data: Pick<Course, 'course_name' | 'description'>) => {
    setCourseData({
      ...courseData,
      course_name: data.course_name,
      description: data.description,
    });
    setCurrentStep(2);
  };

  const handleAddPage = () => {
    setEditingPageIndex(null);
    setIsPageFormOpen(true);
  };

  const handleEditPage = (index: number) => {
    setEditingPageIndex(index);
    setIsPageFormOpen(true);
  };

  const handleSavePage = (page: CoursePage) => {
    const newPages = [...courseData.pages];
    
    if (editingPageIndex !== null) {
      newPages[editingPageIndex] = page;
    } else {
      newPages.push(page);
    }

    setCourseData({
      ...courseData,
      pages: newPages,
    });
  };

  const handleDeletePage = (index: number) => {
    const newPages = courseData.pages.filter((_, i) => i !== index);
    // Reorder remaining pages
    const reorderedPages = newPages.map((page, i) => ({
      ...page,
      page_order: i + 1,
    }));

    setCourseData({
      ...courseData,
      pages: reorderedPages,
    });
  };

  const handlePagesChange = (pages: CoursePage[]) => {
    setCourseData({
      ...courseData,
      pages,
    });
  };

  const handleQuizChange = (quiz: Quiz) => {
    setCourseData({
      ...courseData,
      quiz,
    });
  };

  const submitCourse = async (isDraft: boolean) => {
    if (!user) return;

    setIsSubmitting(true);
    
    try {
      const payload: CourseCreatePayload = {
        course_name: courseData.course_name,
        description: courseData.description,
        created_by: user.id,
        is_draft: isDraft,
        pages: courseData.pages.map(({ id, course_id, ...page }) => page),
        quiz: {
          quiz_title: courseData.quiz.quiz_title,
          pass_score: courseData.quiz.pass_score,
          questions: courseData.quiz.questions.map(({ id, quiz_id, ...question }) => question),
        },
      };

      await courseService.createCourse(payload);
      navigate('/trainer/course-builder');
    } catch (error) {
      console.error('Error creating course:', error);
      alert('Failed to create course. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveDraft = () => submitCourse(true);
  const handlePublish = () => submitCourse(false);

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">Course Metadata</h2>
            <form onSubmit={handleSubmit(handleMetadataSubmit)} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Course Name *
                </label>
                <input
                  type="text"
                  {...register('course_name', {
                    required: 'Course name is required',
                    maxLength: {
                      value: 100,
                      message: 'Course name must be 100 characters or less',
                    },
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter course name"
                />
                {errors.course_name && (
                  <p className="mt-1 text-sm text-red-600">{errors.course_name.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  {...register('description', {
                    maxLength: {
                      value: 1000,
                      message: 'Description must be 1000 characters or less',
                    },
                  })}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter course description"
                />
                {errors.description && (
                  <p className="mt-1 text-sm text-red-600">{errors.description.message}</p>
                )}
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Next
                </button>
              </div>
            </form>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-lg shadow">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-gray-800">Course Pages</h2>
                <button
                  onClick={handleAddPage}
                  className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                >
                  Add Page
                </button>
              </div>

              <PageTable
                pages={courseData.pages}
                onPagesChange={handlePagesChange}
                onEditPage={handleEditPage}
                onDeletePage={handleDeletePage}
              />
            </div>

            <PageForm
              isOpen={isPageFormOpen}
              onClose={() => setIsPageFormOpen(false)}
              onSave={handleSavePage}
              page={editingPageIndex !== null ? courseData.pages[editingPageIndex] : undefined}
              nextPageOrder={courseData.pages.length + 1}
            />
          </div>
        );

      case 3:
        return (
          <QuizForm
            quiz={courseData.quiz}
            onQuizChange={handleQuizChange}
          />
        );

      case 4:
        return (
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold text-gray-800 mb-6">Review Course</h2>
            
            {/* Course Metadata */}
            <div className="mb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-2">Course Details</h3>
              <div className="bg-gray-50 p-4 rounded-lg">
                <p><strong>Name:</strong> {courseData.course_name}</p>
                {courseData.description && (
                  <p><strong>Description:</strong> {courseData.description}</p>
                )}
              </div>
            </div>

            {/* Pages Summary */}
            <div className="mb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Pages ({courseData.pages.length})
              </h3>
              <div className="bg-gray-50 p-4 rounded-lg">
                {courseData.pages.map((page, index) => (
                  <div key={index} className="flex justify-between items-center py-2 border-b border-gray-200 last:border-b-0">
                    <span>{page.page_title}</span>
                    <span className="text-sm text-gray-500">{page.content_type}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Quiz Summary */}
            <div className="mb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Quiz: {courseData.quiz.quiz_title}
              </h3>
              <div className="bg-gray-50 p-4 rounded-lg">
                <p><strong>Pass Score:</strong> {courseData.quiz.pass_score}%</p>
                <p><strong>Questions:</strong> {courseData.quiz.questions.length}</p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end space-x-3">
              <button
                onClick={handleSaveDraft}
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : 'Save as Draft'}
              </button>
              <button
                onClick={handlePublish}
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
              >
                {isSubmitting ? 'Publishing...' : 'Publish Course'}
              </button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate('/trainer/course-builder')}
            className="text-blue-600 hover:text-blue-800 mb-4 flex items-center"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Course Builder
          </button>
          <h1 className="text-3xl font-bold text-gray-900">Create New Course</h1>
        </div>

        {/* Step Indicator */}
        <div className="mb-8">
          <nav aria-label="Progress">
            <ol className="flex items-center">
              {steps.map((step, stepIdx) => (
                <li key={step.name} className={`${stepIdx !== steps.length - 1 ? 'pr-8 sm:pr-20' : ''} relative`}>
                  <div className="flex items-center">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-full ${
                        step.number < currentStep
                          ? 'bg-blue-600 text-white'
                          : step.number === currentStep
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-200 text-gray-400'
                      }`}
                    >
                      {step.number < currentStep ? (
                        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <span>{step.number}</span>
                      )}
                    </div>
                    <div className="ml-3">
                      <div className={`text-sm font-medium ${step.number <= currentStep ? 'text-blue-600' : 'text-gray-400'}`}>
                        {step.name}
                      </div>
                      <div className="text-xs text-gray-500">{step.description}</div>
                    </div>
                  </div>
                  {stepIdx !== steps.length - 1 && (
                    <div className="absolute top-4 left-8 -ml-px h-0.5 w-full bg-gray-200" />
                  )}
                </li>
              ))}
            </ol>
          </nav>
        </div>

        {/* Step Content */}
        {renderStepContent()}

        {/* Navigation */}
        {currentStep > 1 && currentStep < 4 && (
          <div className="flex justify-between mt-6">
            <button
              onClick={() => setCurrentStep(currentStep - 1)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Previous
            </button>
            <button
              onClick={() => setCurrentStep(currentStep + 1)}
              disabled={!canProceedToNextStep()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}

        {currentStep === 4 && (
          <div className="flex justify-start mt-6">
            <button
              onClick={() => setCurrentStep(currentStep - 1)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Previous
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CourseCreationWizard; 