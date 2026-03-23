import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authLogger, securityLogger } from '../config/logger';
import { tokenBlacklistService } from '../services/TokenBlacklistService';

// Extend Express Request type to include user property
declare global {
  namespace Express {
    interface Request {
      user?: {
        user_id: number;
        role: string;
      };
    }
  }
}

// JWT secret key with proper validation
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === 'qtip_secret_key') {
  console.error('CRITICAL: JWT_SECRET environment variable is not set or using default value. This is insecure for production.');
  process.exit(1);
}

/**
 * Authentication middleware to verify JWT token
 */
export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ message: 'No auth token provided' });
      return;
    }

    const token = authHeader.split(' ')[1];
    
    // Check if token is blacklisted (logged out)
    if (tokenBlacklistService.isTokenBlacklisted(token)) {
      console.log('[AUTH MIDDLEWARE] Token is blacklisted (user logged out)');
      res.status(401).json({ 
        message: 'Token has been invalidated',
        code: 'TOKEN_BLACKLISTED'
      });
      return;
    }
    
    try {
      // Verify token — support both legacy camelCase (userId/roleId) and
      // current snake_case (user_id/role_id) payload formats.
      const decoded = jwt.verify(token, JWT_SECRET) as {
        user_id?: number;
        userId?: number;
        role_id?: number;
        roleId?: number;
      };

      const resolvedUserId = decoded.user_id ?? decoded.userId;
      const resolvedRoleId = decoded.role_id ?? decoded.roleId;

      // Attach user data to request with role converted from role id
      let role = 'User';
      if (resolvedRoleId === 1) role = 'Admin';
      else if (resolvedRoleId === 2) role = 'QA';
      else if (resolvedRoleId === 3) role = 'CSR';
      else if (resolvedRoleId === 4) role = 'Trainer';
      else if (resolvedRoleId === 5) role = 'Manager';
      else if (resolvedRoleId === 6) role = 'Director';

      req.user = {
        user_id: resolvedUserId!,
        role
      };
      
      next();
    } catch (error: any) {
      if (error.name === 'TokenExpiredError') {
        console.error('Authentication error: Token expired');
        res.status(401).json({ message: 'Token expired, please login again' });
      } else {
        console.error('Authentication error:', error);
        res.status(401).json({ message: 'Invalid token' });
      }
    }
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ message: 'Authentication failed' });
  }
};

/**
 * Admin role authorization middleware
 */
export const authorizeAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  
  // Check for Admin role
  if (req.user.role !== 'Admin') {
    res.status(403).json({ error: 'Access denied. Admin role required' });
    return;
  }
  
  next();
};

/**
 * Enhanced Trainer role authorization middleware with security logging
 */
export const authorizeTrainer = (req: Request, res: Response, next: NextFunction): void => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const endpoint = req.originalUrl;
  
  if (!req.user) {
    console.warn('[TRAINER AUTH] Unauthorized access attempt:', {
      ip,
      endpoint,
      timestamp: new Date().toISOString(),
      reason: 'No user token'
    });
    res.status(401).json({ 
      error: 'UNAUTHORIZED',
      message: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
    return;
  }
  
  // Check for Trainer role or Admin role (who can also manage courses)
  if (req.user.role !== 'Trainer' && req.user.role !== 'Admin') {
    console.warn('[TRAINER AUTH] Access denied:', {
      user_id: req.user.user_id,
      role: req.user.role,
      ip,
      endpoint,
      timestamp: new Date().toISOString(),
      reason: 'Insufficient permissions'
    });
    res.status(403).json({ 
      error: 'FORBIDDEN',
      message: 'Access denied. Trainer role required',
      code: 'INSUFFICIENT_PERMISSIONS'
    });
    return;
  }
  
  // Log successful authorization
  console.log('[TRAINER AUTH] Authorization successful:', {
    user_id: req.user.user_id,
    role: req.user.role,
    ip,
    endpoint,
    timestamp: new Date().toISOString()
  });
  
  next();
};

/**
 * QA role authorization middleware
 */
export const authorizeQA = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    securityLogger.accessDenied(
      req.ip || 'unknown',
      req.originalUrl,
      'Not authenticated'
    );
    res.status(401).json({ 
      error: 'UNAUTHORIZED',
      message: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
    return;
  }
  
  // Check for QA role or Admin role (who can also access QA functions)
  if (req.user.role !== 'QA' && req.user.role !== 'Admin') {
    securityLogger.accessDenied(
      req.ip || 'unknown',
      req.originalUrl,
      'Insufficient permissions for QA access',
      req.user.user_id
    );
    res.status(403).json({ 
      error: 'FORBIDDEN',
      message: 'Access denied. QA role required',
      code: 'INSUFFICIENT_PERMISSIONS'
    });
    return;
  }
  
  authLogger.tokenValidation(true, req.user.user_id, req.ip, 'QA authorization successful');
  
  next();
};

/**
 * Manager role authorization middleware with security logging
 */
export const authorizeManager = (req: Request, res: Response, next: NextFunction): void => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const endpoint = req.originalUrl;
  
  if (!req.user) {
    console.warn('[MANAGER AUTH] Unauthorized access attempt:', {
      ip,
      endpoint,
      timestamp: new Date().toISOString(),
      reason: 'No user token'
    });
    securityLogger.accessDenied(
      ip,
      endpoint,
      'Not authenticated'
    );
    res.status(401).json({ 
      error: 'UNAUTHORIZED',
      message: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
    return;
  }
  
  // Check for Manager role, Admin role, or QA role (for dispute resolution)
  // Admin and QA can access Manager functions, especially dispute resolution
  if (req.user.role !== 'Manager' && req.user.role !== 'Admin' && req.user.role !== 'QA') {
    console.warn('[MANAGER AUTH] Access denied:', {
      user_id: req.user.user_id,
      role: req.user.role,
      ip,
      endpoint,
      timestamp: new Date().toISOString(),
      reason: 'Insufficient permissions'
    });
    securityLogger.accessDenied(
      ip,
      endpoint,
      'Insufficient permissions for Manager access',
      req.user.user_id
    );
    res.status(403).json({ 
      error: 'FORBIDDEN',
      message: 'Access denied. Manager, Admin, or QA role required',
      code: 'INSUFFICIENT_PERMISSIONS'
    });
    return;
  }
  
  // Log successful authorization
  console.log('[MANAGER AUTH] Authorization successful:', {
    user_id: req.user.user_id,
    role: req.user.role,
    ip,
    endpoint,
    timestamp: new Date().toISOString()
  });
  
  authLogger.tokenValidation(true, req.user.user_id, req.ip, 'Manager authorization successful');
  
  next();
};

export default { authenticate, authorizeAdmin, authorizeTrainer, authorizeQA, authorizeManager }; 