export interface Course {
  id?: number;
  course_name: string;
  description?: string;
  created_by?: number;
  created_at?: string;
  is_draft: boolean;
  pages: CoursePage[];
  quiz: Quiz;
}

export interface CoursePage {
  id?: number;
  course_id?: number;
  page_title: string;
  content_type: 'TEXT' | 'VIDEO' | 'PDF';
  content_url?: string;
  content_text?: string;
  page_order: number;
}

export interface Quiz {
  id?: number;
  course_id?: number;
  quiz_title: string;
  pass_score: number;
  questions: QuizQuestion[];
}

export interface QuizQuestion {
  id?: number;
  quiz_id?: number;
  question_text: string;
  options: string[];
  correct_option: number;
}

export interface CourseCreatePayload {
  course_name: string;
  description?: string;
  created_by: number;
  is_draft: boolean;
  pages: Omit<CoursePage, 'id' | 'course_id'>[];
  quiz: {
    quiz_title: string;
    pass_score: number;
    questions: Omit<QuizQuestion, 'id' | 'quiz_id'>[];
  };
}

export interface CourseListResponse {
  id: number;
  course_name: string;
  description?: string;
  created_by: number;
  created_at: string;
  is_draft: boolean;
} 