import prisma from '../config/prisma';
import { dbLogger } from '../config/logger';
import { User } from '../models/User';
import {
  UserFilters,
  PaginatedUserResponse,
  UserWithDetails,
  UserCreateRequest,
  UserUpdateRequest,
  UserServiceError,
} from '../services/UserService';

/**
 * MySQL implementation of UserRepository using Prisma
 */
export class MySQLUserRepository {

  async findAll(page: number, limit: number, filters?: UserFilters): Promise<PaginatedUserResponse> {
    try {
      dbLogger.query('Finding users with pagination', [`page=${page}`, `limit=${limit}`]);

      const offset = (page - 1) * limit;

      const where: any = {};
      if (filters?.role_id !== undefined) where.role_id = filters.role_id;
      if (filters?.department_id !== undefined) where.department_id = filters.department_id;
      if (filters?.is_active !== undefined) where.is_active = filters.is_active;
      if (filters?.search) {
        where.OR = [
          { username: { contains: filters.search } },
          { email: { contains: filters.search } },
        ];
      }

      const [total, rows] = await prisma.$transaction([
        prisma.user.count({ where }),
        prisma.user.findMany({
          where,
          include: {
            role: { select: { role_name: true } },
            department: { select: { department_name: true } },
          },
          orderBy: { created_at: 'desc' },
          skip: offset,
          take: limit,
        }),
      ]);

      const users = rows.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        role_id: u.role_id,
        role_name: u.role.role_name,
        department_id: u.department_id,
        department_name: u.department?.department_name ?? null,
        is_active: u.is_active,
        created_at: u.created_at,
        updated_at: u.updated_at,
      }));

      dbLogger.query('Users query completed', [`found=${users.length}`, `total=${total}`]);

      return {
        users: users as UserWithDetails[],
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      dbLogger.error(error as Error, 'Error finding users');
      throw new UserServiceError('Database error while fetching users', 'DATABASE_ERROR', 500);
    }
  }

  async findById(id: number): Promise<UserWithDetails | null> {
    try {
      dbLogger.query('Finding user by ID', [`id=${id}`]);

      const user = await prisma.user.findUnique({
        where: { id },
        include: {
          role: { select: { role_name: true } },
          department: { select: { department_name: true } },
        },
      });

      if (!user) return null;

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        password_hash: user.password_hash,
        role_id: user.role_id,
        role_name: user.role.role_name,
        department_id: user.department_id,
        department_name: user.department?.department_name ?? null,
        is_active: user.is_active,
        created_at: user.created_at,
        updated_at: user.updated_at,
      } as UserWithDetails;
    } catch (error) {
      dbLogger.error(error as Error, 'Error finding user by ID', [`id=${id}`]);
      throw new UserServiceError('Database error while fetching user', 'DATABASE_ERROR', 500);
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    try {
      dbLogger.query('Finding user by email', [`email=${email}`]);

      const user = await prisma.user.findUnique({ where: { email } });
      return user as unknown as User | null;
    } catch (error) {
      dbLogger.error(error as Error, 'Error finding user by email', [`email=${email}`]);
      throw new UserServiceError('Database error while checking email', 'DATABASE_ERROR', 500);
    }
  }

  async findByUsername(username: string): Promise<User | null> {
    try {
      dbLogger.query('Finding user by username', [`username=${username}`]);

      const user = await prisma.user.findUnique({ where: { username } });
      return user as unknown as User | null;
    } catch (error) {
      dbLogger.error(error as Error, 'Error finding user by username', [`username=${username}`]);
      throw new UserServiceError('Database error while checking username', 'DATABASE_ERROR', 500);
    }
  }

  async create(userData: UserCreateRequest, created_by: number): Promise<UserWithDetails> {
    try {
      console.log(`[NEW USER] UserRepository: Creating user: ${userData.username}`);

      const result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            username: userData.username,
            email: userData.email,
            password_hash: userData.password,
            role_id: userData.role_id,
            department_id: userData.department_id ?? null,
            is_active: true,
          },
        });

        await tx.auditLog.create({
          data: {
            user_id: created_by,
            action: 'CREATE',
            target_type: 'users',
            target_id: user.id,
            details: `Created user ${userData.username}`,
          },
        });

        return user;
      });

      const createdUser = await this.findById(result.id);
      if (!createdUser) throw new UserServiceError('Failed to retrieve created user', 'CREATE_ERROR', 500);

      console.log(`[NEW USER] UserRepository: User created successfully with ID: ${result.id}`);
      return createdUser;
    } catch (error) {
      console.error('[NEW USER] UserRepository: Error creating user:', error);
      if (error instanceof UserServiceError) throw error;
      throw new UserServiceError('Database error while creating user', 'DATABASE_ERROR', 500);
    }
  }

  async update(id: number, userData: UserUpdateRequest, updatedBy: number): Promise<UserWithDetails> {
    try {
      console.log(`[NEW USER] UserRepository: Updating user ID: ${id}`);

      const updateData: any = {};
      if (userData.username !== undefined) updateData.username = userData.username;
      if (userData.email !== undefined) updateData.email = userData.email;
      if (userData.password !== undefined) updateData.password_hash = userData.password;
      if (userData.role_id !== undefined) updateData.role_id = userData.role_id;
      if (userData.department_id !== undefined) updateData.department_id = userData.department_id;

      if (Object.keys(updateData).length === 0) {
        throw new UserServiceError('No fields to update', 'NO_UPDATE_FIELDS', 400);
      }

      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data: updateData });

        await tx.auditLog.create({
          data: {
            user_id: updatedBy,
            action: 'UPDATE',
            target_type: 'users',
            target_id: id,
            details: JSON.stringify(userData),
          },
        });
      });

      const updatedUser = await this.findById(id);
      if (!updatedUser) throw new UserServiceError('Failed to retrieve updated user', 'UPDATE_ERROR', 500);

      console.log(`[NEW USER] UserRepository: User updated successfully: ${updatedUser.username}`);
      return updatedUser;
    } catch (error) {
      console.error('[NEW USER] UserRepository: Error updating user:', error);
      if (error instanceof UserServiceError) throw error;
      throw new UserServiceError('Database error while updating user', 'DATABASE_ERROR', 500);
    }
  }

  async delete(id: number, deletedBy: number): Promise<void> {
    try {
      console.log(`[NEW USER] UserRepository: Deleting user ID: ${id}`);

      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data: { is_active: false } });

        await tx.auditLog.create({
          data: {
            user_id: deletedBy,
            action: 'DELETE',
            target_type: 'users',
            target_id: id,
            details: 'Soft deleted user (marked inactive)',
          },
        });
      });

      console.log(`[NEW USER] UserRepository: User deleted successfully with ID: ${id}`);
    } catch (error) {
      console.error('[NEW USER] UserRepository: Error deleting user:', error);
      throw new UserServiceError('Database error while deleting user', 'DATABASE_ERROR', 500);
    }
  }

  async toggleStatus(id: number, is_active: boolean, updatedBy: number): Promise<UserWithDetails> {
    try {
      console.log(`[NEW USER] UserRepository: Toggling user status ID: ${id} to ${is_active}`);

      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data: { is_active: is_active } });

        await tx.auditLog.create({
          data: {
            user_id: updatedBy,
            action: 'STATUS_CHANGE',
            target_type: 'users',
            target_id: id,
            details: `Changed user status to ${is_active ? 'active' : 'inactive'}`,
          },
        });
      });

      const updatedUser = await this.findById(id);
      if (!updatedUser) throw new UserServiceError('Failed to retrieve user after status change', 'STATUS_ERROR', 500);

      console.log(`[NEW USER] UserRepository: User status updated successfully: ${updatedUser.username}`);
      return updatedUser;
    } catch (error) {
      console.error('[NEW USER] UserRepository: Error toggling user status:', error);
      if (error instanceof UserServiceError) throw error;
      throw new UserServiceError('Database error while changing user status', 'DATABASE_ERROR', 500);
    }
  }

  async findManagers(): Promise<User[]> {
    try {
      console.log('[NEW USER] UserRepository: Finding managers');

      const users = await prisma.user.findMany({
        where: {
          is_active: true,
          role: { role_name: 'Manager' },
        },
        orderBy: { username: 'asc' },
      });

      console.log(`[NEW USER] UserRepository: Found ${users.length} managers`);
      return users as unknown as User[];
    } catch (error) {
      console.error('[NEW USER] UserRepository: Error finding managers:', error);
      throw new UserServiceError('Database error while fetching managers', 'DATABASE_ERROR', 500);
    }
  }

  async findDirectors(): Promise<User[]> {
    try {
      console.log('[NEW USER] UserRepository: Finding directors');

      const users = await prisma.user.findMany({
        where: {
          is_active: true,
          role: { role_name: 'Director' },
        },
        orderBy: { username: 'asc' },
      });

      console.log(`[NEW USER] UserRepository: Found ${users.length} directors`);
      return users as unknown as User[];
    } catch (error) {
      console.error('[NEW USER] UserRepository: Error finding directors:', error);
      throw new UserServiceError('Database error while fetching directors', 'DATABASE_ERROR', 500);
    }
  }

  async search(query: string): Promise<User[]> {
    try {
      console.log(`[NEW USER] UserRepository: Searching users with query: ${query}`);

      const users = await prisma.user.findMany({
        where: {
          is_active: true,
          OR: [
            { username: { contains: query } },
            { email: { contains: query } },
          ],
        },
        orderBy: { username: 'asc' },
        take: 50,
      });

      console.log(`[NEW USER] UserRepository: Found ${users.length} users matching search`);
      return users as unknown as User[];
    } catch (error) {
      console.error('[NEW USER] UserRepository: Error searching users:', error);
      throw new UserServiceError('Database error while searching users', 'DATABASE_ERROR', 500);
    }
  }
}
