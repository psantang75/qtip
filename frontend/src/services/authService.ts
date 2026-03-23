import axios from 'axios';

// Define types
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

// Create API instance with base configuration
const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000, // 10 seconds timeout
});

// Export the axios instance so other services can use it with interceptors
export { api };

// Add authorization header to requests if token exists
// Exclude authentication endpoints to prevent sending blacklisted tokens during login
api.interceptors.request.use(
  (config) => {
    // Don't add Authorization header to login or csrf-token requests
    // These endpoints don't require authentication and sending a blacklisted token causes issues
    const isPublicAuthEndpoint = config.url?.includes('/auth/login') || 
                                config.url?.includes('/csrf-token');
    
    if (!isPublicAuthEndpoint) {
      const token = localStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Handle token expiration or unauthorized responses
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    // Handle 401 errors (authentication failures) FIRST, regardless of URL
    if (error.response && error.response.status === 401) {
      // Don't log auth failures during login attempts - that's expected behavior
      const isLoginAttempt = error.config?.url?.includes('/auth/login');
      
      if (!isLoginAttempt) {
        console.error('API Error: 401 Unauthorized', error);
        
        const errorCode = error.response.data?.code;
        
        // If token is blacklisted, immediately logout
        if (errorCode === 'TOKEN_BLACKLISTED') {
          console.log('Token has been blacklisted, forcing logout and redirecting to login');
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          localStorage.removeItem('refreshToken');
          window.location.href = '/login';
          
          // Return a promise that never resolves to prevent error handlers from running
          return new Promise(() => {});
        }
        
        // For other 401 errors, try token refresh if we haven't already tried
        if (!originalRequest._retry) {
          originalRequest._retry = true;
          
          const refreshToken = localStorage.getItem('refreshToken');
          if (refreshToken) {
            try {
              console.log('Attempting token refresh...');
              const refreshResponse = await api.post('/auth/refresh-token', { refreshToken });
              
              if (refreshResponse.data.success) {
                const newToken = refreshResponse.data.token;
                const newRefreshToken = refreshResponse.data.refreshToken;
                
                localStorage.setItem('token', newToken);
                if (newRefreshToken) {
                  localStorage.setItem('refreshToken', newRefreshToken);
                }
                
                // Retry the original request with new token
                originalRequest.headers.Authorization = `Bearer ${newToken}`;
                return api(originalRequest);
              }
            } catch (refreshError) {
              console.log('Token refresh failed, logging out');
            }
          }
        }
        
        // Clear token and redirect to login for authentication failures
        console.log('Authentication failed, clearing token and redirecting to login');
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
        
        // Return a promise that never resolves to prevent error handlers from running
        // The page will redirect before this matters
        return new Promise(() => {});
      }
    }
    
    // Handle 403 errors (authorization/permission issues)
    if (error.response && error.response.status === 403) {
      console.warn('Access denied: Insufficient permissions for this operation');
      // Don't redirect to login for permission errors - this is an authorization issue
    }
    
    // Log other API errors (except login attempts)
    if (error.config && error.config.url && !error.config.url.includes('/auth/login')) {
      console.error('API Error:', error);
    }
    
    // Always reject with the error
    return Promise.reject(error);
  }
);

const authService = {
  // Login the user and store token
  login: async (data: LoginFormData): Promise<User> => {
    try {
      console.log('Sending login request to:', api.defaults.baseURL + '/auth/login');
      console.log('Login credentials:', { email: data.email, password: '******' });
      
      // Clear any existing tokens before login to prevent conflicts
      // This ensures old/blacklisted tokens don't interfere with new login attempts
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('refreshToken');
      
      // Fetch CSRF token before login to ensure proper CSRF protection
      try {
        await api.get('/csrf-token');
        console.log('CSRF token fetched successfully');
      } catch (csrfError) {
        console.warn('Failed to fetch CSRF token, proceeding with login:', csrfError);
      }
      
      const response = await api.post<LoginResponse>('/auth/login', data);
      console.log('Login response received successfully');
      
      // Store authentication data
      localStorage.setItem('token', response.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.user));
      
      // Store refresh token if provided
      if (response.data.refreshToken) {
        localStorage.setItem('refreshToken', response.data.refreshToken);
      }
      
      return response.data.user;
    } catch (error: any) {
      // Enhanced error logging for debugging
      console.error('Login request failed');
      
      if (error.response) {
        // Log response details for debugging
        console.error(`Login error status: ${error.response.status} ${error.response.statusText}`);
        
        // Check for error data in the response
        if (error.response.data) {
          if (typeof error.response.data === 'object') {
            console.error('Error response data:', JSON.stringify(error.response.data));
          } else {
            console.error('Error response data (non-object):', error.response.data);
          }
          
          // Log specific error message if available
          if (error.response.data.error) {
            console.error('Error message from server:', error.response.data.error);
          }
        }
      } else if (error.request) {
        console.error('No response received from server');
      } else {
        console.error('Error setting up request:', error.message || 'Unknown error');
      }
      
      // Re-throw the error to be handled by the caller
      throw error;
    }
  },

  // Logout the user
  logout: async (): Promise<void> => {
    try {
      const token = localStorage.getItem('token');
      
      // Call backend logout endpoint if we have a token
      if (token) {
        try {
          await api.post('/auth/logout');
          console.log('Backend logout successful');
        } catch (error) {
          // Don't fail the logout if backend call fails
          console.warn('Backend logout failed, but continuing with local logout:', error);
        }
      }
    } catch (error) {
      console.warn('Error during logout process:', error);
    } finally {
      // Always clear local storage regardless of backend call result
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('refreshToken');
      console.log('Local logout completed');
    }
  },

  // Check if user is authenticated
  isAuthenticated: (): boolean => {
    return !!localStorage.getItem('token');
  },

  // Get the current user
  getCurrentUser: (): User | null => {
    const userStr = localStorage.getItem('user');
    if (!userStr) return null;
    
    try {
      return JSON.parse(userStr) as User;
    } catch (error) {
      console.error('Error parsing user data:', error);
      authService.logout();
      return null;
    }
  },

  // Get the current token
  getToken: (): string | null => {
    return localStorage.getItem('token');
  }
};

export default authService; 