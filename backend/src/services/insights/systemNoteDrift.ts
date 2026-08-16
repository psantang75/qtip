/**
 * Weekly drift monitor for the system-note classifier.
 *
 * The Touched metric excludes machine-written CRM notes using a hand-curated
 * pattern list (systemNoteClassifier). The CRM has no source flag yet, so new
 * automated note templates can appear at any time and silently re-inflate
 * Touched. This read-only pass surfaces them BEFORE they do damage:
 *
 *   1. Over the last 7 days, group every note the classifier did NOT match by
 *      its normalized prefix and keep the HIGH-FREQUENCY ones. Genuine human
 *      notes are diverse (low per-prefix counts); a new system template repeats,
 *      so a high-count unmatched prefix is a strong "new stamp" signal.
 *   2. Optionally ask the configured AI model to label each candidate
 *      system-vs-human and draft a LIKE pattern (human-in-the-loop only — the AI
 *      never edits the live metric).
 *   3. Email the shortlist to the insights alert recipients via the existing
 *      NotificationService so a person can review and add patterns via PR.
 *
 * Hosted inside the existing RollupWorker cycle and gated to once per 7 days via
 * an ie_config marker, so no new table and no new scheduler are required. Never
 * throws — a monitor failure must not break the rollup.
 */
import mysql from 'mysql2/promise';
import pool from '../../config/database';
import { RowDataPacket } from 'mysql2';
import { crmDatabaseConfig } from '../../config/environment';
import { aiConfig } from '../../config/ai';
import logger from '../../config/logger';
import notificationService from '../notifications/NotificationService';
import { callChatModel, type ModelProvider } from '../ai/ChatModelClient';
import { buildSystemNoteExclusionSql } from './systemNoteClassifier';

const SERVICE = 'systemNoteDrift';
/** ie_config marker holding the last scan date (YYYY-MM-DD). */
const DRIFT_LAST_RUN_KEY = 'system_note_drift_last_run';
const LOOKBACK_DAYS = 7;
/** Normalized-prefix length used to bucket notes. */
const PREFIX_LEN = 48;
/** Only surface a prefix seen at least this many times in the window. */
const MIN_COUNT = 25;
/** Cap the shortlist so the email + AI call stay small. */
const TOP_N = 20;

export interface DriftCandidate {
  source: 'Task' | 'Ticket';
  prefix: string;
  count: number;
  aiLabel?: 'system' | 'human' | 'unsure';
  aiSuggestion?: string;
}

export interface DriftScanResult {
  ran: boolean;
  reason: string;
  candidates: number;
}

/** YYYY-MM-DD in UTC (marker granularity is a day; weekly gate is 7-day math). */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** True when the last run is missing or >= LOOKBACK_DAYS ago. */
async function isDue(now: Date): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT config_value FROM ie_config WHERE config_key = ?`, [DRIFT_LAST_RUN_KEY],
  );
  const last = rows[0]?.config_value as string | undefined;
  if (!last) return true;
  const lastMs = Date.parse(`${last}T00:00:00Z`);
  if (Number.isNaN(lastMs)) return true;
  return now.getTime() - lastMs >= LOOKBACK_DAYS * 86_400_000;
}

async function markRun(now: Date): Promise<void> {
  await pool.query(
    `INSERT INTO ie_config (config_key, config_value, description)
     VALUES (?, ?, 'Last date the Touched system-note drift monitor ran (YYYY-MM-DD).')
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
    [DRIFT_LAST_RUN_KEY, ymd(now)],
  );
}

/** Group unmatched notes by normalized prefix over the lookback window. */
async function findCandidates(crm: mysql.Connection, cutoff: string): Promise<DriftCandidate[]> {
  const keepHumanTask = buildSystemNoteExclusionSql('a.Note');
  const taskSql = `
    SELECT LEFT(LOWER(TRIM(a.Note)), ${PREFIX_LEN}) AS prefix, COUNT(*) AS n
    FROM tblAction a
      JOIN tblTask t      ON t.TaskID = a.TaskID
      JOIN tblTaskType tt ON tt.TaskTypeID = t.TaskTypeID AND tt.DeptID IN (1,2)
    WHERE t.TaskTypeID <> 19 AND a.Note <> '' AND a.CompletedBy IS NOT NULL
      AND a.CompletedOn >= ? AND ${keepHumanTask}
    GROUP BY prefix
    HAVING n >= ${MIN_COUNT}
    ORDER BY n DESC
    LIMIT ${TOP_N}`;

  const keepHumanTicket = buildSystemNoteExclusionSql('tn.Note');
  const ticketSql = `
    SELECT LEFT(LOWER(TRIM(tn.Note)), ${PREFIX_LEN}) AS prefix, COUNT(*) AS n
    FROM tblTicketNote tn
    WHERE tn.Note <> '' AND tn.CreatedBy IS NOT NULL
      AND tn.CreatedOn >= ? AND ${keepHumanTicket}
    GROUP BY prefix
    HAVING n >= ${MIN_COUNT}
    ORDER BY n DESC
    LIMIT ${TOP_N}`;

  const [taskRows] = await crm.query<mysql.RowDataPacket[]>(taskSql, [cutoff]);
  const [ticketRows] = await crm.query<mysql.RowDataPacket[]>(ticketSql, [cutoff]);
  const out: DriftCandidate[] = [
    ...taskRows.map((r) => ({ source: 'Task' as const, prefix: String(r.prefix ?? '').trim(), count: Number(r.n) })),
    ...ticketRows.map((r) => ({ source: 'Ticket' as const, prefix: String(r.prefix ?? '').trim(), count: Number(r.n) })),
  ].filter((c) => c.prefix.length > 0);
  out.sort((a, b) => b.count - a.count);
  return out.slice(0, TOP_N);
}

/** Pick the first configured provider, or null when AI isn't set up. */
function resolveProvider(): ModelProvider | null {
  if (aiConfig.openai) return 'openai';
  if (aiConfig.anthropic) return 'anthropic';
  return null;
}

/**
 * Ask the configured model to label each candidate system-vs-human and draft a
 * LIKE pattern. Best-effort: on any failure the candidates are returned as-is so
 * the email still goes out (human-in-the-loop; AI is advisory only).
 */
async function annotateWithAi(candidates: DriftCandidate[]): Promise<DriftCandidate[]> {
  const provider = resolveProvider();
  if (!provider || candidates.length === 0) return candidates;
  const system =
    'You triage customer-CRM note prefixes for a productivity metric. For each prefix decide if it is a ' +
    'MACHINE-generated stamp (status change, auto-close, queue plumbing, record creation) or a HUMAN work note. ' +
    'Respond with ONLY a JSON object {"items":[{"prefix":"...","label":"system|human|unsure","pattern":"lowercase MySQL LIKE pattern or empty"}]}. ' +
    'A pattern should anchor the machine phrase and end with % (e.g. "created invoice task%"); leave it empty for human notes.';
  const user = JSON.stringify({ prefixes: candidates.map((c) => ({ source: c.source, prefix: c.prefix, count: c.count })) });
  try {
    const res = await callChatModel(provider, { system, user, maxTokens: 1200, responseFormat: 'json_object', timeoutMs: 60_000 });
    const parsed = JSON.parse(res.text) as { items?: Array<{ prefix?: string; label?: string; pattern?: string }> };
    const byPrefix = new Map<string, { label?: string; pattern?: string }>();
    for (const it of parsed.items ?? []) {
      if (it.prefix) byPrefix.set(it.prefix.trim().toLowerCase(), { label: it.label, pattern: it.pattern });
    }
    return candidates.map((c) => {
      const hit = byPrefix.get(c.prefix.toLowerCase());
      const label = hit?.label === 'system' || hit?.label === 'human' ? hit.label : 'unsure';
      return { ...c, aiLabel: label, aiSuggestion: hit?.pattern?.trim() || undefined };
    });
  } catch (err) {
    logger.warn('[systemNoteDrift] AI annotation failed; sending raw candidates', { service: SERVICE, error: (err as Error)?.message });
    return candidates;
  }
}

/**
 * Run the weekly drift scan. Safe to call on every rollup — it self-gates to
 * once per 7 days and no-ops (returning a reason) when not due or unconfigured.
 */
export async function runSystemNoteDriftScan(now: Date = new Date()): Promise<DriftScanResult> {
  try {
    if (!crmDatabaseConfig) return { ran: false, reason: 'no-crm-config', candidates: 0 };
    if (!(await isDue(now))) return { ran: false, reason: 'not-due', candidates: 0 };

    const cutoff = ymd(new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000));
    const crm = await mysql.createConnection({
      host: crmDatabaseConfig.host,
      user: crmDatabaseConfig.user,
      password: crmDatabaseConfig.password,
      database: crmDatabaseConfig.database,
      connectTimeout: 60_000,
      dateStrings: true,
      charset: 'utf8mb4',
    });
    let candidates: DriftCandidate[] = [];
    try {
      candidates = await findCandidates(crm, `${cutoff} 00:00:00`);
    } finally {
      await crm.end().catch(() => { /* socket already gone */ });
    }

    // Mark the run even when nothing surfaced, so a clean week doesn't re-scan
    // the CRM every 30 minutes.
    await markRun(now);
    if (candidates.length === 0) {
      logger.info('[systemNoteDrift] no high-frequency unmatched note prefixes', { service: SERVICE });
      return { ran: true, reason: 'no-candidates', candidates: 0 };
    }

    const annotated = await annotateWithAi(candidates);
    await notificationService.notify(
      'system.note_drift',
      {
        generatedAt: now.toISOString(),
        lookbackDays: LOOKBACK_DAYS,
        candidateCount: annotated.length,
        aiEnabled: resolveProvider() !== null,
        candidates: annotated,
      },
      { entityType: 'system_note_drift', entityId: `drift:${ymd(now)}`, deepLinkPath: '/app/admin/email-templates' },
    );
    logger.info('[systemNoteDrift] emailed drift candidates', { service: SERVICE, candidates: annotated.length });
    return { ran: true, reason: 'ok', candidates: annotated.length };
  } catch (err) {
    logger.error('[systemNoteDrift] scan failed', { service: SERVICE, error: (err as Error)?.message });
    return { ran: false, reason: `error:${(err as Error)?.message?.slice(0, 60) ?? 'unknown'}`, candidates: 0 };
  }
}
