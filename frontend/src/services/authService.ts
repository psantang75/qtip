import axios, { type AxiosError } from 'axios';

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

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 10000,
});

export { api };

api.interceptors.request.use(
  (config) => {
    const isPublicAuthEndpoint =
      config.url?.includes('/auth/login') || config.url?.includes('/csrf-token');

    if (!isPublicAuthEndpoint) {
      const token = localStorage.getItem('token');
      if (token) config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error: unknown) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ code?: string }>) => {
    const originalRequest = error.config as typeof error.config & { _retry?: boolean };

    if (error.response?.status === 401) {
      const isLoginAttempt = error.config?.url?.includes('/auth/login');

      if (!isLoginAttempt) {
        const errorCode = error.response.data?.code;

        if (errorCode === 'TOKEN_BLACKLISTED') {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          localStorage.removeItem('refreshToken');
          window.location.href = '/login';
          return new Promise(() => {});
        }

        if (originalRequest && !originalRequest._retry) {
          originalRequest._retry = true;
          const refreshToken = localStorage.getItem('refreshToken');
          if (refreshToken) {
            try {
              const refreshResponse = await api.post<{
                success: boolean;
                token: string;
                refreshToken?: string;
              }>('/auth/refresh-token', { refreshToken });

              if (refreshResponse.data.success) {
                const newToken = refreshResponse.data.token;
                localStorage.setItem('token', newToken);
                if (refreshResponse.data.refreshToken) {
                  localStorage.setItem('refreshToken', refreshResponse.data.refreshToken);
                }
                if (originalRequest.headers) {
                  originalRequest.headers.Authorization = `Bearer ${newToken}`;
                }
                return api(originalRequest);
              }
            } catch {
              // refresh failed — fall through to redirect
            }
          }
        }

        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
        return new Promise(() => {});
      }
    }

    return Promise.reject(error);
  }
);

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
};

export default authService;
