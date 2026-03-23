import { Request, Response } from 'express';
import { AuthenticationService } from '../services/AuthenticationService';
import { AuthRepository } from '../repositories/AuthRepository';

// Initialize authentication service
const authRepository = new AuthRepository();
const authService = new AuthenticationService(authRepository);

/**
 * Login endpoint
 * @route POST /api/auth/login
 */
export const login = async (req: Request, res: Response) => {
  console.log('[AUTH CONTROLLER] Login request received');
  
  try {
    const authResponse = await authService.login(req.body, req);
    
    return res.status(200).json({
      token: authResponse.token,
      user: authResponse.user,
      permissions: authResponse.permissions,
      message: authResponse.message
    });
  } catch (error: any) {
    console.error('[AUTH CONTROLLER] Authentication error:', error);
    
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
  console.log('[AUTH CONTROLLER] Token validation request received');
  
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
    console.error('[AUTH CONTROLLER] Token validation error:', error);
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
  console.log('[AUTH CONTROLLER] Token refresh request received');
  
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
    console.error('[AUTH CONTROLLER] Token refresh error:', error);
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
  console.log('[AUTH CONTROLLER] Logout request received');
  
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : '';
    
    const logoutResult = await authService.logout(token, req);
    
    return res.status(200).json({
      success: logoutResult.success,
      message: logoutResult.message
    });
  } catch (error: any) {
    console.error('[AUTH CONTROLLER] Logout error:', error);
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
  console.log('[AUTH CONTROLLER] Session status request received');
  
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
    console.error('[AUTH CONTROLLER] Session status error:', error);
    return res.status(200).json({
      authenticated: false,
      message: 'Session check failed',
      timestamp: new Date().toISOString()
    });
  }
}; 