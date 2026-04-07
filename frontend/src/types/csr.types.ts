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

export interface CSRDashboardData {
  stats: CSRStats;
  recentAudits: CSRAudit[];
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