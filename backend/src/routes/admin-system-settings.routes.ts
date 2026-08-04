/**
 * Admin-only system settings routes. Today the only consumer is the
 * KB Index Scheduler card on /app/admin/system-settings — but the
 * route prefix is intentionally generic so future scheduler /
 * platform-level config UIs slot in here instead of growing yet
 * another /api/admin/<one-off> mount.
 *
 * Mounted at /api/admin/system-settings in index.ts.
 *
 *   GET   /kb-scheduler            -> { interval_min, last_run, recent_runs }
 *   PATCH /kb-scheduler            -> body { interval_min }; clamps 5..1440
 *   POST  /kb-scheduler/run-now    -> 202 { started_at } (async run)
 *   GET   /unlock                  -> { window_days, relock_days, max_per_record }
 *   PATCH /unlock                  -> any subset of the above; each clamped
 *
 * All routes require an authenticated admin (RBAC enforced by the
 * existing `authorizeAdmin` middleware — same one /api/admin/* uses).
 */

import express, { RequestHandler } from 'express';
import { authenticate, authorizeAdmin } from '../middleware/auth';
import logger from '../config/logger';
import {
  getKbIndexSettings,
  setKbIndexIntervalMin,
  KB_MIN_INTERVAL_MIN,
  KB_MAX_INTERVAL_MIN,
} from '../services/SystemSettingsService';
import { runKbIndexNow } from '../services/KbIndexScheduler';
import { getUnlockSettings, setUnlockSettings } from '../services/unlock/unlock.config';

const router = express.Router();

router.use(authenticate as unknown as RequestHandler);
router.use(authorizeAdmin as unknown as RequestHandler);

router.get('/kb-scheduler', async (_req, res) => {
  try {
    const settings = await getKbIndexSettings();
    res.json(settings);
  } catch (err) {
    logger.error(`[admin-system-settings] GET /kb-scheduler failed: ${(err as Error).message}`);
    res.status(500).json({ error: 'Failed to load KB scheduler settings' });
  }
});

router.patch('/kb-scheduler', async (req, res) => {
  const body = req.body ?? {};
  const raw = body.interval_min;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    res.status(400).json({
      error: 'interval_min must be a number',
      min: KB_MIN_INTERVAL_MIN,
      max: KB_MAX_INTERVAL_MIN,
    });
    return;
  }
  try {
    const stored = await setKbIndexIntervalMin(n);
    res.json({ interval_min: stored });
  } catch (err) {
    logger.error(`[admin-system-settings] PATCH /kb-scheduler failed: ${(err as Error).message}`);
    res.status(500).json({ error: 'Failed to update KB scheduler interval' });
  }
});

router.post('/kb-scheduler/run-now', async (_req, res) => {
  // Kick off the crawl in the background; respond 202 immediately so
  // the UI's "Run now" button doesn't block on a multi-minute crawl.
  // The next GET will surface the result via last_run / recent_runs
  // when it completes. Errors during the async run are recorded into
  // the run history by `runKbIndexNow` itself.
  const started_at = new Date().toISOString();
  void runKbIndexNow().catch((err) => {
    logger.error(`[admin-system-settings] run-now failed: ${(err as Error).message}`);
  });
  res.status(202).json({ started_at });
});

router.get('/unlock', async (_req, res) => {
  try {
    res.json(await getUnlockSettings());
  } catch (err) {
    logger.error(`[admin-system-settings] GET /unlock failed: ${(err as Error).message}`);
    res.status(500).json({ error: 'Failed to load unlock settings' });
  }
});

router.patch('/unlock', async (req, res) => {
  const body = req.body ?? {};
  const patch: Record<string, number> = {};
  for (const key of ['window_days', 'relock_days', 'max_per_record'] as const) {
    if (body[key] === undefined) continue;
    const n = Number(body[key]);
    if (!Number.isFinite(n)) {
      res.status(400).json({ error: `${key} must be a number` });
      return;
    }
    patch[key] = n;
  }
  try {
    res.json(await setUnlockSettings(patch));
  } catch (err) {
    logger.error(`[admin-system-settings] PATCH /unlock failed: ${(err as Error).message}`);
    res.status(500).json({ error: 'Failed to update unlock settings' });
  }
});

export default router;
