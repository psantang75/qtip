/**
 * TypeScript interfaces for Audit Assignment related tables
 */

export interface AuditAssignment {
  id: number;
  form_id: number;
  target_id: number;
  target_type: 'USER' | 'DEPARTMENT';
  schedule: string;
  qa_id?: number;
  start_date: Date;
  end_date?: Date;
  is_active: boolean;
  created_by: number;
  created_at: Date;
}

/**
 * Data Transfer Objects for creating/updating audit assignments
 */

export interface CreateAuditAssignmentDTO {
  form_id: number;
  target_id: number;
  target_type: 'USER' | 'DEPARTMENT';
  schedule: string;
  qa_id?: number;
  start_date: Date;
  end_date?: Date;
  created_by: number;
}

export interface UpdateAuditAssignmentDTO {
  form_id?: number;
  target_id?: number;
  target_type?: 'USER' | 'DEPARTMENT';
  schedule?: string;
  qa_id?: number;
  start_date?: Date;
  end_date?: Date;
  is_active?: boolean;
}

/**
 * Extended interfaces for retrieving complete audit assignment data
 */

export interface AuditAssignmentWithDetails extends AuditAssignment {
  form_name?: string;
  target_name?: string;
  qa_name?: string;
  created_by_name?: string;
}

/**
 * Interface for batch creating multiple audit assignments
 */
export interface BatchCreateAuditAssignmentsDTO {
  assignments: CreateAuditAssignmentDTO[];
} 