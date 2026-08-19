import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { asyncHandler } from '../utils/errorHandler';
import {
  importChannel, importDetailMessage, normalizeImportStatus, type IngestionChannel,
} from '../services/imports/importLogView';

/**
 * Unified ingestion feed for Admin > Insights > Ingestion Log.
 *
 * Two ingestion systems land here as one list:
 *   - `sql`  — Insights Engine SQL pipeline runs (`ie_ingestion_log`)
 *   - `email`/`manual` — Excel imports (`import_logs`), split by whether the
 *     mailbox poller stamped the row (see imports/runImport `stampSource`).
 *
 * Both are normalized onto one row shape and one status vocabulary so a single
 * channel/status filter and one set of badges cover everything.
 */

export interface UnifiedIngestionRow {
  id: string;
  channel: IngestionChannel;
  name: string;
  source: string;
  started: string;
  finished: string | null;
  status: string;
  rows_loaded: number | null;
  rows_skipped: number | null;
  rows_errored: number | null;
  error_message: string | null;
}

function clampLimit(raw: unknown): number {
  if (raw === undefined || raw === '') return 200;
  const n = parseInt(String(raw), 10);
  if (Number.isNaN(n)) return 200;
  return Math.min(500, Math.max(1, n));
}

/**
 * GET /api/insights/admin/ingestion-log
 * Query: channel=all|sql|email|manual, status=all|SUCCESS|FAILED|RUNNING|PARTIAL,
 *        worker=<ie worker_name> (SQL channel only), limit=1..500
 */
export const getIngestionLog = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const channel = (req.query.channel as string) || 'all';
  const status = (req.query.status as string) || 'all';
  const worker = (req.query.worker as string) || 'all';
  const limit = clampLimit(req.query.limit);

  const rows: UnifiedIngestionRow[] = [];

  // ── SQL pipeline (ie_ingestion_log) ──────────────────────────────────────
  if (channel === 'all' || channel === 'sql') {
    const ieRows = await prisma.ieIngestionLog.findMany({
      where: worker && worker !== 'all' ? { worker_name: worker } : undefined,
      orderBy: { run_started_at: 'desc' },
      take: limit,
    });
    for (const r of ieRows) {
      rows.push({
        id: `ie-${r.id}`,
        channel: 'sql',
        name: r.worker_name,
        source: r.source_system,
        started: r.run_started_at.toISOString(),
        finished: r.run_finished_at ? r.run_finished_at.toISOString() : null,
        status: r.status,
        rows_loaded: r.rows_loaded ?? null,
        rows_skipped: r.rows_skipped ?? null,
        rows_errored: r.rows_errored ?? null,
        error_message: r.error_message ?? null,
      });
    }
  }

  // ── Excel imports (import_logs) — email + manual ─────────────────────────
  if (channel === 'all' || channel === 'email' || channel === 'manual') {
    const logs = await prisma.importLog.findMany({
      orderBy: { created_at: 'desc' },
      take: limit,
      include: { importer: { select: { username: true } } },
    });
    for (const log of logs) {
      const ch = importChannel(log.error_details);
      if (channel === 'email' && ch !== 'email') continue;
      if (channel === 'manual' && ch !== 'manual') continue;

      const details = log.error_details as { from?: string } | null;
      const when = log.created_at.toISOString();
      rows.push({
        id: `imp-${log.id}`,
        channel: ch,
        name: log.data_type,
        source: ch === 'email'
          ? (details?.from ?? 'mailbox')
          : (log.importer?.username ?? 'manual'),
        started: when,
        finished: when, // Excel imports run synchronously; no separate finish time.
        status: normalizeImportStatus(log.status),
        rows_loaded: log.rows_imported,
        rows_skipped: log.rows_skipped,
        rows_errored: log.rows_errored,
        error_message: log.status === 'FAILED' ? importDetailMessage(log.error_details) : null,
      });
    }
  }

  const filtered = status !== 'all' ? rows.filter(r => r.status === status) : rows;
  filtered.sort((a, b) => (a.started < b.started ? 1 : a.started > b.started ? -1 : 0));

  res.json(filtered.slice(0, limit));
});
