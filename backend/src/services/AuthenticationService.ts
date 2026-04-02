import bcrypt from 'bcrypt';
import jwt, { type SignOptions } from 'jsonwebtoken';

interface JwtTokenPayload {
  user_id?: number
  userId?: number
  role_id?: number
  roleId?: number
  type?: string
  exp?: number
  iat?: number
}
import { Request } from 'express';
import { User } from '../models/User';
import { tokenBlacklistService } from './TokenBlacklistService';

// Authentication-specific repository interface (simplified for auth needs)
interface IAuthRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: number): Promise<User | null>;
  updateLastLogin(user_id: number): Promise<boolean>;
  logAuthAttempt(email: string, success: boolean, ipAddress?: string): Promise<void>;
  isAccountLocked(email: string): Promise<boolean>;
  getUserPermissions(user_id: number): Promise<string[]>;
}

/**
 * Authentication response interfaces
 */
export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  success: boolean;
  token?: string;
  refreshToken?: string;
  user?: Omit<User, 'password_hash'>;
  message?: string;
  permissions?: string[];
}

export interface TokenValidationResult {
  valid: boolean;
  user?: User;
  permissions?: string[];
  message?: string;
}

export interface RefreshTokenResult {
  success: boolean;
  token?: string;
  refreshToken?: string;
  message?: string;
}

/**
 * Custom authentication errors
 */
export class AuthenticationError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 401
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * New Authentication Service with Clean Architecture patterns
 * Implements comprehensive authentication operations with enhanced security
 */
export class AuthenticationService {
  private readonly JWT_SECRET: string;
  private readonly JWT_EXPIRES_IN: string;
  private readonly REFRESH_TOKEN_EXPIRES_IN: string;
  private readonly repository: IAuthRepository;

  constructor(repository: IAuthRepository) {
    this.repository = repository;
    this.JWT_SECRET = process.env.JWT_SECRET || 'qtip_secret_key';
    this.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
    this.REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';

    if (!process.env.JWT_SECRET) {
      console.warn('[NEW AUTH] AuthenticationService: JWT_SECRET not set in environment variables, using default');
    }
  }

  /**
   * Enhanced login with comprehensive security checks
   */
  async login(loginData: LoginRequest, req?: Request): Promise<AuthResponse> {
    console.log(`[NEW AUTH] AuthenticationService: Login attempt for email: ${loginData.email}`);
    
    try {
      const { email, password } = loginData;
      const clientIp = req?.ip || req?.connection?.remoteAddress || 'unknown';

      // Input validation
      if (!email || !password) {
        console.log(`[NEW AUTH] AuthenticationService: Missing email or password`);
        await this.repository.logAuthAttempt(email || 'unknown', false, clientIp);
        throw new AuthenticationError('Email and password are required', 'MISSING_CREDENTIALS', 400);
      }

      // Check if account is locked
      const isLocked = await this.repository.isAccountLocked(email);
      if (isLocked) {
        console.log(`[NEW AUTH] AuthenticationService: Account locked for email: ${email}`);
        await this.repository.logAuthAttempt(email, false, clientIp);
        throw new AuthenticationError('Account temporarily locked due to failed login attempts', 'ACCOUNT_LOCKED', 423);
      }

      // Find user
      const user = await this.repository.findByEmail(email);
      if (!user) {
        console.log(`[NEW AUTH] AuthenticationService: User not found for email: ${email}`);
        await this.repository.logAuthAttempt(email, false, clientIp);
        throw new AuthenticationError('Invalid credentials', 'INVALID_CREDENTIALS');
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.password_hash);
      if (!isPasswordValid) {
        console.log(`[NEW AUTH] AuthenticationService: Invalid password for email: ${email}`);
        await this.repository.logAuthAttempt(email, false, clientIp);
        throw new AuthenticationError('Invalid credentials', 'INVALID_CREDENTIALS');
      }

      // Check if user is active (if the field exists)
      if ('is_active' in user && !user.is_active) {
        console.log(`[NEW AUTH] AuthenticationService: Inactive user attempted login: ${email}`);
        await this.repository.logAuthAttempt(email, false, clientIp);
        throw new AuthenticationError('Account is deactivated', 'ACCOUNT_INACTIVE', 403);
      }

      // Generate tokens
      const token = this.generateAccessToken(user);
      const refreshToken = this.generateRefreshToken(user);

      // Get user permissions
      const permissions = await this.repository.getUserPermissions(user.id);

      // Update last login
      await this.repository.updateLastLogin(user.id);

      // Log successful login
      await this.repository.logAuthAttempt(email, true, clientIp);

      // Remove sensitive data from user object
      const { password_hash, ...userWithoutPassword } = user;

      console.log(`[NEW AUTH] AuthenticationService: Successful login for user ID: ${user.id}`);

      return {
        success: true,
        token,
        refreshToken,
        user: userWithoutPassword,
        permissions,
        message: 'Login successful'
      };

    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }

      console.error('[NEW AUTH] AuthenticationService: Unexpected error during login:', error);
      throw new AuthenticationError('Authentication service unavailable', 'SERVICE_ERROR', 500);
    }
  }

  /**
   * Logout user and invalidate tokens
   */
  async logout(token: string, req?: Request): Promise<{ success: boolean; message: string }> {
    console.log(`[NEW AUTH] AuthenticationService: Logout attempt`);
    
    try {
      if (!token) {
        return {
          success: true,
          message: 'No token to invalidate'
        };
      }

      // Decode token to get user info and expiration (support both camelCase and snake_case)
      const decoded = jwt.decode(token) as JwtTokenPayload | null;
      const logoutUserId = decoded?.user_id ?? decoded?.userId;
      if (logoutUserId) {
        console.log(`[NEW AUTH] AuthenticationService: User ${logoutUserId} logging out`);
        
        // Add token to blacklist with its expiration time
        const expirationTime = decoded!.exp;
        tokenBlacklistService.blacklistToken(token, expirationTime);
        
        // Log the logout in audit log
        const clientIp = req?.ip || req?.connection?.remoteAddress || 'unknown';
        console.log(`[NEW AUTH] AuthenticationService: User ${logoutUserId} logged out from IP: ${clientIp}`);
        
        // You could add an audit log entry here if needed
        // await this.repository.logUserActivity(decoded.user_id, 'LOGOUT', { ip: clientIp });
      } else {
        // Even if we can't decode the token, still try to blacklist it
        console.log(`[NEW AUTH] AuthenticationService: Blacklisting potentially invalid token`);
        tokenBlacklistService.blacklistToken(token);
      }

      return {
        success: true,
        message: 'Logout successful'
      };
    } catch (error) {
      console.error('[NEW AUTH] AuthenticationService: Error during logout:', error);
      
      // Even if there's an error, still try to blacklist the token
      if (token) {
        tokenBlacklistService.blacklistToken(token);
      }
      
      return {
        success: true, // Return success even on error to prevent client issues
        message: 'Logout completed'
      };
    }
  }

  /**
   * Validate JWT token and return user information
   */
  async validateToken(token: string): Promise<TokenValidationResult> {
    console.log(`[NEW AUTH] AuthenticationService: Validating token`);
    
    try {
      if (!token) {
        return {
          valid: false,
          message: 'No token provided'
        };
      }

      // Check if token is blacklisted (logged out)
      if (tokenBlacklistService.isTokenBlacklisted(token)) {
        console.log(`[NEW AUTH] AuthenticationService: Token is blacklisted (user logged out)`);
        return {
          valid: false,
          message: 'Token has been invalidated'
        };
      }

      // Verify and decode token (support both camelCase and snake_case payload formats)
      const decoded = jwt.verify(token, this.JWT_SECRET) as JwtTokenPayload;
      const tokenUserId = decoded.user_id ?? decoded.userId;
      const tokenRoleId = decoded.role_id ?? decoded.roleId;

      if (!tokenUserId || !tokenRoleId) {
        console.log(`[NEW AUTH] AuthenticationService: Invalid token structure`);
        return {
          valid: false,
          message: 'Invalid token structure'
        };
      }

      // Get current user data
      const user = await this.repository.findById(tokenUserId);
      if (!user) {
        console.log(`[NEW AUTH] AuthenticationService: User not found for token validation`);
        return {
          valid: false,
          message: 'User not found'
        };
      }

      // Check if user is still active (if the field exists)
      if ('is_active' in user && !user.is_active) {
        console.log(`[NEW AUTH] AuthenticationService: Inactive user attempted token validation`);
        return {
          valid: false,
          message: 'Account is deactivated'
        };
      }

      // Get current permissions
      const permissions = await this.repository.getUserPermissions(user.id);

      console.log(`[NEW AUTH] AuthenticationService: Token validation successful for user ID: ${user.id}`);

      return {
        valid: true,
        user,
        permissions,
        message: 'Token is valid'
      };

    } catch (error: any) {
      if (error.name === 'TokenExpiredError') {
        console.log(`[NEW AUTH] AuthenticationService: Token expired`);
        return {
          valid: false,
          message: 'Token expired'
        };
      } else if (error.name === 'JsonWebTokenError') {
        console.log(`[NEW AUTH] AuthenticationService: Invalid token`);
        return {
          valid: false,
          message: 'Invalid token'
        };
      }

      console.error('[NEW AUTH] AuthenticationService: Error validating token:', error);
      return {
        valid: false,
        message: 'Token validation failed'
      };
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken: string): Promise<RefreshTokenResult> {
    console.log(`[NEW AUTH] AuthenticationService: Refreshing token`);
    
    try {
      if (!refreshToken) {
        return {
          success: false,
          message: 'No refresh token provided'
        };
      }

      // Verify refresh token (support both camelCase and snake_case payload formats)
      const decoded = jwt.verify(refreshToken, this.JWT_SECRET) as JwtTokenPayload;
      const refreshUserId = decoded.user_id ?? decoded.userId;

      if (!refreshUserId || !decoded.type || decoded.type !== 'refresh') {
        console.log(`[NEW AUTH] AuthenticationService: Invalid refresh token structure`);
        return {
          success: false,
          message: 'Invalid refresh token'
        };
      }

      // Get current user data
      const user = await this.repository.findById(refreshUserId);
      if (!user) {
        console.log(`[NEW AUTH] AuthenticationService: User not found for refresh token`);
        return {
          success: false,
          message: 'User not found'
        };
      }

      // Check if user is still active (if the field exists)
      if ('is_active' in user && !user.is_active) {
        console.log(`[NEW AUTH] AuthenticationService: Inactive user attempted token refresh`);
        return {
          success: false,
          message: 'Account is deactivated'
        };
      }

      // Generate new tokens
      const newAccessToken = this.generateAccessToken(user);
      const newRefreshToken = this.generateRefreshToken(user);

      console.log(`[NEW AUTH] AuthenticationService: Token refresh successful for user ID: ${user.id}`);

      return {
        success: true,
        token: newAccessToken,
        refreshToken: newRefreshToken,
        message: 'Token refreshed successfully'
      };

    } catch (error: any) {
      if (error.name === 'TokenExpiredError') {
        console.log(`[NEW AUTH] AuthenticationService: Refresh token expired`);
        return {
          success: false,
          message: 'Refresh token expired'
        };
      } else if (error.name === 'JsonWebTokenError') {
        console.log(`[NEW AUTH] AuthenticationService: Invalid refresh token`);
        return {
          success: false,
          message: 'Invalid refresh token'
        };
      }

      console.error('[NEW AUTH] AuthenticationService: Error refreshing token:', error);
      return {
        success: false,
        message: 'Token refresh failed'
      };
    }
  }

  /**
   * Generate access token
   */
  private generateAccessToken(user: User): string {
    const payload = { 
      user_id: user.id, 
      role_id: user.role_id,
      type: 'access'
    };
    const options: SignOptions = { expiresIn: this.JWT_EXPIRES_IN as any };
    return jwt.sign(payload, this.JWT_SECRET, options);
  }

  /**
   * Generate refresh token
   */
  private generateRefreshToken(user: User): string {
    const payload = { 
      user_id: user.id, 
      role_id: user.role_id,
      type: 'refresh'
    };
    const options: SignOptions = { expiresIn: this.REFRESH_TOKEN_EXPIRES_IN as any };
    return jwt.sign(payload, this.JWT_SECRET, options);
  }

  /**
   * Get role name from role ID
   */
  private getRoleName(role_id: number): string {
    const roleMap: { [key: number]: string } = {
      1: 'Admin',
      2: 'QA',
      3: 'CSR',
      4: 'Trainer',
      5: 'Manager',
      6: 'Director'
    };
    return roleMap[role_id] || 'User';
  }
} 