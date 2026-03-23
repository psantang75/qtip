import { Request, Response, NextFunction } from 'express';
import { UserService, UserServiceError } from '../services/UserService';
import { MySQLUserRepository } from '../repositories/UserRepository';
import prisma from '../config/prisma';

// Initialize user service with repository
const userRepository = new MySQLUserRepository();
const userService = new UserService(userRepository);

/**
 * Get users with filtering and pagination
 * @route GET /api/users
 */
export const getUsers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log('[USER CONTROLLER] Getting users with filters');
    console.log('[USER CONTROLLER] Query params:', req.query);
    
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    
    // Handle role name to role_id conversion
    let role_id = req.query.role_id ? parseInt(req.query.role_id as string) : undefined;
    
    // If role name is provided instead of role_id, convert it
    if (!role_id && req.query.role) {
      const role_name = req.query.role as string;
      const roleMap: { [key: string]: number } = {
        'Admin': 1,
        'QA': 2,
        'CSR': 3,
        'Trainer': 4,
        'Manager': 5,
        'Director': 6
      };
      role_id = roleMap[role_name];
      console.log(`[USER CONTROLLER] Converted role '${role_name}' to role_id: ${role_id}`);
    }
    
    // Default to active users when filtering by role (common use case for dropdowns)
    let is_active = req.query.is_active !== undefined ? req.query.is_active === 'true' : undefined;
    if (role_id && is_active === undefined) {
      is_active = true; // Default to active users for role-based queries
      console.log('[USER CONTROLLER] Defaulting to active users for role-based query');
    }
    
    const filters = {
      role_id,
      department_id: req.query.department_id ? parseInt(req.query.department_id as string) : undefined,
      is_active,
      search: req.query.search as string
    };

    console.log('[USER CONTROLLER] Filters applied:', filters);

    const result = await userService.getUsers(page, limit, filters);
    console.log('[USER CONTROLLER] Service returned:', {
      userCount: result.users.length,
      total: result.pagination.total,
      page: result.pagination.page
    });
    
    // Transform response to match frontend expectations
    const transformedResponse = {
      items: result.users,
      totalItems: result.pagination.total,
      totalPages: result.pagination.totalPages,
      currentPage: result.pagination.page
    };
    
    console.log('[USER CONTROLLER] Sending response:', {
      itemCount: transformedResponse.items.length,
      totalItems: transformedResponse.totalItems,
      currentPage: transformedResponse.currentPage
    });
    
    return res.status(200).json(transformedResponse);
  } catch (error) {
    console.error('[USER CONTROLLER] Error in getUsers:', error);
    next(error); // Let the global error handler handle it
  }
};

/**
 * Get user by ID
 * @route GET /api/users/:id
 */
export const getUserById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log('[USER CONTROLLER] Getting user by ID');
    
    const user_id = parseInt(req.params.id);
    const user = await userService.getUserById(user_id);
    return res.status(200).json(user);
  } catch (error) {
    console.error('[USER CONTROLLER] Error in getUserById:', error);
    next(error); // Let the global error handler handle it
  }
};

/**
 * Create new user
 * @route POST /api/users
 */
export const createUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log('[USER CONTROLLER] Creating new user');
    
    const userData = req.body;
    const created_by = req.user?.user_id || 0;
    
    const newUser = await userService.createUser(userData, created_by);
    return res.status(201).json(newUser);
  } catch (error) {
    console.error('[USER CONTROLLER] Error in createUser:', error);
    next(error); // Let the global error handler handle it
  }
};

/**
 * Update user
 * @route PUT /api/users/:id
 */
export const updateUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log('[USER CONTROLLER] Updating user');
    console.log('[USER CONTROLLER] Request body:', JSON.stringify(req.body, null, 2));
    
    const user_id = parseInt(req.params.id);
    const userData = req.body;
    const updatedBy = req.user?.user_id || 0;
    
    const updatedUser = await userService.updateUser(user_id, userData, updatedBy);
    return res.status(200).json(updatedUser);
  } catch (error) {
    console.error('[USER CONTROLLER] Error in updateUser:', error);
    next(error); // Let the global error handler handle it
  }
};

/**
 * Delete user
 * @route DELETE /api/users/:id
 */
export const deleteUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log('[USER CONTROLLER] Deleting user');
    
    const user_id = parseInt(req.params.id);
    const deletedBy = req.user?.user_id || 0;
    
    await userService.deleteUser(user_id, deletedBy);
    return res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('[USER CONTROLLER] Error in deleteUser:', error);
    next(error); // Let the global error handler handle it
  }
};

/**
 * Toggle user status
 * @route PUT /api/users/:id/status
 */
export const toggleUserStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log('[USER CONTROLLER] Toggling user status');
    
    const user_id = parseInt(req.params.id);
    const { is_active } = req.body;
    const updatedBy = req.user?.user_id || 0;
    
    const updatedUser = await userService.toggleUserStatus(user_id, is_active, updatedBy);
    return res.status(200).json(updatedUser);
  } catch (error) {
    console.error('[USER CONTROLLER] Error in toggleUserStatus:', error);
    next(error); // Let the global error handler handle it
  }
};

/**
 * Change password
 * @route PUT /api/users/change-password
 */
export const changePassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log('[USER CONTROLLER] Changing password');
    
    const user_id = req.user?.user_id;
    if (!user_id) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const { currentPassword, newPassword } = req.body;
    
    await userService.changePassword(user_id, currentPassword, newPassword);
    return res.status(200).json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('[USER CONTROLLER] Error in changePassword:', error);
    next(error); // Let the global error handler handle it
  }
};

/**
 * Get managers
 * @route GET /api/users/managers
 */
export const getManagers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log('[USER CONTROLLER] Getting managers');
    
    const managers = await userService.getManagers();
    return res.status(200).json(managers);
  } catch (error) {
    console.error('[USER CONTROLLER] Error in getManagers:', error);
    next(error); // Let the global error handler handle it
  }
};

/**
 * Get directors
 * @route GET /api/users/directors
 */
export const getDirectors = async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log('[USER CONTROLLER] Getting directors');
    
    const directors = await userService.getDirectors();
    return res.status(200).json(directors);
  } catch (error) {
    console.error('[USER CONTROLLER] Error in getDirectors:', error);
    next(error);
  }
};

/**
 * Get all departments managed by the requesting user
 * @route GET /api/users/my-departments
 */
export const getMyDepartments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = (req as any).user?.user_id;
    if (!user_id) return res.status(401).json({ message: 'Authentication required' });

    const departments = await prisma.departmentManager.findMany({
      where: { manager_id: user_id, is_active: true },
      include: {
        department: {
          select: { id: true, department_name: true, is_active: true },
        },
      },
      orderBy: { department: { department_name: 'asc' } },
    });

    return res.status(200).json(
      departments.map(dm => dm.department)
    );
  } catch (error) {
    console.error('[USER CONTROLLER] Error in getMyDepartments:', error);
    next(error);
  }
}; 