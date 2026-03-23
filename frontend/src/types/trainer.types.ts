/**
 * Training summary statistics
 */
export interface TrainingStats {
  activeCourses: number;
  totalEnrollments: number;
  completionRate: number;
}

/**
 * Course item for displaying in the courses table
 */
export interface CourseItem {
  id: number;
  courseName: string;
  description: string;
  enrollmentCount: number;
  completionRate: number;
  createdAt: string;
  createdBy: number;
}

/**
 * Trainee progress for displaying in the trainees table
 */
export interface TraineeProgress {
  id: number;
  userId: number;
  userName: string;
  courseId: number;
  courseName: string;
  progress: number;
  totalPages: number;
  status: 'IN_PROGRESS' | 'COMPLETED';
  enrolledAt: string;
}

/**
 * Course page content
 */
export interface CoursePage {
  id: number;
  courseId: number;
  pageTitle: string;
  contentType: 'TEXT' | 'VIDEO' | 'PDF';
  contentUrl: string | null;
  contentText: string | null;
  pageOrder: number;
}

/**
 * Quiz data structure
 */
export interface Quiz {
  id: number;
  courseId: number;
  quizTitle: string;
  passScore: number;
  questions: QuizQuestion[];
}

/**
 * Quiz question structure
 */
export interface QuizQuestion {
  id: number;
  quizId: number;
  questionText: string;
  options: string;
  correctOption: number;
}

/**
 * Certificate data
 */
export interface Certificate {
  id: number;
  userId: number;
  courseId: number;
  courseName: string;
  issueDate: string;
  expiryDate: string | null;
} 