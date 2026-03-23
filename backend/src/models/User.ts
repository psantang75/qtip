/**
 * TypeScript interface for the Users table
 */

export interface User {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  role_id: number;
  department_id: number | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * TypeScript interface for creating a new User
 */
export interface CreateUserDTO {
  username: string;
  email: string;
  password: string; // Plain password before hashing
  role_id: number;
  department_id?: number | null;
}

/**
 * TypeScript interface for updating a User
 */
export interface UpdateUserDTO {
  username?: string;
  email?: string;
  password?: string; // Plain password before hashing
  role_id?: number;
  department_id?: number | null;
} 