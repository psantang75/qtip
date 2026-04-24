import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from '../config/environment';
import logger from '../config/logger';

/**
 * Security headers middleware using helmet
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false, // Disable for API compatibility
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
});

/**
 * Custom key generator for rate limiting
 * Provides fallback when req.ip is undefined (common behind IIS/nginx)
 */
const rateLimitKeyGenerator = (req: Request): string => {
  // Try multiple sources for IP address
  const ip = req.ip || 
             req.headers['x-forwarded-for'] as string || 
             req.headers['x-real-ip'] as string || 
             req.socket?.remoteAddress || 
             'unknown';
  
  // If x-forwarded-for contains multiple IPs, use the first one (client IP)
  if (typeof ip === 'string' && ip.includes(',')) {
    return ip.split(',')[0].trim();
  }
  
  return typeof ip === 'string' ? ip : String(ip);
};

/**
 * Rate limiting configurations for different endpoints
 */
export const authLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS, // 15 minutes
  max: config.AUTH_RATE_LIMIT_MAX, // limit each IP to 5 requests per windowMs
  message: {
    error: 'Too many authentication attempts, please try again later',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: Math.ceil(config.RATE_LIMIT_WINDOW_MS / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  skip: (req) => {
    // Skip rate limiting for login endpoint
    if (req.path === '/login' || req.path === '/api/auth/login' || req.path.endsWith('/login')) {
      return true;
    }
    
    // Skip rate limiting for local requests in development
    if (config.NODE_ENV === 'development') {
      const ip = req.ip || req.connection?.remoteAddress || '';
      return ip === '127.0.0.1' || ip === '::1' || ip.includes('127.0.0.1') || ip === '::ffff:127.0.0.1';
    }
    return false;
  }
});

export const apiLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS, // 15 minutes
  max: config.RATE_LIMIT_MAX_REQUESTS, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many API requests, please try again later',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: Math.ceil(config.RATE_LIMIT_WINDOW_MS / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  skip: (req) => {
    // Skip rate limiting for critical auth endpoints (they have their own rate limiter)
    const authEndpoints = [
      '/api/csrf-token',
      '/api/auth/login',
      '/api/auth/refresh',
      '/api/auth/logout'
    ];
    
    if (authEndpoints.some(endpoint => req.path === endpoint || req.path.endsWith(endpoint))) {
      return true;
    }
    
    // Skip rate limiting for monitoring endpoints
    if (req.path === '/health' || req.path === '/metrics' || req.path === '/status') {
      return true;
    }
    
    // Skip rate limiting for frequently accessed read-only endpoints (filters, options, etc.)
    const readOnlyEndpoints = [
      '/filters',
      '/options',
      '/stats',
      '/dashboard'
    ];
    
    if (readOnlyEndpoints.some(endpoint => req.path.includes(endpoint) && req.method === 'GET')) {
      return true;
    }
    
    // Skip rate limiting for local requests in development
    if (config.NODE_ENV === 'development') {
      const ip = req.ip || req.connection?.remoteAddress || '';
      return ip === '127.0.0.1' || ip === '::1' || ip.includes('127.0.0.1') || ip === '::ffff:127.0.0.1';
    }
    return false;
  }
});

/**
 * Request validation middleware
 */
export const validateRequest = (req: Request, res: Response, next: NextFunction): void => {
  // Check for required content-type on POST/PUT/PATCH requests with content
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentLength = parseInt(req.headers['content-length'] || '0');
    const content_type = req.headers['content-type'];
    
    // Only require Content-Type if there's actually content being sent
    if (contentLength > 0 && !content_type) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Content-Type header is required for requests with content',
          code: 'MISSING_CONTENT_TYPE'
        }
      });
      return;
    }

    // Validate Content-Type if one is provided
    if (content_type && 
        !content_type.includes('application/json') && 
        !content_type.includes('multipart/form-data') &&
        !content_type.includes('application/x-www-form-urlencoded')) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Unsupported Content-Type',
          code: 'UNSUPPORTED_CONTENT_TYPE'
        }
      });
      return;
    }
  }

  // Basic request size validation
  const contentLength = parseInt(req.headers['content-length'] || '0');
  if (contentLength > config.MAX_FILE_SIZE) {
    res.status(413).json({
      success: false,
      error: {
        message: 'Request entity too large',
        code: 'REQUEST_TOO_LARGE'
      }
    });
    return;
  }

  next();
};

/**
 * CORS configuration for production
 */
export const corsConfig = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    if (config.ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn(`[SECURITY] CORS blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-Total-Count', 'X-Page-Count', 'X-RateLimit-Limit', 'X-RateLimit-Remaining']
};