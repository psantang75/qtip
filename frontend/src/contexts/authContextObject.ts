import { createContext } from 'react';
import type { User, LoginFormData } from '../services/authService';

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (data: LoginFormData) => Promise<void>;
  logout: () => Promise<void>;
  setDevRole: (roleId: number) => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
