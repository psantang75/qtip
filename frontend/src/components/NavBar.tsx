import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const NavBar: React.FC = () => {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = user?.role_id === 1; // Assuming role_id 1 is Admin

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Helper function to determine if a link is active
  const isActive = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  return (
    <nav className="bg-white shadow-md border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <div className="flex-shrink-0 flex items-center">
              <Link to="/" style={{ 
                fontSize: '26px', 
                fontWeight: 'bold', 
                color: 'var(--color-primary-blue)' 
              }}>
                QTIP
              </Link>
              <span style={{
                fontSize: '18px',
                fontWeight: '500',
                color: 'var(--color-primary-blue)',
                marginLeft: '12px'
              }}>
                Quality, Training & Insight Platform
              </span>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              {isAuthenticated && (
                <>
                  <Link 
                    to="/dashboard" 
                    style={{
                      borderBottomWidth: isActive('/dashboard') ? '2px' : '0',
                      borderBottomColor: 'var(--color-primary-blue)',
                      color: isActive('/dashboard') ? 'var(--color-neutral-900)' : 'var(--color-neutral-600)',
                      fontSize: '14px',
                      fontWeight: '500',
                      paddingTop: '4px',
                      paddingLeft: '4px',
                      paddingRight: '4px',
                      display: 'inline-flex',
                      alignItems: 'center'
                    }}
                  >
                    Dashboard
                  </Link>
                  
                  {isAdmin && (
                    <Link 
                      to="/admin/dashboard" 
                      style={{
                        borderBottomWidth: isActive('/admin') ? '2px' : '0',
                        borderBottomColor: 'var(--color-primary-blue)',
                        color: isActive('/admin') ? 'var(--color-neutral-900)' : 'var(--color-neutral-600)',
                        fontSize: '14px',
                        fontWeight: '500',
                        paddingTop: '4px',
                        paddingLeft: '4px',
                        paddingRight: '4px',
                        display: 'inline-flex',
                        alignItems: 'center'
                      }}
                    >
                      Admin
                    </Link>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="hidden sm:ml-6 sm:flex sm:items-center">
            {isAuthenticated ? (
              <div className="flex items-center space-x-4">
                <span style={{ 
                  fontSize: '14px', 
                  color: 'var(--color-neutral-700)' 
                }}>
                  Welcome, {user?.username}
                </span>
                <button 
                  onClick={handleLogout}
                  className="p-2 rounded-full hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors duration-200"
                  style={{ color: 'var(--color-neutral-700)' }}
                >
                  <span className="sr-only">Logout</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </button>
              </div>
            ) : (
              <Link 
                to="/login"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white shadow-sm transition-all duration-200 hover:shadow-md hover:opacity-90"
                style={{ backgroundColor: 'var(--color-primary-blue)' }}
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default NavBar; 