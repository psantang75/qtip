import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import authService from '../services/authService';
import type { User, LoginFormData } from '../services/authService';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (data: LoginFormData) => Promise<void>;
  logout: () => Promise<void>;
  setDevRole: (roleId: number) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

// Main context provider component
const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sessionTimeoutId, setSessionTimeoutId] = useState<NodeJS.Timeout | null>(null);
  
  // Session timeout functionality
  const setupSessionTimeout = useCallback((tokenExpiryTime?: number) => {
    // Clear existing timeout
    setSessionTimeoutId(prev => {
      if (prev) {
        clearTimeout(prev);
      }
      return null;
    });

    // Default to 24 hours if no expiry time provided
    const timeout = tokenExpiryTime ? (tokenExpiryTime * 1000 - Date.now()) : 24 * 60 * 60 * 1000;
    
    // Set up automatic logout 2 minutes before token expires
    const logoutTime = Math.max(timeout - 2 * 60 * 1000, 60000); // At least 1 minute
    
    const timeoutId = setTimeout(async () => {
      console.log('Session timeout - automatically logging out user');
      
      // Clear local storage and state
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('refreshToken');
      setUser(null);
      setIsAuthenticated(false);
      
      // Show user notification
      alert('Your session has expired. Please log in again.');
      
      // Redirect to login page
      window.location.href = '/login';
    }, logoutTime);
    
    setSessionTimeoutId(timeoutId);
    
    console.log(`Session timeout set for ${Math.round(logoutTime / 1000 / 60)} minutes`);
  }, []);

  // Clear session timeout
  const clearSessionTimeout = useCallback(() => {
    setSessionTimeoutId(prev => {
      if (prev) {
        clearTimeout(prev);
      }
      return null;
    });
  }, []);
  
  // Load user data from storage
  const loadUserFromStorage = useCallback(() => {
    try {
      const token = authService.getToken();
      const storedUser = authService.getCurrentUser();
      
      if (token && storedUser) {
        console.log('Found token and user in storage, setting authenticated state');
        setUser(storedUser);
        setIsAuthenticated(true);
        
        // Set up session timeout for existing session
        setupSessionTimeout();
      } else {
        console.log('No valid token or user found in storage');
        if (token || storedUser) {
          // Clear partial state
          authService.logout();
        }
        setUser(null);
        setIsAuthenticated(false);
      }
    } catch (error) {
      console.error('Error loading user from storage:', error);
      authService.logout();
      setUser(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, [setupSessionTimeout]);
  
  // Check for user on initial load
  useEffect(() => {
    loadUserFromStorage();
  }, [loadUserFromStorage]);

  // Login handler
  const login = async (data: LoginFormData): Promise<void> => {
    setIsLoading(true);
    try {
      const loggedInUser = await authService.login(data);
      console.log('Login successful, setting authenticated state for:', loggedInUser.email);
      setUser(loggedInUser);
      setIsAuthenticated(true);
      
      // Set up session timeout
      setupSessionTimeout();
      
    } catch (error: any) {
      console.error('Login failed in context:', error);
      
      // Add more detailed error logging
      if (error.response) {
        console.error('Login error response status:', error.response.status);
        if (error.response.data) {
          console.error('Login error data:', error.response.data);
        }
      }
      
      setUser(null);
      setIsAuthenticated(false);
      
      // Re-throw so the component can handle it
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  // Logout handler
  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      // Clear session timeout
      clearSessionTimeout();
      
      await authService.logout();
      console.log('Logout completed successfully');
    } catch (error) {
      console.warn('Logout error (continuing anyway):', error);
    } finally {
      setUser(null);
      setIsAuthenticated(false);
      setIsLoading(false);
    }
  }, [clearSessionTimeout]);

  // Dev-only: override role_id in memory without touching auth state
  const setDevRole = (roleId: number) => {
    setUser(prev => prev ? { ...prev, role_id: roleId } : null);
  };

  // Context value
  const value = {
    user,
    isAuthenticated,
    isLoading,
    login,
    logout,
    setDevRole,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

// Custom hook to use auth context
function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export { AuthProvider, useAuth };
export default AuthProvider; 