import { Request, Response, NextFunction } from 'express';
import logger from '../config/logger';

// Performance metrics storage
interface PerformanceMetrics {
  requestCount: number;
  totalResponseTime: number;
  averageResponseTime: number;
  slowestRequest: number;
  fastestRequest: number;
  errorCount: number;
  endpointMetrics: Map<string, {
    count: number;
    totalTime: number;
    averageTime: number;
  }>;
}

class PerformanceMonitor {
  private metrics: PerformanceMetrics = {
    requestCount: 0,
    totalResponseTime: 0,
    averageResponseTime: 0,
    slowestRequest: 0,
    fastestRequest: Number.MAX_SAFE_INTEGER,
    errorCount: 0,
    endpointMetrics: new Map()
  };

  recordRequest(
    method: string, 
    path: string, 
    responseTime: number, 
    statusCode: number
  ): void {
    // Update global metrics
    this.metrics.requestCount++;
    this.metrics.totalResponseTime += responseTime;
    this.metrics.averageResponseTime = this.metrics.totalResponseTime / this.metrics.requestCount;
    
    if (responseTime > this.metrics.slowestRequest) {
      this.metrics.slowestRequest = responseTime;
    }
    
    if (responseTime < this.metrics.fastestRequest) {
      this.metrics.fastestRequest = responseTime;
    }
    
    if (statusCode >= 400) {
      this.metrics.errorCount++;
    }

    // Update endpoint-specific metrics
    const endpoint = `${method} ${path}`;
    const endpointMetric = this.metrics.endpointMetrics.get(endpoint) || {
      count: 0,
      totalTime: 0,
      averageTime: 0
    };
    
    endpointMetric.count++;
    endpointMetric.totalTime += responseTime;
    endpointMetric.averageTime = endpointMetric.totalTime / endpointMetric.count;
    
    this.metrics.endpointMetrics.set(endpoint, endpointMetric);

    // Log slow requests
    if (responseTime > 5000) { // 5 seconds threshold
      logger.warn('Slow request detected', {
        method,
        path,
        responseTime,
        statusCode,
        threshold: '5000ms'
      });
    }
  }

  getMetrics(): PerformanceMetrics & {
    topSlowEndpoints: Array<{ endpoint: string; averageTime: number; count: number; }>;
  } {
    // Get top 10 slowest endpoints
    const sortedEndpoints = Array.from(this.metrics.endpointMetrics.entries())
      .map(([endpoint, metric]) => ({
        endpoint,
        averageTime: metric.averageTime,
        count: metric.count
      }))
      .sort((a, b) => b.averageTime - a.averageTime)
      .slice(0, 10);

    return {
      ...this.metrics,
      topSlowEndpoints: sortedEndpoints
    };
  }

  reset(): void {
    this.metrics = {
      requestCount: 0,
      totalResponseTime: 0,
      averageResponseTime: 0,
      slowestRequest: 0,
      fastestRequest: Number.MAX_SAFE_INTEGER,
      errorCount: 0,
      endpointMetrics: new Map()
    };
  }
}

const performanceMonitor = new PerformanceMonitor();

// Middleware function
export const performanceMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  
  // Add performance context to request
  (req as Request & { startTime?: number }).startTime = startTime;
  
  // Override res.end to capture response time
  const originalEnd = res.end;
  res.end = function(chunk?: any, encoding?: any, cb?: any): any {
    const responseTime = Date.now() - startTime;
    
    // Record metrics
    performanceMonitor.recordRequest(
      req.method,
      req.route?.path || req.path,
      responseTime,
      res.statusCode
    );
    
    // Log request details
    logger.info('Request completed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      user_id: req.user?.user_id
    });
    
    // Call original end method with proper signature
    return originalEnd.call(this, chunk, encoding, cb);
  };
  
  next();
};

// Endpoint to get performance metrics
export const getPerformanceMetrics = (req: Request, res: Response) => {
  const metrics = performanceMonitor.getMetrics();
  res.json({
    status: 'success',
    data: {
      ...metrics,
      endpointMetrics: Object.fromEntries(metrics.endpointMetrics)
    }
  });
};

// Health check middleware
export const healthCheckMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Set health check headers
  res.setHeader('X-Health-Check', 'OK');
  res.setHeader('X-Timestamp', new Date().toISOString());
  
  next();
};

// Request timeout middleware with configurable timeout
export const requestTimeoutMiddleware = (timeoutMs: number = 30000) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn('Request timeout', {
          method: req.method,
          path: req.path,
          timeout: timeoutMs,
          userAgent: req.get('User-Agent')
        });
        
        res.status(408).json({
          error: {
            type: 'REQUEST_TIMEOUT',
            message: 'Request timeout',
            timeout: timeoutMs
          }
        });
      }
    }, timeoutMs);
    
    res.on('finish', () => clearTimeout(timeout));
    res.on('close', () => clearTimeout(timeout));
    
    next();
  };
};

// Database performance tracking
export class DatabasePerformanceTracker {
  private queries: Array<{
    query: string;
    duration: number;
    timestamp: Date;
    success: boolean;
  }> = [];

  recordQuery(query: string, duration: number, success: boolean = true): void {
    this.queries.push({
      query: query.substring(0, 200), // Truncate long queries
      duration,
      timestamp: new Date(),
      success
    });
    
    // Keep only last 1000 queries
    if (this.queries.length > 1000) {
      this.queries = this.queries.slice(-1000);
    }
    
    // Log slow queries
    if (duration > 1000) { // 1 second threshold
      logger.warn('Slow database query detected', {
        query: query.substring(0, 200),
        duration: `${duration}ms`,
        threshold: '1000ms'
      });
    }
  }

  getMetrics() {
    const successfulQueries = this.queries.filter(q => q.success);
    const failedQueries = this.queries.filter(q => !q.success);
    
    const totalDuration = successfulQueries.reduce((sum, q) => sum + q.duration, 0);
    const averageDuration = successfulQueries.length > 0 
      ? totalDuration / successfulQueries.length 
      : 0;
    
    const slowestQuery = this.queries.reduce((slowest, current) => 
      current.duration > slowest.duration ? current : slowest, 
      { duration: 0, query: '', timestamp: new Date(), success: true }
    );

    return {
      totalQueries: this.queries.length,
      successfulQueries: successfulQueries.length,
      failedQueries: failedQueries.length,
      averageDuration: Math.round(averageDuration),
      slowestQuery: {
        query: slowestQuery.query,
        duration: slowestQuery.duration
      },
      recentQueries: this.queries.slice(-10).map(q => ({
        query: q.query,
        duration: q.duration,
        success: q.success
      }))
    };
  }

  reset(): void {
    this.queries = [];
  }
}

export const dbPerformanceTracker = new DatabasePerformanceTracker();

export { performanceMonitor }; 