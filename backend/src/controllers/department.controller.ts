import { Request, Response } from 'express';
import { DepartmentService, DepartmentServiceError } from '../services/DepartmentService';
import { MySQLDepartmentRepository } from '../repositories/MySQLDepartmentRepository';

// Initialize department service
const departmentRepository = new MySQLDepartmentRepository();
const departmentService = new DepartmentService(departmentRepository);

/**
 * Create new department
 * @route POST /api/departments
 */
export const createDepartment = async (req: Request, res: Response) => {
  console.log('[DEPT CONTROLLER] Creating new department');
  
  try {
    const user_id = req.user?.user_id;
    if (!user_id) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const departmentData = {
      department_name: req.body.department_name,
      manager_ids: req.body.manager_ids || []
    };

    const newDepartment = await departmentService.createDepartment(departmentData, user_id);
    res.status(201).json(newDepartment);
  } catch (error) {
    if (error instanceof DepartmentServiceError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    
    console.error('[DEPT CONTROLLER] Error in department service:', error);
    res.status(500).json({ message: 'Failed to create department' });
  }
};

/**
 * Get departments with filtering and pagination
 * @route GET /api/departments
 */
export const getDepartments = async (req: Request, res: Response) => {
  console.log('[DEPT CONTROLLER] Getting departments');
  
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    
    const filters = {
      manager_id: req.query.manager_id ? parseInt(req.query.manager_id as string) : undefined,
      is_active: req.query.is_active ? req.query.is_active === 'true' : undefined,
      search: req.query.search as string
    };

    const result = await departmentService.getDepartments(page, limit, filters);
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof DepartmentServiceError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    
    console.error('[DEPT CONTROLLER] Error in department service:', error);
    res.status(500).json({ message: 'Failed to fetch departments' });
  }
};

/**
 * Get department by ID
 * @route GET /api/departments/:id
 */
export const getDepartmentById = async (req: Request, res: Response) => {
  console.log('[DEPT CONTROLLER] Getting department by ID');
  
  try {
    const id = parseInt(req.params.id);
    const department = await departmentService.getDepartmentById(id);
    res.status(200).json(department);
  } catch (error) {
    if (error instanceof DepartmentServiceError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    
    console.error('[DEPT CONTROLLER] Error in department service:', error);
    res.status(500).json({ message: 'Failed to fetch department' });
  }
};

/**
 * Update department
 * @route PUT /api/departments/:id
 */
export const updateDepartment = async (req: Request, res: Response) => {
  console.log('[DEPT CONTROLLER] Updating department');
  
  try {
    const user_id = req.user?.user_id;
    if (!user_id) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const id = parseInt(req.params.id);
    const departmentData = {
      department_name: req.body.department_name,
      manager_ids: req.body.manager_ids !== undefined ? req.body.manager_ids : undefined
    };

    const updatedDepartment = await departmentService.updateDepartment(id, departmentData, user_id);
    res.status(200).json(updatedDepartment);
  } catch (error) {
    if (error instanceof DepartmentServiceError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    
    console.error('[DEPT CONTROLLER] Error in department service:', error);
    res.status(500).json({ message: 'Failed to update department' });
  }
};

/**
 * Toggle department status
 * @route PUT /api/departments/:id/status
 */
export const toggleDepartmentStatus = async (req: Request, res: Response) => {
  console.log('[DEPT CONTROLLER] Toggling department status');
  
  try {
    const user_id = req.user?.user_id;
    if (!user_id) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const id = parseInt(req.params.id);
    const is_active = req.body.is_active;

    const updatedDepartment = await departmentService.toggleDepartmentStatus(id, is_active, user_id);
    res.status(200).json(updatedDepartment);
  } catch (error) {
    if (error instanceof DepartmentServiceError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    
    console.error('[DEPT CONTROLLER] Error in department service:', error);
    res.status(500).json({ message: 'Failed to toggle department status' });
  }
};

/**
 * Delete department
 * @route DELETE /api/departments/:id
 */
export const deleteDepartment = async (req: Request, res: Response) => {
  console.log('[DEPT CONTROLLER] Deleting department');
  
  try {
    const user_id = req.user?.user_id;
    if (!user_id) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const id = parseInt(req.params.id);
    await departmentService.deleteDepartment(id, user_id);
    res.status(200).json({ message: 'Department deleted successfully' });
  } catch (error) {
    if (error instanceof DepartmentServiceError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    
    console.error('[DEPT CONTROLLER] Error in department service:', error);
    res.status(500).json({ message: 'Failed to delete department' });
  }
};

/**
 * Assign users to department
 * @route POST /api/departments/:id/users
 */
export const assignUsers = async (req: Request, res: Response) => {
  console.log('[DEPT CONTROLLER] Assigning users to department');
  
  try {
    const user_id = req.user?.user_id;
    if (!user_id) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const department_id = parseInt(req.params.id);
    const userIds = req.body.user_ids;

    await departmentService.assignUsers(department_id, userIds, user_id);
    res.status(200).json({ message: 'Users assigned to department successfully' });
  } catch (error) {
    if (error instanceof DepartmentServiceError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    
    console.error('[DEPT CONTROLLER] Error in department service:', error);
    res.status(500).json({ message: 'Failed to assign users to department' });
  }
};

/**
 * Get assignable users
 * @route GET /api/departments/users/assignable
 */
export const getAssignableUsers = async (req: Request, res: Response) => {
  console.log('[DEPT CONTROLLER] Getting assignable users');
  
  try {
    const users = await departmentService.getAssignableUsers();
    res.status(200).json(users);
  } catch (error) {
    if (error instanceof DepartmentServiceError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    
    console.error('[DEPT CONTROLLER] Error in department service:', error);
    res.status(500).json({ message: 'Failed to fetch assignable users' });
  }
}; 