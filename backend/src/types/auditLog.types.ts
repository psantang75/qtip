/**
 * TypeScript types for Audit Logs
 */

export interface AuditLog {
  id: number;
  user_id: number;
  action: string;
  target_id?: number | null;
  target_type?: string | null;
  details?: string | null;
  created_at: Date;
}

/**
 * Extended interface with joined user data
 */
export interface AuditLogWithDetails extends AuditLog {
  username: string;
}

/**
 * Interface for audit log query filters
 */
export interface AuditLogFilters {
  user_id?: number;
  action?: string;
  target_type?: string;
  start_date?: string;
  end_date?: string;
  department_id?: number;
}

/**
 * Response interface with pagination
 */
export interface AuditLogResponse {
  data: AuditLogWithDetails[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/**
 * Interface for a single audit log details
 */
export interface AuditLogDetailResponse {
  log: AuditLogWithDetails;
} 