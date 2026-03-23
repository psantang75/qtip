import bcrypt from 'bcrypt';
import { User, CreateUserDTO, UpdateUserDTO } from '../models/User';

// User service specific interfaces
export interface UserFilters {
  role_id?: number;
  department_id?: number;
  is_active?: boolean;
  search?: string;
}

export interface PaginatedUserResponse {
  users: User[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface UserWithDetails extends User {
  role_name?: string;
  department_name?: string;
  manager_name?: string;
}

export interface UserCreateRequest extends CreateUserDTO {
  // Note: manager relationships are now handled via department_managers table
}

export interface UserUpdateRequest extends UpdateUserDTO {
  // Note: manager relationships are now handled via department_managers table  
}

// User repository interface for dependency injection
interface IUserRepository {
  findAll(page: number, limit: number, filters?: UserFilters): Promise<PaginatedUserResponse>;
  findById(id: number): Promise<UserWithDetails | null>;
  findByEmail(email: string): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  create(userData: UserCreateRequest, created_by: number): Promise<UserWithDetails>;
  update(id: number, userData: UserUpdateRequest, updatedBy: number): Promise<UserWithDetails>;
  delete(id: number, deletedBy: number): Promise<void>;
  toggleStatus(id: number, is_active: boolean, updatedBy: number): Promise<UserWithDetails>;
  findManagers(): Promise<User[]>;
  findDirectors(): Promise<User[]>;
  search(query: string): Promise<User[]>;
}

/**
 * Custom user service errors
 */
export class UserServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'UserServiceError';
  }
}

/**
 * User Service with Clean Architecture patterns
 * Implements comprehensive user management operations with business logic
 */
export class UserService {
  private readonly repository: IUserRepository;
  private readonly saltRounds: number = 10;

  constructor(repository: IUserRepository) {
    this.repository = repository;
  }

  /**
   * Get paginated list of users with filtering
   */
  async getUsers(
    page: number = 1, 
    limit: number = 20, 
    filters?: UserFilters
  ): Promise<PaginatedUserResponse> {
    console.log(`[NEW USER] UserService: Getting users - Page: ${page}, Limit: ${limit}`);
    
    try {
      // Validate pagination parameters
      if (page < 1) {
        throw new UserServiceError('Page must be greater than 0', 'INVALID_PAGE', 400);
      }
      
      if (limit < 1 || limit > 100) {
        throw new UserServiceError('Limit must be between 1 and 100', 'INVALID_LIMIT', 400);
      }

      const result = await this.repository.findAll(page, limit, filters);
      
      console.log(`[NEW USER] UserService: Found ${result.users.length} users`);
      return result;
    } catch (error) {
      if (error instanceof UserServiceError) {
        throw error;
      }
      
      console.error('[NEW USER] UserService: Error getting users:', error);
      throw new UserServiceError('Failed to retrieve users', 'GET_USERS_ERROR', 500);
    }
  }

  /**
   * Get user by ID with detailed information
   */
  async getUserById(id: number): Promise<UserWithDetails> {
    console.log(`[NEW USER] UserService: Getting user by ID: ${id}`);
    
    try {
      if (!id || id <= 0) {
        throw new UserServiceError('Invalid user ID', 'INVALID_USER_ID', 400);
      }

      const user = await this.repository.findById(id);
      
      if (!user) {
        throw new UserServiceError('User not found', 'USER_NOT_FOUND', 404);
      }

      console.log(`[NEW USER] UserService: Found user: ${user.username}`);
      return user;
    } catch (error) {
      if (error instanceof UserServiceError) {
        throw error;
      }
      
      console.error('[NEW USER] UserService: Error getting user by ID:', error);
      throw new UserServiceError('Failed to retrieve user', 'GET_USER_ERROR', 500);
    }
  }

  /**
   * Create a new user with business logic validation
   */
  async createUser(userData: UserCreateRequest, created_by: number): Promise<UserWithDetails> {
    console.log(`[NEW USER] UserService: Creating user: ${userData.username}`);
    
    try {
      // Validate required fields
      await this.validateUserData(userData, true);

      // Check for existing user
      await this.checkUserExists(userData.username, userData.email);

      // Hash password
      const hashedPassword = await this.hashPassword(userData.password);
      
      const userToCreate = {
        ...userData,
        password: hashedPassword
      };

      const newUser = await this.repository.create(userToCreate, created_by);
      
      console.log(`[NEW USER] UserService: User created successfully with ID: ${newUser.id}`);
      return newUser;
    } catch (error) {
      if (error instanceof UserServiceError) {
        throw error;
      }
      
      console.error('[NEW USER] UserService: Error creating user:', error);
      throw new UserServiceError('Failed to create user', 'CREATE_USER_ERROR', 500);
    }
  }

  /**
   * Update an existing user with business logic validation
   */
  async updateUser(
    id: number, 
    userData: UserUpdateRequest, 
    updatedBy: number
  ): Promise<UserWithDetails> {
    console.log(`[NEW USER] UserService: Updating user ID: ${id}`);
    
    try {
      // Validate user ID
      if (!id || id <= 0) {
        throw new UserServiceError('Invalid user ID', 'INVALID_USER_ID', 400);
      }

      // Check if user exists
      const existingUser = await this.repository.findById(id);
      if (!existingUser) {
        throw new UserServiceError('User not found', 'USER_NOT_FOUND', 404);
      }

      // Validate update data
      await this.validateUserData(userData, false);

      // Check for username/email conflicts (excluding current user)
      if (userData.username || userData.email) {
        await this.checkUserExists(userData.username, userData.email, id);
      }

      // Hash password if provided
      let updateData = { ...userData };
      if (userData.password) {
        updateData.password = await this.hashPassword(userData.password);
      }

      const updatedUser = await this.repository.update(id, updateData, updatedBy);
      
      console.log(`[NEW USER] UserService: User updated successfully: ${updatedUser.username}`);
      return updatedUser;
    } catch (error) {
      if (error instanceof UserServiceError) {
        throw error;
      }
      
      console.error('[NEW USER] UserService: Error updating user:', error);
      throw new UserServiceError('Failed to update user', 'UPDATE_USER_ERROR', 500);
    }
  }

  /**
   * Soft delete a user (mark as inactive)
   */
  async deleteUser(id: number, deletedBy: number): Promise<void> {
    console.log(`[NEW USER] UserService: Deleting user ID: ${id}`);
    
    try {
      if (!id || id <= 0) {
        throw new UserServiceError('Invalid user ID', 'INVALID_USER_ID', 400);
      }

      // Check if user exists
      const existingUser = await this.repository.findById(id);
      if (!existingUser) {
        throw new UserServiceError('User not found', 'USER_NOT_FOUND', 404);
      }

      // Prevent self-deletion
      if (id === deletedBy) {
        throw new UserServiceError('Cannot delete your own account', 'SELF_DELETE_ERROR', 403);
      }

      await this.repository.delete(id, deletedBy);
      
      console.log(`[NEW USER] UserService: User deleted successfully: ${existingUser.username}`);
    } catch (error) {
      if (error instanceof UserServiceError) {
        throw error;
      }
      
      console.error('[NEW USER] UserService: Error deleting user:', error);
      throw new UserServiceError('Failed to delete user', 'DELETE_USER_ERROR', 500);
    }
  }

  /**
   * Toggle user active status
   */
  async toggleUserStatus(
    id: number, 
    is_active: boolean, 
    updatedBy: number
  ): Promise<UserWithDetails> {
    console.log(`[NEW USER] UserService: Toggling user status ID: ${id} to ${is_active}`);
    
    try {
      if (!id || id <= 0) {
        throw new UserServiceError('Invalid user ID', 'INVALID_USER_ID', 400);
      }

      // Check if user exists
      const existingUser = await this.repository.findById(id);
      if (!existingUser) {
        throw new UserServiceError('User not found', 'USER_NOT_FOUND', 404);
      }

      // Prevent self-deactivation
      if (id === updatedBy && !is_active) {
        throw new UserServiceError('Cannot deactivate your own account', 'SELF_DEACTIVATE_ERROR', 403);
      }

      const updatedUser = await this.repository.toggleStatus(id, is_active, updatedBy);
      
      console.log(`[NEW USER] UserService: User status updated successfully: ${updatedUser.username}`);
      return updatedUser;
    } catch (error) {
      if (error instanceof UserServiceError) {
        throw error;
      }
      
      console.error('[NEW USER] UserService: Error toggling user status:', error);
      throw new UserServiceError('Failed to toggle user status', 'TOGGLE_STATUS_ERROR', 500);
    }
  }

  /**
   * Change user password (self-service)
   */
  async changePassword(
    user_id: number,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    console.log(`[USER SERVICE] Changing password for user ID: ${user_id}`);
    
    try {
      // Validate inputs
      if (!user_id || user_id <= 0) {
        throw new UserServiceError('Invalid user ID', 'INVALID_USER_ID', 400);
      }

      if (!currentPassword || !newPassword) {
        throw new UserServiceError('Current and new passwords are required', 'MISSING_PASSWORDS', 400);
      }

      // Get user from database
      const user = await this.repository.findById(user_id);
      if (!user) {
        throw new UserServiceError('User not found', 'USER_NOT_FOUND', 404);
      }

      // Verify current password
      const isPasswordValid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!isPasswordValid) {
        throw new UserServiceError('Current password is incorrect', 'INVALID_CURRENT_PASSWORD', 401);
      }

      // Validate new password strength
      if (newPassword.length < 8) {
        throw new UserServiceError('New password must be at least 8 characters', 'WEAK_PASSWORD', 400);
      }

      // Check for uppercase letter
      if (!/[A-Z]/.test(newPassword)) {
        throw new UserServiceError('New password must contain at least one uppercase letter', 'WEAK_PASSWORD', 400);
      }

      // Check for lowercase letter
      if (!/[a-z]/.test(newPassword)) {
        throw new UserServiceError('New password must contain at least one lowercase letter', 'WEAK_PASSWORD', 400);
      }

      // Check for number
      if (!/[0-9]/.test(newPassword)) {
        throw new UserServiceError('New password must contain at least one number', 'WEAK_PASSWORD', 400);
      }

      // Check for special character
      if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword)) {
        throw new UserServiceError('New password must contain at least one special character', 'WEAK_PASSWORD', 400);
      }

      // Check if new password is same as current password
      const isSamePassword = await bcrypt.compare(newPassword, user.password_hash);
      if (isSamePassword) {
        throw new UserServiceError('New password must be different from current password', 'SAME_PASSWORD', 400);
      }

      // Hash new password
      const hashedPassword = await this.hashPassword(newPassword);

      // Update password in database
      await this.repository.update(user_id, { password: hashedPassword }, user_id);

      console.log(`[USER SERVICE] Password changed successfully for user ID: ${user_id}`);
    } catch (error) {
      if (error instanceof UserServiceError) {
        throw error;
      }
      
      console.error('[USER SERVICE] Error changing password:', error);
      throw new UserServiceError('Failed to change password', 'CHANGE_PASSWORD_ERROR', 500);
    }
  }

  /**
   * Get users with manager role
   */
  async getManagers(): Promise<User[]> {
    console.log('[NEW USER] UserService: Getting managers');
    
    try {
      const managers = await this.repository.findManagers();
      console.log(`[NEW USER] UserService: Found ${managers.length} managers`);
      return managers;
    } catch (error) {
      console.error('[NEW USER] UserService: Error getting managers:', error);
      throw new UserServiceError('Failed to retrieve managers', 'GET_MANAGERS_ERROR', 500);
    }
  }

  /**
   * Get users with director role
   */
  async getDirectors(): Promise<User[]> {
    console.log('[NEW USER] UserService: Getting directors');
    
    try {
      const directors = await this.repository.findDirectors();
      console.log(`[NEW USER] UserService: Found ${directors.length} directors`);
      return directors;
    } catch (error) {
      console.error('[NEW USER] UserService: Error getting directors:', error);
      throw new UserServiceError('Failed to retrieve directors', 'GET_DIRECTORS_ERROR', 500);
    }
  }

  /**
   * Search users by query
   */
  async searchUsers(query: string): Promise<User[]> {
    console.log(`[NEW USER] UserService: Searching users with query: ${query}`);
    
    try {
      if (!query || query.trim().length < 2) {
        throw new UserServiceError('Search query must be at least 2 characters', 'INVALID_SEARCH_QUERY', 400);
      }

      const users = await this.repository.search(query.trim());
      console.log(`[NEW USER] UserService: Found ${users.length} users matching search`);
      return users;
    } catch (error) {
      if (error instanceof UserServiceError) {
        throw error;
      }
      
      console.error('[NEW USER] UserService: Error searching users:', error);
      throw new UserServiceError('Failed to search users', 'SEARCH_USERS_ERROR', 500);
    }
  }

  /**
   * Private method to validate user data
   */
  private async validateUserData(userData: Partial<UserCreateRequest>, isCreate: boolean): Promise<void> {
    if (isCreate) {
      // Required fields for creation
      if (!userData.username?.trim()) {
        throw new UserServiceError('username is required', 'MISSING_USERNAME', 400);
      }
      
      if (!userData.email?.trim()) {
        throw new UserServiceError('Email is required', 'MISSING_EMAIL', 400);
      }
      
      if (!userData.password) {
        throw new UserServiceError('Password is required', 'MISSING_PASSWORD', 400);
      }
      
      if (!userData.role_id) {
        throw new UserServiceError('Role is required', 'MISSING_ROLE', 400);
      }
    }

    // Validate username format
    if (userData.username !== undefined) {
      if (userData.username.trim().length < 3) {
        throw new UserServiceError('username must be at least 3 characters', 'INVALID_USERNAME', 400);
      }
      
      if (!/^[a-zA-Z0-9_\s-]+$/.test(userData.username.trim())) {
        throw new UserServiceError('username can only contain letters, numbers, spaces, hyphens, and underscores', 'INVALID_USERNAME_FORMAT', 400);
      }
    }

    // Validate email format
    if (userData.email !== undefined) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(userData.email.trim())) {
        throw new UserServiceError('Invalid email format', 'INVALID_EMAIL', 400);
      }
    }

    // Validate password strength - show complete requirements
    if (userData.password !== undefined) {
      const isValid = 
        userData.password.length >= 8 &&
        /[A-Z]/.test(userData.password) &&
        /[a-z]/.test(userData.password) &&
        /[0-9]/.test(userData.password) &&
        /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(userData.password);

      if (!isValid) {
        throw new UserServiceError(
          'Password must be at least 8 characters and contain at least one uppercase letter, one lowercase letter, one number, and one special character',
          'WEAK_PASSWORD',
          400
        );
      }
    }

    // Validate role_id
    if (userData.role_id !== undefined) {
      if (userData.role_id <= 0 || userData.role_id > 6) {
        throw new UserServiceError('Invalid role ID', 'INVALID_ROLE', 400);
      }
    }
  }

  /**
   * Private method to check if user exists
   */
  private async checkUserExists(
    username?: string, 
    email?: string, 
    excludeId?: number
  ): Promise<void> {
    if (username) {
      const existingByUsername = await this.repository.findByUsername(username);
      if (existingByUsername && existingByUsername.id !== excludeId) {
        throw new UserServiceError('This username is already taken. Please choose a different username.', 'USERNAME_EXISTS', 409);
      }
    }

    if (email) {
      const existingByEmail = await this.repository.findByEmail(email);
      if (existingByEmail && existingByEmail.id !== excludeId) {
        throw new UserServiceError('This email address is already in use by another user. Please choose a different email.', 'EMAIL_EXISTS', 409);
      }
    }
  }

  /**
   * Private method to hash password
   */
  private async hashPassword(password: string): Promise<string> {
    try {
      return await bcrypt.hash(password, this.saltRounds);
    } catch (error) {
      console.error('[NEW USER] UserService: Error hashing password:', error);
      throw new UserServiceError('Failed to process password', 'PASSWORD_HASH_ERROR', 500);
    }
  }
} 