/**
 * phonePresenceProvider — the PHONE side of adherence. Reads the Genesys
 * primary-presence Break and Meal spans and returns them per user per day so the
 * engine can compare when the phone went (and stayed) on Break/Meal against when
 * the agent actually punched.
 *
 * The Genesys DB is a separate MySQL instance, not Prisma-modeled, so it is read
 * through the raw phone pool exactly like the Productivity services. Identity
 * conforms on email: app user_id → users.email → tblPhoneUser.PhoneUserID.
 *
 * DEGRADES SAFELY. When the phone DB is not configured (dev/test), or an agent
 * has no phone identity, that user's phone spans are simply empty and the engine
 * scores no phone occurrences for them — never a stub, never a false positive.
 *
 * Times are returned as SECONDS FROM LOCAL (ET) MIDNIGHT. Genesys *_ET columns
 * already carry ET wall clock and the punch process is pinned to ET, so both
 * sides compare on the same wall clock without any timezone conversion.
 */
import prisma from '../../config/prisma';
import { getDatabasePool } from '../../config/database';
import { phoneDatabaseConfig } from '../../config/environment';
import { RowDataPacket } from 'mysql2';

export interface PhoneSpan {
  startSec: number;
  endSec: number;
}

export interface PhonePresence {
  breaks: PhoneSpan[];
  lunches: PhoneSpan[];
}

const key = (userId: number, dateStr: string) => `${userId}:${dateStr}`;
const phonePool = () => getDatabasePool('phone');

function nextDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** app user_id → lowercased email, for the users we can identify. */
async function loadEmails(userIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (userIds.length === 0) return out;
  const rows = await prisma.user.findMany({
    where: { id: { in: userIds }, email: { not: '' } },
    select: { id: true, email: true },
  });
  for (const r of rows) {
    if (r.email) out.set(r.id, r.email.trim().toLowerCase());
  }
  return out;
}

/** email → Genesys PhoneUserID (GUID), bulk. Empty when the phone DB is off. */
async function loadGuidMap(emails: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (emails.length === 0 || !phoneDatabaseConfig) return out;
  const [rows] = await phonePool().query<RowDataPacket[]>(
    `SELECT LOWER(TRIM(Email)) AS email, PhoneUserID AS guid
       FROM tblPhoneUser WHERE LOWER(TRIM(Email)) IN (${emails.map(() => '?').join(',')})`,
    emails,
  );
  rows.forEach((r) => out.set(String(r.email), String(r.guid)));
  return out;
}

/**
 * Break and Meal presence spans per user per day for the range, keyed
 * `${userId}:${YYYY-MM-DD}`. Absent users (no phone identity / phone DB off) do
 * not appear in the map, which the engine reads as "no phone data" rather than
 * "compliant".
 */
export async function getPhonePresence(
  userIds: number[],
  fromStr: string,
  toStr: string,
): Promise<Map<string, PhonePresence>> {
  const out = new Map<string, PhonePresence>();
  if (userIds.length === 0 || !phoneDatabaseConfig) return out;

  const emailByUser = await loadEmails(userIds);
  const emails = [...new Set([...emailByUser.values()])];
  const guidByEmail = await loadGuidMap(emails);

  // guid → userId, and the guids to actually query.
  const userByGuid = new Map<string, number>();
  for (const [uid, email] of emailByUser) {
    const guid = guidByEmail.get(email);
    if (guid) userByGuid.set(guid, uid);
  }
  const guids = [...userByGuid.keys()];
  if (guids.length === 0) return out;

  const [rows] = await phonePool().query<RowDataPacket[]>(
    `SELECT p.UserID AS guid,
            DATE_FORMAT(p.StartTime_ET, '%Y-%m-%d') AS workDate,
            TIME_TO_SEC(p.StartTime_ET) AS startSec,
            TIME_TO_SEC(p.EndTime_ET) AS endSec,
            COALESCE(sp.LabelName, p.PresenceStatus) AS status
       FROM tblPrimaryPresence p
       LEFT JOIN tblSystemPresence sp ON sp.OrgPresenceID = p.OrgPresenceID
      WHERE p.UserID IN (${guids.map(() => '?').join(',')})
        AND p.StartTime_ET >= ? AND p.StartTime_ET < ?
        AND p.EndTime_ET IS NOT NULL
        AND COALESCE(sp.LabelName, p.PresenceStatus) IN ('Break', 'Meal')
      ORDER BY p.StartTime_ET`,
    [...guids, `${fromStr} 00:00:00`, `${nextDate(toStr)} 00:00:00`],
  );

  for (const r of rows) {
    const uid = userByGuid.get(String(r.guid));
    if (uid == null) continue;
    const dateStr = String(r.workDate);
    const startSec = Number(r.startSec);
    const endSec = Number(r.endSec);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) continue;

    const k = key(uid, dateStr);
    const slot = out.get(k) ?? { breaks: [], lunches: [] };
    if (String(r.status) === 'Break') slot.breaks.push({ startSec, endSec });
    else slot.lunches.push({ startSec, endSec });
    out.set(k, slot);
  }

  return out;
}
