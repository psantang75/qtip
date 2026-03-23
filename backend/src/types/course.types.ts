
// Content Type Enum
export enum content_type {
  TEXT = 'TEXT',
  VIDEO = 'VIDEO',
  PDF = 'PDF'
}

// Course Status Enum
export enum CourseStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED'
}

// Database course record
export interface CourseRecord {
  id: number;
  course_name: string;
  description?: string;
  created_by: number;
  created_at: Date;
  status: CourseStatus;
}

// Course page record
export interface CoursePageRecord {
  id: number;
  course_id: number;
  page_title: string;
  content_type: content_type;
  content_url?: string;
  content_text?: string;
  page_order: number;
}

// Quiz record
export interface QuizRecord {
  id: number;
  course_id: number;
  quiz_title: string;
  pass_score: number; // Decimal, e.g., 0.8 for 80%
}

// Quiz question record
export interface QuizQuestionRecord {
  id: number;
  quiz_id: number;
  question_text: string;
  options: string; // JSON string of options
  correct_option: number; // Index of correct option
}

// DTO for creating a course
export interface CreateCourseDTO {
  course_name: string;
  description?: string;
  is_draft?: boolean;
  created_by: number;
  pages: CoursePageDTO[];
  quiz?: QuizDTO;
}

// DTO for course page
export interface CoursePageDTO {
  page_title: string;
  content_type: content_type;
  content_url?: string;
  content_text?: string;
  page_order: number;
}

// DTO for quiz
export interface QuizDTO {
  quiz_title: string;
  pass_score: number;
  questions: QuizQuestionDTO[];
}

// DTO for quiz question
export interface QuizQuestionDTO {
  question_text: string;
  options: string[]; // Array of options
  correct_option: number; // Index of correct option
}

// Response shape for course list
export interface CourseListItem {
  id: number;
  course_name: string;
  description?: string;
  created_by: number;
  creator_name: string;
  created_at: Date;
  status: CourseStatus;
}

// Response with pagination info
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

// Response shape for course detail
export interface CourseDetailResponse {
  id: number;
  course_name: string;
  description?: string;
  created_by: number;
  creator_name: string;
  created_at: Date;
  status: CourseStatus;
  pages: {
    id: number;
    page_title: string;
    content_type: content_type;
    content_url?: string;
    content_text?: string;
    page_order: number;
  }[];
  quiz?: {
    id: number;
    quiz_title: string;
    pass_score: number;
    questions: {
      id: number;
      question_text: string;
      options: string[];
      correct_option: number;
    }[];
  };
} 