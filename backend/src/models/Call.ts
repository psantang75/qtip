/**
 * TypeScript interface for the Calls table
 */

export interface Call {
  id: number;
  call_id: string; // External ID
  csr_id: number; // Agent who handled the call
  department_id: number | null;
  customer_id: string | null;
  call_date: Date;
  duration: number; // In seconds
  recording_url: string | null;
  transcript: string | null;
  metadata: Record<string, any> | null; // JSON data
  created_at: Date;
  updated_at: Date;
}

/**
 * TypeScript interface for creating a new Call
 */
export interface CreateCallDTO {
  call_id: string;
  csr_id: number;
  department_id?: number | null;
  customer_id?: string | null;
  call_date: Date;
  duration: number;
  recording_url?: string | null;
  transcript?: string | null;
  metadata?: Record<string, any> | null;
}

/**
 * TypeScript interface for updating a Call
 */
export interface UpdateCallDTO {
  call_id?: string;
  csr_id?: number;
  department_id?: number | null;
  customer_id?: string | null;
  call_date?: Date;
  duration?: number;
  recording_url?: string | null;
  transcript?: string | null;
  metadata?: Record<string, any> | null;
} 