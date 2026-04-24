/**
 * TrainerLogger - structured logging facade for trainer-domain operations.
 *
 * Delegates all output to the shared Winston logger (see config/logger.ts) so
 * trainer logs land in the same daily-rotated transports as the rest of the
 * app. Keeps an in-memory ring buffer of recent timing metrics for the
 * monitoring dashboard.
 *
 * Pre-production review item #62b: previously emitted directly via
 * console.log/warn/error.
 */

import logger from '../config/logger';

interface PerformanceMetrics {
  operation: string;
  duration: number;
  timestamp: string;
  trainerId?: number;
  success: boolean;
}

const SERVICE = 'TrainerService';
const SLOW_OPERATION_MS = 2000;

export class TrainerLogger {
  private static instance: TrainerLogger;
  private performanceMetrics: PerformanceMetrics[] = [];
  private readonly maxMetricsHistory = 1000;

  static getInstance(): TrainerLogger {
    if (!TrainerLogger.instance) {
      TrainerLogger.instance = new TrainerLogger();
    }
    return TrainerLogger.instance;
  }

  operation(operation: string, trainerId?: number, data?: unknown): void {
    logger.info('Trainer operation', { service: SERVICE, operation, trainerId, data });
  }

  operationError(operation: string, error: Error, trainerId?: number, data?: unknown): void {
    logger.error('Trainer operation error', {
      service: SERVICE,
      operation,
      trainerId,
      data,
      error: error.message,
      stack: error.stack,
    });
  }

  performance(operation: string, startTime: number, trainerId?: number, success: boolean = true): void {
    const duration = Date.now() - startTime;
    const metrics: PerformanceMetrics = {
      operation,
      duration,
      timestamp: new Date().toISOString(),
      trainerId,
      success,
    };

    this.performanceMetrics.push(metrics);
    if (this.performanceMetrics.length > this.maxMetricsHistory) {
      this.performanceMetrics = this.performanceMetrics.slice(-this.maxMetricsHistory);
    }

    if (duration > SLOW_OPERATION_MS) {
      logger.warn('Slow trainer operation', { service: SERVICE, ...metrics });
    } else {
      logger.debug('Trainer operation timing', { service: SERVICE, operation, duration, trainerId });
    }
  }

  security(event: string, trainerId: number, details?: unknown): void {
    logger.warn('Trainer security event', {
      service: SERVICE,
      operation: `SECURITY_${event}`,
      trainerId,
      data: details,
    });
  }

  auth(event: string, trainerId: number, success: boolean, details?: unknown): void {
    logger.log(success ? 'info' : 'warn', 'Trainer auth event', {
      service: SERVICE,
      operation: `AUTH_${event}`,
      trainerId,
      data: { success, ...(details && typeof details === 'object' ? details : {}) },
    });
  }

  coachingSession(event: string, sessionId: number, trainerId: number, data?: unknown): void {
    logger.info('Trainer coaching event', {
      service: SERVICE,
      operation: `COACHING_${event}`,
      trainerId,
      data: { sessionId, ...(data && typeof data === 'object' ? data : {}) },
    });
  }

  trainingAssignment(event: string, trainerId: number, data?: unknown): void {
    logger.info('Trainer training assignment', {
      service: SERVICE,
      operation: `TRAINING_${event}`,
      trainerId,
      data,
    });
  }

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
    const slowOperations = this.performanceMetrics.filter(m => m.duration > SLOW_OPERATION_MS).length;
    const failedOperations = this.performanceMetrics.filter(m => !m.success).length;
    const errorRate = total > 0 ? (failedOperations / total) * 100 : 0;

    return {
      totalOperations: total,
      avgDuration: Math.round(avgDuration),
      slowOperations,
      errorRate: Math.round(errorRate * 100) / 100,
      recentMetrics: this.performanceMetrics.slice(-10),
    };
  }
}

export const trainerLogger = TrainerLogger.getInstance();
