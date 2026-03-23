import express, { Request, Response } from 'express';
import { register, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';
import prisma from '../config/prisma';
import { config } from '../config/environment';
import logger from '../config/logger';
import { getPerformanceMetrics, healthCheckMiddleware } from '../middleware/performance';
import { dbPerformanceTracker } from '../middleware/performance';
import cacheService from '../services/CacheService';
import { CSRRepository } from '../repositories/CSRRepository';
import { healthCheckErrors } from '../utils/errorHandler';

const router = express.Router();

// Collect default metrics (CPU, memory, etc.)
collectDefaultMetrics();

// Custom metrics
const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5]
});

const activeConnections = new Gauge({
  name: 'database_connections_active',
  help: 'Number of active database connections'
});

const authAttemptsTotal = new Counter({
  name: 'auth_attempts_total',
  help: 'Total number of authentication attempts',
  labelNames: ['status']
});

const appUptime = new Gauge({
  name: 'app_uptime_seconds',
  help: 'Application uptime in seconds'
});

// Update uptime every 30 seconds
const startTime = Date.now();
setInterval(() => {
  appUptime.set((Date.now() - startTime) / 1000);
}, 30000);

/**
 * Health check endpoint
 * @route GET /health
 * @desc Get application health status
 * @access Public
 */
router.get('/health', healthCheckMiddleware, async (req: Request, res: Response) => {
  try {
    const healthChecks = await Promise.allSettled([
      CSRRepository.healthCheck(),
      Promise.resolve(cacheService.isHealthy())
    ]);

    const dbHealthy = healthChecks[0].status === 'fulfilled' && healthChecks[0].value;
    const cacheHealthy = healthChecks[1].status === 'fulfilled' && healthChecks[1].value;

    const overall = dbHealthy && cacheHealthy;
    
    res.status(overall ? 200 : 503).json({
      status: overall ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealthy ? 'healthy' : 'unhealthy',
        cache: cacheHealthy ? 'healthy' : 'unhealthy'
      },
      errors: healthCheckErrors
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
});

/**
 * Database health check endpoint
 * @route GET /health/database
 * @desc Check the health of the database
 * @access Public
 */
router.get('/health/database', async (req: Request, res: Response) => {
  try {
    const start = Date.now();

    // Test database connection with a simple query
    const result = await prisma.$queryRaw`SELECT 1 as test, NOW() as current_time`;
    
    const responseTime = Date.now() - start;
    
    res.status(200).json({
      status: 'ok',
      database: 'connected',
      responseTime: `${responseTime}ms`,
      timestamp: new Date().toISOString(),
      result: result
    });
  } catch (error) {
    logger.error('Database health check failed:', error);
    res.status(500).json({
      status: 'error',
      database: 'disconnected',
      timestamp: new Date().toISOString(),
      error: 'Database connection failed'
    });
  }
});

/**
 * Readiness check endpoint
 * @route GET /ready
 * @desc Check if application is ready to serve traffic
 * @access Public
 */
router.get('/ready', async (req: Request, res: Response) => {
  try {
    const checks = {
      database: false,
      environment: false,
      dependencies: false
    };

    // Database check
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = true;
    } catch (error) {
      logger.error('Database readiness check failed:', error);
    }

    // Environment variables check
    const requiredEnvVars = [
      'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME',
      'JWT_SECRET', 'REFRESH_TOKEN_SECRET'
    ];
    
    checks.environment = requiredEnvVars.every(envVar => process.env[envVar]);

    // Dependencies check (basic)
    checks.dependencies = true; // Could add more sophisticated checks here

    const allChecksPass = Object.values(checks).every(check => check === true);

    const status = allChecksPass ? 200 : 503;
    
    res.status(status).json({
      status: allChecksPass ? 'ready' : 'not ready',
      checks,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Readiness check failed:', error);
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Readiness check failed'
    });
  }
});

/**
 * Liveness check endpoint
 * @route GET /live
 * @desc Simple liveness check
 * @access Public
 */
router.get('/live', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

/**
 * Prometheus metrics endpoint
 * @route GET /metrics
 * @desc Prometheus metrics in text format
 * @access Public
 */
router.get('/metrics', getPerformanceMetrics);

/**
 * Database connection pool status endpoint
 * @route GET /status/database-pool
 * @desc Get the status of the database connection pool
 * @access Public
 */
router.get('/status/database-pool', async (req: Request, res: Response) => {
  try {
    // Get connection to test pool
    const status: any[] = await prisma.$queryRaw`SHOW STATUS WHERE Variable_name IN ('Connections', 'Max_used_connections', 'Threads_connected', 'Threads_running', 'Uptime')`;


    const formattedStatus = (status as any[]).reduce((acc: any, row: any) => {
      acc[row.Variable_name] = row.Value;
      return acc;
    }, {});

    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      databaseStatus: formattedStatus,
      poolConfig: {
        host: config.DB_HOST,
        database: config.DB_NAME,
        user: config.DB_USER
      }
    });
  } catch (error) {
    logger.error('Database pool status check failed:', error);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Database pool status check failed'
    });
  }
});

/**
 * System information endpoint
 * @route GET /info
 * @desc Get detailed system information
 * @access Public
 */
router.get('/info', async (req: Request, res: Response) => {
  try {
    const info = {
      application: {
        name: config.APP_NAME,
        version: config.APP_VERSION,
        environment: config.NODE_ENV,
        startTime: new Date(startTime).toISOString(),
        uptime: process.uptime()
      },
      system: {
        platform: process.platform,
        architecture: process.arch,
        nodeVersion: process.version,
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100,
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024 * 100) / 100,
          rss: Math.round(process.memoryUsage().rss / 1024 / 1024 * 100) / 100,
          external: Math.round(process.memoryUsage().external / 1024 / 1024 * 100) / 100
        },
        cpu: {
          usage: process.cpuUsage()
        }
      },
      database: await checkDatabaseHealth(),
      configuration: {
        port: config.PORT,
        logLevel: config.LOG_LEVEL,
        jwtExpiration: config.JWT_EXPIRES_IN,
        bcryptRounds: config.BCRYPT_ROUNDS
      }
    };

    res.status(200).json(info);
  } catch (error: any) {
    logger.error('System info collection failed', {
      error: error.message
    });

    res.status(500).json({
      error: 'Failed to collect system information',
      message: error.message
    });
  }
});

/**
 * Check database health
 */
async function checkDatabaseHealth(): Promise<any> {
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1 as health_check`;
    const duration = Date.now() - start;

    return {
      status: 'connected',
      responseTime: `${duration}ms`,
      connections: await getDatabaseConnectionCount()
    };
  } catch (error: any) {
    logger.error('Database health check failed', {
      error: error.message
    });

    return {
      status: 'error',
      error: error.message,
      connections: 0
    };
  }
}

/**
 * Get database connection count
 */
async function getDatabaseConnectionCount(): Promise<number> {
  try {
    const dbName = config.DB_NAME;
    const rows = await prisma.$queryRaw<{ connection_count: bigint }[]>`
      SELECT COUNT(*) as connection_count 
      FROM information_schema.processlist 
      WHERE db = ${dbName} AND command != 'Sleep'
    `;
    return Number(rows[0]?.connection_count) || 0;
  } catch (error) {
    return 0;
  }
}

/**
 * Middleware to collect HTTP metrics
 */
export const metricsMiddleware = (req: Request, res: Response, next: Function) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route ? req.route.path : req.path;

    httpRequestsTotal
      .labels(req.method, route, res.statusCode.toString())
      .inc();

    httpRequestDuration
      .labels(req.method, route, res.statusCode.toString())
      .observe(duration);
  });

  next();
};

/**
 * Track authentication attempts
 */
export const trackAuthAttempt = (success: boolean) => {
  authAttemptsTotal
    .labels(success ? 'success' : 'failure')
    .inc();
};

/**
 * Database performance metrics endpoint
 * @route GET /api/monitoring/database-metrics
 */
router.get('/database-metrics', (req, res) => {
  const metrics = dbPerformanceTracker.getMetrics();
  res.json({
    status: 'success',
    data: metrics
  });
});

/**
 * Cache metrics endpoint
 * @route GET /api/monitoring/cache-metrics
 */
router.get('/cache-metrics', (req, res) => {
  const stats = cacheService.getStats();
  res.json({
    status: 'success',
    data: stats
  });
});

/**
 * Combined system metrics endpoint
 * @route GET /api/monitoring/system-metrics
 */
router.get('/system-metrics', async (req, res) => {
  try {
    const [dbMetrics, cacheStats] = await Promise.all([
      Promise.resolve(dbPerformanceTracker.getMetrics()),
      Promise.resolve(cacheService.getStats())
    ]);

    res.json({
      status: 'success',
      timestamp: new Date().toISOString(),
      data: {
        database: dbMetrics,
        cache: cacheStats,
        errors: healthCheckErrors,
        uptime: process.uptime(),
        memory: process.memoryUsage()
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to collect system metrics'
    });
  }
});

/**
 * Reset metrics endpoint (for development/testing)
 * @route POST /api/monitoring/reset-metrics
 */
router.post('/reset-metrics', (req: Request, res: Response): void => {
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({
      status: 'error',
      message: 'Metrics reset not allowed in production'
    });
    return;
  }

  dbPerformanceTracker.reset();
  
  res.json({
    status: 'success',
    message: 'Metrics reset successfully'
  });
});

export default router; 