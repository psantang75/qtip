export interface Course {
  id: number;
  course_name: string;
  description?: string;
  created_by: number;
  created_at: string;
  is_draft: boolean;
}

export interface TrainingPath {
  id: number;
  path_name: string;
  created_by: number;
  created_at: string;
}

export interface User {
  id: number;
  username: string;
  email: string;
  role_id: number;
  department_id?: number;
  is_active: boolean;
}

export interface Department {
  id: number;
  department_name: string;
  is_active: boolean;
}

export interface Assignment {
  assignment_type: 'COURSE' | 'TRAINING_PATH';
  target_type: 'USER' | 'DEPARTMENT';
  target_id: number[];
  course_id?: number;
  path_id?: number;
  due_date?: string;
}

export interface PendingAssignment extends Assignment {
  tempId: string;
  courseName?: string;
  pathName?: string;
  targetNames: string[];
}

export interface Enrollment {
  id: number;
  course_id?: number;
  path_id?: number;
  user_id?: number;
  department_id?: number;
  assignment_type: 'COURSE' | 'TRAINING_PATH';
  target_type: 'USER' | 'DEPARTMENT';
  status: 'IN_PROGRESS' | 'COMPLETED';
  progress: number;
  due_date?: string;
  created_at: string;
  course_name?: string;
  path_name?: string;
  user_name?: string;
  target_name?: string;
  department_name?: string;
}

export interface AssignmentFormData {
  assignment_type: 'COURSE' | 'TRAINING_PATH';
  target_type: 'USER' | 'DEPARTMENT';
  target_id: number[];
  course_id: number | null;
  path_id: number | null;
  due_date: string;
}

export interface CreateEnrollmentRequest {
  assignments: {
    assignment_type: 'COURSE' | 'TRAINING_PATH';
    target_type: 'USER' | 'DEPARTMENT';
    target_id: number;
    course_id?: number;
    path_id?: number;
    due_date?: string;
  }[];
}

export interface CancelEnrollmentRequest {
  enrollment_id: number;
} 