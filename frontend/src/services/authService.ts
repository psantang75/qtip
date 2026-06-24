import apiClient from './apiClient';

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

export interface LoginFormData {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: User;
  refreshToken?: string;
}

// `api` is the shared axios instance (auth token, CSRF, FormData, JWT
// refresh-on-401, and in-flight GET de-dup all live in apiClient.ts now).
// Re-exported here so the many `import { api } from './authService'` call
// sites keep working without change.
const api = apiClient;

export { api };

const authService = {
  login: async (data: LoginFormData): Promise<User> => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('refreshToken');

    try {
      await api.get('/csrf-token');
    } catch {
      // CSRF fetch is best-effort; proceed regardless
    }

    const response = await api.post<LoginResponse>('/auth/login', data);

    localStorage.setItem('token', response.data.token);
    localStorage.setItem('user', JSON.stringify(response.data.user));
    if (response.data.refreshToken) {
      localStorage.setItem('refreshToken', response.data.refreshToken);
    }

    return response.data.user;
  },

  logout: async (): Promise<void> => {
    try {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          await api.post('/auth/logout');
        } catch {
          // Backend logout failure is non-fatal
        }
      }
    } finally {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('refreshToken');
    }
  },

  isAuthenticated: (): boolean => !!localStorage.getItem('token'),

  getCurrentUser: (): User | null => {
    const userStr = localStorage.getItem('user');
    if (!userStr) return null;
    try {
      return JSON.parse(userStr) as User;
    } catch {
      void authService.logout();
      return null;
    }
  },

  getToken: (): string | null => localStorage.getItem('token'),

  /** POST /api/auth/forgot-password — always resolves; never leaks account existence. */
  forgotPassword: async (email: string): Promise<{ message: string }> => {
    const response = await api.post<{ message: string }>('/auth/forgot-password', { email });
    return response.data;
  },

  /** GET /api/auth/reset-password/validate?token= — used to show "expired/invalid" before form. */
  validateResetToken: async (token: string): Promise<{
    valid: boolean; reason?: 'invalid' | 'expired' | 'used';
  }> => {
    try {
      const response = await api.get<{ valid: boolean; reason?: 'invalid' | 'expired' | 'used' }>(
        `/auth/reset-password/validate`, { params: { token } },
      );
      return response.data;
    } catch (err: any) {
      const data = err?.response?.data;
      return { valid: false, reason: data?.reason ?? 'invalid' };
    }
  },

  /** POST /api/auth/reset-password — consumes the token and sets a new password. */
  resetPassword: async (
    token: string,
    newPassword: string,
    confirmPassword: string,
  ): Promise<{ ok: boolean; message: string }> => {
    try {
      const response = await api.post<{ ok: boolean; message: string }>(
        '/auth/reset-password', { token, newPassword, confirmPassword },
      );
      return response.data;
    } catch (err: any) {
      const data = err?.response?.data;
      return {
        ok: false,
        message: data?.message ?? 'Password reset failed.',
      };
    }
  },
};

export default authService;
