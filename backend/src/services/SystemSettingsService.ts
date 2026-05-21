/**
 * Thin typed wrapper around the existing `ie_config` KV table for the
 * KB Index Scheduler's three persisted keys. We intentionally reuse
 * `ie_config` instead of adding a new `system_settings` / `app_kv`
 * table — the workspace rule is "never add tables or alter a
 * database" and `ie_config` is already a string-typed KV with an
 * `updated_at` column we get for free.
 *
 * Keys owned by this module (all prefixed `kb_index.` so future hub
 * cards can claim their own prefix without collision):
 *
 *   kb_index.interval_min       string-encoded int, default 60, range 5..1440
 *   kb_index.last_run_json      JSON of CrawlSummary + ran_at ISO timestamp
 *   kb_index.recent_runs_json   JSON array (capped to 20) of the above
 *
 * All getters tolerate missing rows + malformed JSON and return the
 * documented default — the scheduler must never crash because of a
 * bad config row.
 */

import prisma from '../config/prisma';
import logger from '../config/logger';
import type { CrawlSummary } from './KbIndexService';

const KB_INTERVAL_KEY = 'kb_index.interval_min';
const KB_LAST_RUN_KEY = 'kb_index.last_run_json';
const KB_RECENT_RUNS_KEY = 'kb_index.recent_runs_json';

/** Default tick cadence when the row is missing or unparseable. */
export const KB_DEFAULT_INTERVAL_MIN = 60;
/** Lower bound on the interval to avoid hammering BookStack accidentally. */
export const KB_MIN_INTERVAL_MIN = 5;
/** Upper bound — a full day; anything longer becomes effectively "off". */
export const KB_MAX_INTERVAL_MIN = 1440;
/** Cap on how many historical runs we surface back to the admin UI. */
export const KB_RECENT_RUNS_CAP = 20;

export interface KbIndexRunRecord extends CrawlSummary {
  ran_at: string;
  triggered_by: 'scheduler' | 'manual' | 'boot';
}

export interface KbIndexSettings {
  interval_min: number;
  last_run: KbIndexRunRecord | null;
  recent_runs: KbIndexRunRecord[];
}

async function getValue(key: string): Promise<string | null> {
  const row = await prisma.ieConfig.findUnique({ where: { config_key: key } });
  return row?.config_value ?? null;
}

async function setValue(key: string, value: string, description?: string): Promise<void> {
  await prisma.ieConfig.upsert({
    where: { config_key: key },
    create: { config_key: key, config_value: value, description: description ?? null },
    update: { config_value: value },
  });
}

/**
 * Read the configured interval in minutes. Clamps to the documented
 * range and falls back to the default when the row is missing or
 * unparseable so the scheduler always has a sane tick value.
 */
export async function getKbIndexIntervalMin(): Promise<number> {
  const raw = await getValue(KB_INTERVAL_KEY);
  if (!raw) return KB_DEFAULT_INTERVAL_MIN;
  const n = Number(raw);
  if (!Number.isFinite(n)) return KB_DEFAULT_INTERVAL_MIN;
  return clampInterval(Math.round(n));
}

/**
 * Persist a new interval value. Returns the value actually stored
 * (after clamping) so callers can echo it back to the UI without a
 * second round-trip.
 */
export async function setKbIndexIntervalMin(minutes: number): Promise<number> {
  const clamped = clampInterval(Math.round(minutes));
  await setValue(
    KB_INTERVAL_KEY,
    String(clamped),
    'KB Index Scheduler tick interval (minutes). Range 5..1440; default 60.'
  );
  return clamped;
}

function clampInterval(n: number): number {
  if (!Number.isFinite(n)) return KB_DEFAULT_INTERVAL_MIN;
  if (n < KB_MIN_INTERVAL_MIN) return KB_MIN_INTERVAL_MIN;
  if (n > KB_MAX_INTERVAL_MIN) return KB_MAX_INTERVAL_MIN;
  return n;
}

export async function getKbIndexLastRun(): Promise<KbIndexRunRecord | null> {
  const raw = await getValue(KB_LAST_RUN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as KbIndexRunRecord;
  } catch (err) {
    logger.warn(`[SystemSettings] kb_index.last_run_json unparseable: ${(err as Error).message}`);
    return null;
  }
}

export async function getKbIndexRecentRuns(): Promise<KbIndexRunRecord[]> {
  const raw = await getValue(KB_RECENT_RUNS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as KbIndexRunRecord[];
  } catch (err) {
    logger.warn(`[SystemSettings] kb_index.recent_runs_json unparseable: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Append a run record to both the last-run slot and the recent-runs
 * array (capped, newest first). Called by both the scheduler tick and
 * the manual "Run now" button so the UI sees the same history
 * regardless of which path triggered the crawl.
 */
export async function recordKbIndexRun(record: KbIndexRunRecord): Promise<void> {
  const recent = await getKbIndexRecentRuns();
  const next = [record, ...recent].slice(0, KB_RECENT_RUNS_CAP);
  await setValue(
    KB_LAST_RUN_KEY,
    JSON.stringify(record),
    'Last KB Index Scheduler crawl summary (JSON).'
  );
  await setValue(
    KB_RECENT_RUNS_KEY,
    JSON.stringify(next),
    `Recent KB Index Scheduler crawl summaries (JSON, capped at ${KB_RECENT_RUNS_CAP}).`
  );
}

/** Composite getter used by the admin GET endpoint. */
export async function getKbIndexSettings(): Promise<KbIndexSettings> {
  const [interval_min, last_run, recent_runs] = await Promise.all([
    getKbIndexIntervalMin(),
    getKbIndexLastRun(),
    getKbIndexRecentRuns(),
  ]);
  return { interval_min, last_run, recent_runs };
}
