/**
 * Department related types and interfaces
 */

export interface Department {
  id: number;
  department_name: string;
  is_active: boolean;
  created_at?: Date;
  updated_at?: Date;
}

export interface DepartmentManager {
  id: number;
  department_id: number;
  manager_id: number;
  manager_name: string;
  assigned_at: Date;
  assigned_by: number;
  is_active: boolean;
}

export interface DepartmentWithDetails extends Department {
  managers: DepartmentManager[];
  user_count: number;
}

export interface DepartmentCreateRequest {
  department_name: string;
  manager_ids?: number[];
}

export interface DepartmentUpdateRequest {
  department_name?: string;
  manager_ids?: number[];
}

export interface DepartmentManagerAssignmentRequest {
  department_id: number;
  manager_ids: number[];
}

export interface DepartmentFilters {
  manager_id?: number;
  is_active?: boolean;
  search?: string;
}

export interface PaginatedDepartmentResponse {
  items: DepartmentWithDetails[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
} 