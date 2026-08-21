/**
 * Insights → Productivity: live single-day roster.
 *
 * One row per in-scope agent for ONE day, aggregated live from the same sources
 * the drill-down reads (so a collapsed roster row never disagrees with the tiles
 * that open beneath it). The report is day-scoped, so per-day live group-bys are
 * the right cost profile — not a warehoused daily fact.
 *
 *   paid time  → punch_raw (Work + Break)
 *   queue/occupancy → Genesys routing status
 *   calls / AHT / missed → Genesys conversations + segments
 *   tickets touched → ie_ticket_task_productivity_daily (the stored Workload count)
 *
 * Scope mirrors the other Agent Activity readers: CSR role, area decided by the
 * "Sales Department - All" department subtree.
 */
import pool from '../config/database';
import { getDatabasePool } from '../config/database';
import { phoneDatabaseConfig } from '../config/environment';
import { RowDataPacket } from 'mysql2';
import { AGENT_ROLE, areaDeptGuard, type Area } from './insightsAgentScope';

/**
 * Resolved scope for one viewer, two independent layers:
 *
 *  - `pageDepartmentKeys` — the report POPULATION, configured per page in
 *    Insights → Page Management (`ie_page_department_access`). When set, it
 *    defines exactly which departments appear (descendant-inclusive). Empty
 *    means "not configured" → fall back to the built-in area/subtree split.
 *  - `selfEmployeeKey` / `departmentKeys` — the viewer's own data scope, which
 *    NARROWS within the population. SELF pins to their own row;
 *    DEPARTMENT/DIVISION restricts to their department subtree; ALL adds
 *    neither.
 */
export interface RosterScope {
  selfEmployeeKey: number | null;
  departmentKeys: number[];
  pageDepartmentKeys: number[];
}

export interface ProductivityRosterRow {
  employeeKey: number;
  agent: string;
  department: string;
  clockedMin: number;
  utilizationPct: number;
  occupancyPct: number;
  callsPerHour: number;
  ahtMins: number;
  missedCalls: number;
  /** Raw measures the department comparison reads (talk + hold + wrap). */
  handleMin: number;
  onQueueMin: number;
  ticketsTouched: number;
}

export interface ProductivityRosterResult {
  date: string;
  area: Area;
  rows: ProductivityRosterRow[];
  departments: string[];
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

interface AgentIdentity { employeeKey: number; userId: number | null; agent: string; email: string; department: string }

/** In-scope CSR/Sales agents with the identities each source is keyed on. */
async function loadAgents(area: Area, scope: RosterScope): Promise<AgentIdentity[]> {
  // is_active = 1 drops terminated CSRs (the sibling reader guards the same way);
  // is_current = 1 keeps the live SCD row.
  const where = [
    'e.is_current = 1',
    'e.is_active = 1',
    'e.role_name = ?',
    "e.email IS NOT NULL AND e.email <> ''",
  ];
  const params: (string | number)[] = [AGENT_ROLE];

  // Population: the page's configured departments own it when present, otherwise
  // the built-in area/subtree split. This is the admin-facing "who appears" knob.
  if (scope.pageDepartmentKeys.length > 0) {
    where.push(`e.department_key IN (${scope.pageDepartmentKeys.map(() => '?').join(',')})`);
    params.push(...scope.pageDepartmentKeys);
  } else {
    const guard = areaDeptGuard(area);
    where.push(guard.sql);
    params.push(...guard.params);
  }

  // Viewer narrowing, applied on top of the population. SELF pins to one
  // employee; DEPARTMENT/DIVISION restricts to the viewer's department subtree.
  if (scope.selfEmployeeKey != null) {
    where.push('e.employee_key = ?');
    params.push(scope.selfEmployeeKey);
  } else if (scope.departmentKeys.length > 0) {
    where.push(`e.department_key IN (${scope.departmentKeys.map(() => '?').join(',')})`);
    params.push(...scope.departmentKeys);
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT e.employee_key AS employeeKey, e.user_id AS userId, e.username AS agent,
            LOWER(TRIM(e.email)) AS email, COALESCE(dpt.department_name, '') AS department
     FROM ie_dim_employee e
     JOIN ie_dim_department dpt ON dpt.is_current = 1 AND dpt.department_key = e.department_key
     WHERE ${where.join(' AND ')}
     ORDER BY dpt.department_name, e.username`,
    params,
  );
  return rows.map((r) => ({
    employeeKey: Number(r.employeeKey),
    userId: r.userId != null ? Number(r.userId) : null,
    agent: String(r.agent),
    email: String(r.email),
    department: String(r.department),
  }));
}

function nextDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
const etDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Paid minutes (Work + Break) per agent for the ET calendar day. Punch instants
 * are UTC and the process is pinned to ET, so the day is bounded on a widened UTC
 * window and summed in JS on the exact ET date — matching the drill-down's Clock.
 */
async function loadPaidMinutes(userIds: number[], date: string): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (userIds.length === 0) return out;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT user_id AS userId, punch_in_at, punch_out_at
     FROM punch_raw
     WHERE user_id IN (${userIds.map(() => '?').join(',')})
       AND punch_out_at IS NOT NULL AND pay_type IN ('Work', 'Break')
       AND punch_in_at >= ? AND punch_in_at < ?`,
    [...userIds, `${date} 00:00:00`, `${nextDate(date)} 12:00:00`],
  );
  for (const r of rows) {
    if (!(r.punch_in_at instanceof Date) || !(r.punch_out_at instanceof Date)) continue;
    if (etDate(r.punch_in_at as Date) !== date) continue;
    const mins = Math.max(0, Math.round(((r.punch_out_at as Date).getTime() - (r.punch_in_at as Date).getTime()) / 60000));
    out.set(Number(r.userId), (out.get(Number(r.userId)) ?? 0) + mins);
  }
  return out;
}

async function loadGuidMap(emails: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (emails.length === 0 || !phoneDatabaseConfig) return out;
  const [rows] = await getDatabasePool('phone').query<RowDataPacket[]>(
    `SELECT LOWER(TRIM(Email)) AS email, PhoneUserID AS guid
     FROM tblPhoneUser WHERE LOWER(TRIM(Email)) IN (${emails.map(() => '?').join(',')})`,
    emails,
  );
  rows.forEach((r) => out.set(String(r.email), String(r.guid)));
  return out;
}

interface RoutingAgg { onQueueMin: number; engagedMin: number }
async function loadRouting(guids: string[], dayStart: string, dayEnd: string): Promise<Map<string, RoutingAgg>> {
  const out = new Map<string, RoutingAgg>();
  if (guids.length === 0 || !phoneDatabaseConfig) return out;
  const [rows] = await getDatabasePool('phone').query<RowDataPacket[]>(
    `SELECT UserID AS guid,
            SUM(CASE WHEN RoutingStatus <> 'OFF_QUEUE' THEN TIMESTAMPDIFF(SECOND, StartTime_ET, EndTime_ET) ELSE 0 END) AS onqSec,
            SUM(CASE WHEN RoutingStatus IN ('INTERACTING', 'COMMUNICATING') THEN TIMESTAMPDIFF(SECOND, StartTime_ET, EndTime_ET) ELSE 0 END) AS engSec
     FROM tblRoutingStatus
     WHERE UserID IN (${guids.map(() => '?').join(',')})
       AND StartTime_ET >= ? AND StartTime_ET < ? AND EndTime_ET IS NOT NULL
     GROUP BY UserID`,
    [...guids, dayStart, dayEnd],
  );
  rows.forEach((r) => out.set(String(r.guid), { onQueueMin: Number(r.onqSec || 0) / 60, engagedMin: Number(r.engSec || 0) / 60 }));
  return out;
}

interface CallAgg { answered: number; missed: number; handleMin: number }
async function loadCalls(guids: string[], dayStart: string, dayEnd: string): Promise<Map<string, CallAgg>> {
  const out = new Map<string, CallAgg>();
  if (guids.length === 0 || !phoneDatabaseConfig) return out;
  const [rows] = await getDatabasePool('phone').query<RowDataPacket[]>(
    `SELECT u.guid AS guid,
            SUM(u.answered) AS answered,
            SUM(CASE WHEN u.answered = 0 AND u.dir = 'Inbound' THEN 1 ELSE 0 END) AS missed,
            SUM(u.handleSec) AS handleSec
     FROM (
       SELECT pt.UserId AS guid, c.ConversationId AS cid,
              MIN(sess.Direction) AS dir,
              MAX(CASE WHEN seg.SegmentType = 'Interact' THEN 1 ELSE 0 END) AS answered,
              SUM(CASE WHEN seg.SegmentType IN ('Interact', 'Hold', 'Wrapup') THEN TIMESTAMPDIFF(SECOND, seg.SegmentStart_ET, seg.SegmentEnd_ET) ELSE 0 END) AS handleSec
       FROM tblConversations c
       JOIN tblParticipants pt ON pt.ConversationId = c.ConversationId AND pt.UserId IN (${guids.map(() => '?').join(',')})
       JOIN tblSessions sess ON sess.ConversationID = c.ConversationId AND sess.ParticipantID = pt.ParticipantId
       LEFT JOIN tblSegments seg ON seg.SessionId = sess.SessionId
       WHERE c.ConversationStart_ET >= ? AND c.ConversationStart_ET < ?
       GROUP BY pt.UserId, c.ConversationId
     ) u
     GROUP BY u.guid`,
    [...guids, dayStart, dayEnd],
  );
  rows.forEach((r) => out.set(String(r.guid), {
    answered: Number(r.answered) || 0,
    missed: Number(r.missed) || 0,
    handleMin: Number(r.handleSec || 0) / 60,
  }));
  return out;
}

async function loadTicketsTouched(employeeKeys: number[], date: string, area: Area): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (employeeKeys.length === 0) return out;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT employee_key AS employeeKey, SUM(touched) AS touched
     FROM ie_ticket_task_productivity_daily
     WHERE employee_key IN (${employeeKeys.map(() => '?').join(',')}) AND snapshot_date = ? AND area = ?
     GROUP BY employee_key`,
    [...employeeKeys, date, area],
  );
  rows.forEach((r) => out.set(Number(r.employeeKey), Number(r.touched) || 0));
  return out;
}

/** Build the day roster for one area, restricted to the viewer's data scope. */
export async function getProductivityRoster(area: Area, date: string, scope: RosterScope): Promise<ProductivityRosterResult> {
  const agents = await loadAgents(area, scope);
  if (agents.length === 0) return { date, area, rows: [], departments: [] };

  const dayStart = `${date} 00:00:00`;
  const dayEnd = `${date} 23:59:59`;
  const userIds = agents.map((a) => a.userId).filter((u): u is number => u != null);
  const emails = [...new Set(agents.map((a) => a.email))];
  const employeeKeys = agents.map((a) => a.employeeKey);

  const guidMap = await loadGuidMap(emails);
  const guids = [...new Set([...guidMap.values()])];

  const [paid, routing, calls, tickets] = await Promise.all([
    loadPaidMinutes(userIds, date),
    loadRouting(guids, dayStart, dayEnd),
    loadCalls(guids, dayStart, dayEnd),
    loadTicketsTouched(employeeKeys, date, area),
  ]);

  const rows: ProductivityRosterRow[] = agents.map((a) => {
    const clockedMin = a.userId != null ? paid.get(a.userId) ?? 0 : 0;
    const guid = guidMap.get(a.email);
    const r = guid ? routing.get(guid) : undefined;
    const c = guid ? calls.get(guid) : undefined;
    const onQueueMin = r?.onQueueMin ?? 0;
    const engagedMin = r?.engagedMin ?? 0;
    const answered = c?.answered ?? 0;
    const handleMin = c?.handleMin ?? 0;
    return {
      employeeKey: a.employeeKey,
      agent: a.agent,
      department: a.department,
      clockedMin: Math.round(clockedMin),
      utilizationPct: pct(handleMin, clockedMin),
      occupancyPct: pct(engagedMin, onQueueMin),
      callsPerHour: clockedMin > 0 ? answered / (clockedMin / 60) : 0,
      ahtMins: answered > 0 ? handleMin / answered : 0,
      missedCalls: c?.missed ?? 0,
      handleMin: Math.round(handleMin),
      onQueueMin: Math.round(onQueueMin),
      ticketsTouched: tickets.get(a.employeeKey) ?? 0,
    };
  });

  const departments = [...new Set(rows.map((r) => r.department).filter(Boolean))].sort();
  return { date, area, rows, departments };
}
