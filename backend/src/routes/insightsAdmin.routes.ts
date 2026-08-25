import express, { RequestHandler } from 'express';
import { authenticate, authorizeAdmin } from '../middleware/auth';
import {
  listKpis, createKpi, updateKpi, getThresholds, setThreshold, updateThreshold, deleteThreshold,
} from '../controllers/insightsAdminKpi.controller';
import {
  listPages, updatePageAccess, updatePageDepartmentAccess, listDepartments,
  listOverrides, createOverride, deleteOverride,
} from '../controllers/insightsAdminPage.controller';
import { getIngestionLog } from '../controllers/insightsAdminIngestion.controller';
import {
  listEmailFeeds, createEmailFeed, updateEmailFeed, deleteEmailFeed,
} from '../controllers/insightsAdminEmailFeed.controller';
import { getCalendar, updateCalendarDay, saveCalendarMonth } from '../controllers/insightsAdminCalendar.controller';
import {
  listSourceReportsAdmin, updateSourceReport, runSourceReportNow,
} from '../controllers/insightsAdminSourceReport.controller';
import {
  getAttendanceConfig, savePointRules, saveWarningThresholds, recalculateAttendance,
  savePointsStartDate,
} from '../controllers/insightsAdminAttendance.controller';
import {
  getMonitoringHealth, listDatasetMonitors, updateDatasetMonitor, runMonitoringNow,
} from '../controllers/insightsAdminMonitoring.controller';

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
router.put('/pages/:id/department-access', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, updatePageDepartmentAccess as unknown as RequestHandler);
router.get('/departments', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, listDepartments as unknown as RequestHandler);
router.get('/pages/:id/overrides', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, listOverrides as unknown as RequestHandler);
router.post('/pages/:id/overrides', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, createOverride as unknown as RequestHandler);
router.delete('/pages/:id/overrides/:overrideId', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, deleteOverride as unknown as RequestHandler);

router.get('/ingestion-log', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, getIngestionLog as unknown as RequestHandler);
router.get('/email-feeds', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, listEmailFeeds as unknown as RequestHandler);
router.post('/email-feeds', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, createEmailFeed as unknown as RequestHandler);
router.put('/email-feeds/:id', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, updateEmailFeed as unknown as RequestHandler);
router.delete('/email-feeds/:id', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, deleteEmailFeed as unknown as RequestHandler);

router.get('/source-reports', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, listSourceReportsAdmin as unknown as RequestHandler);
router.put('/source-reports/:id', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, updateSourceReport as unknown as RequestHandler);
router.post('/source-reports/:id/run-now', authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler, runSourceReportNow as unknown as RequestHandler);

// ── Business Calendar ─────────────────────────────────────────────────────────
const auth = [authenticate as unknown as RequestHandler, authorizeAdmin as unknown as RequestHandler];
router.get('/calendar',            ...auth, getCalendar       as unknown as RequestHandler);
router.put('/calendar/:date',      ...auth, updateCalendarDay as unknown as RequestHandler);
router.post('/calendar/save-month',...auth, saveCalendarMonth as unknown as RequestHandler);

// ── Attendance points ─────────────────────────────────────────────────────────
// The bands and discipline ladder are edited in Admin -> List Management ->
// Attendance; these are the endpoints behind that editor. Saving inserts a new
// effective-dated version rather than mutating history.
router.get('/attendance/config',       ...auth, getAttendanceConfig      as unknown as RequestHandler);
router.put('/attendance/rules',        ...auth, savePointRules           as unknown as RequestHandler);
router.put('/attendance/thresholds',   ...auth, saveWarningThresholds    as unknown as RequestHandler);
router.put('/attendance/points-start', ...auth, savePointsStartDate      as unknown as RequestHandler);
router.post('/attendance/recalculate', ...auth, recalculateAttendance    as unknown as RequestHandler);

// ── Dataset monitoring (health dashboard + threshold registry) ────────────────
router.get('/monitoring/health',       ...auth, getMonitoringHealth  as unknown as RequestHandler);
router.get('/monitoring/datasets',     ...auth, listDatasetMonitors  as unknown as RequestHandler);
router.put('/monitoring/datasets/:id', ...auth, updateDatasetMonitor as unknown as RequestHandler);
router.post('/monitoring/run',         ...auth, runMonitoringNow     as unknown as RequestHandler);

export default router;
