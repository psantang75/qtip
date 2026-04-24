import prisma from '../config/prisma';
import { User } from '../models/User';
import logger from '../config/logger';

/**
 * Authentication Repository
 * Simplified repository focused on auth-specific operations
 */
export class AuthRepository {
  async findByEmail(email: string): Promise<User | null> {
    try {
      logger.info(`[NEW AUTH] AuthRepository: Finding user by email: ${email}`);

      const user = await prisma.user.findFirst({
        where: { email, is_active: true },
      });

      if (!user) {
        logger.info(`[NEW AUTH] AuthRepository: User not found for email: ${email}`);
        return null;
      }

      logger.info(`[NEW AUTH] AuthRepository: User found - ID: ${user.id}, Role: ${user.role_id}`);
      return user as unknown as User;
    } catch (error) {
      logger.error('[NEW AUTH] AuthRepository: Error finding user by email:', error);
      throw new Error(`Database error: Failed to find user by email`);
    }
  }

  async findById(id: number): Promise<User | null> {
    try {
      logger.info(`[NEW AUTH] AuthRepository: Finding user by ID: ${id}`);

      const user = await prisma.user.findFirst({
        where: { id, is_active: true },
      });

      if (!user) {
        logger.info(`[NEW AUTH] AuthRepository: User not found for ID: ${id}`);
        return null;
      }

      logger.info(`[NEW AUTH] AuthRepository: User found by ID - Email: ${user.email}`);
      return user as unknown as User;
    } catch (error) {
      logger.error('[NEW AUTH] AuthRepository: Error finding user by ID:', error);
      throw new Error(`Database error: Failed to find user by ID`);
    }
  }

  async updateLastLogin(user_id: number): Promise<boolean> {
    try {
      logger.info(`[NEW AUTH] AuthRepository: Updating last login for user ID: ${user_id}`);

      await prisma.user.update({
        where: { id: user_id },
        data: { last_login: new Date() },
      });

      logger.info(`[NEW AUTH] AuthRepository: Last login updated successfully for user ID: ${user_id}`);
      return true;
    } catch (error) {
      logger.error('[NEW AUTH] AuthRepository: Error updating last login:', error);
      return false;
    }
  }

  async logAuthAttempt(email: string, success: boolean, ipAddress?: string): Promise<void> {
    try {
      logger.info(`[NEW AUTH] AuthRepository: Logging auth attempt - Email: ${email}, Success: ${success}`);

      await prisma.authLog.create({
        data: {
          email,
          success,
          ip_address: ipAddress ?? null,
        },
      });

      logger.info(`[NEW AUTH] AuthRepository: Auth attempt logged successfully`);
    } catch (error) {
      logger.error('[NEW AUTH] AuthRepository: Error logging auth attempt:', error);
    }
  }

  async isAccountLocked(email: string): Promise<boolean> {
    try {
      logger.info(`[NEW AUTH] AuthRepository: Checking if account is locked for email: ${email}`);

      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      const failedAttempts = await prisma.authLog.count({
        where: {
          email,
          success: false,
          attempted_at: { gt: fifteenMinutesAgo },
        },
      });

      const isLocked = failedAttempts >= 5;

      if (isLocked) {
        logger.info(`[NEW AUTH] AuthRepository: Account is LOCKED for email: ${email} (${failedAttempts} failed attempts)`);
      } else {
        logger.info(`[NEW AUTH] AuthRepository: Account is NOT locked for email: ${email} (${failedAttempts} failed attempts)`);
      }

      return isLocked;
    } catch (error) {
      logger.error('[NEW AUTH] AuthRepository: Error checking account lock status:', error);
      return false;
    }
  }

  async getUserPermissions(user_id: number): Promise<string[]> {
    try {
      logger.info(`[NEW AUTH] AuthRepository: Getting permissions for user ID: ${user_id}`);

      const user = await prisma.user.findUnique({
        where: { id: user_id },
        select: { role_id: true },
      });

      if (!user) return [];

      const permissions = this.getPermissionsByRole(user.role_id);
      logger.info(`[NEW AUTH] AuthRepository: Found ${permissions.length} permissions for user ID: ${user_id}`);
      return permissions;
    } catch (error) {
      logger.error('[NEW AUTH] AuthRepository: Error getting user permissions:', error);
      return [];
    }
  }

  private getPermissionsByRole(role_id: number): string[] {
    const rolePermissions: { [key: number]: string[] } = {
      1: ['admin:all', 'users:manage', 'departments:manage', 'reports:view', 'forms:manage'],
      2: ['qa:manage', 'forms:create', 'audits:manage', 'reports:view'],
      3: ['profile:edit', 'forms:view', 'submissions:create'],
      4: ['training:manage', 'users:view', 'forms:create'],
      5: ['team:manage', 'reports:view', 'goals:manage'],
      6: ['director:all', 'reports:view', 'strategy:manage'],
    };
    return rolePermissions[role_id] || ['profile:edit'];
  }
}
