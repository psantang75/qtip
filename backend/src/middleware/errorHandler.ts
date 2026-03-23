import { Request, Response, NextFunction } from 'express';
import { UserServiceError } from '../services/UserService';
import logger from '../config/logger';

/**
 * Custom error class for application errors
 */
export class AppError extends Error {
  public statusCode: number;
  public code: string;
  public isOperational: boolean;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Global error handling middleware
 */
export const errorHandler = (
  error: Error | AppError | UserServiceError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Log to both console (iisnode) and Winston error log
  console.error('Error caught by global handler:', {
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    timestamp: new Date().toISOString()
  });
  
  logger.error('Error caught by global handler', {
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    user_id: (req as any).user?.user_id
  });

  // Handle UserServiceError (custom service errors)
  if (error instanceof UserServiceError) {
    res.status(error.statusCode).json({
      success: false,
      error: {
        message: error.message,
        code: error.code,
        timestamp: new Date().toISOString()
      }
    });
    return;
  }

  // Handle custom AppError
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      success: false,
      error: {
        message: error.message,
        code: error.code,
        timestamp: new Date().toISOString()
      }
    });
    return;
  }

  // Handle MongoDB/MySQL connection errors
  if (error.message.includes('connect') || error.message.includes('connection')) {
    res.status(503).json({
      success: false,
      error: {
        message: 'Database connection error',
        code: 'DATABASE_UNAVAILABLE',
        timestamp: new Date().toISOString()
      }
    });
    return;
  }

  // Handle validation errors
  if (error.name === 'ValidationError') {
    res.status(400).json({
      success: false,
      error: {
        message: error.message,
        code: 'VALIDATION_ERROR',
        timestamp: new Date().toISOString()
      }
    });
    return;
  }

  // Handle JWT errors
  if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
    res.status(401).json({
      success: false,
      error: {
        message: 'Invalid or expired token',
        code: 'AUTH_ERROR',
        timestamp: new Date().toISOString()
      }
    });
    return;
  }

  // Default error response
  res.status(500).json({
    success: false,
    error: {
      message: process.env.NODE_ENV === 'production' 
        ? 'Internal server error' 
        : error.message,
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
      ...(process.env.NODE_ENV !== 'production' && { stack: error.stack })
    }
  });
};

/**
 * Catch-all handler for undefined routes
 */
export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: {
      message: `Route ${req.originalUrl} not found`,
      code: 'ROUTE_NOT_FOUND',
      timestamp: new Date().toISOString()
    }
  });
};

/**
 * Async wrapper to catch errors in async route handlers
 */
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}; 