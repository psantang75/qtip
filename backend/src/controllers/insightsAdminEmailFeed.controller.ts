import { Request, Response } from 'express';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { mailboxImportConfig } from '../config/environment';
import {
  listFeeds, getFeedById, createFeed, updateFeed, deleteFeed, isKnownDataType,
  type EmailFeedRecord,
} from '../services/mailbox/feedRegistry';
import { importChannel, normalizeImportStatus } from '../services/imports/importLogView';

/**
 * Insights Admin Email Feed controller — CRUD for the `mailbox_import_feed`
 * registry that lists mailbox pickups on the Report Schedules page, next to the
 * SQL source reports (`/api/insights/admin/email-feeds`).
 *
 * Editable fields are `display_name`, `cadence_label` and `is_active`;
 * `data_type` is fixed at create time because it's the key that ties a feed to
 * its import handler and `import_logs` history. There is no per-feed run cadence
 * — one mailbox poller drains every feed on the same interval — so each row's
 * `last_*` state is derived from the most recent `import_logs` row for its
 * data_type rather than stored.
 */

export interface EmailFeedRow {
  id: number;
  data_type: string;
  name: string;
  cadence_label: string | null;
  is_active: boolean;
  poll_minutes: number;
  last_pickup_at: string | null;
  last_source: 'email' | 'manual' | null;
  last_status: string | null;
  last_file: string | null;
  rows_imported: number | null;
  rows_skipped: number | null;
  rows_errored: number | null;
}

/** Join one feed record to its most recent import to build the UI DTO. */
async function toRow(feed: EmailFeedRecord): Promise<EmailFeedRow> {
  const last = await prisma.importLog.findFirst({
    where: { data_type: feed.dataType },
    orderBy: { created_at: 'desc' },
  });
  return {
    id: feed.id,
    data_type: feed.dataType,
    name: feed.name,
    cadence_label: feed.cadenceLabel,
    is_active: feed.isActive,
    poll_minutes: mailboxImportConfig.pollMinutes,
    last_pickup_at: last ? last.created_at.toISOString() : null,
    last_source: last ? importChannel(last.error_details) : null,
    last_status: last ? normalizeImportStatus(last.status) : null,
    last_file: last?.file_name ?? null,
    rows_imported: last?.rows_imported ?? null,
    rows_skipped: last?.rows_skipped ?? null,
    rows_errored: last?.rows_errored ?? null,
  };
}

/**
 * GET /api/insights/admin/email-feeds
 * Every feed (active and inactive), each joined to its most recent import.
 */
export const listEmailFeeds = async (_req: Request, res: Response): Promise<void> => {
  try {
    const feeds = await listFeeds(true);
    const rows = await Promise.all(feeds.map(toRow));
    res.json(rows);
  } catch (error) {
    logger.error('listEmailFeeds error:', error);
    res.status(500).json({ error: 'Failed to list email feeds' });
  }
};

/**
 * POST /api/insights/admin/email-feeds
 * Body: { data_type, name, cadence_label?, is_active? }
 */
export const createEmailFeed = async (req: Request, res: Response): Promise<void> => {
  try {
    const dataType = String(req.body.data_type ?? '').trim();
    const name = String(req.body.name ?? '').trim();
    const cadenceLabel = req.body.cadence_label != null ? String(req.body.cadence_label).trim() : null;

    if (!isKnownDataType(dataType)) { res.status(400).json({ error: 'Unknown data_type' }); return; }
    if (!name) { res.status(400).json({ error: 'name is required' }); return; }

    const created = await createFeed({
      dataType,
      name,
      cadenceLabel: cadenceLabel || null,
      isActive: req.body.is_active !== false,
    });
    res.status(201).json(await toRow(created));
  } catch (error) {
    if ((error as { code?: string })?.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'A feed already exists for this data type' });
      return;
    }
    logger.error('createEmailFeed error:', error);
    res.status(500).json({ error: 'Failed to create email feed' });
  }
};

/**
 * PUT /api/insights/admin/email-feeds/:id
 * Updates name / cadence_label / is_active. Partial: send any subset.
 */
export const updateEmailFeed = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid feed id' }); return; }

    const patch: { name?: string; cadenceLabel?: string | null; isActive?: boolean } = {};
    if (req.body.name !== undefined) {
      const n = String(req.body.name).trim();
      if (!n) { res.status(400).json({ error: 'name cannot be blank' }); return; }
      patch.name = n;
    }
    if (req.body.cadence_label !== undefined) {
      patch.cadenceLabel = req.body.cadence_label ? String(req.body.cadence_label).trim() : null;
    }
    if (req.body.is_active !== undefined) patch.isActive = !!req.body.is_active;

    const existing = await getFeedById(id);
    if (!existing) { res.status(404).json({ error: 'Feed not found' }); return; }

    const updated = await updateFeed(id, patch);
    res.json(await toRow(updated!));
  } catch (error) {
    logger.error('updateEmailFeed error:', error);
    res.status(500).json({ error: 'Failed to update email feed' });
  }
};

/**
 * DELETE /api/insights/admin/email-feeds/:id
 */
export const deleteEmailFeed = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid feed id' }); return; }

    const ok = await deleteFeed(id);
    if (!ok) { res.status(404).json({ error: 'Feed not found' }); return; }
    res.status(204).end();
  } catch (error) {
    logger.error('deleteEmailFeed error:', error);
    res.status(500).json({ error: 'Failed to delete email feed' });
  }
};
