/**
 * Shared READ-ONLY CRM access for the per-agent, per-day Insights drill-downs
 * (touch detail, Sales productivity). One short-lived connection per request,
 * with `dateStrings` so CRM DATETIMEs come back as the wall-clock strings the
 * timeline slices ("YYYY-MM-DD HH:MM:SS") instead of being shifted by the driver.
 */
import mysql from 'mysql2/promise';
import { crmDatabaseConfig } from '../../config/environment';

/** Opens a CRM connection; callers must `end()` it. Null when CRM isn't configured. */
export async function openCrmConnection(): Promise<mysql.Connection | null> {
  if (!crmDatabaseConfig) return null;
  return mysql.createConnection({
    host: crmDatabaseConfig.host,
    user: crmDatabaseConfig.user,
    password: crmDatabaseConfig.password,
    database: crmDatabaseConfig.database,
    connectTimeout: 60_000,
    dateStrings: true,
    charset: 'utf8mb4',
  });
}

export interface CrmSalesPerson { userId: number; name: string }

/**
 * Conformed email -> the agent's CRM UserID(s) (my_aspnet_users id, the id the
 * CRM stamps on tblAction.CompletedBy / tblTicketNote.CreatedBy). UserID 12 is
 * the system account and never counts as an agent.
 */
export async function resolveCrmSalesPeople(crm: mysql.Connection, email: string): Promise<CrmSalesPerson[]> {
  const [rows] = await crm.query<mysql.RowDataPacket[]>(
    `SELECT UserID, MAX(SalesPersonName) AS name FROM tblSalesPeople
     WHERE UserID NOT IN (12) AND email IS NOT NULL AND LOWER(TRIM(email)) = ?
     GROUP BY UserID`,
    [email],
  );
  return rows.map((r) => ({ userId: Number(r.UserID), name: (r.name as string) ?? '' }));
}
