import React, { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import CSRDashboard from './CSRDashboard';
import ManagerDashboard from './ManagerDashboard';
import LoadingSpinner from './ui/LoadingSpinner';
import { HiExclamationCircle } from 'react-icons/hi';

/**
 * User role mapping for consistent role identification
 */
const ROLE_MAP = {
  1: 'Admin',
  2: 'QA', 
  3: 'CSR',
  4: 'Trainer',
  5: 'Manager',
  6: 'Director'
} as const;

/**
 * Valid role types
 */
type UserRole = typeof ROLE_MAP[keyof typeof ROLE_MAP];

/**
 * Props for UnavailableDashboard component
 */
interface UnavailableDashboardProps {
  role: string;
  message?: string;
}

/**
 * Component shown when dashboard is not available for user's role
 */
const UnavailableDashboard: React.FC<UnavailableDashboardProps> = ({ 
  role, 
  message = "Dashboard not available for your role" 
}) => (
  <div className="max-w-4xl mx-auto p-6">
    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 shadow-sm">
      <div className="flex items-start space-x-3">
        <HiExclamationCircle className="h-6 w-6 text-yellow-600 flex-shrink-0 mt-0.5" />
        <div>
          <h3 className="text-lg font-medium text-yellow-800 mb-2">
            Access Restricted
          </h3>
          <p className="text-sm text-yellow-700 mb-1">
            {message}: <span className="font-medium">{role}</span>
          </p>
          <p className="text-xs text-yellow-600">
            Please contact your administrator if you believe this is an error.
          </p>
        </div>
      </div>
    </div>
  </div>
);

/**
 * RoleDashboard Component
 * 
 * Routes users to appropriate dashboard based on their role.
 * Provides fallback UI for roles without specific dashboards.
 * 
 * Features:
 * - Role-based dashboard routing
 * - Loading state management
 * - Graceful fallback for unsupported roles
 * - Type-safe role mapping
 * - Modern UI components
 */
const RoleDashboard: React.FC = () => {
  const { user, isLoading } = useAuth();

  // Memoized role calculation for performance
  const userRole = useMemo((): UserRole | 'Unknown' => {
    if (!user?.role_id) return 'Unknown';
    return ROLE_MAP[user.role_id as keyof typeof ROLE_MAP] || 'Unknown';
  }, [user?.role_id]);

  // Show loading state while authentication is being checked
  if (isLoading || !user) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-center">
          <LoadingSpinner size="lg" color="primary" />
          <p className="mt-4 text-sm text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  // Route to appropriate dashboard based on user role
  switch (userRole) {
    case 'Manager':
      return <ManagerDashboard />;
      
    case 'CSR':
      return <CSRDashboard />;
      
    case 'Admin':
      // Redirect to admin dashboard route instead of component
      return (
        <div className="max-w-4xl mx-auto p-6">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-blue-900 mb-2">
              Welcome, Administrator
            </h2>
            <p className="text-blue-700">
              Please use the sidebar navigation to access admin functions.
            </p>
          </div>
        </div>
      );
      
    case 'QA':
      return (
        <div className="max-w-4xl mx-auto p-6">
          <div className="bg-green-50 border border-green-200 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-green-900 mb-2">
              QA Dashboard
            </h2>
            <p className="text-green-700">
              Please use the sidebar navigation to access QA functions.
            </p>
          </div>
        </div>
      );
      
    case 'Trainer':
      return (
        <div className="max-w-4xl mx-auto p-6">
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-purple-900 mb-2">
              Trainer Dashboard
            </h2>
            <p className="text-purple-700">
              Please use the sidebar navigation to access trainer functions.
            </p>
          </div>
        </div>
      );
      
    case 'Director':
      return (
        <div className="max-w-4xl mx-auto p-6">
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-indigo-900 mb-2">
              Director Dashboard
            </h2>
            <p className="text-indigo-700">
              Please use the sidebar navigation to access director functions.
            </p>
          </div>
        </div>
      );
      
    default:
      return <UnavailableDashboard role={userRole} />;
  }
};

export default RoleDashboard; 