import express, { RequestHandler } from 'express';
import { authenticate, authorizeAdmin } from '../middleware/auth';
import {
  listKpis, createKpi, updateKpi, getThresholds, setThreshold, updateThreshold, deleteThreshold,
} from '../controllers/insightsAdminKpi.controller';
import {
  listPages, updatePageAccess, listOverrides, createOverride, deleteOverride,
} from '../controllers/insightsAdminPage.controller';
import { getIngestionLog } from '../controllers/insightsAdminIngestion.controller';
import { getCalendar, updateCalendarDay, saveCalendarMonth } from '../controllers/insightsAdminCalendar.controller';

const router = express.Router();

router.get('/kpis', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, listKpis as unknown as RequestHandler);
router.post('/kpis', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, createKpi as unknown as RequestHandler);
router.put('/kpis/:id', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, updateKpi as unknown as RequestHandler);
router.get('/kpis/:id/thresholds', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, getThresholds as unknown as RequestHandler);
router.post('/kpis/:id/thresholds', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, setThreshold as unknown as RequestHandler);
router.put('/kpis/:id/thresholds/:thresholdId', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, updateThreshold as unknown as RequestHandler);
router.delete('/kpis/:id/thresholds/:thresholdId', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, deleteThreshold as unknown as RequestHandler);

router.get('/pages', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, listPages as unknown as RequestHandler);
router.put('/pages/:id/access', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, updatePageAccess as unknown as RequestHandler);
router.get('/pages/:id/overrides', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, listOverrides as unknown as RequestHandler);
router.post('/pages/:id/overrides', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, createOverride as unknown as RequestHandler);
router.delete('/pages/:id/overrides/:overrideId', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, deleteOverride as unknown as RequestHandler);

router.get('/ingestion-log', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, getIngestionLog as unknown as RequestHandler);

// ── Business Calendar ─────────────────────────────────────────────────────────
const auth = [authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler];
router.get('/calendar',            ...auth, getCalendar       as unknown as RequestHandler);
router.put('/calendar/:date',      ...auth, updateCalendarDay as unknown as RequestHandler);
router.post('/calendar/save-month',...auth, saveCalendarMonth as unknown as RequestHandler);

export default router;
