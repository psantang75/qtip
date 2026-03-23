import { 
  Department, 
  DepartmentWithDetails, 
  DepartmentFilters, 
  PaginatedDepartmentResponse, 
  DepartmentCreateRequest, 
  DepartmentUpdateRequest 
} from '../types/department.types';

// Department repository interface for dependency injection
interface IDepartmentRepository {
  findAll(page: number, limit: number, filters?: DepartmentFilters): Promise<PaginatedDepartmentResponse>;
  findById(id: number): Promise<DepartmentWithDetails | null>;
  findByName(name: string): Promise<Department | null>;
  create(departmentData: DepartmentCreateRequest, created_by: number): Promise<DepartmentWithDetails>;
  update(id: number, departmentData: DepartmentUpdateRequest, updatedBy: number): Promise<DepartmentWithDetails>;
  delete(id: number, deletedBy: number): Promise<void>;
  toggleStatus(id: number, is_active: boolean, updatedBy: number): Promise<DepartmentWithDetails>;
  assignUsers(department_id: number, userIds: number[], assigned_by: number): Promise<void>;
  assignManagers(department_id: number, managerIds: number[], assigned_by: number): Promise<void>;
  getAssignableUsers(): Promise<any[]>;
  getUserCount(department_id: number): Promise<number>;
}

/**
 * Custom department service errors
 */
export class DepartmentServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'DepartmentServiceError';
  }
}

/**
 * Department Service with Clean Architecture patterns
 * Implements comprehensive department management operations with business logic
 */
export class DepartmentService {
  private readonly repository: IDepartmentRepository;

  constructor(repository: IDepartmentRepository) {
    this.repository = repository;
  }

  /**
   * Get paginated list of departments with filtering
   */
  async getDepartments(
    page: number = 1, 
    limit: number = 20, 
    filters?: DepartmentFilters
  ): Promise<PaginatedDepartmentResponse> {
    console.log(`[NEW DEPT] DepartmentService: Getting departments - Page: ${page}, Limit: ${limit}`);
    
    try {
      // Validate pagination parameters
      if (page < 1) {
        throw new DepartmentServiceError('Page must be greater than 0', 'INVALID_PAGE', 400);
      }
      
      if (limit < 1 || limit > 100) {
        throw new DepartmentServiceError('Limit must be between 1 and 100', 'INVALID_LIMIT', 400);
      }

      const result = await this.repository.findAll(page, limit, filters);
      
      console.log(`[NEW DEPT] DepartmentService: Found ${result.items.length} departments`);
      return result;
    } catch (error) {
      if (error instanceof DepartmentServiceError) {
        throw error;
      }
      
      console.error('[NEW DEPT] DepartmentService: Error getting departments:', error);
      throw new DepartmentServiceError('Failed to retrieve departments', 'GET_DEPARTMENTS_ERROR', 500);
    }
  }

  /**
   * Get department by ID with detailed information
   */
  async getDepartmentById(id: number): Promise<DepartmentWithDetails> {
    console.log(`[NEW DEPT] DepartmentService: Getting department by ID: ${id}`);
    
    try {
      if (!id || id <= 0) {
        throw new DepartmentServiceError('Invalid department ID', 'INVALID_DEPARTMENT_ID', 400);
      }

      const department = await this.repository.findById(id);
      
      if (!department) {
        throw new DepartmentServiceError('Department not found', 'DEPARTMENT_NOT_FOUND', 404);
      }

      console.log(`[NEW DEPT] DepartmentService: Found department: ${department.department_name}`);
      return department;
    } catch (error) {
      if (error instanceof DepartmentServiceError) {
        throw error;
      }
      
      console.error('[NEW DEPT] DepartmentService: Error getting department by ID:', error);
      throw new DepartmentServiceError('Failed to retrieve department', 'GET_DEPARTMENT_ERROR', 500);
    }
  }

  /**
   * Create a new department with business logic validation
   */
  async createDepartment(departmentData: DepartmentCreateRequest, created_by: number): Promise<DepartmentWithDetails> {
    console.log(`[NEW DEPT] DepartmentService: Creating department: ${departmentData.department_name}`);
    
    try {
      // Validate required fields
      await this.validateDepartmentData(departmentData, true);

      // Check for existing department
      await this.checkDepartmentExists(departmentData.department_name);

      const newDepartment = await this.repository.create(departmentData, created_by);
      
      console.log(`[NEW DEPT] DepartmentService: Department created successfully with ID: ${newDepartment.id}`);
      return newDepartment;
    } catch (error) {
      if (error instanceof DepartmentServiceError) {
        throw error;
      }
      
      console.error('[NEW DEPT] DepartmentService: Error creating department:', error);
      throw new DepartmentServiceError('Failed to create department', 'CREATE_DEPARTMENT_ERROR', 500);
    }
  }

  /**
   * Update an existing department with business logic validation
   */
  async updateDepartment(
    id: number, 
    departmentData: DepartmentUpdateRequest, 
    updatedBy: number
  ): Promise<DepartmentWithDetails> {
    console.log(`[NEW DEPT] DepartmentService: Updating department ID: ${id}`);
    
    try {
      // Validate department ID
      if (!id || id <= 0) {
        throw new DepartmentServiceError('Invalid department ID', 'INVALID_DEPARTMENT_ID', 400);
      }

      // Check if department exists
      const existingDepartment = await this.repository.findById(id);
      if (!existingDepartment) {
        throw new DepartmentServiceError('Department not found', 'DEPARTMENT_NOT_FOUND', 404);
      }

      // Validate update data
      await this.validateDepartmentData(departmentData, false);

      // Check for name conflicts (excluding current department)
      if (departmentData.department_name) {
        await this.checkDepartmentExists(departmentData.department_name, id);
      }

      const updatedDepartment = await this.repository.update(id, departmentData, updatedBy);
      
      console.log(`[NEW DEPT] DepartmentService: Department updated successfully: ${updatedDepartment.department_name}`);
      return updatedDepartment;
    } catch (error) {
      if (error instanceof DepartmentServiceError) {
        throw error;
      }
      
      console.error('[NEW DEPT] DepartmentService: Error updating department:', error);
      throw new DepartmentServiceError('Failed to update department', 'UPDATE_DEPARTMENT_ERROR', 500);
    }
  }

  /**
   * Delete a department with business logic validation
   */
  async deleteDepartment(id: number, deletedBy: number): Promise<void> {
    console.log(`[NEW DEPT] DepartmentService: Deleting department ID: ${id}`);
    
    try {
      if (!id || id <= 0) {
        throw new DepartmentServiceError('Invalid department ID', 'INVALID_DEPARTMENT_ID', 400);
      }

      // Check if department exists
      const existingDepartment = await this.repository.findById(id);
      if (!existingDepartment) {
        throw new DepartmentServiceError('Department not found', 'DEPARTMENT_NOT_FOUND', 404);
      }

      // Check if department has users
      const userCount = await this.repository.getUserCount(id);
      if (userCount > 0) {
        throw new DepartmentServiceError(
          'Cannot delete department with assigned users. Please reassign users first.',
          'DEPARTMENT_HAS_USERS',
          400
        );
      }

      await this.repository.delete(id, deletedBy);
      
      console.log(`[NEW DEPT] DepartmentService: Department deleted successfully: ${existingDepartment.department_name}`);
    } catch (error) {
      if (error instanceof DepartmentServiceError) {
        throw error;
      }
      
      console.error('[NEW DEPT] DepartmentService: Error deleting department:', error);
      throw new DepartmentServiceError('Failed to delete department', 'DELETE_DEPARTMENT_ERROR', 500);
    }
  }

  /**
   * Toggle department active status
   */
  async toggleDepartmentStatus(
    id: number, 
    is_active: boolean, 
    updatedBy: number
  ): Promise<DepartmentWithDetails> {
    console.log(`[NEW DEPT] DepartmentService: Toggling department status ID: ${id} to ${is_active}`);
    
    try {
      if (!id || id <= 0) {
        throw new DepartmentServiceError('Invalid department ID', 'INVALID_DEPARTMENT_ID', 400);
      }

      if (typeof is_active !== 'boolean') {
        throw new DepartmentServiceError('Status must be a boolean value', 'INVALID_STATUS', 400);
      }

      // Check if department exists
      const existingDepartment = await this.repository.findById(id);
      if (!existingDepartment) {
        throw new DepartmentServiceError('Department not found', 'DEPARTMENT_NOT_FOUND', 404);
      }

      const updatedDepartment = await this.repository.toggleStatus(id, is_active, updatedBy);
      
      console.log(`[NEW DEPT] DepartmentService: Department status updated successfully: ${updatedDepartment.department_name}`);
      return updatedDepartment;
    } catch (error) {
      if (error instanceof DepartmentServiceError) {
        throw error;
      }
      
      console.error('[NEW DEPT] DepartmentService: Error toggling department status:', error);
      throw new DepartmentServiceError('Failed to toggle department status', 'TOGGLE_STATUS_ERROR', 500);
    }
  }

  /**
   * Assign users to a department
   */
  async assignUsers(
    department_id: number, 
    userIds: number[], 
    assigned_by: number
  ): Promise<void> {
    console.log(`[NEW DEPT] DepartmentService: Assigning users to department ID: ${department_id}`);
    
    try {
      if (!department_id || department_id <= 0) {
        throw new DepartmentServiceError('Invalid department ID', 'INVALID_DEPARTMENT_ID', 400);
      }

      if (!Array.isArray(userIds)) {
        throw new DepartmentServiceError('User IDs must be an array', 'INVALID_USER_IDS', 400);
      }

      if (userIds.length === 0) {
        throw new DepartmentServiceError('At least one user ID is required', 'EMPTY_USER_IDS', 400);
      }

      // Validate user IDs
      const invalidIds = userIds.filter(id => !id || id <= 0);
      if (invalidIds.length > 0) {
        throw new DepartmentServiceError('All user IDs must be valid positive numbers', 'INVALID_USER_IDS', 400);
      }

      // Check if department exists
      const existingDepartment = await this.repository.findById(department_id);
      if (!existingDepartment) {
        throw new DepartmentServiceError('Department not found', 'DEPARTMENT_NOT_FOUND', 404);
      }

      await this.repository.assignUsers(department_id, userIds, assigned_by);
      
      console.log(`[NEW DEPT] DepartmentService: ${userIds.length} users assigned to department: ${existingDepartment.department_name}`);
    } catch (error) {
      if (error instanceof DepartmentServiceError) {
        throw error;
      }
      
      console.error('[NEW DEPT] DepartmentService: Error assigning users:', error);
      throw new DepartmentServiceError('Failed to assign users to department', 'ASSIGN_USERS_ERROR', 500);
    }
  }

  /**
   * Get users eligible for assignment to departments
   */
  async getAssignableUsers(): Promise<any[]> {
    console.log('[NEW DEPT] DepartmentService: Getting assignable users');
    
    try {
      const users = await this.repository.getAssignableUsers();
      console.log(`[NEW DEPT] DepartmentService: Found ${users.length} assignable users`);
      return users;
    } catch (error) {
      console.error('[NEW DEPT] DepartmentService: Error getting assignable users:', error);
      throw new DepartmentServiceError('Failed to retrieve assignable users', 'GET_ASSIGNABLE_USERS_ERROR', 500);
    }
  }

  /**
   * Assign managers to a department
   */
  async assignManagers(
    department_id: number, 
    managerIds: number[], 
    assigned_by: number
  ): Promise<void> {
    console.log(`[NEW DEPT] DepartmentService: Assigning managers to department ID: ${department_id}`);
    
    try {
      if (!department_id || department_id <= 0) {
        throw new DepartmentServiceError('Invalid department ID', 'INVALID_DEPARTMENT_ID', 400);
      }

      if (!Array.isArray(managerIds)) {
        throw new DepartmentServiceError('Manager IDs must be an array', 'INVALID_MANAGER_IDS', 400);
      }

      // Validate manager IDs if provided
      if (managerIds.length > 0) {
        const invalidIds = managerIds.filter(id => !id || id <= 0);
        if (invalidIds.length > 0) {
          throw new DepartmentServiceError('All manager IDs must be valid positive numbers', 'INVALID_MANAGER_IDS', 400);
        }
      }

      // Check if department exists
      const existingDepartment = await this.repository.findById(department_id);
      if (!existingDepartment) {
        throw new DepartmentServiceError('Department not found', 'DEPARTMENT_NOT_FOUND', 404);
      }

      await this.repository.assignManagers(department_id, managerIds, assigned_by);
      
      console.log(`[NEW DEPT] DepartmentService: ${managerIds.length} managers assigned to department: ${existingDepartment.department_name}`);
    } catch (error) {
      if (error instanceof DepartmentServiceError) {
        throw error;
      }
      
      console.error('[NEW DEPT] DepartmentService: Error assigning managers:', error);
      throw new DepartmentServiceError('Failed to assign managers to department', 'ASSIGN_MANAGERS_ERROR', 500);
    }
  }

  /**
   * Private method to validate department data
   */
  private async validateDepartmentData(departmentData: Partial<DepartmentCreateRequest>, isCreate: boolean): Promise<void> {
    if (isCreate) {
      // Required fields for creation
      if (!departmentData.department_name?.trim()) {
        throw new DepartmentServiceError('Department name is required', 'MISSING_DEPARTMENT_NAME', 400);
      }
    }

    // Validate department name format
    if (departmentData.department_name !== undefined) {
      const name = departmentData.department_name.trim();
      
      if (name.length < 2) {
        throw new DepartmentServiceError('Department name must be at least 2 characters', 'INVALID_DEPARTMENT_NAME', 400);
      }
      
      if (name.length > 100) {
        throw new DepartmentServiceError('Department name must be less than 100 characters', 'INVALID_DEPARTMENT_NAME', 400);
      }
      
      // Check for valid characters (letters, numbers, spaces, hyphens, underscores)
      if (!/^[a-zA-Z0-9\s\-_&.]+$/.test(name)) {
        throw new DepartmentServiceError(
          'Department name can only contain letters, numbers, spaces, hyphens, underscores, ampersands, and periods',
          'INVALID_DEPARTMENT_NAME_FORMAT',
          400
        );
      }
    }

    // Validate manager_ids (now supports multiple managers)
    if (departmentData.manager_ids !== undefined && departmentData.manager_ids !== null) {
      if (!Array.isArray(departmentData.manager_ids)) {
        throw new DepartmentServiceError('Manager IDs must be an array', 'INVALID_MANAGER_IDS_FORMAT', 400);
      }
      
      // Validate each manager ID
      const invalidManagerIds = departmentData.manager_ids.filter(id => !id || id <= 0);
      if (invalidManagerIds.length > 0) {
        throw new DepartmentServiceError('All manager IDs must be valid positive numbers', 'INVALID_MANAGER_IDS', 400);
      }
    }


  }

  /**
   * Private method to check if department exists
   */
  private async checkDepartmentExists(name: string, excludeId?: number): Promise<void> {
    const existingDepartment = await this.repository.findByName(name.trim());
    
    if (existingDepartment && (!excludeId || existingDepartment.id !== excludeId)) {
      throw new DepartmentServiceError('Department name already exists', 'DEPARTMENT_NAME_EXISTS', 409);
    }
  }
} 