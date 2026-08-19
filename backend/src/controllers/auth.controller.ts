/**
 * Auth controller — INTENTIONAL EXCEPTION to the Phase 2.2 `AppError` envelope
 * migration. Do NOT wrap these handlers in `asyncHandler` / convert their
 * non-2xx responses to thrown `AppError`. Every response shape here is a typed
 * API CONTRACT that clients branch on, and the global error envelope would
 * silently change those shapes:
 *   - `login` re-emits AuthenticationService's `{ error, code }` with the
 *     service's own `statusCode`. Routing a non-`AppError` through the global
 *     handler collapses a bad-credentials 401 into a 500.
 *   - `validateToken` / `refreshToken` / `logout` / `getSessionStatus` return
 *     typed payloads (`valid` / `success` / `authenticated`) on BOTH success and
 *     failure so the client (and the apiClient refresh-on-401 interceptor, which
 *     reads `data.code` + the refresh `{ success, token }` shape) can branch.
 *   - `forgotPassword` deliberately always returns 200 (anti-enumeration).
 *   - `resetPassword` / `validateResetTokenEndpoint` return `{ ok }` /
 *     `{ valid, reason }` that `frontend authService` reads field-by-field.
 * The frontend's `getBackendMessage` explicitly supports the `{ error: '…' }`
 * auth shape. These endpoints already use correct status codes, structured
 * payloads, and generic 5xx messages — there is no hardening to gain by
 * migrating, only sign-in/refresh/reset breakage to risk.
 */
import { Request, Response } from 'express';
import { AuthenticationService } from '../services/AuthenticationService';
import { AuthRepository } from '../repositories/AuthRepository';
import {
  requestReset, validateResetToken, consumeReset,
} from '../services/PasswordResetService';
import { ResetPasswordSchema, ResetPasswordConfirmSchema } from '../validation/user.validation';
import logger from '../config/logger';

// Initialize authentication service
const authRepository = new AuthRepository();
const authService = new AuthenticationService(authRepository);

/**
 * Login endpoint
 * @route POST /api/auth/login
 */
export const login = async (req: Request, res: Response) => {
  logger.info('[AUTH CONTROLLER] Login request received');
  
  try {
    const authResponse = await authService.login(req.body, req);
    
    return res.status(200).json({
      token: authResponse.token,
      user: authResponse.user,
      permissions: authResponse.permissions,
      message: authResponse.message
    });
  } catch (error: any) {
    logger.error('[AUTH CONTROLLER] Authentication error:', error);
    
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ 
      error: error.message,
      code: error.code || 'AUTH_ERROR'
    });
  }
};

/**
 * Token validation endpoint
 * @route POST /api/auth/validate-token
 */
export const validateToken = async (req: Request, res: Response) => {
  logger.info('[AUTH CONTROLLER] Token validation request received');
  
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        valid: false, 
        message: 'No token provided' 
      });
    }

    const token = authHeader.split(' ')[1];
    const validationResult = await authService.validateToken(token);
    
    if (validationResult.valid) {
      return res.status(200).json({
        valid: true,
        user: validationResult.user,
        permissions: validationResult.permissions,
        message: validationResult.message
      });
    } else {
      return res.status(401).json({
        valid: false,
        message: validationResult.message
      });
    }
  } catch (error: any) {
    logger.error('[AUTH CONTROLLER] Token validation error:', error);
    return res.status(500).json({ 
      valid: false,
      message: 'Token validation failed' 
    });
  }
};

/**
 * Token refresh endpoint
 * @route POST /api/auth/refresh-token
 */
export const refreshToken = async (req: Request, res: Response) => {
  logger.info('[AUTH CONTROLLER] Token refresh request received');
  
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({ 
        success: false, 
        message: 'Refresh token is required' 
      });
    }

    const refreshResult = await authService.refreshToken(refreshToken);
    
    if (refreshResult.success) {
      return res.status(200).json({
        success: true,
        token: refreshResult.token,
        refreshToken: refreshResult.refreshToken,
        message: refreshResult.message
      });
    } else {
      return res.status(401).json({
        success: false,
        message: refreshResult.message
      });
    }
  } catch (error: any) {
    logger.error('[AUTH CONTROLLER] Token refresh error:', error);
    return res.status(500).json({ 
      success: false,
      message: 'Token refresh failed' 
    });
  }
};

/**
 * Logout endpoint
 * @route POST /api/auth/logout
 */
export const logout = async (req: Request, res: Response) => {
  logger.info('[AUTH CONTROLLER] Logout request received');
  
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : '';
    
    const logoutResult = await authService.logout(token, req);
    
    return res.status(200).json({
      success: logoutResult.success,
      message: logoutResult.message
    });
  } catch (error: any) {
    logger.error('[AUTH CONTROLLER] Logout error:', error);
    return res.status(500).json({ 
      success: false,
      message: 'Logout failed' 
    });
  }
};

/**
 * Session status endpoint for monitoring
 * @route GET /api/auth/session-status
 */
export const getSessionStatus = async (req: Request, res: Response) => {
  logger.info('[AUTH CONTROLLER] Session status request received');
  
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : '';
    
    if (!token) {
      return res.status(200).json({
        authenticated: false,
        message: 'No token provided'
      });
    }

    const validationResult = await authService.validateToken(token);
    
    return res.status(200).json({
      authenticated: validationResult.valid,
      user: validationResult.valid ? validationResult.user : null,
      message: validationResult.message,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    logger.error('[AUTH CONTROLLER] Session status error:', error);
    return res.status(200).json({
      authenticated: false,
      message: 'Session check failed',
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Forgot-password: always returns 200 to avoid email enumeration. The
 * service drops the request silently if the email doesn't exist.
 * @route POST /api/auth/forgot-password
 */
export const forgotPassword = async (req: Request, res: Response) => {
  logger.info('[AUTH CONTROLLER] Forgot-password request received');
  try {
    const parsed = ResetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(200).json({
        message: 'If that email exists, a reset link has been sent.',
      });
    }
    const ip = req.ip || req.connection?.remoteAddress || undefined;
    await requestReset(parsed.data.email, ip);
    return res.status(200).json({
      message: 'If that email exists, a reset link has been sent.',
    });
  } catch (error: any) {
    logger.error('[AUTH CONTROLLER] forgot-password error', error);
    return res.status(200).json({
      message: 'If that email exists, a reset link has been sent.',
    });
  }
};

/**
 * Validate a reset token (so the UI can show "expired" before the
 * user types a new password).
 * @route GET /api/auth/reset-password/validate?token=...
 */
export const validateResetTokenEndpoint = async (req: Request, res: Response) => {
  const token = String(req.query.token || '').trim();
  if (!token) return res.status(400).json({ valid: false, reason: 'invalid' });
  const result = await validateResetToken(token);
  return res.status(result.valid ? 200 : 400).json(result);
};

/**
 * Consume a reset token and set a new password.
 * @route POST /api/auth/reset-password
 */
export const resetPassword = async (req: Request, res: Response) => {
  logger.info('[AUTH CONTROLLER] reset-password request received');
  try {
    const parsed = ResetPasswordConfirmSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        message: parsed.error.errors[0]?.message || 'Invalid input',
      });
    }
    const result = await consumeReset(parsed.data.token, parsed.data.newPassword);
    if (!result.ok) {
      return res.status(400).json({
        ok: false,
        message: result.reason === 'expired'
          ? 'This reset link has expired. Request a new one.'
          : result.reason === 'used'
          ? 'This reset link has already been used.'
          : 'Invalid reset link.',
      });
    }
    return res.status(200).json({ ok: true, message: 'Password updated. You can now sign in.' });
  } catch (error: any) {
    logger.error('[AUTH CONTROLLER] reset-password error', error);
    return res.status(500).json({ ok: false, message: 'Password reset failed.' });
  }
};
