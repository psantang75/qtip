/**
 * Custom Hooks Index
 * 
 * Exports all custom business logic hooks for the QTIP application.
 * These hooks provide enhanced functionality alongside existing API calls.
 * 
 * Usage examples:
 * 
 * ```typescript
 * import { useAuth, useUsers, usePerformanceGoals } from '../hooks';
 * 
 * // In your component
 * const { user, isAuthenticated, enhancedLogin } = useAuth();
 * const { users, loading, createUser } = useUsers();
 * const { goals, calculateGoals } = usePerformanceGoals();
 * ```
 */

// Authentication hooks
export { useAuth } from './useAuth';

// Business logic hooks
export { useUsers } from './useUsers';
// Temporarily disabled: export { usePerformanceGoals } from './usePerformanceGoals';
// Temporarily disabled: export { useForms } from './useForms';
// Temporarily disabled: export { useAnalytics } from './useAnalytics';

// Utility hooks
export { useAsync } from './useAsync';

// Note: Types can be imported directly from individual hook modules
// Example: import type { User, Role } from '../hooks/useUsers';

/**
 * Hook usage guidelines:
 * 
 * 1. **useAuth**: Enhanced authentication with permission checking, session management, and utilities
 *    - Use for login/logout operations, permission checks, role-based access
 *    - Extends existing AuthContext with additional functionality
 * 
 * 2. **useUsers**: Comprehensive user management with caching and pagination
 *    - Use for user CRUD operations, searching, filtering, and role management
 *    - Includes reference data (roles, departments, managers)
 * 
 * 3. **usePerformanceGoals**: Goal management and performance calculations
 *    - Use for goal tracking, progress calculations, and performance metrics
 *    - Supports real-time calculations and goal analytics
 * 
 * 4. **useForms**: QA form management and submission handling
 *    - Use for form building, submission management, and scoring
 *    - Handles form lifecycle from creation to finalization
 * 
 * 5. **useAnalytics**: Advanced analytics and reporting
 *    - Use for dashboard metrics, trends, distributions, and exports
 *    - Includes caching, filtering, and data visualization support
 * 
 * 6. **useAsync**: Generic async operation management
 *    - Use for handling async operations with loading states and error handling
 *    - Useful for any API calls not covered by specific hooks
 */ 