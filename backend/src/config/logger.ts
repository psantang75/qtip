import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { config, isDevelopment, isProduction } from './environment';

/**
 * Custom log format for structured logging
 */
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, service, user_id, ip, method, url, statusCode, duration, stack, ...meta }) => {
    const logObject: any = {
      timestamp,
      level: level.toUpperCase(),
      message,
      service: service || 'QTIP-API',
      environment: config.NODE_ENV,
      ...meta
    };

    // Add request context if available
    if (user_id) logObject.user_id = user_id;
    if (ip) logObject.ip = ip;
    if (method) logObject.method = method;
    if (url) logObject.url = url;
    if (statusCode) logObject.statusCode = statusCode;
    if (duration) logObject.duration = `${duration}ms`;
    if (stack) logObject.stack = stack;

    return JSON.stringify(logObject);
  })
);

/**
 * Development format for better readability
 */
const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, service, user_id, method, url, statusCode, duration, ...meta }) => {
    let logMessage = `${timestamp} [${level}] ${service || 'QTIP'}: ${message}`;
    
    if (method && url) {
      logMessage += ` | ${method} ${url}`;
    }
    
    if (statusCode) {
      logMessage += ` | ${statusCode}`;
    }
    
    if (duration) {
      logMessage += ` | ${duration}ms`;
    }
    
    if (user_id) {
      logMessage += ` | User: ${user_id}`;
    }

    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      logMessage += ` | ${JSON.stringify(meta)}`;
    }

    return logMessage;
  })
);

/**
 * Create Winston logger instance
 */
const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: isDevelopment ? devFormat : logFormat,
  defaultMeta: {
    service: 'QTIP-API',
    version: config.APP_VERSION,
    environment: config.NODE_ENV
  },
  transports: [
    // Console transport
    new winston.transports.Console({
      silent: false,
      handleExceptions: true,
      handleRejections: true
    })
  ],
  exitOnError: false
});

// Add file transports for production with daily rotation
if (isProduction) {
  // Error log file - Daily rotation
  logger.add(new DailyRotateFile({
    filename: 'logs/error-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    format: logFormat,
    maxSize: '20m', // Rotate if file exceeds 20MB
    maxFiles: '30d', // Keep logs for 30 days
    zippedArchive: true, // Compress old logs
    handleExceptions: true
  }));

  // Combined log file - Daily rotation
  logger.add(new DailyRotateFile({
    filename: 'logs/combined-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    format: logFormat,
    maxSize: '20m', // Rotate if file exceeds 20MB
    maxFiles: '30d', // Keep logs for 30 days
    zippedArchive: true // Compress old logs
  }));

  // Access log file - Daily rotation
  logger.add(new DailyRotateFile({
    filename: 'logs/access-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    level: 'info',
    format: logFormat,
    maxSize: '20m', // Rotate if file exceeds 20MB
    maxFiles: '30d', // Keep logs for 30 days
    zippedArchive: true // Compress old logs
  }));
}

/**
 * HTTP request logging middleware
 */
export const requestLogger = (req: any, res: any, next: any) => {
  const start = Date.now();
  
  // Get user info from request if available
  const user_id = req.user?.user_id;
  const ip = req.ip || req.connection.remoteAddress;
  
  // Log request start
  logger.info('HTTP Request Started', {
    method: req.method,
    url: req.originalUrl,
    ip,
    user_id,
    userAgent: req.headers['user-agent'],
    content_type: req.headers['content-type']
  });

  // Capture response details
  res.on('finish', () => {
    const duration = Date.now() - start;
    // Log level based on response status:
    // 5xx (server errors) -> 'error' (appears in error.log)
    // 4xx (client errors) -> 'warn' (appears in combined.log and access.log only)
    // 2xx/3xx (success) -> 'info'
    const logLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    
    logger.log(logLevel, 'HTTP Request Completed', {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration,
      ip,
      user_id,
      contentLength: res.getHeader('content-length')
    });

    // Log slow requests
    if (duration > 1000) {
      logger.warn('Slow Request Detected', {
        method: req.method,
        url: req.originalUrl,
        duration,
        user_id,
        ip
      });
    }
  });

  next();
};

/**
 * Database operation logger
 */
export const dbLogger = {
  query: (sql: string, params?: any[], duration?: number, user_id?: number) => {
    logger.debug('Database Query', {
      sql: sql.replace(/\s+/g, ' ').trim(),
      params: params ? params.length : 0,
      duration: duration ? `${duration}ms` : undefined,
      user_id
    });
  },
  
  error: (error: Error, sql?: string, params?: any[], user_id?: number) => {
    logger.error('Database Error', {
      message: error.message,
      sql: sql?.replace(/\s+/g, ' ').trim(),
      params: params ? params.length : 0,
      user_id,
      stack: error.stack
    });
  },
  
  connection: (action: 'acquired' | 'released' | 'error', details?: any) => {
    logger.debug('Database Connection', {
      action,
      ...details
    });
  }
};

/**
 * Service operation logger
 */
export const serviceLogger = {
  operation: (service: string, operation: string, user_id?: number, data?: any) => {
    logger.info('Service Operation', {
      service,
      operation,
      user_id,
      ...data
    });
  },
  
  error: (service: string, operation: string, error: Error, user_id?: number, data?: any) => {
    logger.error('Service Error', {
      service,
      operation,
      error: error.message,
      user_id,
      stack: error.stack,
      ...data
    });
  }
};

/**
 * Authentication logger
 */
export const authLogger = {
  login: (email: string, success: boolean, ip?: string, reason?: string) => {
    const level = success ? 'info' : 'warn';
    logger.log(level, 'Authentication Attempt', {
      event: 'login',
      email,
      success,
      ip,
      reason
    });
  },
  
  logout: (user_id: number, ip?: string) => {
    logger.info('User Logout', {
      event: 'logout',
      user_id,
      ip
    });
  },
  
  tokenValidation: (success: boolean, user_id?: number, ip?: string, reason?: string) => {
    const level = success ? 'debug' : 'warn';
    logger.log(level, 'Token Validation', {
      event: 'token_validation',
      success,
      user_id,
      ip,
      reason
    });
  }
};

/**
 * Security logger
 */
export const securityLogger = {
  rateLimitExceeded: (ip: string, endpoint: string, userAgent?: string) => {
    logger.warn('Rate Limit Exceeded', {
      event: 'rate_limit_exceeded',
      ip,
      endpoint,
      userAgent
    });
  },
  
  suspiciousActivity: (ip: string, activity: string, details?: any) => {
    logger.warn('Suspicious Activity Detected', {
      event: 'suspicious_activity',
      ip,
      activity,
      ...details
    });
  },
  
  accessDenied: (ip: string, endpoint: string, reason: string, user_id?: number) => {
    logger.warn('Access Denied', {
      event: 'access_denied',
      ip,
      endpoint,
      reason,
      user_id
    });
  }
};

/**
 * Application lifecycle logger
 */
export const appLogger = {
  startup: (port: number) => {
    logger.info('Application Started', {
      event: 'app_startup',
      port,
      environment: config.NODE_ENV,
      version: config.APP_VERSION
    });
  },
  
  shutdown: (reason: string) => {
    logger.info('Application Shutdown', {
      event: 'app_shutdown',
      reason
    });
  },
  
  error: (error: Error, context?: string) => {
    logger.error('Application Error', {
      event: 'app_error',
      error: error.message,
      context,
      stack: error.stack
    });
  }
};

export default logger; 