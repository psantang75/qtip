import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { HiOutlineMenuAlt2, HiOutlineCog } from 'react-icons/hi';

/**
 * Header component props with proper TypeScript interface
 */
interface HeaderProps {
  /** Function to toggle sidebar visibility */
  toggleSidebar?: () => void;
  /** Current sidebar open state */
  isSidebarOpen?: boolean;
}

/**
 * Application header component with navigation and user controls
 * 
 * Features:
 * - Mobile-responsive menu toggle
 * - User avatar and info display
 * - Logout functionality
 * - Customizable title
 * - Modern UI components
 */
const Header: React.FC<HeaderProps> = ({ toggleSidebar, isSidebarOpen }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleProfile = () => {
    navigate('/profile');
  };


  return (
    <header className="bg-white h-20 px-4 sm:px-6 flex items-center border-b border-gray-200 shadow-lg w-full sticky top-0 z-20">
      {/* Mobile menu button */}
      {toggleSidebar && (
        <button
          type="button"
          className="lg:hidden inline-flex items-center justify-center p-2 rounded-md text-neutral-700 hover:text-neutral-900 hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 mr-4"
          onClick={toggleSidebar}
        >
          <span className="sr-only">{isSidebarOpen ? 'Close menu' : 'Open menu'}</span>
          <HiOutlineMenuAlt2 className="h-6 w-6" />
        </button>
      )}
      
      {/* Page title */}
      <div className="flex-grow">
        <h1 className="text-3xl font-semibold hidden lg:block" style={{ color: '#00aeef' }}>
          Quality Training & Insight Platform
        </h1>
        <h1 className="text-xl font-semibold lg:hidden truncate" style={{ color: '#00aeef' }}>
          Quality Training & Insight Platform
        </h1>
      </div>

      {/* User section */}
      <div className="flex items-center gap-3 mr-8">
        {/* Profile button */}
        <button
          onClick={handleProfile}
          className="px-4 py-3 text-lg font-medium rounded-md border transition-all duration-120 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-98 bg-white text-gray-700 border-gray-300 hover:bg-gray-50 focus:ring-gray-400 shadow-sm flex items-center gap-2"
          title="Profile Settings"
        >
          <HiOutlineCog className="h-5 w-5" />
          <span className="hidden sm:inline">Profile</span>
        </button>
        
        {/* Logout button - matching Add User button style */}
        <button
          onClick={handleLogout}
          className="px-6 py-3 text-lg font-medium rounded-md border transition-all duration-120 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-98 bg-primary text-white border-primary hover:bg-blue-600 focus:ring-primary shadow-sm"
        >
          Logout
        </button>
      </div>
    </header>
  );
};

export default Header; 