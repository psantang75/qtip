import express, { RequestHandler } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getInsightsNavigation,
  getInsightsAccess,
  getDataFreshness,
  getKpiConfig,
} from '../controllers/insights.controller';
import { getAgentActivityStatus, getEmailActivity, getCallActivity, getTicketsTasks, getTicketsPastDue, getTicketsDailyHistory, getTicketsProductivity, getLeads, getMargin } from '../controllers/insightsAgentActivity.controller';
import qcRouter from './insightsQC.routes';
import csrRouter from './insightsCsr.routes';

const router = express.Router();

router.get('/navigation',
  authenticate as unknown as RequestHandler,
  getInsightsNavigation as unknown as RequestHandler
);

router.get('/access/:pageKey',
  authenticate as unknown as RequestHandler,
  getInsightsAccess as unknown as RequestHandler
);

router.get('/data-freshness',
  authenticate as unknown as RequestHandler,
  getDataFreshness as unknown as RequestHandler
);

router.get('/kpi-config',
  authenticate as unknown as RequestHandler,
  getKpiConfig as unknown as RequestHandler
);

// Agent Activity (Phase 2 data layer) — ingestion registry/status surface.
// Per-report data endpoints are added one phase at a time as fact tables land.
router.get('/agent-activity/status',
  authenticate as unknown as RequestHandler,
  getAgentActivityStatus as unknown as RequestHandler
);

router.get('/agent-activity/email',
  authenticate as unknown as RequestHandler,
  getEmailActivity as unknown as RequestHandler
);

router.get('/agent-activity/call',
  authenticate as unknown as RequestHandler,
  getCallActivity as unknown as RequestHandler
);

router.get('/agent-activity/tickets',
  authenticate as unknown as RequestHandler,
  getTicketsTasks as unknown as RequestHandler
);

router.get('/agent-activity/tickets/past-due',
  authenticate as unknown as RequestHandler,
  getTicketsPastDue as unknown as RequestHandler
);

router.get('/agent-activity/tickets/daily-history',
  authenticate as unknown as RequestHandler,
  getTicketsDailyHistory as unknown as RequestHandler
);

router.get('/agent-activity/tickets/productivity',
  authenticate as unknown as RequestHandler,
  getTicketsProductivity as unknown as RequestHandler
);

router.get('/agent-activity/leads',
  authenticate as unknown as RequestHandler,
  getLeads as unknown as RequestHandler
);

router.get('/agent-activity/margin',
  authenticate as unknown as RequestHandler,
  getMargin as unknown as RequestHandler
);

// QC analytics — authenticate applied per-handler (via qcHandler wrapper)
router.use('/qc', authenticate as unknown as RequestHandler, qcRouter as unknown as RequestHandler);

// Agent Activity - CSR (attendance points and schedule compliance)
router.use('/csr', authenticate as unknown as RequestHandler, csrRouter as unknown as RequestHandler);

export default router;
