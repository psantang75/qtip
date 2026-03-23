/**
 * CSR Dashboard Types
 */

export interface CSRStats {
  qaScore: {
    score: number;
    total: number;
  };
  goalProgress: {
    qaScore: {
      current: number;
      target: number;
    };
    trainingCompletion: {
      current: number;
      target: number;
    };
  };
  trainingStatus: {
    completed: number;
    assigned: number;
  };
}

export interface CSRAudit {
  id: number;
  form_id: number;
  formName: string;
  score: number;
  submittedDate: string;
  status: 'DRAFT' | 'SUBMITTED' | 'DISPUTED' | 'FINALIZED';
}

export interface CSRAuditDetail extends CSRAudit {
  questions: Array<{
    id: number;
    questionText: string;
    score: number;
    maxScore: number;
    notes?: string;
  }>;
}

export interface CSRDispute {
  id: number;
  submission_id: number;
  reason: string;
  status: 'OPEN' | 'UPHELD' | 'REJECTED' | 'ADJUSTED';
  created_at: string;
  resolved_at?: string;
  resolution_notes: string | null;
  attachment_url?: string;
  score?: number;
  previous_score?: number | null;
  adjusted_score?: number | null;
}

export interface CSRTrainingCourse {
  id: number;
  courseName: string;
  progress: {
    completed: number;
    total: number;
  };
  dueDate: string;
  status: 'In Progress' | 'Completed' | 'Not Started';
}

export interface CSRDashboardData {
  stats: CSRStats;
  recentAudits: CSRAudit[];
  trainingCourses: CSRTrainingCourse[];
}

// Training Dashboard Specific Types
export interface TrainingSummary {
  assignedCourses: number;
  completedCourses: number;
  overdueCourses: number;
}

export interface EnrollmentDetail {
  id: number;
  courseId: number;
  courseName: string;
  description?: string;
  progress: {
    completed: number;
    total: number;
  };
  dueDate: string;
  status: 'In Progress' | 'Completed' | 'Not Started' | 'Overdue';
  enrolledDate: string;
  completedDate?: string;
  certificateId?: number;
}

export interface CourseContent {
  id: number;
  courseName: string;
  description: string;
  pages: CoursePage[];
  quiz?: CourseQuiz;
  enrollment: {
    id: number;
    progress: number;
    status: string;
  };
}

export interface CoursePage {
  id: number;
  pageTitle: string;
  contentType: 'TEXT' | 'VIDEO' | 'PDF';
  contentText?: string;
  contentUrl?: string;
  pageOrder: number;
  isCompleted: boolean;
}

export interface CourseQuiz {
  id: number;
  quizTitle: string;
  passScore: number;
  questions: QuizQuestion[];
  userAttempts?: QuizAttempt[];
}

export interface QuizQuestion {
  id: number;
  questionText: string;
  options: string[]; // Array of option strings
  correctOption: number;
}

export interface QuizAttempt {
  id: number;
  score: number;
  answers: number[]; // Array of selected option indices
  submittedAt: string;
  passed: boolean;
}

export interface QuizSubmission {
  quizId: number;
  answers: number[]; // Array of selected option indices
}

export interface CourseProgress {
  enrollmentId: number;
  pageId?: number;
  quizId?: number;
  completed: boolean;
}

export interface Certificate {
  id: number;
  courseId: number;
  enrollmentId?: number;
  courseName: string;
  issuedDate: string;
  expiryDate?: string;
  status?: 'Valid' | 'Expired';
  certificateUrl?: string;
}

export interface TrainingFilters {
  status?: 'all' | 'in-progress' | 'completed' | 'not-started' | 'overdue';
  dueDateOrder?: 'asc' | 'desc';
}

export interface PaginatedEnrollments {
  enrollments: EnrollmentDetail[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PaginatedCertificates {
  certificates: Certificate[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// CSR Coaching Session Types
export type CoachingType = 
  | 'Classroom'
  | 'Side-by-Side' 
  | 'Team Session'
  | '1-on-1'
  | 'PIP'
  | 'Verbal Warning'
  | 'Written Warning';

export interface CSRCoachingSession {
  id: number;
  session_date: string;
  topics?: string[]; // Array of topic names
  topic_ids?: number[]; // Array of topic IDs
  // Legacy fields for backward compatibility (deprecated)
  topic?: string;
  coaching_type: CoachingType;
  notes?: string;
  status: 'SCHEDULED' | 'COMPLETED';
  attachment_filename?: string;
  attachment_path?: string;
  manager_name: string;
  created_at: string;
}

export interface CSRCoachingFilters {
  status: string;
  coaching_type: string;
  startDate: string;
  endDate: string;
  search?: string;
}

export interface PaginatedCSRCoaching {
  sessions: CSRCoachingSession[];
  totalCount: number;
  page: number;
  limit: number;
}

// LMS Service Types
export interface Course {
  id: number;
  courseName: string;
  description: string;
  status: 'DRAFT' | 'PUBLISHED';
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingPath {
  id: number;
  pathName: string;
  description: string;
  courseIds: number[];
  status: 'ACTIVE' | 'INACTIVE';
  createdBy: number;
  createdAt: string;
  updatedAt: string;
} 