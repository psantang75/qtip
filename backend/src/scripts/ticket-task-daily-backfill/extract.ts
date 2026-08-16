/**
 * Extraction phase of the Tickets & Tasks daily-history backfill.
 *
 * Pulls the CRM audit trail (READ-ONLY — this file must never write to the
 * CRM) into local `bf_tt_*` work tables on the primary DB:
 *
 *   - tblTaskHistory rows are the PRE-CHANGE task state archived at every
 *     change (`ArchivedOn` = change time), so "state at time T" = the row with
 *     the smallest ArchivedOn > T (falling back to the current tblTask row,
 *     stored here with a 9999-01-01 sentinel ArchivedOn).
 *   - Intra-day churn is dropped at insert time: for 8am snapshots only the
 *     FIRST archive after each day's 8am mark can ever be an as-of row, so the
 *     work table keeps one row per (task, 8am-bucket) — PK dedupe via
 *     INSERT IGNORE, chunks arrive in TaskHistoryID (≈ chronological) order.
 *   - tblTaskHistory has no leading-ArchivedOn index, so the big scan chunks
 *     by TaskHistoryID (PK) ranges instead of dates.
 *   - CRM DATETIMEs are ET wall time; the extraction connection uses
 *     dateStrings so values land in the work tables as literal strings and are
 *     never timezone-shifted by the UTC-pinned primary pool.
 */
import mysql from 'mysql2/promise';
import { RowDataPacket } from 'mysql2';
import pool from '../../config/database';
import { crmDatabaseConfig } from '../../config/environment';
import {
  buildSystemNoteExclusionSql,
  systemExclusionEnabled,
  TOUCHED_EXCLUDE_SYSTEM_FLAG,
} from '../../services/insights/systemNoteClassifier';

/** Task-side population rules, mirroring task_open.extract.sql. */
const TASK_DEPTS = [1, 2];
const EXCLUDED_TASK_TYPE = 19;
// 1M-id chunks (~830k buffered rows) crashed the node process under memory
// pressure; 250k keeps the per-chunk buffer around ~200k rows.
const HIST_CHUNK = 250_000;     // TaskHistoryID ids per task-history scan chunk
const SMALL_CHUNK = 1_000_000;  // id chunk for the small ticket tables
const ID_BATCH = 1000;          // TaskIDs per IN(...) batch for ticket-linked pulls

export async function openCrmConnection(): Promise<mysql.Connection> {
  if (!crmDatabaseConfig) throw new Error('CRM_DB_* env vars are not configured');
  return mysql.createConnection({
    host: crmDatabaseConfig.host,
    user: crmDatabaseConfig.user,
    password: crmDatabaseConfig.password,
    database: crmDatabaseConfig.database,
    connectTimeout: 60_000,
    dateStrings: true,
    charset: 'utf8mb4',
    // The connection sits idle while each chunk loads into the local DB; slow
    // loads (minutes under contention) let middleboxes kill the socket.
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
  });
}

/** Connection error codes worth a reconnect-and-retry (vs a real SQL error). */
const TRANSIENT_CODES = new Set(['ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED']);

/**
 * CRM connection wrapper: same `query` shape as mysql.Connection, but a
 * dropped socket (the hours-long scan has died twice to ECONNRESET) is
 * reopened and the query retried instead of failing the whole run. Chunk
 * queries are plain reads, so retrying is always safe.
 */
export class CrmClient {
  private conn: mysql.Connection | null = null;

  async query<T extends mysql.RowDataPacket[]>(sql: string, params?: unknown): Promise<[T, mysql.FieldPacket[]]> {
    for (let attempt = 1; ; attempt++) {
      if (!this.conn) this.conn = await openCrmConnection();
      try {
        return await this.conn.query<T>(sql, params);
      } catch (err) {
        const code = (err as { code?: string }).code ?? '';
        // mysql2 reports a silently-dropped socket as a codeless plain Error
        // ("Can't add new command when connection is in closed state").
        const transient = TRANSIENT_CODES.has(code) || /closed state/i.test((err as Error).message ?? '');
        if (attempt > 3 || !transient) throw err;
        console.log(`  CRM connection lost (${code || 'closed'}); reconnecting (attempt ${attempt}/3)...`);
        try { this.conn.destroy(); } catch { /* socket already gone */ }
        this.conn = null;
        await new Promise((r) => setTimeout(r, 5_000 * attempt));
      }
    }
  }

  async end(): Promise<void> {
    if (!this.conn) return;
    try { await this.conn.end(); } catch { this.conn.destroy(); }
    this.conn = null;
  }
}

export async function createWorkTables(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS bf_tt_task_hist (
    task_id        INT          NOT NULL,
    bucket_date    DATE         NOT NULL,
    archived_on    DATETIME     NOT NULL,
    due_on         DATETIME     NULL,
    task_status_id INT          NULL,
    completed_on   DATETIME     NULL,
    assigned_to    INT          NULL,
    task_type_id   INT          NULL,
    created_on     DATETIME     NULL,
    PRIMARY KEY (task_id, bucket_date),
    KEY idx_bf_hist_task_arch (task_id, archived_on)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await pool.query(`CREATE TABLE IF NOT EXISTS bf_tt_ticket (
    ticket_id   BIGINT   NOT NULL,
    task_id     INT      NOT NULL,
    created_on  DATETIME NULL,
    assigned_to INT      NULL,
    PRIMARY KEY (ticket_id),
    KEY idx_bf_ticket_task (task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await pool.query(`CREATE TABLE IF NOT EXISTS bf_tt_ticket_status (
    id         BIGINT   NOT NULL,
    ticket_id  BIGINT   NOT NULL,
    status_id  INT      NOT NULL,
    created_on DATETIME NULL,
    PRIMARY KEY (id),
    KEY idx_bf_tstatus_ticket (ticket_id, created_on)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Touched-by-actor sources: one deduped row per (item, calendar day, actor).
  // A task "touch" is a noted tblAction; a ticket "touch" is a tblTicketNote —
  // the same human-activity sources the live report uses for "last touched by".
  // Keyed by the ACTOR (who did the work), not the assignee, so system accounts
  // and manager reassignments (which are not notes) never land here.
  await pool.query(`CREATE TABLE IF NOT EXISTS bf_tt_task_action (
    task_id      INT  NOT NULL,
    action_date  DATE NOT NULL,
    user_id      INT  NOT NULL,
    -- Task type of the touched task, so touched can be split by segment
    -- (Contact Manager vs other) without a re-join. Constant per task_id.
    task_type_id INT  NULL,
    PRIMARY KEY (task_id, action_date, user_id),
    KEY idx_bf_taction_date (action_date, user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await pool.query(`CREATE TABLE IF NOT EXISTS bf_tt_ticket_note (
    ticket_id   BIGINT NOT NULL,
    note_date   DATE   NOT NULL,
    user_id     INT    NOT NULL,
    PRIMARY KEY (ticket_id, note_date, user_id),
    KEY idx_bf_tnote_date (note_date, user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await pool.query(`CREATE TABLE IF NOT EXISTS bf_tt_task_status (
    task_status_id INT          NOT NULL,
    title          VARCHAR(100) NULL,
    closed         TINYINT      NOT NULL DEFAULT 0,
    PRIMARY KEY (task_status_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await pool.query(`CREATE TABLE IF NOT EXISTS bf_tt_task_type (
    task_type_id INT          NOT NULL,
    dept_id      INT          NULL,
    -- Title drives the Contact Manager segment split on the Sales page.
    title        VARCHAR(150) NULL,
    PRIMARY KEY (task_type_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await pool.query(`CREATE TABLE IF NOT EXISTS bf_tt_salespeople (
    user_id INT          NOT NULL,
    email   VARCHAR(255) NULL,
    name    VARCHAR(150) NULL,
    PRIMARY KEY (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await pool.query(`CREATE TABLE IF NOT EXISTS bf_tt_progress (
    phase   VARCHAR(20) NOT NULL,
    last_id BIGINT      NOT NULL,
    PRIMARY KEY (phase)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

export async function dropWorkTables(): Promise<void> {
  for (const t of ['bf_tt_task_hist', 'bf_tt_ticket', 'bf_tt_ticket_status', 'bf_tt_task_status', 'bf_tt_task_type', 'bf_tt_salespeople', 'bf_tt_task_action', 'bf_tt_ticket_note', 'bf_tt_progress']) {
    await pool.query(`DROP TABLE IF EXISTS ${t}`);
  }
}

/** Insert in modest slices: one giant multi-row VALUES statement stalls the
 *  local server for minutes and can exceed max_allowed_packet. */
const INSERT_SLICE = 30_000;

async function batchInsert(sql: string, rows: unknown[][]): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_SLICE) {
    await pool.query(sql, [rows.slice(i, i + INSERT_SLICE)]);
  }
}

/**
 * Resume markers. The 76M-row main scan runs for hours; if the process dies
 * (or is killed to tune something) a re-run picks up at the last finished
 * chunk instead of re-truncating. Completed phases store last_id = -1.
 */
async function getMarker(phase: string): Promise<number | null> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT last_id FROM bf_tt_progress WHERE phase = ?`, [phase],
  );
  return rows.length ? Number(rows[0].last_id) : null;
}

async function setMarker(phase: string, lastId: number): Promise<void> {
  await pool.query(
    `INSERT INTO bf_tt_progress (phase, last_id) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE last_id = VALUES(last_id)`,
    [phase, lastId],
  );
}

/** Small lookup tables: task statuses, task types, salespeople (deduped per UserID). */
async function extractLookups(crm: CrmClient): Promise<void> {
  const [statuses] = await crm.query<mysql.RowDataPacket[]>(
    `SELECT TaskStatusID, Title, Closed+0 AS Closed FROM tblTaskStatus`,
  );
  await pool.query(`TRUNCATE TABLE bf_tt_task_status`);
  await batchInsert(
    `INSERT IGNORE INTO bf_tt_task_status (task_status_id, title, closed) VALUES ?`,
    statuses.map((r) => [r.TaskStatusID, r.Title, r.Closed ? 1 : 0]),
  );

  const [types] = await crm.query<mysql.RowDataPacket[]>(`SELECT TaskTypeID, DeptID, Title FROM tblTaskType`);
  await pool.query(`TRUNCATE TABLE bf_tt_task_type`);
  await batchInsert(
    `INSERT IGNORE INTO bf_tt_task_type (task_type_id, dept_id, title) VALUES ?`,
    types.map((r) => [r.TaskTypeID, r.DeptID, r.Title]),
  );

  // One row per UserID: prefer the CRM-displayed profile (matches CRMService's
  // identity note); UserID 12 = system/house account, excluded like the extracts.
  const [sps] = await crm.query<mysql.RowDataPacket[]>(
    `SELECT UserID, email, SalesPersonName, isDisplayInCRM+0 AS disp, SalesPersonID
     FROM tblSalesPeople WHERE UserID IS NOT NULL AND UserID NOT IN (12)
     ORDER BY UserID, disp DESC, SalesPersonID ASC`,
  );
  const seen = new Set<number>();
  const spRows: unknown[][] = [];
  for (const r of sps) {
    if (seen.has(r.UserID)) continue;
    seen.add(r.UserID);
    spRows.push([r.UserID, r.email, r.SalesPersonName]);
  }
  await pool.query(`TRUNCATE TABLE bf_tt_salespeople`);
  await batchInsert(`INSERT IGNORE INTO bf_tt_salespeople (user_id, email, name) VALUES ?`, spRows);
  console.log(`  lookups: ${statuses.length} statuses, ${types.length} types, ${spRows.length} salespeople`);
}

/** All tickets + their full status timeline (small tables, id-chunked scans). */
async function extractTickets(crm: CrmClient): Promise<void> {
  await pool.query(`TRUNCATE TABLE bf_tt_ticket`);
  const [[tRange]] = await crm.query<mysql.RowDataPacket[]>(`SELECT MIN(TicketID) mn, MAX(TicketID) mx FROM tblTicket`);
  let total = 0;
  for (let lo = Number(tRange.mn ?? 0); lo <= Number(tRange.mx ?? 0); lo += SMALL_CHUNK) {
    const [rows] = await crm.query<mysql.RowDataPacket[]>(
      `SELECT TicketID, TaskID, CASE WHEN CreatedOn > '1900-01-01' THEN CreatedOn END AS CreatedOn, AssignedToUserID
       FROM tblTicket WHERE TicketID >= ? AND TicketID < ?`,
      [lo, lo + SMALL_CHUNK],
    );
    await batchInsert(
      `INSERT IGNORE INTO bf_tt_ticket (ticket_id, task_id, created_on, assigned_to) VALUES ?`,
      rows.map((r) => [r.TicketID, r.TaskID ?? 0, r.CreatedOn, r.AssignedToUserID]),
    );
    total += rows.length;
  }
  console.log(`  tickets: ${total}`);

  await pool.query(`TRUNCATE TABLE bf_tt_ticket_status`);
  const [[sRange]] = await crm.query<mysql.RowDataPacket[]>(
    `SELECT MIN(TicketStatusHistoryID) mn, MAX(TicketStatusHistoryID) mx FROM tblTicketStatusHistory`,
  );
  total = 0;
  for (let lo = Number(sRange.mn ?? 0); lo <= Number(sRange.mx ?? 0); lo += SMALL_CHUNK) {
    const [rows] = await crm.query<mysql.RowDataPacket[]>(
      `SELECT TicketStatusHistoryID, TicketID, StatusID, CreatedOn
       FROM tblTicketStatusHistory WHERE TicketStatusHistoryID >= ? AND TicketStatusHistoryID < ?`,
      [lo, lo + SMALL_CHUNK],
    );
    await batchInsert(
      `INSERT IGNORE INTO bf_tt_ticket_status (id, ticket_id, status_id, created_on) VALUES ?`,
      rows.map((r) => [r.TicketStatusHistoryID, r.TicketID, r.StatusID, r.CreatedOn]),
    );
    total += rows.length;
  }
  console.log(`  ticket status history: ${total}`);
}

const HIST_SELECT = `
  SELECT h.TaskID, h.ArchivedOn,
         DATE(DATE_SUB(h.ArchivedOn, INTERVAL 8 HOUR))                     AS bucket,
         CASE WHEN h.DueOn       > '1900-01-01' THEN h.DueOn       END     AS DueOn,
         h.TaskStatusID,
         CASE WHEN h.CompletedOn > '1900-01-01' THEN h.CompletedOn END     AS CompletedOn,
         h.AssignedTo, h.TaskTypeID,
         CASE WHEN h.CreatedOn   > '1900-01-01' THEN h.CreatedOn   END     AS CreatedOn
  FROM tblTaskHistory h`;

const HIST_INSERT = `INSERT IGNORE INTO bf_tt_task_hist
  (task_id, bucket_date, archived_on, due_on, task_status_id, completed_on, assigned_to, task_type_id, created_on) VALUES ?`;

const histRow = (r: mysql.RowDataPacket): unknown[] =>
  [r.TaskID, r.bucket, r.ArchivedOn, r.DueOn, r.TaskStatusID, r.CompletedOn, r.AssignedTo, r.TaskTypeID, r.CreatedOn];

// Start the scan ~1M ids below the ArchivedOn crossover: the PK is only
// ≈chronological (concurrent inserts reorder by seconds), so a margin makes it
// impossible to skip a needed row; the ArchivedOn filter still discards the
// margin's pre-cutoff rows.
const START_SAFETY_IDS = 1_000_000;

/**
 * First `idCol` whose `dateCol` >= cutoff, via PK binary search (indexed point
 * reads — NOT a full-table scan). Lets a big id-chunked scan jump straight to
 * the window instead of loading years of rows the reconstruction can't select.
 * Backs off START_SAFETY_IDS because the PK is only ≈chronological.
 */
async function findStartIdBy(crm: CrmClient, table: string, idCol: string, dateCol: string, cutoff: string, mn: number, mx: number): Promise<number> {
  let lo = mn;
  let hi = mx;
  let ans = mx + 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const [rows] = await crm.query<mysql.RowDataPacket[]>(
      `SELECT ${idCol} AS id, ${dateCol} AS a FROM ${table} WHERE ${idCol} >= ? ORDER BY ${idCol} LIMIT 1`,
      [mid],
    );
    if (!rows.length) { hi = mid - 1; continue; }
    if (String(rows[0].a) >= cutoff) { ans = Number(rows[0].id); hi = mid - 1; }
    else lo = mid + 1;
  }
  return Math.max(mn, ans - START_SAFETY_IDS);
}

/** First TaskHistoryID whose ArchivedOn >= cutoff (used by the main history scan). */
async function findStartId(crm: CrmClient, cutoff: string, mn: number, mx: number): Promise<number> {
  return findStartIdBy(crm, 'tblTaskHistory', 'TaskHistoryID', 'ArchivedOn', cutoff, mn, mx);
}

/** Main scan: tblTaskHistory in PK chunks from the ArchivedOn cutoff onward,
 *  filtered to the task-side population. Resumes from the bf_tt_progress marker
 *  after an interrupt. */
async function extractTaskHistoryMain(crm: CrmClient, cutoff: string): Promise<void> {
  const [[range]] = await crm.query<mysql.RowDataPacket[]>(`SELECT MIN(TaskHistoryID) mn, MAX(TaskHistoryID) mx FROM tblTaskHistory`);
  const mn = Number(range.mn ?? 0);
  const mx = Number(range.mx ?? 0);
  const resumeAt = await getMarker('main');
  const startId = resumeAt != null ? resumeAt : await findStartId(crm, cutoff, mn, mx);
  console.log(`  main scan window: ids ${startId}..${mx} (ArchivedOn >= ${cutoff})`);
  let total = 0;
  for (let lo = startId; lo <= mx; lo += HIST_CHUNK) {
    const t0 = Date.now();
    const [rows] = await crm.query<mysql.RowDataPacket[]>(
      `${HIST_SELECT}
       JOIN tblTaskType tt ON tt.TaskTypeID = h.TaskTypeID
       WHERE h.TaskHistoryID >= ? AND h.TaskHistoryID < ?
         AND h.ArchivedOn >= ?
         AND tt.DeptID IN (${TASK_DEPTS.join(',')}) AND h.TaskTypeID <> ${EXCLUDED_TASK_TYPE}`,
      [lo, lo + HIST_CHUNK, cutoff],
    );
    const t1 = Date.now();
    await batchInsert(HIST_INSERT, rows.map(histRow));
    await setMarker('main', lo + HIST_CHUNK);
    total += rows.length;
    console.log(
      `  task history scan ${Math.min(lo + HIST_CHUNK, mx)}/${mx} ids ` +
      `(+${rows.length}, total ${total}, crm ${((t1 - t0) / 1000).toFixed(1)}s, load ${((Date.now() - t1) / 1000).toFixed(1)}s)`,
    );
  }
}

/** Ticket-linked tasks need due-date history regardless of task dept/type. */
async function extractTaskHistoryForTickets(crm: CrmClient, cutoff: string): Promise<void> {
  const [ids] = await pool.query<mysql.RowDataPacket[]>(`SELECT DISTINCT task_id FROM bf_tt_ticket WHERE task_id > 0`);
  let total = 0;
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const batch = ids.slice(i, i + ID_BATCH).map((r) => r.task_id);
    const [rows] = await crm.query<mysql.RowDataPacket[]>(
      `${HIST_SELECT} WHERE h.TaskID IN (${batch.map(() => '?').join(',')}) AND h.ArchivedOn >= ?`,
      [...batch, cutoff],
    );
    await batchInsert(HIST_INSERT, rows.map(histRow));
    total += rows.length;
  }
  console.log(`  ticket-linked task history: ${total} rows for ${ids.length} tasks`);
}

const CURRENT_SELECT = `
  SELECT t.TaskID, '9999-01-01 00:00:00' AS ArchivedOn, '9999-01-01' AS bucket,
         CASE WHEN t.DueOn       > '1900-01-01' THEN t.DueOn       END AS DueOn,
         t.TaskStatusID,
         CASE WHEN t.CompletedOn > '1900-01-01' THEN t.CompletedOn END AS CompletedOn,
         t.AssignedTo, t.TaskTypeID,
         CASE WHEN t.CreatedOn   > '1900-01-01' THEN t.CreatedOn   END AS CreatedOn
  FROM tblTask t`;

/** Current tblTask rows (the "state now" fallback interval, sentinel ArchivedOn 9999-01-01). */
async function extractCurrentTasks(crm: CrmClient): Promise<void> {
  const [[range]] = await crm.query<mysql.RowDataPacket[]>(`SELECT MIN(TaskID) mn, MAX(TaskID) mx FROM tblTask`);
  let total = 0;
  for (let lo = Number(range.mn ?? 0); lo <= Number(range.mx ?? 0); lo += HIST_CHUNK) {
    const [rows] = await crm.query<mysql.RowDataPacket[]>(
      `${CURRENT_SELECT}
       JOIN tblTaskType tt ON tt.TaskTypeID = t.TaskTypeID
       WHERE t.TaskID >= ? AND t.TaskID < ?
         AND tt.DeptID IN (${TASK_DEPTS.join(',')}) AND t.TaskTypeID <> ${EXCLUDED_TASK_TYPE}`,
      [lo, lo + HIST_CHUNK],
    );
    await batchInsert(HIST_INSERT, rows.map(histRow));
    total += rows.length;
  }
  const [ids] = await pool.query<mysql.RowDataPacket[]>(`SELECT DISTINCT task_id FROM bf_tt_ticket WHERE task_id > 0`);
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const batch = ids.slice(i, i + ID_BATCH).map((r) => r.task_id);
    const [rows] = await crm.query<mysql.RowDataPacket[]>(
      `${CURRENT_SELECT} WHERE t.TaskID IN (${batch.map(() => '?').join(',')})`,
      batch,
    );
    await batchInsert(HIST_INSERT, rows.map(histRow));
    total += rows.length;
  }
  console.log(`  current task rows: ${total}`);
}

/**
 * Task touches by actor: one deduped (task_id, calendar day, actor) row per
 * noted tblAction within the window, restricted to the report's task universe
 * (dept 1/2, type <> 19). Actor = tblAction.CompletedBy (who did the work),
 * NOT the assignee — so a manager's action lands on the manager (dropped later
 * because managers aren't conformed CSR agents) and system rows with no actor
 * are skipped. Resumes from the bf_tt_progress marker after an interrupt.
 */
async function extractTaskActions(crm: CrmClient, cutoff: string, excludeSystem: boolean): Promise<void> {
  const [[range]] = await crm.query<mysql.RowDataPacket[]>(`SELECT MIN(ActionID) mn, MAX(ActionID) mx FROM tblAction`);
  const mn = Number(range.mn ?? 0);
  const mx = Number(range.mx ?? 0);
  const resumeAt = await getMarker('actions');
  if (resumeAt == null) await pool.query(`TRUNCATE TABLE bf_tt_task_action`);
  const startId = resumeAt != null ? resumeAt : await findStartIdBy(crm, 'tblAction', 'ActionID', 'CompletedOn', cutoff, mn, mx);
  // Drop machine-written notes at staging time (same classifier the live capture
  // and drill-down use) so TOUCHED_ITEMS is already clean. No bind params.
  const keepHuman = excludeSystem ? ` AND ${buildSystemNoteExclusionSql('a.Note')}` : '';
  console.log(`  task action scan window: ids ${startId}..${mx} (CompletedOn >= ${cutoff})${excludeSystem ? ' [system notes excluded]' : ''}`);
  let total = 0;
  for (let lo = startId; lo <= mx; lo += HIST_CHUNK) {
    const [rows] = await crm.query<mysql.RowDataPacket[]>(
      `SELECT a.TaskID, DATE(a.CompletedOn) AS d, a.CompletedBy AS user_id, t.TaskTypeID AS task_type_id
       FROM tblAction a
       JOIN tblTask t     ON t.TaskID = a.TaskID
       JOIN tblTaskType tt ON tt.TaskTypeID = t.TaskTypeID AND tt.DeptID IN (${TASK_DEPTS.join(',')})
       WHERE a.ActionID >= ? AND a.ActionID < ? AND a.CompletedOn >= ?
         AND a.Note <> '' AND a.CompletedBy IS NOT NULL AND t.TaskTypeID <> ${EXCLUDED_TASK_TYPE}${keepHuman}`,
      [lo, lo + HIST_CHUNK, cutoff],
    );
    await batchInsert(
      `INSERT IGNORE INTO bf_tt_task_action (task_id, action_date, user_id, task_type_id) VALUES ?`,
      rows.filter((r) => r.d).map((r) => [r.TaskID, r.d, r.user_id, r.task_type_id]),
    );
    await setMarker('actions', lo + HIST_CHUNK);
    total += rows.length;
    console.log(`  task action scan ${Math.min(lo + HIST_CHUNK, mx)}/${mx} ids (+${rows.length}, total ${total})`);
  }
}

/** Ticket touches by actor: one deduped (ticket_id, calendar day, actor) row per
 *  tblTicketNote within the window. Actor = tblTicketNote.CreatedBy. */
async function extractTicketNotes(crm: CrmClient, cutoff: string, excludeSystem: boolean): Promise<void> {
  const [[range]] = await crm.query<mysql.RowDataPacket[]>(`SELECT MIN(TicketNoteID) mn, MAX(TicketNoteID) mx FROM tblTicketNote`);
  const mn = Number(range.mn ?? 0);
  const mx = Number(range.mx ?? 0);
  const resumeAt = await getMarker('notes');
  if (resumeAt == null) await pool.query(`TRUNCATE TABLE bf_tt_ticket_note`);
  const startId = resumeAt != null ? resumeAt : await findStartIdBy(crm, 'tblTicketNote', 'TicketNoteID', 'CreatedOn', cutoff, mn, mx);
  // Same system-note exclusion as the task side so ticket touches match capture.
  const keepHuman = excludeSystem ? ` AND ${buildSystemNoteExclusionSql('tn.Note')}` : '';
  console.log(`  ticket note scan window: ids ${startId}..${mx} (CreatedOn >= ${cutoff})${excludeSystem ? ' [system notes excluded]' : ''}`);
  let total = 0;
  for (let lo = startId; lo <= mx; lo += SMALL_CHUNK) {
    const [rows] = await crm.query<mysql.RowDataPacket[]>(
      `SELECT tn.TicketID, DATE(tn.CreatedOn) AS d, tn.CreatedBy AS user_id
       FROM tblTicketNote tn
       WHERE tn.TicketNoteID >= ? AND tn.TicketNoteID < ? AND tn.CreatedOn >= ? AND tn.CreatedBy IS NOT NULL${keepHuman}`,
      [lo, lo + SMALL_CHUNK, cutoff],
    );
    await batchInsert(
      `INSERT IGNORE INTO bf_tt_ticket_note (ticket_id, note_date, user_id) VALUES ?`,
      rows.filter((r) => r.d).map((r) => [r.TicketID, r.d, r.user_id]),
    );
    await setMarker('notes', lo + SMALL_CHUNK);
    total += rows.length;
    console.log(`  ticket note scan ${Math.min(lo + SMALL_CHUNK, mx)}/${mx} ids (+${rows.length}, total ${total})`);
  }
}

/** Run a phase once; completed phases are skipped on re-runs via the marker. */
async function phase(name: string, label: string, fn: () => Promise<void>): Promise<void> {
  if ((await getMarker(name)) === -1) {
    console.log(`${label}: already done, skipping.`);
    return;
  }
  console.log(`${label}...`);
  await fn();
  await setMarker(name, -1);
}

export async function runExtraction(histFrom: string): Promise<void> {
  // The reconstruction only reads archived rows with archived_on > snapshot-8am,
  // so history older than the window's first day is never used. Cut off at
  // midnight of histFrom (a few hours before the earliest 8am moment).
  const cutoff = `${histFrom} 00:00:00`;
  // Touched cleanup toggle (default ON): exclude machine-written notes so the
  // reconstructed Touched matches the live capture. Mirrors captureDailyTicketProductivity.
  const [exclCfg] = await pool.query<RowDataPacket[]>(
    `SELECT config_value FROM ie_config WHERE config_key = ?`, [TOUCHED_EXCLUDE_SYSTEM_FLAG],
  );
  const excludeSystem = systemExclusionEnabled(exclCfg[0]?.config_value as string | undefined);
  const crm = new CrmClient();
  try {
    await phase('lookups', 'Extracting CRM lookups', () => extractLookups(crm));
    await phase('tickets', 'Extracting tickets + status history', () => extractTickets(crm));
    await phase('main', 'Extracting task history (main population scan)', async () => {
      // Fresh start only: a resume (numeric marker) must keep what it has.
      if ((await getMarker('main')) == null) await pool.query(`TRUNCATE TABLE bf_tt_task_hist`);
      await extractTaskHistoryMain(crm, cutoff);
    });
    await phase('linked', 'Extracting task history (ticket-linked tasks)', () => extractTaskHistoryForTickets(crm, cutoff));
    await phase('current', 'Extracting current task rows', () => extractCurrentTasks(crm));
    await phase('actions', 'Extracting task actions (touched-by-actor)', () => extractTaskActions(crm, cutoff, excludeSystem));
    await phase('notes', 'Extracting ticket notes (touched-by-actor)', () => extractTicketNotes(crm, cutoff, excludeSystem));
  } finally {
    await crm.end();
  }
}
