import { api } from './authService';
import type { User } from './userService';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DepartmentManager {
  id: number;
  department_id: number;
  manager_id: number;
  manager_name: string;
  assigned_at: string;
  assigned_by: number;
  is_active: boolean;
}

export interface Department {
  id: number;
  department_name: string;
  managers: DepartmentManager[];
  user_count: number;
  is_active: boolean;
  created_at: string;
}

export interface DepartmentCreateDTO {
  department_name: string;
  manager_ids?: number[];
}

export interface DepartmentUpdateDTO {
  department_name?: string;
  manager_ids?: number[];
}

export interface DepartmentFilters {
  manager_id?: number;
  is_active?: boolean;
  search?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

const departmentService = {

  getDepartments: async (
    page = 1,
    limit = 20,
    filters?: DepartmentFilters,
  ): Promise<PaginatedResponse<Department>> => {
    let url = `/departments?page=${page}&limit=${limit}`
    if (filters?.manager_id)              url += `&manager_id=${filters.manager_id}`
    if (filters?.is_active !== undefined) url += `&is_active=${filters.is_active}`
    if (filters?.search)                  url += `&search=${encodeURIComponent(filters.search)}`
    const response = await api.get(url)
    const data = response.data
    // Normalise regardless of what the backend returns
    if (data?.items && Array.isArray(data.items)) return data as PaginatedResponse<Department>
    if (Array.isArray(data)) {
      return { items: data, totalItems: data.length, totalPages: 1, currentPage: page }
    }
    return { items: [], totalItems: 0, totalPages: 0, currentPage: page }
  },

  getDepartmentById: async (departmentId: number): Promise<Department> => {
    const response = await api.get(`/departments/${departmentId}`)
    return response.data
  },

  createDepartment: async (departmentData: DepartmentCreateDTO): Promise<Department> => {
    const response = await api.post('/departments', departmentData)
    return response.data
  },

  updateDepartment: async (departmentId: number, departmentData: DepartmentUpdateDTO): Promise<Department> => {
    const response = await api.put(`/departments/${departmentId}`, departmentData)
    if (response.data?.success && response.data?.data) return response.data.data
    if (response.data) return response.data
    throw new Error('Invalid response format from server')
  },

  deleteDepartment: async (departmentId: number): Promise<void> => {
    await api.delete(`/departments/${departmentId}`)
  },

  toggleDepartmentStatus: async (departmentId: number, isActive: boolean): Promise<Department> => {
    const response = await api.put(`/departments/${departmentId}/status`, { is_active: isActive })
    if (response.data?.success && response.data?.data) return response.data.data
    if (response.data) return response.data
    throw new Error('Invalid response format from server')
  },

  assignUsers: async (departmentId: number, userIds: number[]): Promise<void> => {
    await api.post(`/departments/${departmentId}/users`, { user_ids: userIds })
  },

  getAssignableUsers: async (): Promise<User[]> => {
    const response = await api.get('/departments/users/assignable')
    return response.data
  },

  assignManagers: async (departmentId: number, managerIds: number[]): Promise<void> => {
    await api.post(`/departments/${departmentId}/managers`, { manager_ids: managerIds })
  },

  getDepartmentManagers: async (departmentId: number): Promise<DepartmentManager[]> => {
    const response = await api.get(`/departments/${departmentId}/managers`)
    return response.data
  },
}

export default departmentService
