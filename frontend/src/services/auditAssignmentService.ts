import { apiDelete, apiGet, apiPost, apiPut } from './apiClient';

// Types for Audit Assignment Management
export interface AuditAssignment {
  id: number;
  form_id: number;
  form_name: string;
  target_id: number;
  target_type: 'USER' | 'DEPARTMENT';
  target_name: string; // User name or Department name
  schedule: string;
  qa_id: number | null;
  qa_name: string | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  created_by: number;
  created_at: string;
}

export interface AuditAssignmentCreateDTO {
  form_id: number;
  target_id: number;
  target_type: 'USER' | 'DEPARTMENT';
  schedule: string;
  qa_id: number | null;
  start_date: string;
  end_date: string | null;
  created_by?: number;
}

export interface PaginatedResponse<T> {
  assignments: T[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
}

const SCOPE = 'auditAssignmentService';

const auditAssignmentService = {
  // Get audit assignments with pagination and search
  getAuditAssignments: (
    page: number = 1,
    limit: number = 10,
    search: string = '',
    additionalParams: Record<string, string> = {}
  ): Promise<PaginatedResponse<AuditAssignment>> => {
    const params: Record<string, string | number> = { page, limit };
    if (search) params.search = search;
    for (const [key, value] of Object.entries(additionalParams)) {
      if (value !== undefined && value !== null && value !== '') params[key] = value;
    }
    return apiGet<PaginatedResponse<AuditAssignment>>(SCOPE, '/audit-assignments', { params });
  },

  // Create multiple audit assignments in bulk
  createAuditAssignments: (
    assignments: AuditAssignmentCreateDTO[]
  ): Promise<{ message: string; assignments: AuditAssignment[] }> =>
    apiPost<{ message: string; assignments: AuditAssignment[] }>(
      SCOPE,
      '/audit-assignments',
      { assignments },
    ),

  // Update an existing audit assignment
  updateAuditAssignment: (
    id: number,
    assignment: Partial<AuditAssignmentCreateDTO>
  ): Promise<{ message: string; assignment: AuditAssignment }> =>
    apiPut<{ message: string; assignment: AuditAssignment }>(
      SCOPE,
      `/audit-assignments/${id}`,
      assignment,
    ),

  // Deactivate an audit assignment (soft delete)
  deactivateAuditAssignment: (
    id: number
  ): Promise<{ message: string }> =>
    apiDelete<{ message: string }>(SCOPE, `/audit-assignments/${id}`),
};

export default auditAssignmentService;
