export interface ManagerStats {
  qaScore: number;
  trainingCompletion: number;
  disputes: number;
  coachingSessions: number;
}

export interface TeamAudit {
  id: number;
  csr_id: number;
  csr_name: string;
  form_id: number;
  form_name: string;
  score: number;
  submitted_date: string;
  total_score?: number;
}

export interface TeamTraining {
  id: number;
  user_id: number;
  csr_name: string;
  course_id: number;
  course_name: string;
  progress: number;
  status: 'IN_PROGRESS' | 'COMPLETED';
  enrolled_at: string;
}

export interface ManagerDashboardData {
  stats: ManagerStats;
  recentAudits: TeamAudit[];
  teamTraining: TeamTraining[];
}

export interface PaginatedAudits {
  audits: TeamAudit[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PaginatedTraining {
  training: TeamTraining[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// New interfaces for Manager Team Audits component
export interface ManagerTeamAudit {
  id: number;
  csr_id: number;
  csr_name: string;
  qa_analyst_name: string;
  form_id: number;
  form_name: string;
  total_score: number;
  submitted_at: string;
  status: 'DRAFT' | 'SUBMITTED' | 'DISPUTED' | 'FINALIZED';
  dispute_status: 'None' | 'Pending' | 'Resolved';
  dispute_id?: number;
}

export interface ManagerTeamAuditDetails extends ManagerTeamAudit {
  metadata: Array<{
    field_name: string;
    value: string;
  }>;
  answers: Array<{
    question_id: number;
    question_text: string;
    answer: string;
    notes?: string;
    category_name: string;
  }>;
  calls: Array<{
    call_id: string;
    call_date: string;
    duration: number;
    transcript?: string;
    recording_url?: string;
  }>;
  dispute?: {
    id: number;
    reason: string;
    status: string;
    resolution_notes?: string;
    created_at: string;
    resolved_at?: string;
  };
}

export interface TeamAuditFilters {
  csr_id: string;
  form_id: string;
  formName: string;
  startDate: string;
  endDate: string;
  dispute_status: string;
  status: string;
}

export interface CSROption {
  id: number;
  username: string;
}

export interface FormOption {
  id: number;
  form_name: string;
}

export interface PaginatedTeamAudits {
  audits: ManagerTeamAudit[];
  totalCount: number;
  page: number;
  limit: number;
}

// Dispute Resolution interfaces
export interface DisputeFilters {
  csr_id: string;
  form_id: string;
  status: string;
  startDate: string;
  endDate: string;
}

export interface Dispute {
  id: number;
  submission_id: number;
  csr_id: number;
  csr_name: string;
  form_id: number;
  form_name: string;
  reason: string;
  status: 'OPEN' | 'UPHELD' | 'REJECTED' | 'ADJUSTED';
  created_at: string;
  resolved_at?: string;
  resolution_notes?: string;
  total_score: number;
  previous_score?: number | null;
  adjusted_score?: number | null;
  qa_analyst_name: string;
}

export interface PaginatedDisputes {
  disputes: Dispute[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DisputeDetails extends Dispute {
  audit_details: {
    metadata: Array<{
      field_name: string;
      value: string;
    }>;
    answers: Array<{
      question_id: number;
      question_text: string;
      answer: string;
      notes?: string;
      category_name: string;
    }>;
    calls: Array<{
      call_id: string;
      call_date: string;
      duration: number;
      transcript?: string;
      recording_url?: string;
    }>;
  };
  attachments?: Array<{
    id: number;
    filename: string;
    url: string;
  }>;
}

export interface ResolutionForm {
  resolution_action: 'UPHOLD' | 'ADJUST' | 'ASSIGN_TRAINING';
  new_score?: number;
  training_id?: number;
  resolution_notes: string;
}

// Coaching session interfaces
export type CoachingType = 
  | 'Classroom'
  | 'Side-by-Side' 
  | 'Team Session'
  | '1-on-1'
  | 'PIP'
  | 'Verbal Warning'
  | 'Written Warning';

export interface CoachingSession {
  id: number;
  csr_id: number;
  csr_name: string;
  session_date: string;
  topics?: string[]; // Array of topic names
  topic_ids?: number[]; // Array of topic IDs
  // Legacy fields for backward compatibility (deprecated)
  topic?: string;
  topic_id?: number | null;
  coaching_type: CoachingType;
  notes?: string;
  status: 'SCHEDULED' | 'COMPLETED';
  attachment_filename?: string;
  attachment_path?: string;
  attachment_size?: number;
  attachment_mime_type?: string;
  created_at: string;
  created_by_name?: string;
}

export interface CoachingSessionDetails extends CoachingSession {
  csr_email?: string;
  csr_department?: string;
}

export interface CoachingSessionForm {
  csr_id: number;
  session_date: string;
  topic_ids: number[]; // Array of topic IDs (required)
  coaching_type: CoachingType;
  notes: string;
  status: 'SCHEDULED' | 'COMPLETED';
  attachment?: File;
  // Legacy fields for backward compatibility (deprecated)
  topic?: string;
  topic_id?: number | null;
}

export interface CoachingSessionFilters {
  csr_id: string;
  status: string;
  coaching_type: string;
  startDate: string;
  endDate: string;
  search: string;
}

export interface PaginatedCoachingSessions {
  sessions: CoachingSession[];
  totalCount: number;
  page: number;
  limit: number;
} 