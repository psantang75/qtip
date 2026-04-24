import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authLogger, securityLogger } from '../config/logger';
import { tokenBlacklistService } from '../services/TokenBlacklistService';
import { ApiErrors, sendError } from '../utils/apiError';
import { getJwtSecret } from '../config/environment';

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

// JWT secret resolved through the shared helper so we share one fail-fast
// posture with `services/AuthenticationService.ts` and `config/environment.ts`.
// See pre-production review item #44.
const JWT_SECRET = getJwtSecret();

/**
 * Authentication middleware to verify JWT token
 */
export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      ApiErrors.unauthorized(res);
      return;
    }

    const token = authHeader.split(' ')[1];

    if (tokenBlacklistService.isTokenBlacklisted(token)) {
      authLogger.tokenValidation(false, 0, req.ip, 'Token blacklisted');
      sendError(res, 401, 'UNAUTHORIZED', 'Token has been invalidated', 'TOKEN_BLACKLISTED');
      return;
    }

    try {
      // Support both legacy camelCase (userId/roleId) and current snake_case (user_id/role_id) payloads
      const decoded = jwt.verify(token, JWT_SECRET) as {
        user_id?: number; userId?: number;
        role_id?: number; roleId?: number;
      };

      const resolvedUserId = decoded.user_id ?? decoded.userId;
      const resolvedRoleId = decoded.role_id ?? decoded.roleId;

      let role = 'User';
      if (resolvedRoleId === 1) role = 'Admin';
      else if (resolvedRoleId === 2) role = 'QA';
      else if (resolvedRoleId === 3) role = 'CSR';
      else if (resolvedRoleId === 4) role = 'Trainer';
      else if (resolvedRoleId === 5) role = 'Manager';
      else if (resolvedRoleId === 6) role = 'Director';

      req.user = { user_id: resolvedUserId!, role };
      next();
    } catch (error: any) {
      if (error.name === 'TokenExpiredError') {
        sendError(res, 401, 'UNAUTHORIZED', 'Token expired, please login again', 'TOKEN_EXPIRED');
      } else {
        authLogger.tokenValidation(false, 0, req.ip, 'Invalid token');
        ApiErrors.unauthorized(res);
      }
    }
  } catch {
    ApiErrors.internal(res, 'Authentication failed');
  }
};

/**
 * Admin role authorization middleware
 */
export const authorizeAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) { ApiErrors.unauthorized(res); return; }
  if (req.user.role !== 'Admin') { ApiErrors.forbidden(res, 'Access denied. Admin role required'); return; }
  next();
};

/**
 * Trainer role authorization middleware
 */
export const authorizeTrainer = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    securityLogger.accessDenied(req.ip || 'unknown', req.originalUrl, 'Not authenticated');
    ApiErrors.unauthorized(res);
    return;
  }
  if (req.user.role !== 'Trainer' && req.user.role !== 'Admin') {
    securityLogger.accessDenied(req.ip || 'unknown', req.originalUrl, 'Insufficient permissions for Trainer access', req.user.user_id);
    ApiErrors.forbidden(res, 'Access denied. Trainer role required');
    return;
  }
  next();
};

/**
 * QA or Trainer read-only authorization — used for completed submission routes
 * that trainers need visibility into alongside QA and Admin.
 */
export const authorizeQAOrTrainer = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required', code: 'AUTH_REQUIRED' });
    return;
  }
  const allowed = ['Admin', 'QA', 'Trainer'];
  if (!allowed.includes(req.user.role)) {
    securityLogger.accessDenied(req.ip || 'unknown', req.originalUrl, 'Insufficient permissions', req.user.user_id);
    res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied: insufficient permissions', code: 'INSUFFICIENT_PERMISSIONS' });
    return;
  }
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
 * Coaching access authorization — Admin, QA, Trainer, Manager (roleIds 1,2,4,5)
 */
export const authorizeCoachingUser = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    ApiErrors.unauthorized(res);
    return;
  }
  const allowed = ['Admin', 'QA', 'Trainer', 'Manager'];
  if (!allowed.includes(req.user.role)) {
    securityLogger.accessDenied(req.ip || 'unknown', req.originalUrl, 'Insufficient permissions for coaching access', req.user.user_id);
    ApiErrors.forbidden(res, 'Access denied. Admin, QA, Trainer, or Manager role required');
    return;
  }
  next();
};

/**
 * Manager role authorization middleware
 */
export const authorizeManager = (req: Request, res: Response, next: NextFunction): void => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';

  if (!req.user) {
    securityLogger.accessDenied(ip, req.originalUrl, 'Not authenticated');
    ApiErrors.unauthorized(res);
    return;
  }

  // Admin and QA can access manager functions (e.g. dispute resolution)
  if (req.user.role !== 'Manager' && req.user.role !== 'Admin' && req.user.role !== 'QA') {
    securityLogger.accessDenied(ip, req.originalUrl, 'Insufficient permissions for Manager access', req.user.user_id);
    ApiErrors.forbidden(res, 'Access denied. Manager, Admin, or QA role required');
    return;
  }

  authLogger.tokenValidation(true, req.user.user_id, ip, 'Manager authorization successful');
  next();
};

export default { authenticate, authorizeAdmin, authorizeTrainer, authorizeQA, authorizeQAOrTrainer, authorizeManager, authorizeCoachingUser }; 