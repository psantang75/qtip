import { api } from './authService';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface User {
  id: number;
  username: string;
  email: string;
  role_id: number;
  role_name?: string;
  department_id: number | null;
  department_name?: string | null;
  manager_id?: number | null;
  title?: string | null;
  is_active: boolean;
  last_login?: string | null;
  created_at: string;
}

export interface Role {
  id: number;
  role_name: string;
}

export interface Department {
  id: number;
  department_name: string;
  is_active: boolean;
}

export interface UserCreateDTO {
  username: string;
  email: string;
  password: string;
  role_id: number;
  department_id: number | null;
  title?: string;
}

export interface UserUpdateDTO {
  username?: string;
  email?: string;
  password?: string;
  role_id?: number;
  department_id?: number | null;
  title?: string;
}

export interface UserFilters {
  role_id?: number;
  department_id?: number;
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

const userService = {

  getUsers: async (page = 1, limit = 20, filters?: UserFilters): Promise<PaginatedResponse<User>> => {
    let url = `/users?page=${page}&limit=${limit}`
    if (filters?.role_id)                  url += `&role_id=${filters.role_id}`
    if (filters?.department_id)            url += `&department_id=${filters.department_id}`
    if (filters?.is_active !== undefined)  url += `&is_active=${filters.is_active}`
    if (filters?.search)                   url += `&search=${encodeURIComponent(filters.search)}`
    const response = await api.get(url)
    if (response.data?.items)  return response.data
    if (response.data?.users)  return {
      items:       response.data.users,
      totalItems:  response.data.pagination?.total ?? 0,
      totalPages:  response.data.pagination?.totalPages ?? 1,
      currentPage: page,
    }
    return { items: [], totalItems: 0, totalPages: 0, currentPage: page }
  },

  getUserById: async (userId: number): Promise<User> => {
    const response = await api.get(`/users/${userId}`)
    return response.data
  },

  createUser: async (userData: UserCreateDTO): Promise<User> => {
    const response = await api.post('/users', userData)
    return response.data
  },

  updateUser: async (userId: number, userData: UserUpdateDTO): Promise<User> => {
    try {
      const response = await api.put(`/users/${userId}`, userData)
      if (response.data?.success && response.data?.data) return response.data.data
      if (response.data) return response.data
      throw new Error('Invalid response format from server')
    } catch (error: unknown) {
      const e = error as { response?: { data?: { error?: unknown; code?: string } } }
      const apiError = e?.response?.data?.error
      if (typeof apiError === 'string') throw new Error(apiError)
      if (apiError && typeof apiError === 'object' && 'message' in apiError) {
        throw new Error((apiError as { message: string }).message)
      }
      const code = e?.response?.data?.code
      if (code === 'EMAIL_EXISTS')    throw new Error('This email address is already in use.')
      if (code === 'USERNAME_EXISTS') throw new Error('This username is already taken.')
      if (code === 'USER_NOT_FOUND')  throw new Error('User not found. Please refresh and try again.')
      throw error
    }
  },

  deleteUser: async (userId: number): Promise<void> => {
    await api.delete(`/users/${userId}`)
  },

  toggleUserStatus: async (userId: number, isActive: boolean): Promise<User> => {
    const response = await api.put(`/users/${userId}/status`, { is_active: isActive })
    if (response.data?.success && response.data?.data) return response.data.data
    if (response.data) return response.data
    throw new Error('Invalid response format from server')
  },

  changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
    try {
      await api.put('/users/change-password', { currentPassword, newPassword })
    } catch (error: unknown) {
      const e = error as { response?: { data?: { error?: unknown } } }
      const apiError = e?.response?.data?.error
      if (typeof apiError === 'string') throw new Error(apiError)
      if (apiError && typeof apiError === 'object' && 'message' in apiError) {
        throw new Error((apiError as { message: string }).message)
      }
      throw error
    }
  },

  getRoles: async (): Promise<Role[]> => {
    const response = await api.get('/roles')
    if (Array.isArray(response.data?.data))  return response.data.data
    if (Array.isArray(response.data?.items)) return response.data.items
    if (Array.isArray(response.data))        return response.data
    return []
  },

  getDepartments: async (): Promise<Department[]> => {
    const response = await api.get('/departments')
    if (Array.isArray(response.data?.items)) return response.data.items
    if (Array.isArray(response.data))        return response.data
    return []
  },

  getActiveDepartments: async (): Promise<Department[]> => {
    const response = await api.get('/departments?is_active=true')
    if (Array.isArray(response.data?.items)) return response.data.items
    if (Array.isArray(response.data))        return response.data
    return []
  },

  getManagers: async (): Promise<User[]> => {
    const response = await api.get('/users/managers')
    return response.data
  },
}

export default userService
