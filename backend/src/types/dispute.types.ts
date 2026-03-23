
// Dispute status enum
export enum DisputeStatus {
  OPEN = 'OPEN',
  UPHELD = 'UPHELD', 
  REJECTED = 'REJECTED',
  ADJUSTED = 'ADJUSTED'
}

// Database dispute record
export interface DisputeRecord {
  id: number;
  submission_id: number;
  disputed_by: number;
  resolved_by: number | null;
  created_at: Date;
  resolved_at: Date | null;
  status: DisputeStatus;
  reason: string;
  resolution_notes: string | null;
}

// DTO for creating a new dispute
export interface CreateDisputeDTO {
  submission_id: number;
  disputed_by: number;
  reason: string;
  attachment_url?: string;
}

// Response shape for dispute list
export interface DisputeListItem {
  dispute_id: number;
  audit_id: number;
  form_name: string;
  score: number;
  previous_score?: number | null;
  adjusted_score?: number | null;
  status: DisputeStatus;
  created_at: Date;
  resolution_notes: string | null;
}

// Response shape for audit history
export interface AuditListItem {
  submission_id: number;
  form_id: number;
  form_name: string; 
  score: number;
  submitted_at: Date;
  status: string;
  csr_id?: string | number;
  is_disputable: boolean;
}

// Response with pagination info
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
} 