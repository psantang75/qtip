/**
 * Time agents spend in named Genesys presence statuses, read from the phone DB.
 *
 * Statuses are matched by their label (tblSystemPresence.LabelName), never by
 * presence id — the ids differ per org and change when a status is rebuilt.
 */
import { getDatabasePool } from '../config/database';
import { phoneDatabaseConfig } from '../config/environment';
import { RowDataPacket } from 'mysql2';

/**
 * The after-call work statuses that count toward handle time. The Genesys
 * wrap-up segment on the call is deliberately not one of them; see
 * workers/sql/support_call.extract.sql.
 */
export const AFTER_CALL_STATUSES = ['Wrap Pending', 'Follow-Up Extended'] as const;

/** Genesys guid → seconds in any of `labels`, for spans starting in [dayStart, dayEnd). */
export async function loadPresenceSeconds(
  guids: string[], labels: readonly string[], dayStart: string, dayEnd: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (guids.length === 0 || labels.length === 0 || !phoneDatabaseConfig) return out;
  const [rows] = await getDatabasePool('phone').query<RowDataPacket[]>(
    `SELECT p.UserID AS guid, SUM(TIMESTAMPDIFF(SECOND, p.StartTime_ET, p.EndTime_ET)) AS sec
     FROM tblPrimaryPresence p
     JOIN tblSystemPresence sp ON sp.OrgPresenceID = p.OrgPresenceID
     WHERE p.UserID IN (${guids.map(() => '?').join(',')})
       AND sp.LabelName IN (${labels.map(() => '?').join(',')})
       AND p.StartTime_ET >= ? AND p.StartTime_ET < ? AND p.EndTime_ET IS NOT NULL
     GROUP BY p.UserID`,
    [...guids, ...labels, dayStart, dayEnd],
  );
  rows.forEach((r) => out.set(String(r.guid), Number(r.sec || 0)));
  return out;
}
