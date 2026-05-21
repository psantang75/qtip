import dotenv from 'dotenv';
import path from 'path';
// Load .env BEFORE any module that reads process.env at import time
// (notably ./config/environment which fail-fasts on missing DB_PASSWORD when
// NODE_ENV=production). Path is resolved relative to the compiled file so it
// works regardless of PM2/Node cwd:
//   dev   : <repo>/backend/src/index.ts -> <repo>/backend/.env
//   prod  : /opt/qtip/backend/dist/index.js -> /opt/qtip/backend/.env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import cookieParser from 'cookie-parser';
import csurf from 'csurf';

// Production middleware imports
import { securityHeaders, apiLimiter, authLimiter, validateRequest, corsConfig } from './middleware/security';
import { errorHandler, notFoundHandler } from './utils/errorHandler';
import { requestLogger, appLogger } from './config/logger';
import { swaggerSpec } from './config/swagger';
import monitoringRoutes, { metricsMiddleware } from './routes/monitoring.routes';
import { config } from './config/environment';
import authRoutes from './routes/auth.routes';
import formRoutes from './routes/form.routes';
import auditAssignmentRoutes from './routes/auditAssignment.routes';
import submissionRoutes from './routes/submission.routes';
import disputeRoutes from './routes/dispute.routes';
import trainerRoutes from './routes/trainer.routes';
import analyticsRoutes from './routes/analytics.routes';
import auditLogRoutes from './routes/auditLog.routes';
import userRoutes from './routes/user.routes';
import roleRoutes from './routes/role.routes';
import departmentRoutes from './routes/department.routes';
import directorDepartmentRoutes from './routes/directorDepartment.routes';
import enhancedPerformanceGoalRoutes from './routes/enhancedPerformanceGoal.routes';
import qaRoutes from './routes/qa.routes';
import csrRoutes from './routes/csr.routes';
import quizRoutes from './routes/quiz.routes';
import managerRoutes from './routes/manager.routes';
import adminRoutes from './routes/admin.routes';
import adminSystemSettingsRoutes from './routes/admin-system-settings.routes';
import listRoutes  from './routes/list.routes';
import phoneSystemRoutes from './routes/phoneSystem.routes';
import callRoutes from './routes/calls.routes';
import crmRoutes from './routes/crm.routes';
import kbRoutes from './routes/kb.routes';
import aiReviewerRoutes from './routes/ai-reviewer.routes';
import writeupRoutes from './routes/writeup.routes';
import importRoutes from './routes/import.routes';
import metricRoutes from './routes/metric.routes';
import reportRoutes from './routes/report.routes';
import rawDataRoutes from './routes/rawData.routes';
import insightsRoutes from './routes/insights.routes';
import insightsAdminRoutes from './routes/insightsAdmin.routes';
import onDemandReportsRoutes from './routes/onDemandReports.routes';
import logger from './config/logger';


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

// Rate limiting:
//   - authLimiter is mounted directly on /api/auth so credential-stuffing attempts
//     against /api/auth/login (and friends) are throttled per-IP.
//   - apiLimiter applies to every other /api route. Both limiters self-skip
//     localhost in development and read-only/monitoring endpoints (see security.ts).
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api', apiLimiter);

app.use('/api/forms', formRoutes);
app.use('/api/audit-assignments', auditAssignmentRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/trainer', trainerRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/director-departments', directorDepartmentRoutes);
app.use('/api/departments', departmentRoutes);
// Performance goals: only the Enhanced* stack is mounted. The classic
// /api/performance-goals stack (legacy controller + feature-flagged service +
// MySQLPerformanceGoalRepository) was removed during the pre-production review
// (item #15) — it had no frontend caller and was a third parallel
// implementation of the same table.
app.use('/api/enhanced-performance-goals', enhancedPerformanceGoalRoutes);
app.use('/api/qa', qaRoutes);
app.use('/api/csr', csrRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/manager', managerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/system-settings', adminSystemSettingsRoutes);
app.use('/api/list-items', listRoutes);
app.use('/api/phone-system', phoneSystemRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/kb', kbRoutes);
app.use('/api/ai-reviewer', aiReviewerRoutes);
app.use('/api/writeups', writeupRoutes);
app.use('/api/imports', importRoutes);
app.use('/api/metrics', metricRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/raw-data', rawDataRoutes);
app.use('/api/insights', insightsRoutes);
app.use('/api/insights/admin', insightsAdminRoutes);
app.use('/api/on-demand-reports', onDemandReportsRoutes);

// Error handling middleware (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
const port = normalizePort(process.env.PORT || '3000');
const server = app.listen(port, () => {
  //appLogger.startup(port);
  logger.info(`🚀 QTIP API v${config.APP_VERSION} running on port ${port}`);
  logger.info(`📖 API Documentation: http://localhost:${port}/api-docs`);
  logger.info(`💚 Health Check: http://localhost:${port}/health`);
  logger.info(`📊 Metrics: http://localhost:${port}/metrics`);
  // Smoke signal #1 — make it obvious in stdout which prompt the AI
  // Reviewer is using on this boot. If this line is missing, the
  // process is running stale code and a deploy/restart didn't take.
  logger.info('[AI REVIEWER] system prompt v2.0 active (timeline + observations + confidence)');

  // Run the calibration absorb sweep + golden-set seeder + calibration map
  // probe on boot so smoke signals appear in stdout immediately. Each call
  // catches its own errors so a sub-system failure can't block boot.
  void (async () => {
    // AI Reviewer config caches: rule packs + per-question rubrics.
    // Both expose sync read APIs to keep the prompt builders sync, so
    // they need a warmed cache before the first AI run. Errors are
    // logged but don't abort boot — the readers fall back to empty
    // results until the next 60s background refresh succeeds.
    try {
      const { warmCache: warmRulePackCache } = await import('./services/RulePackService');
      await warmRulePackCache();
    } catch (err) {
      logger.error('[RULE PACKS] warmCache failed on boot', { error: (err as Error).message });
    }
    // Layer 1 of the 4-layer prompt model: universal base prompts. Seeds
    // the three default rows from the legacy .md files on first boot if
    // missing, then loads them into the in-process cache the prompt
    // builders read from synchronously.
    try {
      const { warmCache: warmBasePromptCache } = await import('./services/BasePromptService');
      await warmBasePromptCache();
    } catch (err) {
      logger.error('[BASE PROMPTS] warmCache failed on boot', { error: (err as Error).message });
    }
    try {
      const { warmFormRubricsCache } = await import('./services/aiReviewerPrompt');
      await warmFormRubricsCache();
    } catch (err) {
      logger.error('[ai-reviewer] rubrics warmCache failed on boot', { error: (err as Error).message });
    }

    const { runAbsorbSweepOnBoot } = await import('./services/AICalibrationAbsorbSweep');
    await runAbsorbSweepOnBoot();
    const { runGoldenSetSeederOnBoot } = await import('./services/AIGoldenSetSeeder');
    await runGoldenSetSeederOnBoot();
    const { logCalibratorStateOnBoot } = await import('./services/ConfidenceCalibrator');
    await logCalibratorStateOnBoot();
    const { runDriftSweepOnBoot } = await import('./services/AIDriftDetector');
    await runDriftSweepOnBoot();
    const { logCostGuardStateOnBoot } = await import('./services/AIReviewerCostGuard');
    await logCostGuardStateOnBoot();

    // Email / Notification system: seed default templates (idempotent),
    // verify SMTP, and start the digest scheduler.
    try {
      const { seedEmailTemplates } = await import('./services/email/templateSeeds');
      await seedEmailTemplates();
      const { default: emailService } = await import('./services/email/EmailService');
      const verify = await emailService.verify();
      logger.info(`[EMAIL] transport ${emailService.isConfigured() ? 'configured' : 'not_configured'}, dryRun=${emailService.isDryRun()}, verify=${verify.ok ? 'ok' : verify.error}`);
      const { startDigestScheduler } = await import('./services/notifications/DigestScheduler');
      startDigestScheduler();
    } catch (err) {
      logger.error('[EMAIL] startup failed', err);
    }

    // KB Index Scheduler: keeps `kb_page_embeddings` + the parsed
    // `kb_pages_meta.qtip_steps` (Approach structure) fresh against
    // BookStack edits so the AI Reviewer doesn't grade against a
    // stale snapshot of the playbook. Boot is non-fatal — a missing
    // OpenAI key or BookStack creds just no-ops the scheduler with a
    // warn log.
    try {
      const { startKbIndexScheduler } = await import('./services/KbIndexScheduler');
      await startKbIndexScheduler();
    } catch (err) {
      logger.error('[KB INDEX SCHEDULER] startup failed', err);
    }
  })();
});

// Graceful shutdown handling
const gracefulShutdown = (signal: string) => {
  appLogger.shutdown(`Received ${signal}`);
  logger.info(`\n🔄 Received ${signal}. Graceful shutdown...`);
  
  server.close(() => {
    logger.info('✅ HTTP server closed.');
    process.exit(0);
  });

  // Force close after 30 seconds
  setTimeout(() => {
    logger.error('❌ Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 30000);
};

// Handle various shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle unhandled promise rejections
process.on('unhandledRejection', (err: Error) => {
  appLogger.error(err, 'Unhandled Promise Rejection');
  logger.error('💥 Unhandled Promise Rejection:', err);
  
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
  logger.error('💥 Uncaught Exception:', err);
  
  // Always exit on uncaught exceptions
  process.exit(1);
}); 