import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import logger from '../config/logger';
import { v4 as uuidv4 } from 'uuid';
import { UserServiceError } from '../services/UserService';

/**
 * Canonical error-handling module for the API.
 *
 * Exports:
 *   - `AppError` + `ErrorType`     — structured, correlation-aware error class
 *   - factory helpers              — createValidationError, createNotFoundError, etc.
 *   - `addCorrelationId`           — request middleware (assigns/propagates X-Correlation-ID)
 *   - `errorHandler`               — global Express error middleware (mounted in index.ts)
 *   - `notFoundHandler`            — catch-all 404 (mounted in index.ts)
 *   - `asyncHandler`               — wraps async route handlers
 *   - `handleDatabaseError`        — normalize MySQL driver errors → AppError
 *   - `timeoutHandler`             — request timeout middleware
 *   - `healthCheckErrors` helpers  — counters for the /health endpoint
 *
 * History: this module replaced an older `middleware/errorHandler.ts` that
 * defined a parallel `AppError` (positional `(message, statusCode, code)` ctor)
 * and a thinner middleware. The two were consolidated during the pre-production
 * review (item #23) so every layer throws and renders against the same shape.
 */

// Error types
export enum ErrorType {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  NOT_FOUND_ERROR = 'NOT_FOUND_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR'
}

// Custom error class
export class AppError extends Error {
  public readonly type: ErrorType;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly context?: Record<string, any>;
  public readonly correlationId: string;

  constructor(
    message: string,
    type: ErrorType,
    statusCode: number,
    isOperational = true,
    context?: Record<string, any>
  ) {
    super(message);
    this.type = type;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.context = context;
    this.correlationId = uuidv4();
    
    Error.captureStackTrace(this, this.constructor);
  }
}

// Pre-defined error creators
export const createValidationError = (message: string, context?: Record<string, any>) =>
  new AppError(message, ErrorType.VALIDATION_ERROR, 400, true, context);

export const createAuthorizationError = (message: string, context?: Record<string, any>) =>
  new AppError(message, ErrorType.AUTHORIZATION_ERROR, 403, true, context);

export const createNotFoundError = (message: string, context?: Record<string, any>) =>
  new AppError(message, ErrorType.NOT_FOUND_ERROR, 404, true, context);

export const createDatabaseError = (message: string, context?: Record<string, any>) =>
  new AppError(message, ErrorType.DATABASE_ERROR, 500, false, context);

// Error response interface
interface ErrorResponse {
  error: {
    type: string;
    message: string;
    correlationId: string;
    timestamp: string;
    path: string;
    method: string;
    details?: Record<string, any>;
  };
}

// Add correlation ID middleware
export const addCorrelationId = (req: Request, res: Response, next: NextFunction) => {
  req.correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
  res.setHeader('X-Correlation-ID', req.correlationId as string);
  next();
};

// Enhanced error handler middleware
export const errorHandler = (
  error: Error | AppError | UserServiceError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const correlationId = req.correlationId || uuidv4();
  
  // Log error with context
  const errorContext = {
    correlationId,
    method: req.method,
    path: req.path,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    user_id: req.user?.user_id,
    timestamp: new Date().toISOString(),
    ...(error instanceof AppError ? error.context : {})
  };

  // UserServiceError carries its own statusCode/code — render it before the
  // generic catch so service-layer 4xx responses survive.
  if (error instanceof UserServiceError) {
    logger.warn('UserService operational error', {
      error: { message: error.message, code: error.code, statusCode: error.statusCode },
      context: errorContext,
    });
    res.status(error.statusCode).json({
      error: {
        type: error.code || 'USER_SERVICE_ERROR',
        message: error.message,
        correlationId,
        timestamp: new Date().toISOString(),
        path: req.path,
        method: req.method,
      },
    });
    return;
  }

  // JWT errors thrown by jsonwebtoken — surface as 401 instead of 500.
  if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
    logger.warn('JWT verification error', { error: { message: error.message }, context: errorContext });
    res.status(401).json({
      error: {
        type: ErrorType.AUTHORIZATION_ERROR,
        message: 'Invalid or expired token',
        correlationId,
        timestamp: new Date().toISOString(),
        path: req.path,
        method: req.method,
      },
    });
    return;
  }

  if (error instanceof AppError) {
    // Operational errors - log as warning
    logger.warn('Operational error occurred', {
      error: {
        type: error.type,
        message: error.message,
        statusCode: error.statusCode,
        stack: error.stack
      },
      context: errorContext
    });
  } else if (error instanceof ZodError) {
    // Validation errors from Zod
    logger.warn('Validation error occurred', {
      error: {
        type: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.errors
      },
      context: errorContext
    });
  } else {
    // Programming errors - log as error
    logger.error('Unexpected error occurred', {
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      },
      context: errorContext
    });
  }

  // Prepare error response
  let errorResponse: ErrorResponse;

  if (error instanceof AppError) {
    errorResponse = {
      error: {
        type: error.type,
        message: error.message,
        correlationId: error.correlationId,
        timestamp: new Date().toISOString(),
        path: req.path,
        method: req.method,
        ...(process.env.NODE_ENV === 'development' && error.context ? { details: error.context } : {})
      }
    };
    res.status(error.statusCode).json(errorResponse);
  } else if (error instanceof ZodError) {
    errorResponse = {
      error: {
        type: ErrorType.VALIDATION_ERROR,
        message: 'Request validation failed',
        correlationId,
        timestamp: new Date().toISOString(),
        path: req.path,
        method: req.method,
        details: error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message,
          code: err.code
        }))
      }
    };
    res.status(400).json(errorResponse);
  } else if (error.message && /\b(connect|connection)\b/i.test(error.message)) {
    // Bare driver "connect ECONNREFUSED" / "Connection lost" without a code.
    errorResponse = {
      error: {
        type: ErrorType.DATABASE_ERROR,
        message: 'Database connection error',
        correlationId,
        timestamp: new Date().toISOString(),
        path: req.path,
        method: req.method,
      },
    };
    res.status(503).json(errorResponse);
  } else {
    // Unknown errors - don't expose details in production
    errorResponse = {
      error: {
        type: ErrorType.INTERNAL_SERVER_ERROR,
        message: process.env.NODE_ENV === 'production' 
          ? 'An internal server error occurred'
          : error.message,
        correlationId,
        timestamp: new Date().toISOString(),
        path: req.path,
        method: req.method,
        ...(process.env.NODE_ENV === 'development' ? { details: { stack: error.stack } } : {})
      }
    };
    res.status(500).json(errorResponse);
  }
};

/**
 * Catch-all 404 handler for undefined routes. Mounted right before
 * `errorHandler` in `index.ts`.
 */
export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    error: {
      type: ErrorType.NOT_FOUND_ERROR,
      message: `Route ${req.originalUrl} not found`,
      correlationId: req.correlationId || uuidv4(),
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
    },
  });
};

// Async error wrapper
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Database error handler
export const handleDatabaseError = (error: any, context?: Record<string, any>): AppError => {
  if (error.code === 'ER_DUP_ENTRY') {
    return createValidationError('Duplicate entry detected', { 
      field: error.sqlMessage?.match(/for key '(.+?)'/)?.[1],
      ...context 
    });
  }
  
  if (error.code === 'ER_NO_REFERENCED_ROW_2') {
    return createValidationError('Referenced record does not exist', context);
  }
  
  if (error.code === 'ECONNREFUSED') {
    return createDatabaseError('Database connection failed', context);
  }
  
  if (error.code === 'ER_ACCESS_DENIED_ERROR') {
    return createDatabaseError('Database access denied', context);
  }
  
  // Generic database error
  return createDatabaseError('Database operation failed', {
    code: error.code,
    sqlState: error.sqlState,
    ...context
  });
};

// Request timeout handler
export const timeoutHandler = (timeout: number = 30000) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeoutId = setTimeout(() => {
      if (!res.headersSent) {
        const error = new AppError(
          'Request timeout',
          ErrorType.INTERNAL_SERVER_ERROR,
          408,
          true,
          { timeout, path: req.path, method: req.method }
        );
        next(error);
      }
    }, timeout);
    
    res.on('finish', () => clearTimeout(timeoutId));
    res.on('close', () => clearTimeout(timeoutId));
    
    next();
  };
};

// Health check error monitoring
export const healthCheckErrors = {
  database: 0,
  external: 0,
  validation: 0,
  authorization: 0
};

export const incrementErrorCount = (errorType: ErrorType) => {
  switch (errorType) {
    case ErrorType.DATABASE_ERROR:
      healthCheckErrors.database++;
      break;
    case ErrorType.EXTERNAL_SERVICE_ERROR:
      healthCheckErrors.external++;
      break;
    case ErrorType.VALIDATION_ERROR:
      healthCheckErrors.validation++;
      break;
    case ErrorType.AUTHORIZATION_ERROR:
      healthCheckErrors.authorization++;
      break;
  }
};

// Express middleware declaration augmentation
declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
} 