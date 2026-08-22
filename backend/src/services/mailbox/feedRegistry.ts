/**
 * The email-delivered data feeds we expect to arrive at the QTIP mailbox.
 *
 * Backed by the `mailbox_import_feed` table — a first-class sibling of the
 * `ie_source_report` registry that drives the SQL Report Schedules. Admins
 * manage the set from Insights > Report Schedules > Email Feeds (add / edit
 * cadence + name / toggle active / delete). Each row names one feed:
 *   - `data_type`     → the import `data_type` the file lands as ("punch_data").
 *                       This is the key that ties the feed to its import_logs
 *                       history and to the manual-upload fallback. Unique.
 *   - `display_name`  → the name shown on Report Schedules ("Paychex Punch Data").
 *   - `cadence_label` → free-text expected-arrival note; display only.
 *
 * A row whose data_type is no longer a known import type is skipped on read
 * rather than shown broken — a stale row should fail quiet, not surface a dead
 * feed. Writes validate the data_type against `DATA_TYPES` up front.
 */

import pool from '../../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { DATA_TYPES, type DataType } from '../importService';
import type { SqlParams } from '../../utils/db/sqlParams';

export const FEED_TABLE = 'mailbox_import_feed';

export interface EmailFeedRecord {
  id: number;
  dataType: DataType;
  name: string;
  cadenceLabel: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface CreateFeedInput {
  dataType: DataType;
  name: string;
  cadenceLabel?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdateFeedInput {
  name?: string;
  cadenceLabel?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

export const isKnownDataType = (value: string): value is DataType =>
  (DATA_TYPES as readonly string[]).includes(value);

function mapRow(r: RowDataPacket): EmailFeedRecord {
  return {
    id: Number(r.id),
    dataType: r.data_type as DataType,
    name: ((r.display_name as string | null) ?? '').trim() || String(r.data_type),
    cadenceLabel: (r.cadence_label as string | null) ?? null,
    isActive: !!r.is_active,
    sortOrder: Number(r.sort_order),
  };
}

/** All feeds in admin sort order. Pass `false` to return only active feeds. */
export async function listFeeds(includeInactive = true): Promise<EmailFeedRecord[]> {
  const where = includeInactive ? '' : 'WHERE is_active = 1';
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM ${FEED_TABLE} ${where} ORDER BY sort_order ASC, display_name ASC`,
  );
  return rows.filter((r) => isKnownDataType(String(r.data_type))).map(mapRow);
}

export async function getFeedById(id: number): Promise<EmailFeedRecord | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM ${FEED_TABLE} WHERE id = ?`,
    [id],
  );
  return rows.length ? mapRow(rows[0]) : null;
}

export async function createFeed(input: CreateFeedInput): Promise<EmailFeedRecord> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO ${FEED_TABLE} (data_type, display_name, cadence_label, is_active, sort_order)
     VALUES (?, ?, ?, ?, ?)`,
    [
      input.dataType,
      input.name,
      input.cadenceLabel ?? null,
      input.isActive === false ? 0 : 1,
      input.sortOrder ?? 0,
    ],
  );
  return (await getFeedById(result.insertId))!;
}

/** Partial update of the editable fields. data_type is immutable (it's the key). */
export async function updateFeed(id: number, patch: UpdateFeedInput): Promise<EmailFeedRecord | null> {
  const fields: string[] = [];
  // Concrete element type (not `unknown[]`) so the array satisfies mysql2's
  // `execute()` values parameter under every @types resolution — the stricter
  // typing surfaced only in the reproducible Docker build, not a local install.
  const values: SqlParams = [];

  if (patch.name !== undefined) { fields.push('display_name = ?'); values.push(patch.name); }
  if (patch.cadenceLabel !== undefined) { fields.push('cadence_label = ?'); values.push(patch.cadenceLabel || null); }
  if (patch.isActive !== undefined) { fields.push('is_active = ?'); values.push(patch.isActive ? 1 : 0); }
  if (patch.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(patch.sortOrder); }

  if (fields.length === 0) return getFeedById(id);

  values.push(id);
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE ${FEED_TABLE} SET ${fields.join(', ')} WHERE id = ?`,
    values,
  );
  return result.affectedRows === 0 ? null : getFeedById(id);
}

export async function deleteFeed(id: number): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>(
    `DELETE FROM ${FEED_TABLE} WHERE id = ?`,
    [id],
  );
  return result.affectedRows > 0;
}
