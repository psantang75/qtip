/**
 * TrainerLogger - Comprehensive logging service for trainer operations
 * Provides structured logging, performance monitoring, and audit trails
 */

interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  operation: string;
  trainerId?: number;
  data?: any;
  duration?: number;
  error?: string;
  stack?: string;
}

interface PerformanceMetrics {
  operation: string;
  duration: number;
  timestamp: string;
  trainerId?: number;
  success: boolean;
}

export class TrainerLogger {
  private static instance: TrainerLogger;
  private performanceMetrics: PerformanceMetrics[] = [];
  private maxMetricsHistory = 1000;

  static getInstance(): TrainerLogger {
    if (!TrainerLogger.instance) {
      TrainerLogger.instance = new TrainerLogger();
    }
    return TrainerLogger.instance;
  }

  /**
   * Log trainer operation with structured data
   */
  operation(operation: string, trainerId?: number, data?: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      operation,
      trainerId,
      data
    };

    console.log(`[TRAINER SERVICE] ${operation}:`, entry);
  }

  /**
   * Log trainer operation error with detailed context
   */
  operationError(operation: string, error: Error, trainerId?: number, data?: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      operation,
      trainerId,
      data,
      error: error.message,
      stack: error.stack
    };

    console.error(`[TRAINER SERVICE ERROR] ${operation}:`, entry);
  }

  /**
   * Log performance metrics for monitoring
   */
  performance(operation: string, startTime: number, trainerId?: number, success: boolean = true): void {
    const duration = Date.now() - startTime;
    const metrics: PerformanceMetrics = {
      operation,
      duration,
      timestamp: new Date().toISOString(),
      trainerId,
      success
    };

    // Add to metrics history
    this.performanceMetrics.push(metrics);
    
    // Keep only recent metrics
    if (this.performanceMetrics.length > this.maxMetricsHistory) {
      this.performanceMetrics = this.performanceMetrics.slice(-this.maxMetricsHistory);
    }

    // Log slow operations (> 2 seconds)
    if (duration > 2000) {
      console.warn(`[TRAINER PERFORMANCE WARNING] Slow operation detected:`, metrics);
    } else {
      console.log(`[TRAINER PERFORMANCE] ${operation}: ${duration}ms`);
    }
  }

  /**
   * Log security-related events
   */
  security(event: string, trainerId: number, details?: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'WARN',
      operation: `SECURITY_${event}`,
      trainerId,
      data: details
    };

    console.warn(`[TRAINER SECURITY] ${event}:`, entry);
  }

  /**
   * Log authentication events
   */
  auth(event: string, trainerId: number, success: boolean, details?: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: success ? 'INFO' : 'WARN',
      operation: `AUTH_${event}`,
      trainerId,
      data: { success, ...details }
    };

    if (success) {
      console.log(`[TRAINER AUTH] ${event}:`, entry);
    } else {
      console.warn(`[TRAINER AUTH FAILED] ${event}:`, entry);
    }
  }

  /**
   * Get performance statistics for monitoring dashboard
   */
  getPerformanceStats(): {
    totalOperations: number;
    avgDuration: number;
    slowOperations: number;
    errorRate: number;
    recentMetrics: PerformanceMetrics[];
  } {
    const total = this.performanceMetrics.length;
    const avgDuration = total > 0 
      ? this.performanceMetrics.reduce((sum, m) => sum + m.duration, 0) / total
      : 0;
    
    const slowOperations = this.performanceMetrics.filter(m => m.duration > 2000).length;
    const failedOperations = this.performanceMetrics.filter(m => !m.success).length;
    const errorRate = total > 0 ? (failedOperations / total) * 100 : 0;

    return {
      totalOperations: total,
      avgDuration: Math.round(avgDuration),
      slowOperations,
      errorRate: Math.round(errorRate * 100) / 100,
      recentMetrics: this.performanceMetrics.slice(-10)
    };
  }

  /**
   * Log coaching session specific events
   */
  coachingSession(event: string, sessionId: number, trainerId: number, data?: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      operation: `COACHING_${event}`,
      trainerId,
      data: { sessionId, ...data }
    };

    console.log(`[TRAINER COACHING] ${event}:`, entry);
  }

  /**
   * Log training assignment events
   */
  trainingAssignment(event: string, trainerId: number, data?: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      operation: `TRAINING_${event}`,
      trainerId,
      data
    };

    console.log(`[TRAINER ASSIGNMENT] ${event}:`, entry);
  }
}

// Export singleton instance
export const trainerLogger = TrainerLogger.getInstance(); 