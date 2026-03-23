import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import multer from 'multer';
import swaggerUi from 'swagger-ui-express';
import cookieParser from 'cookie-parser';
import csurf from 'csurf';

// Production middleware imports
// Rate limiting disabled - apiLimiter and authLimiter imports commented out
import { securityHeaders, /* apiLimiter, authLimiter, */ validateRequest, corsConfig } from './middleware/security';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestLogger, appLogger } from './config/logger';
import { swaggerSpec } from './config/swagger';
import monitoringRoutes, { metricsMiddleware } from './routes/monitoring.routes';
import { config } from './config/environment';
import authRoutes from './routes/auth.routes';
import formRoutes from './routes/form.routes';
import auditAssignmentRoutes from './routes/auditAssignment.routes';
import submissionRoutes from './routes/submission.routes';
import disputeRoutes from './routes/dispute.routes';
import courseRoutes from './routes/course.routes';
import trainingPathRoutes from './routes/trainingPath.routes';
import enrollmentRoutes from './routes/enrollment.routes';
import trainerRoutes from './routes/trainer.routes';
import analyticsRoutes from './routes/analytics.routes';
import auditLogRoutes from './routes/auditLog.routes';
import userRoutes from './routes/user.routes';
import roleRoutes from './routes/role.routes';
import departmentRoutes from './routes/department.routes';
import directorDepartmentRoutes from './routes/directorDepartment.routes';
import performanceGoalRoutes from './routes/performanceGoal.routes';
import enhancedPerformanceGoalRoutes from './routes/enhancedPerformanceGoal.routes';
import qaRoutes from './routes/qa.routes';
import csrRoutes from './routes/csr.routes';
import quizRoutes from './routes/quiz.routes';
import certificateRoutes from './routes/certificate.routes';
import managerRoutes from './routes/manager.routes';
import adminRoutes from './routes/admin.routes';
import phoneSystemRoutes from './routes/phoneSystem.routes';
import callRoutes from './routes/calls.routes';
import topicRoutes from './routes/topic.routes';
import importRoutes from './routes/import.routes';
import metricRoutes from './routes/metric.routes';
import reportRoutes from './routes/report.routes';
import rawDataRoutes from './routes/rawData.routes';


function normalizePort(val: string | number): string | number | false {
  const port = typeof val === 'string' ? parseInt(val, 10) : val;

  if (isNaN(port)) {
    return val; // named pipe
  }

  if (port >= 0) {
    return port; // valid port number
  }

  return false;
}


// Load environment variables
dotenv.config();

// Create Express server
const app = express();
const PORT = config.PORT;

// Trust proxy for accurate IP addresses
// In production/staging behind IIS/nginx, trust all proxies
// This allows Express to correctly read X-Forwarded-For headers
const nodeEnv = process.env.NODE_ENV?.toLowerCase() || 'development';
if (nodeEnv === 'production' || nodeEnv === 'staging') {
  app.set('trust proxy', true);
} else {
  app.set('trust proxy', 1);
}

// Security middleware
app.use(securityHeaders);
app.use(validateRequest);

// Request logging middleware (before routes)
app.use(requestLogger);

// Metrics collection middleware
app.use(metricsMiddleware);

// CORS middleware with production configuration
app.use(cors(corsConfig));

// Rate limiting middleware - DISABLED
// app.use(apiLimiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Add cookie-parser middleware before csurf
app.use(cookieParser());

// CSRF protection middleware (after body parsing, before routes)
const csrfProtection = csurf({
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
  }
});
app.use(csrfProtection);

// Expose CSRF token to frontend via cookie
app.use((req, res, next) => {
  res.cookie('XSRF-TOKEN', req.csrfToken(), {
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
  });
  next();
});

// Add this endpoint to allow frontend to fetch CSRF token
app.get('/api/csrf-token', (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Set up multer for handling file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.MAX_FILE_SIZE,
  },
});

// Serve static files from uploads directory
app.use('/uploads', express.static('uploads'));

// Monitoring and health check routes (no authentication required)
app.use('/', monitoringRoutes);

// API Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  explorer: true,
  customSiteTitle: 'QTIP API Documentation',
  customfavIcon: '/favicon.ico',
  customCss: '.swagger-ui .topbar { display: none }'
}));

// Test route
app.get('/test', (req, res) => {
  res.json({ 
    message: 'QTIP API is running!',
    version: config.APP_VERSION,
    environment: config.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// Routes with specific rate limiting - DISABLED
app.use('/api/auth', authRoutes);
app.use('/api/forms', formRoutes);
app.use('/api/audit-assignments', auditAssignmentRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/training-paths', trainingPathRoutes);
app.use('/api/enrollments', enrollmentRoutes);
app.use('/api/trainer', trainerRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/director-departments', directorDepartmentRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/performance-goals', performanceGoalRoutes);
app.use('/api/enhanced-performance-goals', enhancedPerformanceGoalRoutes);
app.use('/api/qa', qaRoutes);
app.use('/api/csr', csrRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/certificates', certificateRoutes);
app.use('/api/manager', managerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/phone-system', phoneSystemRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/topics', topicRoutes);
app.use('/api/imports', importRoutes);
app.use('/api/metrics', metricRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/raw-data', rawDataRoutes);

// Error handling middleware (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
const port = normalizePort(process.env.PORT || '3000');
const server = app.listen(port, () => {
  //appLogger.startup(port);
  console.log(`🚀 QTIP API v${config.APP_VERSION} running on port ${port}`);
  console.log(`📖 API Documentation: http://localhost:${port}/api-docs`);
  console.log(`💚 Health Check: http://localhost:${port}/health`);
  console.log(`📊 Metrics: http://localhost:${port}/metrics`);
});

// Graceful shutdown handling
const gracefulShutdown = (signal: string) => {
  appLogger.shutdown(`Received ${signal}`);
  console.log(`\n🔄 Received ${signal}. Graceful shutdown...`);
  
  server.close(() => {
    console.log('✅ HTTP server closed.');
    process.exit(0);
  });

  // Force close after 30 seconds
  setTimeout(() => {
    console.error('❌ Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 30000);
};

// Handle various shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle unhandled promise rejections
process.on('unhandledRejection', (err: Error) => {
  appLogger.error(err, 'Unhandled Promise Rejection');
  console.error('💥 Unhandled Promise Rejection:', err);
  
  if (config.NODE_ENV === 'production') {
    // In production, don't crash on unhandled rejections, just log them
    return;
  }
  
  // In development, exit to force fixes
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err: Error) => {
  appLogger.error(err, 'Uncaught Exception');
  console.error('💥 Uncaught Exception:', err);
  
  // Always exit on uncaught exceptions
  process.exit(1);
}); 