import { Request, Response, NextFunction } from 'express';

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const store: RateLimitStore = {};

/**
 * Helper function to extract IP address from request
 * Handles proxy scenarios (IIS, nginx, etc.)
 */
const getClientIp = (req: Request): string => {
  // Try multiple sources for IP address
  const ip = req.ip || 
             (req.headers['x-forwarded-for'] as string) || 
             (req.headers['x-real-ip'] as string) || 
             req.socket?.remoteAddress || 
             'unknown';
  
  // If x-forwarded-for contains multiple IPs, use the first one (client IP)
  if (typeof ip === 'string' && ip.includes(',')) {
    return ip.split(',')[0].trim();
  }
  
  return typeof ip === 'string' ? ip : String(ip);
};

/**
 * Rate limiting middleware
 * @param windowMs - Time window in milliseconds
 * @param maxRequests - Maximum number of requests per window
 * @param message - Error message when limit exceeded
 */
export const createRateLimit = (
  windowMs: number = 15 * 60 * 1000, // 15 minutes
  maxRequests: number = 100,
  message: string = 'Too many requests, please try again later'
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = getClientIp(req);
    const now = Date.now();
    
    // Clean up expired entries
    Object.keys(store).forEach(k => {
      if (store[k].resetTime < now) {
        delete store[k];
      }
    });
    
    // Initialize or get current count
    if (!store[key] || store[key].resetTime < now) {
      store[key] = {
        count: 1,
        resetTime: now + windowMs
      };
    } else {
      store[key].count++;
    }
    
    // Check if limit exceeded
    if (store[key].count > maxRequests) {
      res.status(429).json({
        success: false,
        error: 'RATE_LIMIT_EXCEEDED',
        message,
        retryAfter: Math.ceil((store[key].resetTime - now) / 1000)
      });
      return;
    }
    
    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - store[key].count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(store[key].resetTime / 1000));
    
    next();
  };
};

/**
 * Strict rate limiter for sensitive endpoints
 */
export const strictRateLimit = createRateLimit(
  5 * 60 * 1000, // 5 minutes
  10, // 10 requests per 5 minutes
  'Too many requests to this endpoint, please try again later'
);

/**
 * Standard rate limiter for general API endpoints
 */
export const standardRateLimit = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  100, // 100 requests per 15 minutes
  'Too many requests, please try again later'
);

/**
 * Lenient rate limiter for read-only endpoints
 */
export const lenientRateLimit = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  200, // 200 requests per 15 minutes
  'Too many requests, please try again later'
); 