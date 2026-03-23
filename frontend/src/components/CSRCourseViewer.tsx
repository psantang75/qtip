import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { 
  CourseContent, 
  CoursePage, 
  CourseQuiz, 
  QuizQuestion, 
  QuizSubmission,
  QuizAttempt 
} from '../types/csr.types';
import { 
  getCourseContent, 
  updateCourseProgress, 
  submitQuiz, 
  completeCourse,
  getCourseContentByEnrollment,
  getLastViewedPosition,
  updateLastViewedPosition
} from '../services/csrTrainingService';

// Page Content Renderer Component
const PageContentRenderer: React.FC<{ page: CoursePage }> = ({ page }) => {
  const renderContent = () => {
    switch (page.contentType) {
      case 'TEXT':
        return (
          <div 
            className="prose max-w-none"
            dangerouslySetInnerHTML={{ __html: page.contentText || '' }}
          />
        );
      
      case 'VIDEO':
        return (
          <div className="aspect-w-16 aspect-h-9">
            <video
              controls
              className="w-full h-full rounded-lg"
              src={page.contentUrl}
            >
              Your browser does not support the video tag.
            </video>
          </div>
        );
      
      case 'PDF':
        return (
          <div className="flex flex-col items-center space-y-4">
            <iframe
              src={page.contentUrl}
              className="w-full h-96 border rounded-lg"
              title={page.pageTitle}
            />
            <a
              href={page.contentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Download PDF
            </a>
          </div>
        );
      
      default:
        return <div className="text-gray-500">Content type not supported</div>;
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">{page.pageTitle}</h2>
      {renderContent()}
    </div>
  );
};

// Quiz Component
const QuizForm: React.FC<{
  quiz: CourseQuiz;
  onSubmit: (submission: QuizSubmission) => void;
  loading: boolean;
  previousAttempts?: QuizAttempt[];
}> = ({ quiz, onSubmit, loading, previousAttempts }) => {
  const [answers, setAnswers] = useState<number[]>(new Array(quiz.questions.length).fill(-1));
  const [showResults, setShowResults] = useState(false);
  const [lastAttempt, setLastAttempt] = useState<QuizAttempt | null>(
    previousAttempts && previousAttempts.length > 0 
      ? previousAttempts[previousAttempts.length - 1] 
      : null
  );

  const handleAnswerChange = (questionIndex: number, optionIndex: number) => {
    const newAnswers = [...answers];
    newAnswers[questionIndex] = optionIndex;
    setAnswers(newAnswers);
  };

  const handleSubmit = () => {
    if (answers.some(answer => answer === -1)) {
      alert('Please answer all questions before submitting.');
      return;
    }

    onSubmit({
      quizId: quiz.id,
      answers
    });
  };

  const canRetake = () => {
    return !lastAttempt || !lastAttempt.passed;
  };

  const isFormComplete = () => {
    return answers.every(answer => answer !== -1);
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">{quiz.quizTitle}</h2>
        <p className="text-sm text-gray-600">
          Pass Score: {quiz.passScore}% | {quiz.questions.length} Questions
        </p>
        {lastAttempt && (
          <div className={`mt-2 p-3 rounded-md ${lastAttempt.passed ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            <p className={`text-sm ${lastAttempt.passed ? 'text-green-800' : 'text-red-800'}`}>
              Last Attempt: {lastAttempt.score}% - {lastAttempt.passed ? 'Passed' : 'Failed'}
            </p>
          </div>
        )}
      </div>

      {(canRetake() || !lastAttempt) && (
        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="space-y-6">
          {quiz.questions.map((question, questionIndex) => (
            <div key={question.id} className="border border-gray-200 rounded-lg p-4">
              <h3 className="font-medium text-gray-900 mb-3">
                {questionIndex + 1}. {question.questionText}
              </h3>
              <div className="space-y-2">
                {question.options.map((option, optionIndex) => (
                  <label key={optionIndex} className="flex items-center">
                    <input
                      type="radio"
                      name={`question-${questionIndex}`}
                      value={optionIndex}
                      checked={answers[questionIndex] === optionIndex}
                      onChange={() => handleAnswerChange(questionIndex, optionIndex)}
                      className="mr-3 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-gray-700">{option}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}

          <div className="flex justify-between items-center pt-4">
            <div className="text-sm text-gray-500">
              {answers.filter(answer => answer !== -1).length} of {quiz.questions.length} questions answered
            </div>
            <button
              type="submit"
              disabled={!isFormComplete() || loading}
              className="px-6 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Submitting...' : 'Submit Quiz'}
            </button>
          </div>
        </form>
      )}

      {lastAttempt && lastAttempt.passed && (
        <div className="text-center py-8">
          <div className="text-green-600 mb-2">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-1">Quiz Completed Successfully!</h3>
          <p className="text-gray-600">You scored {lastAttempt.score}% and passed this quiz.</p>
        </div>
      )}
    </div>
  );
};

// Page Navigation Sidebar Component
const PageNavigation: React.FC<{
  pages: CoursePage[];
  quiz?: CourseQuiz;
  currentPageIndex: number;
  currentSection: 'page' | 'quiz';
  onPageSelect: (index: number) => void;
  onQuizSelect: () => void;
}> = ({ pages, quiz, currentPageIndex, currentSection, onPageSelect, onQuizSelect }) => {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="font-medium text-gray-900 mb-4">Course Content</h3>
      <nav className="space-y-2">
        {pages.map((page, index) => (
          <button
            key={page.id}
            onClick={() => onPageSelect(index)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
              currentSection === 'page' && currentPageIndex === index
                ? 'bg-blue-100 text-blue-700 font-medium'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <div className="flex items-center">
              {page.isCompleted ? (
                <svg className="w-4 h-4 mr-2 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <div className="w-4 h-4 mr-2 rounded-full border border-gray-300" />
              )}
              <span className="truncate">{page.pageTitle}</span>
            </div>
          </button>
        ))}
        
        {quiz && (
          <button
            onClick={onQuizSelect}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
              currentSection === 'quiz'
                ? 'bg-blue-100 text-blue-700 font-medium'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <div className="flex items-center">
              <svg className="w-4 h-4 mr-2 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <span className="truncate">{quiz.quizTitle}</span>
            </div>
          </button>
        )}
      </nav>
    </div>
  );
};

// Main Course Viewer Component
const CSRCourseViewer: React.FC = () => {
  const { enrollmentId } = useParams<{ enrollmentId: string }>();
  const navigate = useNavigate();
  
  const [courseContent, setCourseContent] = useState<CourseContent | null>(null);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [currentSection, setCurrentSection] = useState<'page' | 'quiz'>('page');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizResults, setQuizResults] = useState<QuizAttempt | null>(null);
  const [resumedFromSavedPosition, setResumedFromSavedPosition] = useState(false);

  // Load course content
  useEffect(() => {
    const loadCourse = async () => {
      if (!enrollmentId) {
        console.log('No enrollmentId provided');
        setError('No enrollment ID provided');
        setLoading(false);
        return;
      }
      
      console.log('Loading course with enrollment ID:', enrollmentId);
      
      try {
        setLoading(true);
        setError(null);
        const content = await getCourseContentByEnrollment(parseInt(enrollmentId));
        console.log('Course content loaded:', content);
        setCourseContent(content);

        // Get the last viewed position to resume where the user left off
        try {
          const lastPosition = await getLastViewedPosition(parseInt(enrollmentId));
          console.log('Last position:', lastPosition);
          
          if (lastPosition.pageIndex !== undefined && lastPosition.pageIndex > 0) {
            setCurrentPageIndex(lastPosition.pageIndex);
            console.log(`Resuming from page ${lastPosition.pageIndex}`);
            setResumedFromSavedPosition(true);
          }
        } catch (positionError) {
          console.log('No previous position found, starting from beginning');
          // If there's an error getting the position, just start from the beginning
        }
      } catch (err) {
        console.error('Error loading course:', err);
        setError(`Failed to load course content (Enrollment ID: ${enrollmentId}). Please try again.`);
      } finally {
        setLoading(false);
      }
    };

    loadCourse();
  }, [enrollmentId]);

  // Mark page as completed when viewed
  const markPageAsCompleted = async (pageId: number) => {
    if (!courseContent) return;
    
    try {
      await updateCourseProgress({
        enrollmentId: courseContent.enrollment.id,
        pageId,
        completed: true
      });
      
      // Update local state to mark page as completed
      setCourseContent(prev => prev ? {
        ...prev,
        pages: prev.pages.map(page => 
          page.id === pageId ? { ...page, isCompleted: true } : page
        )
      } : null);

      // Refresh course content to get updated progress
      const refreshedContent = await getCourseContentByEnrollment(parseInt(enrollmentId!));
      setCourseContent(refreshedContent);
    } catch (err) {
      console.error('Error marking page as completed:', err);
    }
  };

  // Handle quiz submission
  const handleQuizSubmit = async (submission: QuizSubmission) => {
    try {
      setQuizLoading(true);
      const result = await submitQuiz(submission);
      
      const attempt: QuizAttempt = {
        id: Date.now(), // Temporary ID
        score: result.score,
        answers: submission.answers,
        submittedAt: new Date().toISOString(),
        passed: result.passed
      };
      
      setQuizResults(attempt);
      
      // Update quiz attempts in course content
      if (courseContent?.quiz) {
        setCourseContent(prev => prev ? {
          ...prev,
          quiz: {
            ...prev.quiz!,
            userAttempts: [...(prev.quiz!.userAttempts || []), attempt]
          }
        } : null);
      }
    } catch (err) {
      console.error('Error submitting quiz:', err);
      alert('Failed to submit quiz. Please try again.');
    } finally {
      setQuizLoading(false);
    }
  };

  // Handle course completion
  const handleCompleteCourse = async () => {
    if (!courseContent) return;
    
    const allPagesCompleted = courseContent.pages.every(page => page.isCompleted);
    const quizPassed = !courseContent.quiz || 
      (courseContent.quiz.userAttempts && 
       courseContent.quiz.userAttempts.some(attempt => attempt.passed));
    
    if (!allPagesCompleted) {
      alert('Please complete all pages before finishing the course.');
      return;
    }
    
    if (courseContent.quiz && !quizPassed) {
      alert('Please pass the quiz before finishing the course.');
      return;
    }
    
    try {
      const certificate = await completeCourse(courseContent.enrollment.id);
      alert('Congratulations! You have completed the course and earned a certificate.');
      navigate('/training-dashboard');
    } catch (err) {
      console.error('Error completing course:', err);
      alert('Failed to complete course. Please try again.');
    }
  };

  // Navigation handlers
  const goToPage = (index: number) => {
    setCurrentPageIndex(index);
    setCurrentSection('page');
    
    // Save the current position
    if (courseContent) {
      const page = courseContent.pages[index];
      
      // Save position (don't wait for completion)
      updateLastViewedPosition({
        enrollmentId: parseInt(enrollmentId!),
        pageId: page.id,
        pageIndex: index
      }).catch(err => {
        console.error('Error saving position:', err);
        // Don't block navigation if position saving fails
      });
      
      // Mark page as completed when navigating to it
      if (!page.isCompleted) {
        markPageAsCompleted(page.id);
      }
    }
  };

  const goToQuiz = () => {
    setCurrentSection('quiz');
  };

  const goToPreviousPage = () => {
    if (currentSection === 'quiz') {
      setCurrentSection('page');
      setCurrentPageIndex(courseContent!.pages.length - 1);
    } else if (currentPageIndex > 0) {
      goToPage(currentPageIndex - 1);
    }
  };

  const goToNextPage = () => {
    if (currentSection === 'page') {
      if (currentPageIndex < courseContent!.pages.length - 1) {
        goToPage(currentPageIndex + 1);
      } else if (courseContent!.quiz) {
        goToQuiz();
      }
    }
  };

  // Check if course can be completed
  const canCompleteCourse = () => {
    if (!courseContent) return false;
    
    const allPagesCompleted = courseContent.pages.every(page => page.isCompleted);
    const quizPassed = !courseContent.quiz || 
      (courseContent.quiz.userAttempts && 
       courseContent.quiz.userAttempts.some(attempt => attempt.passed));
    
    return allPagesCompleted && quizPassed;
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-4">
          <h2 className="text-lg font-semibold text-blue-900">Debug Info</h2>
          <p className="text-blue-800">Enrollment ID: {enrollmentId || 'undefined'}</p>
          <p className="text-blue-800">Loading: {loading ? 'true' : 'false'}</p>
        </div>
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2 mb-8"></div>
          <div className="grid grid-cols-4 gap-6">
            <div className="bg-gray-200 h-96 rounded-lg"></div>
            <div className="col-span-3 bg-gray-200 h-96 rounded-lg"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !courseContent) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">Error</h3>
              <p className="mt-1 text-sm text-red-700">{error || 'Course not found'}</p>
              <button
                onClick={() => navigate('/training-dashboard')}
                className="mt-2 text-sm text-red-800 font-medium hover:text-red-900"
              >
                Back to Training Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const currentPage = courseContent.pages[currentPageIndex];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">{courseContent.courseName}</h1>
            <p className="text-gray-600 mt-1">{courseContent.description}</p>
          </div>
          <button
            onClick={() => navigate('/training-dashboard')}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Back to Dashboard
          </button>
        </div>
        
        {/* Progress Bar */}
        <div className="bg-gray-200 rounded-full h-2">
          <div 
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ 
              width: `${Math.round(courseContent.enrollment.progress * 100)}%` 
            }}
          />
        </div>
        <div className="text-sm text-gray-600 mt-1">
          Progress: {Math.round(courseContent.enrollment.progress * 100)}%
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar Navigation */}
        <div className="lg:col-span-1">
          <PageNavigation
            pages={courseContent.pages}
            quiz={courseContent.quiz}
            currentPageIndex={currentPageIndex}
            currentSection={currentSection}
            onPageSelect={goToPage}
            onQuizSelect={goToQuiz}
          />
        </div>

        {/* Content Area */}
        <div className="lg:col-span-3">
          {currentSection === 'page' && currentPage && (
            <PageContentRenderer page={currentPage} />
          )}
          
          {currentSection === 'quiz' && courseContent.quiz && (
            <QuizForm
              quiz={courseContent.quiz}
              onSubmit={handleQuizSubmit}
              loading={quizLoading}
              previousAttempts={courseContent.quiz.userAttempts}
            />
          )}

          {/* Navigation Controls */}
          <div className="flex justify-between items-center mt-6 p-4 bg-gray-50 rounded-lg">
            <button
              onClick={goToPreviousPage}
              disabled={currentSection === 'page' && currentPageIndex === 0}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>

            <div className="text-sm text-gray-600">
              {currentSection === 'page' 
                ? `Page ${currentPageIndex + 1} of ${courseContent.pages.length}`
                : 'Quiz'
              }
            </div>

            <div className="space-x-2">
              {currentSection === 'page' && 
               (currentPageIndex < courseContent.pages.length - 1 || courseContent.quiz) && (
                <button
                  onClick={goToNextPage}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700"
                >
                  Next
                </button>
              )}
              
              {canCompleteCourse() && (
                <button
                  onClick={handleCompleteCourse}
                  className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md hover:bg-green-700"
                >
                  Complete Course
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CSRCourseViewer; 