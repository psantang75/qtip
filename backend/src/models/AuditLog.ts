/**
 * TypeScript interface for Audit Log related tables
 */

export interface AuditLog {
  id: number;
  user_id: number;
  action: string;
  target_id: number | null;
  target_type: string | null;
  details: string | null;
  created_at: Date;
}

/**
 * Extended interface with username for display
 */
export interface AuditLogWithUser extends AuditLog {
  username: string;
} 