/**
 * Insights → Productivity: live per-agent, per-day drill-down.
 *
 * Assembles ONE agent's day from the source systems on demand (never warehoused),
 * mirroring the `insightsTouchDetail` precedent — a single agent + single day is a
 * cheap, read-only slice, so it is read live rather than pre-aggregated:
 *   - clock spans   → punch_raw (primary DB), paid = Work + Break
 *   - routing/presence → Genesys tblRoutingStatus / tblPrimaryPresence (phone DB)
 *   - calls         → tblConversations/Participants/Sessions/Segments (phone DB)
 *   - tickets       → CRM touch detail (reuses insightsTouchDetail, the same events
 *                     the Workload "touched" count is built from)
 *
 * The shape returned is the frontend `AgentDay` (see productivityTypes.ts), so
 * `buildDayModel` is a drop-in over it. Identity conforms on email, exactly like
 * the touch-detail reconciliation: employee_key → email → Genesys PhoneUserID and
 * → CRM UserID(s).
 */
import pool from '../config/database';
import { getDatabasePool } from '../config/database';
import { phoneDatabaseConfig } from '../config/environment';
import { RowDataPacket } from 'mysql2';
import { getTicketTouchDetail } from './insightsTouchDetail.service';
import type { Area } from './insightsAgentScope';

// Re-exported so existing importers (e.g. the roster service) keep their path.
export type { Area };

interface Span { start: string; end: string; status: string }
interface CallSpan {
  conversationId: string; start: string; end: string; direction: 'Inbound' | 'Outbound';
  answered: boolean; acd: boolean; holdMins: number; wrapMins: number; transferred: boolean;
}
interface TicketTouch {
  itemType: 'task' | 'ticket';
  /** The real CRM TaskID / TicketID — the number in the deep-link URL, not an internal key. */
  itemId: number;
  /** CRM deep link for the item (from the touch-detail extract), null when unresolved. */
  url: string | null;
  subject: string | null;
  action: 'Updated' | 'Completed';
}
interface TicketEvent { time: string; updated: number; completed: number; ids: TicketTouch[] }
export interface AgentDay {
  schedule: null;
  clock: Span[];
  routing: Span[];
  presence: Span[];
  calls: CallSpan[];
  outbound: { dials: number; connected: number; voicemail: number; noAnswer: number };
  tickets: TicketEvent[];
}

const phonePool = () => getDatabasePool('phone');

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * Punch datetimes are stored as UTC instants and the process is pinned to
 * America/New_York (config/timezone.ts), so JS getters give Eastern wall-clock —
 * the SAME wall clock the Genesys *_ET columns already carry. Formatting here in
 * JS (rather than SQL TIME_FORMAT, which would return the raw UTC value) is what
 * keeps the Clock row aligned with the Status/Calls rows on the timeline.
 */
const etHM = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Collapse consecutive same-status runs into one span (presence comes in noisy). */
function mergeSpans(spans: Span[]): Span[] {
  return spans.reduce<Span[]>((acc, s) => {
    const prev = acc[acc.length - 1];
    if (prev && prev.status === s.status && prev.end === s.start) prev.end = s.end;
    else acc.push({ ...s });
    return acc;
  }, []);
}

/** Punch pay_type → the timeline's ClockStatus vocabulary. */
function clockStatusOf(payType: string): string {
  if (payType === 'Work') return 'Working';
  if (payType === 'Break') return 'Break';
  if (payType === 'Meal') return 'Meal';
  return 'Away';
}

/** employee_key → { userId (app/punch id), email, departmentKey }. Null when unmapped. */
export async function resolveAgentIdentity(
  employeeKey: number,
): Promise<{ userId: number | null; email: string | null; departmentKey: number | null } | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT user_id AS userId, LOWER(TRIM(email)) AS email, department_key AS departmentKey
     FROM ie_dim_employee WHERE employee_key = ? AND is_current = 1 LIMIT 1`,
    [employeeKey],
  );
  if (!rows.length) return null;
  return {
    userId: rows[0].userId != null ? Number(rows[0].userId) : null,
    email: rows[0].email ?? null,
    departmentKey: rows[0].departmentKey != null ? Number(rows[0].departmentKey) : null,
  };
}

/** email → Genesys PhoneUserID (GUID). Null when the agent has no phone identity. */
export async function resolvePhoneUserId(email: string): Promise<string | null> {
  if (!phoneDatabaseConfig) return null;
  const [rows] = await phonePool().query<RowDataPacket[]>(
    `SELECT PhoneUserID FROM tblPhoneUser WHERE LOWER(TRIM(Email)) = ? LIMIT 1`,
    [email],
  );
  return rows.length ? String(rows[0].PhoneUserID) : null;
}

function nextDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

async function loadClock(userId: number, date: string): Promise<Span[]> {
  // Punch instants are UTC; an ET calendar day runs ~04:00Z that day to ~04:00Z
  // the next. Widen the UTC window past midnight so evening ET punches (which
  // land on the next UTC day) are caught, then filter to the exact ET date in JS.
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT punch_in_at, punch_out_at, pay_type
     FROM punch_raw
     WHERE user_id = ? AND punch_out_at IS NOT NULL
       AND punch_in_at >= ? AND punch_in_at < ?
     ORDER BY punch_in_at`,
    [userId, `${date} 00:00:00`, `${nextDate(date)} 12:00:00`],
  );
  const onDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === date;
  return rows
    .filter((r) => r.punch_in_at instanceof Date && r.punch_out_at instanceof Date && onDate(r.punch_in_at as Date))
    .map((r) => ({ start: etHM(r.punch_in_at as Date), end: etHM(r.punch_out_at as Date), status: clockStatusOf(String(r.pay_type)) }))
    .filter((s) => s.start !== s.end);
}

async function loadRouting(guid: string, dayStart: string, dayEnd: string): Promise<Span[]> {
  const [rows] = await phonePool().query<RowDataPacket[]>(
    `SELECT TIME_FORMAT(StartTime_ET, '%H:%i') AS s, TIME_FORMAT(EndTime_ET, '%H:%i') AS e, RoutingStatus AS status
     FROM tblRoutingStatus
     WHERE UserID = ? AND StartTime_ET >= ? AND StartTime_ET < ? AND EndTime_ET IS NOT NULL
     ORDER BY StartTime_ET`,
    [guid, dayStart, dayEnd],
  );
  return rows
    .filter((r) => r.s && r.e && r.s !== r.e)
    .map((r) => ({ start: r.s as string, end: r.e as string, status: String(r.status) }));
}

async function loadPresence(guid: string, dayStart: string, dayEnd: string): Promise<Span[]> {
  const [rows] = await phonePool().query<RowDataPacket[]>(
    `SELECT TIME_FORMAT(p.StartTime_ET, '%H:%i') AS s, TIME_FORMAT(p.EndTime_ET, '%H:%i') AS e,
            COALESCE(sp.LabelName, p.PresenceStatus) AS status
     FROM tblPrimaryPresence p
     LEFT JOIN tblSystemPresence sp ON sp.OrgPresenceID = p.OrgPresenceID
     WHERE p.UserID = ? AND p.StartTime_ET >= ? AND p.StartTime_ET < ? AND p.EndTime_ET IS NOT NULL
     ORDER BY p.StartTime_ET`,
    [guid, dayStart, dayEnd],
  );
  return mergeSpans(
    rows.filter((r) => r.s && r.e && r.s !== r.e).map((r) => ({ start: r.s as string, end: r.e as string, status: String(r.status) })),
  );
}

/**
 * One row per conversation the agent took part in, with the Genesys segments
 * folded into the handle measures the model needs: Interact = answered + talk,
 * Hold = hold time, Wrapup = after-call work, a Transfer disconnect = transferred.
 */
async function loadCalls(guid: string, dayStart: string, dayEnd: string): Promise<{ calls: CallSpan[]; outbound: AgentDay['outbound'] }> {
  const [rows] = await phonePool().query<RowDataPacket[]>(
    `SELECT c.ConversationId AS cid,
            MIN(sess.Direction) AS dir,
            TIME_FORMAT(COALESCE(MIN(CASE WHEN seg.SegmentType = 'Interact' THEN seg.SegmentStart_ET END), MIN(c.ConversationStart_ET)), '%H:%i') AS startHm,
            MAX(CASE WHEN seg.SegmentType = 'Interact' THEN 1 ELSE 0 END) AS answered,
            MAX(CASE WHEN seg.DisconnectType = 'Transfer' THEN 1 ELSE 0 END) AS transferred,
            SUM(CASE WHEN seg.SegmentType = 'Interact' THEN TIMESTAMPDIFF(SECOND, seg.SegmentStart_ET, seg.SegmentEnd_ET) ELSE 0 END) AS talkSec,
            SUM(CASE WHEN seg.SegmentType = 'Hold'     THEN TIMESTAMPDIFF(SECOND, seg.SegmentStart_ET, seg.SegmentEnd_ET) ELSE 0 END) AS holdSec,
            SUM(CASE WHEN seg.SegmentType = 'Wrapup'   THEN TIMESTAMPDIFF(SECOND, seg.SegmentStart_ET, seg.SegmentEnd_ET) ELSE 0 END) AS wrapSec
     FROM tblConversations c
     JOIN tblParticipants pt ON pt.ConversationId = c.ConversationId AND pt.UserId = ?
     JOIN tblSessions sess ON sess.ConversationID = c.ConversationId AND sess.ParticipantID = pt.ParticipantId
     LEFT JOIN tblSegments seg ON seg.SessionId = sess.SessionId
     WHERE c.ConversationStart_ET >= ? AND c.ConversationStart_ET < ?
     GROUP BY c.ConversationId
     ORDER BY startHm`,
    [guid, dayStart, dayEnd],
  );

  const outbound = { dials: 0, connected: 0, voicemail: 0, noAnswer: 0 };
  const calls: CallSpan[] = rows.map((r) => {
    const direction: 'Inbound' | 'Outbound' = r.dir === 'Inbound' ? 'Inbound' : 'Outbound';
    const answered = Number(r.answered) === 1;
    const talkMin = Math.round(Number(r.talkSec || 0) / 60);
    const holdMins = Math.round(Number(r.holdSec || 0) / 60);
    const wrapMins = Math.round(Number(r.wrapSec || 0) / 60);
    const start = String(r.startHm);
    const end = answered ? toHHMM(toMin(start) + talkMin) : start;
    if (direction === 'Outbound') {
      outbound.dials += 1;
      if (answered) outbound.connected += 1; else outbound.noAnswer += 1;
    }
    return {
      conversationId: String(r.cid), start, end, direction, answered,
      acd: direction === 'Inbound', holdMins, wrapMins, transferred: Number(r.transferred) === 1,
    };
  });
  return { calls, outbound };
}

/** CRM touched events → per-minute TicketEvent[], deduped to distinct items (the
 *  same basis the Workload "touched" count uses). Machine notes are dropped. */
async function loadTickets(area: Area, employeeKey: number, date: string): Promise<TicketEvent[]> {
  const detail = await getTicketTouchDetail({ area, employeeKey, date });
  const seen = new Set<string>();
  const byMinute = new Map<string, TicketEvent>();
  for (const r of detail.rows) {
    if (r.isSystem) continue;
    const key = `${r.itemType === 'task' ? 'T' : 'K'}${r.itemId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const time = String(r.occurredAt).slice(11, 16) || '00:00';
    const ev = byMinute.get(time) ?? { time, updated: 0, completed: 0, ids: [] };
    ev.updated += 1;
    ev.ids.push({ itemType: r.itemType, itemId: r.itemId, url: r.crmUrl, subject: r.subject, action: 'Updated' });
    byMinute.set(time, ev);
  }
  return [...byMinute.values()].sort((a, b) => (a.time < b.time ? -1 : 1));
}

/**
 * Live-assemble one agent's day. Any stream that cannot be sourced (no phone
 * identity, no CRM user) degrades to empty rather than failing the whole day.
 */
/**
 * `pageDepartmentKeys` — the report population configured on the page; the
 * drill-down agent must sit inside it (empty = not configured, no restriction).
 * `viewerDepartmentKeys` — the caller's own DEPARTMENT/DIVISION data scope. Both
 * are AND-ed, so an out-of-scope key yields an empty day rather than leaking
 * another department's activity (mirrors the roster's dept filter).
 */
export async function getProductivityDay(
  area: Area,
  employeeKey: number,
  date: string,
  scope: { pageDepartmentKeys?: number[]; viewerDepartmentKeys?: number[] } = {},
): Promise<AgentDay> {
  const empty: AgentDay = {
    schedule: null, clock: [], routing: [], presence: [], calls: [],
    outbound: { dials: 0, connected: 0, voicemail: 0, noAnswer: 0 }, tickets: [],
  };
  const identity = await resolveAgentIdentity(employeeKey);
  if (!identity) return empty;

  const withinScope = (keys: number[]) =>
    keys.length === 0 || (identity.departmentKey != null && keys.includes(identity.departmentKey));
  if (!withinScope(scope.pageDepartmentKeys ?? []) || !withinScope(scope.viewerDepartmentKeys ?? [])) {
    return empty;
  }

  const dayStart = `${date} 00:00:00`;
  const dayEnd = `${date} 23:59:59`;

  const clock = identity.userId ? await loadClock(identity.userId, date) : [];
  const guid = identity.email ? await resolvePhoneUserId(identity.email) : null;
  const [routing, presence, callData] = guid
    ? await Promise.all([loadRouting(guid, dayStart, dayEnd), loadPresence(guid, dayStart, dayEnd), loadCalls(guid, dayStart, dayEnd)])
    : [[], [], { calls: [], outbound: empty.outbound }];
  const tickets = await loadTickets(area, employeeKey, date);

  return { schedule: null, clock, routing, presence, calls: callData.calls, outbound: callData.outbound, tickets };
}
