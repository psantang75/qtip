/**
 * Insights → Productivity: the Desk Utilization inputs for the day roster.
 *
 *   Desk Utilization = (productive desk time + Genesys "In Warehouse" time) / paid time
 *
 *   productive desk time → ie_fact_desktime_daily.productive_sec (DeskTimeSyncWorker),
 *                          falling back to the live DeskTime API for unsynced days
 *   In Warehouse time    → Genesys tblPrimaryPresence spans labelled "In Warehouse"
 *                          (an org label under the Busy system presence)
 *   paid time            → punch_raw Work + Break (the roster's clockedMin)
 *
 * The two are added, not merged on a timeline: DeskTime only exposes a daily
 * total, so time an agent was both at the computer and in warehouse status can
 * count twice. The tooltip shows both parts so that is visible to the reader.
 */
import pool, { getDatabasePool } from '../config/database';
import { phoneDatabaseConfig } from '../config/environment';
import { RowDataPacket } from 'mysql2';
import { deskTimeService } from './desktime/DeskTimeService';

const WAREHOUSE_PRESENCE_LABEL = 'In Warehouse';

export interface DeskInputs {
  /** email → productive desk minutes; `null` when DeskTime is unavailable. */
  deskMinByEmail: Map<string, number> | null;
  /** Genesys guid → In Warehouse minutes. */
  warehouseMinByGuid: Map<string, number>;
}

async function loadWarehouseMinutes(guids: string[], dayStart: string, dayEnd: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (guids.length === 0 || !phoneDatabaseConfig) return out;
  const [rows] = await getDatabasePool('phone').query<RowDataPacket[]>(
    `SELECT p.UserID AS guid, SUM(TIMESTAMPDIFF(SECOND, p.StartTime_ET, p.EndTime_ET)) AS sec
     FROM tblPrimaryPresence p
     JOIN tblSystemPresence sp ON sp.OrgPresenceID = p.OrgPresenceID
     WHERE p.UserID IN (${guids.map(() => '?').join(',')})
       AND sp.LabelName = ?
       AND p.StartTime_ET >= ? AND p.StartTime_ET < ? AND p.EndTime_ET IS NOT NULL
     GROUP BY p.UserID`,
    [...guids, WAREHOUSE_PRESENCE_LABEL, dayStart, dayEnd],
  );
  rows.forEach((r) => out.set(String(r.guid), Number(r.sec || 0) / 60));
  return out;
}

/** Stored productive seconds for the day, or `null` when the sync has not loaded it. */
async function loadStoredProductive(date: string): Promise<Map<string, number> | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT agent_email AS email, SUM(productive_sec) AS sec
     FROM ie_fact_desktime_daily WHERE date_key = ? GROUP BY agent_email`,
    [Number(date.replace(/-/g, ''))],
  );
  if (rows.length === 0) return null;
  return new Map(rows.map((r) => [String(r.email), Number(r.sec || 0)]));
}

/** ie_fact_desktime_daily first (Report Schedules' DeskTime Activity row); live DeskTime for days not yet stored. */
async function loadProductiveSeconds(date: string): Promise<Map<string, number> | null> {
  return (await loadStoredProductive(date)) ?? deskTimeService.getProductiveSecondsByEmail(date);
}

export async function loadDeskInputs(guids: string[], date: string, dayStart: string, dayEnd: string): Promise<DeskInputs> {
  const [productive, warehouseMinByGuid] = await Promise.all([
    loadProductiveSeconds(date),
    loadWarehouseMinutes(guids, dayStart, dayEnd),
  ]);
  const deskMinByEmail = productive
    ? new Map([...productive].map(([email, sec]) => [email, sec / 60] as [string, number]))
    : null;
  return { deskMinByEmail, warehouseMinByGuid };
}

export interface DeskRowFields {
  /** Productive DeskTime minutes; `null` when the agent has no DeskTime data. */
  deskProductiveMin: number | null;
  warehouseMin: number;
  /** `null` when the desk half is unknown — never reported as 0%. */
  deskUtilizationPct: number | null;
}

/** The roster row's desk fields for one agent. */
export function deskFieldsFor(inputs: DeskInputs, email: string, guid: string | undefined, paidMin: number): DeskRowFields {
  const deskMin = inputs.deskMinByEmail?.get(email);
  const warehouseMin = guid ? inputs.warehouseMinByGuid.get(guid) ?? 0 : 0;
  if (deskMin == null) {
    return { deskProductiveMin: null, warehouseMin: Math.round(warehouseMin), deskUtilizationPct: null };
  }
  return {
    deskProductiveMin: Math.round(deskMin),
    warehouseMin: Math.round(warehouseMin),
    deskUtilizationPct: paidMin > 0 ? Math.round(((deskMin + warehouseMin) / paidMin) * 100) : 0,
  };
}
