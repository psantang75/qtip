
/**
 * Enrollment status enum
 */
export enum EnrollmentStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED'
}

/**
 * Database enrollment record
 */
export interface EnrollmentRecord {
  id: number;
  course_id?: number;
  path_id?: number;
  user_id?: number;
  department_id?: number;
  assignment_type: assignment_type;
  target_type: target_type;
  status: EnrollmentStatus;
  progress: number;
  due_date?: Date;
  created_at: Date;
}

/**
 * Assignment type enum
 */
export enum assignment_type {
  COURSE = 'COURSE',
  TRAINING_PATH = 'TRAINING_PATH'
}

/**
 * Target type enum
 */
export enum target_type {
  USER = 'USER',
  DEPARTMENT = 'DEPARTMENT'
}

/**
 * DTO for creating a training assignment
 */
export interface CreateAssignmentDTO {
  assignment_type: assignment_type;
  target_type: target_type;
  target_ids: number[];
  course_id?: number;
  path_id?: number;
  due_date?: string;
}

/**
 * Single item in a pending assignment batch
 */
export interface PendingAssignment {
  assignment_type: assignment_type;
  target_type: target_type;
  target_id: number;
  course_id?: number;
  path_id?: number;
  due_date?: string;
}

/**
 * Batch assignment DTO
 */
export interface BatchAssignmentDTO {
  assignments: PendingAssignment[];
}

/**
 * Response shape for enrollment list
 */
export interface EnrollmentListItem {
  id: number;
  course_id?: number;
  path_id?: number;
  course_name?: string;
  path_name?: string;
  user_id?: number;
  department_id?: number;
  user_name?: string;
  department_name?: string;
  assignment_type: assignment_type;
  target_type: target_type;
  target_name: string;
  status: EnrollmentStatus;
  progress: number;
  due_date?: Date;
  created_at: Date;
}

/**
 * Response with pagination info
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
} 