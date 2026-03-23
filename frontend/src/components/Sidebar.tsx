import React, { useState, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from './ui/LoadingSpinner';
import Button from './ui/Button';
import { generateNavigationSections } from '../config/navigation.config';
import { USER_ROLES, ROLE_NAMES, UserRoleId } from '../types/routes.types';
import { 
  HiChevronDown,
  HiChevronRight
} from 'react-icons/hi';

/**
 * Enhanced Sidebar Navigation Component with New Architecture
 * 
 * Features:
 * - Type-safe navigation with centralized configuration
 * - Role-based navigation filtering
 * - Loading states and smooth transitions
 * - Hierarchical navigation with sections
 * - Icons and badges for better UX
 * - Collapsible sections with state persistence
 * - Active state management
 * - Professional styling with new UI components
 */
const Sidebar: React.FC = () => {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set(['account']) // Default collapsed sections
  );
  
  const userRoleId = user?.role_id as UserRoleId;

  // Generate navigation sections using the new configuration system
  const navigationSections = useMemo(() => {
    if (!user || !userRoleId) return [];
    return generateNavigationSections(userRoleId);
  }, [user, userRoleId]);

  // Toggle section collapse with better state management
  const toggleSection = (sectionId: string) => {
    setCollapsedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId);
      } else {
        newSet.add(sectionId);
      }
      return newSet;
    });
  };

  // Get role name using the type-safe mapping
  const getRoleName = (): string => {
    return ROLE_NAMES[userRoleId] || 'User';
  };

  // Enhanced loading state with better UX
  if (isLoading) {
    return (
      <aside className="h-screen w-80 fixed left-0 top-0 bg-neutral-700 flex flex-col z-40 shadow-xl">
        <div className="flex items-center justify-center h-20 px-6 border-b border-neutral-600">
          <LoadingSpinner size="md" color="white" />
        </div>
        <div className="flex-grow flex items-center justify-center">
          <div className="text-center text-neutral-200">
            <LoadingSpinner size="lg" color="white" />
            <p className="mt-3 text-sm">Loading navigation...</p>
          </div>
        </div>
      </aside>
    );
  }

  // Don't render sidebar for unauthenticated users
  if (!user) {
    return null;
  }

  return (
    <aside className="h-screen w-80 fixed left-0 top-0 bg-neutral-700 flex flex-col z-40 shadow-xl">
      {/* Enhanced User Header with better styling */}
      <div className="flex items-center justify-center h-20 px-6 border-b border-neutral-600 bg-neutral-800">
        <div className="text-center">
          <h1 className="text-lg font-bold text-white">
            {user.username}
          </h1>
          <p className="text-sm text-neutral-300 mt-1">{getRoleName()}</p>
        </div>
      </div>
      
      {/* Enhanced Navigation with new architecture */}
      <nav className="flex-grow overflow-y-auto px-4 py-6 scrollbar-hide">
        <div className="space-y-6">
          {navigationSections.map((section) => {
            const isCollapsed = collapsedSections.has(section.id);
            
            return (
              <div key={section.id} className="space-y-2">
                {/* Section Header with improved interaction */}
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-neutral-400 uppercase tracking-wider">
                    {section.title}
                  </h3>
                  {section.collapsible && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleSection(section.id)}
                      className="p-1 h-6 w-6 text-neutral-400 hover:text-neutral-200 transition-colors"
                      aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${section.title} section`}
                    >
                      {isCollapsed ? (
                        <HiChevronRight className="h-3 w-3" />
                      ) : (
                        <HiChevronDown className="h-3 w-3" />
                      )}
                    </Button>
                  )}
                </div>

                {/* Section Items with improved styling */}
                {(!section.collapsible || !isCollapsed) && (
                  <ul className="space-y-1">
                    {section.items.map((item) => {
                      const isActive = location.pathname === item.path || 
                                      (item.path !== '/' && location.pathname.startsWith(item.path));
                      
                      return (
                        <li key={item.id}>
                          <Link
                            to={item.path}
                            className={`group flex items-center px-3 py-2.5 rounded-lg text-base font-medium transition-all duration-200 ${
                              isActive
                                ? 'bg-primary text-white shadow-lg transform scale-105'
                                : 'text-neutral-100 hover:bg-neutral-600 hover:text-white hover:transform hover:scale-105'
                            }`}
                            aria-current={isActive ? 'page' : undefined}
                          >
                            <span className="flex-grow">{item.label}</span>
                            {item.badge && (
                              <span className="ml-2 px-2 py-1 text-xs bg-danger text-white rounded-full font-semibold">
                                {item.badge}
                              </span>
                            )}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </nav>

      {/* TODO: POST-LAUNCH ENHANCEMENT - User info footer
          Removed user info display as it's not needed for launch version */}
    </aside>
  );
};

export default Sidebar; 
