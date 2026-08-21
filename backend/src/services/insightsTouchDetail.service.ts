/**
 * Insights — Ticket & Task "touch" validation read service.
 *
 * On-demand drill-down behind the Workload report's `touched` metric: for ONE
 * agent on ONE day it lists every underlying CRM event that the daily capture
 * counts — a noted task action (tblAction) or a ticket note (tblTicketNote) —
 * with the item, subject, actor, note/action text, and timestamp so a manager
 * can reconcile a `touched` count that looks high.
 *
 * The filters mirror `captureDailyTicketProductivity`'s `touchedSql` exactly
 * (task depts 1/2, TaskTypeID <> 19, Note <> '', keyed by the actor) and apply
 * the same system-note classifier: machine-written notes are still listed (so a
 * reviewer can see them) but flagged `isSystem` and excluded from the distinct
 * count, so it reconciles to the stored (clean) `touched`. Reads are live and
 * READ-ONLY against the CRM, scoped to a single actor + single day, so the
 * source cost is tiny (this never runs unless the user asks for it).
 */
import mysql from 'mysql2/promise';
import pool from '../config/database';
import { RowDataPacket } from 'mysql2';
import { crmDatabaseConfig } from '../config/environment';
import {
  isSystemNote,
  systemExclusionEnabled,
  TOUCHED_EXCLUDE_SYSTEM_FLAG,
} from './insights/systemNoteClassifier';

export interface TouchDetailRow {
  itemType: 'task' | 'ticket';
  itemId: number;
  subject: string | null;
  segment: 'contact_manager' | 'other';
  actor: string | null;
  crmUserId: number;
  note: string;
  occurredAt: string;
  /** CRM deep link, built with the same rules as the open ticket/task extracts. */
  crmUrl: string | null;
  /** True when this note is a machine-written stamp (excluded from Touched). */
  isSystem: boolean;
}

export interface TouchDetailResult {
  date: string;
  area: 'sales' | 'csr';
  employeeKey: number;
  email: string | null;
  crmUserIds: number[];
  rows: TouchDetailRow[];
  /** Individual note/action events (a single item can be touched many times). */
  rawEventCount: number;
  /** Distinct items touched — the figure that reconciles to stored `touched`. */
  distinctItemCount: number;
  /** Stored `touched` for this agent+day+area, when the daily row exists. */
  storedTouched: number | null;
  reason: string;
}

export interface TouchDetailParams {
  area: 'sales' | 'csr';
  employeeKey: number;
  date: string;
  /** Sales only: scope the drill-down to one section. 'contact_manager' lists
   *  only Contact Manager task touches; 'other' lists all other tasks + tickets.
   *  Omitted (or for CSR) means the full, un-split list. */
  segment?: 'contact_manager' | 'other';
}

// Task touches: a noted action on a sales/ops task (depts 1/2, type <> 19),
// keyed by the actor (tblAction.CompletedBy = my_aspnet_users.id = SalesPeople
// UserID). Segment splits Contact Manager out like the Sales Workload page.
const taskSql = (userPlaceholders: string) => `
  SELECT a.TaskID AS itemId,
         tt.Title AS subject,
         CASE WHEN tt.Title = 'Contact Manager' THEN 'contact_manager' ELSE 'other' END AS segment,
         a.CompletedBy AS crmUserId,
         a.CompletedOn AS occurredAt,
         a.Note        AS note,
         -- Same deep-link rules as task_open.extract.sql. CHAR(63) is the
         -- question-mark char; a literal one would be read as a bind placeholder
         -- by mysql2 (even inside a comment). It MUST be built with USING utf8mb4:
         -- a bare CHAR() returns VARBINARY, and a CONCAT that is all-binary comes
         -- back from mysql2 as a Buffer, not a string (the extract only dodges
         -- this because it writes through a VARCHAR column that launders it). The
         -- task branch happens to include a text column (tt.NewScreen) so it
         -- coerces to a string regardless, but we pin the charset here too so both
         -- branches are string-typed by construction. JobID is a scalar subquery
         -- (not a join) so a task with more than one job can't duplicate the touch
         -- rows this endpoint counts.
         CASE
           WHEN t.TaskTypeID IN (14, 42, 46)
             THEN CONCAT('http://crm.dm-us.com/Jobs/', tt.NewScreen, CHAR(63 USING utf8mb4), 'JobID=',
                         (SELECT jj.JobID FROM tblJobs jj WHERE jj.TaskID = t.TaskID LIMIT 1))
           ELSE CONCAT('http://crm.dm-us.com/TaskManager/', tt.NewScreen, CHAR(63 USING utf8mb4), 'TaskID=', t.TaskID)
         END           AS crmUrl
  FROM tblAction a
    JOIN tblTask t      ON t.TaskID = a.TaskID
    JOIN tblTaskType tt ON tt.TaskTypeID = t.TaskTypeID AND tt.DeptID IN (1,2)
  WHERE t.TaskTypeID <> 19 AND a.Note <> ''
    AND a.CompletedBy IN (${userPlaceholders}) AND DATE(a.CompletedOn) = ?
  ORDER BY a.CompletedOn
  LIMIT 5000`;

// Ticket touches: a ticket note keyed by its author (tblTicketNote.CreatedBy).
// Classification is joined for a readable subject; LEFT JOINs so a note is never
// dropped from the list even if its ticket/classification can't be resolved.
const ticketSql = (userPlaceholders: string) => `
  SELECT tn.TicketID AS itemId,
         NULLIF(TRIM(CONCAT_WS(' / ', tc1.ClassificationName, tc2.ClassificationName)), '') AS subject,
         tn.CreatedBy AS crmUserId,
         tn.CreatedOn AS occurredAt,
         tn.Note      AS note,
         -- Same deep-link rule as ticket_open.extract.sql. CHAR(63) is the
         -- question-mark char (a literal one would be read as a bind placeholder).
         -- USING utf8mb4 is REQUIRED: this CONCAT has no text column, so a bare
         -- CHAR() leaves the whole value VARBINARY and mysql2 returns it as a
         -- Buffer, which serialises to a useless {type:'Buffer'} href — the exact
         -- reason the ticket link was dead while the task link (which carries a
         -- text column) worked. Pinning the charset keeps it a real string.
         CONCAT('http://crm.dm-us.com/Tickets/Edit', CHAR(63 USING utf8mb4), 'CustomerID=0&JobID=0&TicketID=', tn.TicketID) AS crmUrl
  FROM tblTicketNote tn
    LEFT JOIN tblTicket tk               ON tk.TicketID = tn.TicketID
    LEFT JOIN tblTicketClassification tc2 ON tk.ClassificationID = tc2.ClassificationID
    LEFT JOIN tblTicketClassification tc1 ON tc1.ClassificationID = tc2.ParentID
  WHERE tn.CreatedBy IN (${userPlaceholders}) AND DATE(tn.CreatedOn) = ?
  ORDER BY tn.CreatedOn
  LIMIT 5000`;

export async function getTicketTouchDetail(params: TouchDetailParams): Promise<TouchDetailResult> {
  const { area, employeeKey, date, segment } = params;
  const empty = (reason: string, email: string | null = null, crmUserIds: number[] = []): TouchDetailResult => ({
    date, area, employeeKey, email, crmUserIds,
    rows: [], rawEventCount: 0, distinctItemCount: 0, storedTouched: null, reason,
  });

  if (!crmDatabaseConfig) return empty('no-crm-config');

  // Agent identity conforms on email, same as the capture job (reversed here):
  // employee_key -> email -> CRM UserID(s).
  const [empRows] = await pool.query<RowDataPacket[]>(
    `SELECT LOWER(TRIM(email)) AS email FROM ie_dim_employee
     WHERE employee_key = ? AND is_current = 1 AND email IS NOT NULL AND email <> '' LIMIT 1`,
    [employeeKey],
  );
  const email = empRows.length ? String(empRows[0].email) : null;
  if (!email) return empty('no-email');

  // Stored touched for the reconciliation banner. When a segment is requested
  // (Sales CM vs other), scope to that slice so the drill-down reconciles to the
  // number shown in that section; otherwise sum across segments.
  const segmentFilter = segment ? ' AND segment = ?' : '';
  const [stRows] = await pool.query<RowDataPacket[]>(
    `SELECT SUM(touched) AS t FROM ie_ticket_task_productivity_daily
     WHERE employee_key = ? AND snapshot_date = ? AND area = ?${segmentFilter}`,
    segment ? [employeeKey, date, area, segment] : [employeeKey, date, area],
  );
  const storedTouched = stRows.length && stRows[0].t != null ? Number(stRows[0].t) : null;

  // Same toggle the capture/backfill honor: when on, machine-written notes are
  // flagged and excluded from the distinct count so this drill-down reconciles
  // to the stored (clean) Touched. When off, nothing is flagged and the raw
  // pre-cleanup behavior is reproduced.
  const [exclCfg] = await pool.query<RowDataPacket[]>(
    `SELECT config_value FROM ie_config WHERE config_key = ?`, [TOUCHED_EXCLUDE_SYSTEM_FLAG],
  );
  const excludeSystem = systemExclusionEnabled(exclCfg[0]?.config_value as string | undefined);

  const crm = await mysql.createConnection({
    host: crmDatabaseConfig.host,
    user: crmDatabaseConfig.user,
    password: crmDatabaseConfig.password,
    database: crmDatabaseConfig.database,
    connectTimeout: 60_000,
    dateStrings: true,
    charset: 'utf8mb4',
  });
  try {
    const [spRows] = await crm.query<mysql.RowDataPacket[]>(
      `SELECT UserID, MAX(SalesPersonName) AS name FROM tblSalesPeople
       WHERE UserID NOT IN (12) AND email IS NOT NULL AND LOWER(TRIM(email)) = ?
       GROUP BY UserID`,
      [email],
    );
    const crmUserIds = spRows.map((r) => Number(r.UserID));
    const nameByUser = new Map<number, string>(spRows.map((r) => [Number(r.UserID), (r.name as string) ?? '']));
    if (crmUserIds.length === 0) { await crm.end(); return empty('no-crm-user', email); }

    const ph = crmUserIds.map(() => '?').join(',');
    const [taskRows] = await crm.query<mysql.RowDataPacket[]>(taskSql(ph), [...crmUserIds, date]);
    const [ticketRows] = await crm.query<mysql.RowDataPacket[]>(ticketSql(ph), [...crmUserIds, date]);
    await crm.end();

    const rows: TouchDetailRow[] = [];
    for (const r of taskRows) {
      const note = String(r.note ?? '');
      rows.push({
        itemType: 'task', itemId: Number(r.itemId),
        subject: (r.subject as string | null) ?? null,
        segment: r.segment === 'contact_manager' ? 'contact_manager' : 'other',
        crmUserId: Number(r.crmUserId), actor: nameByUser.get(Number(r.crmUserId)) ?? null,
        note, occurredAt: String(r.occurredAt),
        crmUrl: (r.crmUrl as string | null) ?? null,
        isSystem: excludeSystem && isSystemNote(note),
      });
    }
    for (const r of ticketRows) {
      const note = String(r.note ?? '');
      rows.push({
        itemType: 'ticket', itemId: Number(r.itemId),
        subject: (r.subject as string | null) ?? null, segment: 'other',
        crmUserId: Number(r.crmUserId), actor: nameByUser.get(Number(r.crmUserId)) ?? null,
        note, occurredAt: String(r.occurredAt),
        crmUrl: (r.crmUrl as string | null) ?? null,
        isSystem: excludeSystem && isSystemNote(note),
      });
    }
    rows.sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0));

    // Scope to the requested section so the "All Other" drill-down never lists
    // Contact Manager touches (and vice-versa). Ticket rows are always 'other',
    // so the CM slice is tasks-only and the other slice keeps every ticket.
    const scopedRows = segment ? rows.filter((r) => r.segment === segment) : rows;

    // touched = distinct items with a HUMAN noted event that day, keyed
    // T<taskId>/K<ticketId>. System rows are kept in the list (so the panel can
    // badge them) but excluded from the count that reconciles to stored Touched.
    const distinct = new Set(
      scopedRows.filter((r) => !r.isSystem).map((r) => `${r.itemType === 'task' ? 'T' : 'K'}${r.itemId}`),
    );
    return {
      date, area, employeeKey, email, crmUserIds, rows: scopedRows,
      rawEventCount: scopedRows.length, distinctItemCount: distinct.size, storedTouched, reason: 'ok',
    };
  } catch (err) {
    await crm.end().catch(() => { /* socket already gone */ });
    throw err;
  }
}
