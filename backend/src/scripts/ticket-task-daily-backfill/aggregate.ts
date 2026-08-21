/**
 * Reconstruction phase of the Tickets & Tasks daily-history backfill.
 *
 * For each snapshot day D, the as-of moment is 'D 08:00:00' in CRM wall time
 * (= ET). State of a task at that moment = its bf_tt_task_hist row with the
 * smallest archived_on strictly after the moment (pre-change archive
 * semantics; the current tblTask row sits at the 9999-01-01 sentinel so a
 * match always exists). Population/bucket rules mirror the live report:
 *
 *   Tasks   — dept 1/2 task types, type != 19, status open per
 *             tblTaskStatus.Closed with the 'Contact Past Due' exception, and
 *             the extract's 2-month recently-completed tail evaluated as-of D.
 *   Tickets — status != 5 as of D (latest status-history row, MAX(id) like the
 *             live extract), bucketed by the linked task's as-of DueOn.
 *             Ticket assignee changes are not audited, so the CURRENT assignee
 *             attributes historical ticket rows (known caveat).
 *
 * Agents conform exactly like the live pipeline: salesperson email ->
 * ie_dim_employee (is_current, role CSR) -> department subtree decides the
 * sales/csr area. Rows land in ie_ticket_task_daily with is_backfilled = 1 and
 * never touch live-captured (is_backfilled = 0) days.
 */
import { RowDataPacket } from 'mysql2';
import pool from '../../config/database';
// Same "who is an agent" rule the live pipeline uses — imported, not re-declared.
import { AGENT_ROLE, SALES_DEPT_ROOT_PATH } from '../../services/insightsAgentScope';

/** The one task type the Sales Productivity page splits out from everything else. */
const CONTACT_MANAGER_TITLE = 'Contact Manager';
/** Segment for a row given a task-type title column: Contact Manager vs everything else. */
const segCase = (titleCol: string): string =>
  `CASE WHEN ${titleCol} = '${CONTACT_MANAGER_TITLE}' THEN 'contact_manager' ELSE 'other' END`;

const AREA_CASE = `CASE WHEN dpt.hierarchy_path = ? OR dpt.hierarchy_path LIKE CONCAT(?, '/%') THEN 'sales' ELSE 'csr' END`;

const AGENT_JOINS = `
  JOIN ie_dim_employee e ON e.is_current = 1 AND e.role_name = '${AGENT_ROLE}'
   AND LOWER(TRIM(e.email)) = LOWER(TRIM(sp.email))
  JOIN ie_dim_department dpt ON dpt.is_current = 1 AND dpt.department_key = e.department_key`;

/** As-of task state: the archived row with MIN(archived_on) > the snapshot moment. */
const ASOF_TASK = `
  SELECT hh.task_id, hh.due_on, hh.task_status_id, hh.completed_on, hh.assigned_to, hh.task_type_id, hh.created_on
  FROM bf_tt_task_hist hh
  JOIN (SELECT task_id, MIN(archived_on) AS a FROM bf_tt_task_hist WHERE archived_on > ? GROUP BY task_id) m
    ON m.task_id = hh.task_id AND hh.archived_on = m.a`;

const bucketExprs = `
  SUM(h.due_on IS NOT NULL AND DATE(h.due_on) > ?) AS cur,
  SUM(h.due_on IS NOT NULL AND DATE(h.due_on) = ?) AS due_today,
  SUM(h.due_on IS NOT NULL AND DATE(h.due_on) < ?) AS past_due`;

function taskDaySql(insert: boolean): string {
  return `${insert ? `INSERT INTO ie_ticket_task_daily
    (snapshot_date, area, employee_key, agent_name, department_name, cur, due_today, past_due, is_backfilled)` : ''}
  SELECT ? AS snapshot_date, ${AREA_CASE} AS area, e.employee_key, MAX(sp.name) AS agent_name, MAX(dpt.department_name) AS department_name,
         ${bucketExprs}${insert ? ', 1' : ''}
  FROM (${ASOF_TASK}) h
  JOIN bf_tt_task_type ty ON ty.task_type_id = h.task_type_id AND ty.dept_id IN (1,2)
  JOIN bf_tt_task_status ts ON ts.task_status_id = h.task_status_id
   AND (ts.closed = 0 OR ts.title = 'Contact Past Due')
  JOIN bf_tt_salespeople sp ON sp.user_id = h.assigned_to
  ${AGENT_JOINS}
  WHERE h.task_type_id <> 19
    AND h.created_on IS NOT NULL AND h.created_on <= ?
    AND (h.completed_on IS NULL OR h.completed_on >= DATE_SUB(?, INTERVAL 2 MONTH))
  GROUP BY area, e.employee_key
  HAVING cur > 0 OR due_today > 0 OR past_due > 0`;
}

function ticketDaySql(insert: boolean): string {
  // VALUES() is deprecated in MySQL 8.0.20+ but is the only ON DUPLICATE form
  // that works with INSERT ... SELECT; the additive update merges ticket counts
  // into agent rows the task insert already created.
  return `${insert ? `INSERT INTO ie_ticket_task_daily
    (snapshot_date, area, employee_key, agent_name, department_name, cur, due_today, past_due, is_backfilled)` : ''}
  SELECT ? AS snapshot_date, ${AREA_CASE} AS area, e.employee_key, MAX(sp.name) AS agent_name, MAX(dpt.department_name) AS department_name,
         ${bucketExprs}${insert ? ', 1' : ''}
  FROM bf_tt_ticket t
  JOIN (SELECT ticket_id, MAX(id) AS mid FROM bf_tt_ticket_status WHERE created_on <= ? GROUP BY ticket_id) sx
    ON sx.ticket_id = t.ticket_id
  JOIN bf_tt_ticket_status s ON s.id = sx.mid AND s.status_id <> 5
  JOIN (${ASOF_TASK}) h ON h.task_id = t.task_id
  JOIN bf_tt_salespeople sp ON sp.user_id = t.assigned_to
  ${AGENT_JOINS}
  WHERE t.task_id > 0 AND t.created_on IS NOT NULL AND t.created_on <= ?
  GROUP BY area, e.employee_key
  HAVING cur > 0 OR due_today > 0 OR past_due > 0${insert ? `
  ON DUPLICATE KEY UPDATE
    cur = cur + VALUES(cur), due_today = due_today + VALUES(due_today), past_due = past_due + VALUES(past_due)` : ''}`;
}

/** Both day statements bind the same params in the same order: snapshot_date,
 *  the two AREA_CASE paths, the three bucket comparisons, then the three
 *  as-of-moment timestamps (as-of join, created-by, completed-tail). */
const dayParams = (day: string, ts: string, sales: string): unknown[] =>
  [day, sales, sales, day, day, day, ts, ts, ts];

/** Reconstruct and persist one snapshot day. Returns false when skipped. */
export async function backfillDay(day: string, force: boolean): Promise<boolean> {
  const ts = `${day} 08:00:00`;
  const [live] = await pool.query<RowDataPacket[]>(
    `SELECT MAX(is_backfilled = 0) AS hasLive, MAX(is_backfilled = 1) AS hasBackfill
     FROM ie_ticket_task_daily WHERE snapshot_date = ?`,
    [day],
  );
  if (live.length && Number(live[0].hasLive) === 1) return false;          // never touch live captures
  if (live.length && Number(live[0].hasBackfill) === 1 && !force) return false; // resume support
  await pool.query(`DELETE FROM ie_ticket_task_daily WHERE snapshot_date = ? AND is_backfilled = 1`, [day]);
  await pool.query(taskDaySql(true), dayParams(day, ts, SALES_DEPT_ROOT_PATH));
  await pool.query(ticketDaySql(true), dayParams(day, ts, SALES_DEPT_ROOT_PATH));
  return true;
}

interface AreaTotals { current: number; dueToday: number; pastDue: number }

/**
 * Dry-run reconstruction of one day, summed per area — nothing is written.
 * Used by --validate to compare recent days against the live report.
 */
export async function reconstructDayTotals(day: string): Promise<Record<string, AreaTotals>> {
  const ts = `${day} 08:00:00`;
  const totals: Record<string, AreaTotals> = {
    sales: { current: 0, dueToday: 0, pastDue: 0 },
    csr: { current: 0, dueToday: 0, pastDue: 0 },
  };
  for (const sql of [taskDaySql(false), ticketDaySql(false)]) {
    const [rows] = await pool.query<RowDataPacket[]>(sql, dayParams(day, ts, SALES_DEPT_ROOT_PATH));
    for (const r of rows) {
      const t = totals[r.area as string];
      t.current += Number(r.cur);
      t.dueToday += Number(r.due_today);
      t.pastDue += Number(r.past_due);
    }
  }
  return totals;
}

// ── Productivity roll-up (beginning / new assigned / touched / closed) ───────

/**
 * Per-metric aggregation wrapper: given a subquery that yields (item, user_id)
 * rows for one day, conform the user (the assignee for new/closed, the ACTOR
 * for touched) exactly like the bucket backfill (bf_tt_salespeople ->
 * ie_dim_employee CSR -> department subtree -> area) and COUNT(DISTINCT item)
 * per (area, employee_key). Non-conformed users (system accounts, managers)
 * drop out. Params: the two AREA_CASE paths, then whatever the items subquery
 * binds.
 */
function metricSql(itemsSubquery: string): string {
  return `SELECT ${AREA_CASE} AS area, e.employee_key AS employee_key, x.segment AS segment,
            MAX(sp.name) AS agent_name, MAX(dpt.department_name) AS department_name,
            COUNT(DISTINCT x.item) AS n
          FROM (${itemsSubquery}) x
          JOIN bf_tt_salespeople sp ON sp.user_id = x.user_id
          ${AGENT_JOINS}
          GROUP BY area, e.employee_key, x.segment`;
}

/** One task row per task_id (created/completed/assignee + segment), restricted to
 *  the task-side population (dept 1/2, type <> 19). Segment splits Contact Manager
 *  tasks from all other task types. */
const TASK_AGG = `
  SELECT t.task_id, t.assigned_to, t.created_on, t.completed_on, ${segCase('ty.title')} AS segment
  FROM (SELECT task_id, MAX(assigned_to) AS assigned_to, MAX(task_type_id) AS task_type_id,
               MAX(created_on) AS created_on, MAX(completed_on) AS completed_on
        FROM bf_tt_task_hist GROUP BY task_id) t
  JOIN bf_tt_task_type ty ON ty.task_type_id = t.task_type_id AND ty.dept_id IN (1,2)
  WHERE t.task_type_id <> 19`;

// New assigned: created that day (tasks + tickets). Tickets are always 'other'.
const NEW_ITEMS = `
  SELECT CONCAT('T', t.task_id) AS item, t.assigned_to AS user_id, t.segment AS segment
  FROM (${TASK_AGG}) t WHERE t.created_on IS NOT NULL AND DATE(t.created_on) = ?
  UNION ALL
  SELECT CONCAT('K', k.ticket_id) AS item, k.assigned_to AS user_id, 'other' AS segment
  FROM bf_tt_ticket k WHERE k.created_on IS NOT NULL AND DATE(k.created_on) = ?`;

// Closed: task completed that day, or ticket status -> 5 (Closed) that day.
const CLOSED_ITEMS = `
  SELECT CONCAT('T', t.task_id) AS item, t.assigned_to AS user_id, t.segment AS segment
  FROM (${TASK_AGG}) t WHERE t.completed_on IS NOT NULL AND DATE(t.completed_on) = ?
  UNION ALL
  SELECT CONCAT('K', k.ticket_id) AS item, k.assigned_to AS user_id, 'other' AS segment
  FROM bf_tt_ticket k
  WHERE k.ticket_id IN (SELECT ticket_id FROM bf_tt_ticket_status WHERE status_id = 5 AND DATE(created_on) = ?)`;

// Touched: distinct items the agent had a NOTED ACTION on that day, attributed
// to the ACTOR (who did the work), not the assignee — sourced from tblAction /
// tblTicketNote via the bf_tt_task_action / bf_tt_ticket_note work tables. Since
// only real notes/actions land there, system state changes and manager
// reassignments never count, and the actor conform (below) drops managers.
// Segment comes from the touched task's type (bf_tt_task_action.task_type_id);
// ticket notes are always 'other'.
const TOUCHED_ITEMS = `
  SELECT CONCAT('T', ta.task_id) AS item, ta.user_id AS user_id, ${segCase('ty.title')} AS segment
  FROM bf_tt_task_action ta
  LEFT JOIN bf_tt_task_type ty ON ty.task_type_id = ta.task_type_id
  WHERE ta.action_date = ?
  UNION ALL
  SELECT CONCAT('K', tn.ticket_id) AS item, tn.user_id AS user_id, 'other' AS segment
  FROM bf_tt_ticket_note tn WHERE tn.note_date = ?`;

// Contact Manager beginning per (area, employee): open CM tasks with a due date
// as-of the morning. The bucket carries the segment-less TOTAL beginning, so we
// only recompute the CM slice here and derive other = total - CM (matching the
// live capture, so backfilled and live rows use identical math). CM is one task
// type, so the inner as-of is filtered to CM rows before grouping.
//
// bf_tt_task_hist has no standalone archived_on index, so the as-of range scan
// runs ~15-25s — over the 25s session cap. A per-query MAX_EXECUTION_TIME hint
// (5 min) overrides the cap for just this read; it's a one-time backfill.
// Params: the two AREA_CASE paths, then the as-of moment three times (inner
// as-of range, created-on cutoff, completed-tail cutoff).
const CM_TASK_BEGIN = `
  SELECT /*+ MAX_EXECUTION_TIME(300000) */
         ${AREA_CASE} AS area, e.employee_key AS employee_key,
         SUM(h.due_on IS NOT NULL) AS n
  FROM (
    SELECT hh.task_id, hh.due_on, hh.task_status_id, hh.completed_on, hh.assigned_to, hh.created_on
    FROM bf_tt_task_hist hh
    JOIN (SELECT hh2.task_id, MIN(hh2.archived_on) AS a
          FROM bf_tt_task_hist hh2
          JOIN bf_tt_task_type ty2 ON ty2.task_type_id = hh2.task_type_id AND ty2.title = '${CONTACT_MANAGER_TITLE}'
          WHERE hh2.archived_on > ? GROUP BY hh2.task_id) m
      ON m.task_id = hh.task_id AND hh.archived_on = m.a
  ) h
  JOIN bf_tt_task_status ts ON ts.task_status_id = h.task_status_id
   AND (ts.closed = 0 OR ts.title = 'Contact Past Due')
  JOIN bf_tt_salespeople sp ON sp.user_id = h.assigned_to
  ${AGENT_JOINS}
  WHERE h.created_on IS NOT NULL AND h.created_on <= ?
    AND (h.completed_on IS NULL OR h.completed_on >= DATE_SUB(?, INTERVAL 2 MONTH))
  GROUP BY area, e.employee_key
  HAVING n > 0`;

interface ProdAcc { segment: string; agentName: string | null; departmentName: string | null; beginning: number; newAssigned: number; touched: number; closed: number }

/** Reconstruct one day's per-(area, employee, segment) productivity entirely
 *  from the bf_tt_* work tables. Beginning is recomputed per segment (rather than
 *  read from the segment-less bucket) so Contact Manager can be split; CM + other
 *  still equals the bucket total because the population/rules match. */
async function reconstructProductivityDay(day: string): Promise<Map<string, { area: string; employeeKey: number } & ProdAcc>> {
  const ts = `${day} 08:00:00`;
  const acc = new Map<string, { area: string; employeeKey: number } & ProdAcc>();
  const key = (area: string, ek: number, seg: string) => `${area}:${ek}:${seg}`;
  const ensure = (area: string, ek: number, seg: string, name: string | null, dept: string | null) => {
    const k = key(area, ek, seg);
    let row = acc.get(k);
    if (!row) { row = { area, employeeKey: ek, segment: seg, agentName: name, departmentName: dept, beginning: 0, newAssigned: 0, touched: 0, closed: 0 }; acc.set(k, row); }
    if (!row.agentName && name) row.agentName = name;
    if (!row.departmentName && dept) row.departmentName = dept;
    return row;
  };

  // Beginning: TOTAL per (area, employee) from the already-computed bucket, then
  // split off the Contact Manager slice (other = total - CM). Fast bucket read +
  // one CM-only as-of scan, instead of re-scanning the full population per day.
  const [beginRows] = await pool.query<RowDataPacket[]>(
    `SELECT area, employee_key, MAX(agent_name) AS agent_name, MAX(department_name) AS department_name,
            SUM(cur + due_today + past_due) AS beginning
     FROM ie_ticket_task_daily WHERE snapshot_date = ? GROUP BY area, employee_key`,
    [day],
  );
  const [cmRows] = await pool.query<RowDataPacket[]>(CM_TASK_BEGIN, [SALES_DEPT_ROOT_PATH, SALES_DEPT_ROOT_PATH, ts, ts, ts]);
  const cmByKey = new Map<string, number>();
  for (const r of cmRows) cmByKey.set(`${r.area}:${Number(r.employee_key)}`, Number(r.n));
  for (const b of beginRows) {
    const area = b.area as string;
    const ek = Number(b.employee_key);
    const name = (b.agent_name as string | null) ?? null;
    const dept = (b.department_name as string | null) ?? null;
    const total = Number(b.beginning);
    const cm = Math.min(cmByKey.get(`${area}:${ek}`) ?? 0, total);
    const other = total - cm;
    if (cm > 0) ensure(area, ek, 'contact_manager', name, dept).beginning += cm;
    if (other > 0) ensure(area, ek, 'other', name, dept).beginning += other;
  }

  const metrics: Array<[string, unknown[], keyof ProdAcc]> = [
    [metricSql(NEW_ITEMS), [SALES_DEPT_ROOT_PATH, SALES_DEPT_ROOT_PATH, day, day], 'newAssigned'],
    [metricSql(TOUCHED_ITEMS), [SALES_DEPT_ROOT_PATH, SALES_DEPT_ROOT_PATH, day, day], 'touched'],
    [metricSql(CLOSED_ITEMS), [SALES_DEPT_ROOT_PATH, SALES_DEPT_ROOT_PATH, day, day], 'closed'],
  ];
  for (const [sql, params, field] of metrics) {
    const [rows] = await pool.query<RowDataPacket[]>(sql, params);
    for (const r of rows) {
      const row = ensure(r.area as string, Number(r.employee_key), r.segment as string, (r.agent_name as string | null) ?? null, (r.department_name as string | null) ?? null);
      (row[field] as number) += Number(r.n);
    }
  }
  return acc;
}

/** Reconstruct and persist one productivity day (is_backfilled = 1). Returns false when skipped. */
export async function productivityDay(day: string, force: boolean): Promise<boolean> {
  const [live] = await pool.query<RowDataPacket[]>(
    `SELECT MAX(is_backfilled = 0) AS hasLive, MAX(is_backfilled = 1) AS hasBackfill
     FROM ie_ticket_task_productivity_daily WHERE snapshot_date = ?`,
    [day],
  );
  if (live.length && Number(live[0].hasLive) === 1) return false;               // never touch live captures
  if (live.length && Number(live[0].hasBackfill) === 1 && !force) return false; // resume support

  const acc = await reconstructProductivityDay(day);
  const values = [...acc.values()].filter((r) => r.beginning || r.newAssigned || r.touched || r.closed);
  await pool.query(`DELETE FROM ie_ticket_task_productivity_daily WHERE snapshot_date = ? AND is_backfilled = 1`, [day]);
  if (values.length === 0) return true;

  await pool.query(
    `INSERT INTO ie_ticket_task_productivity_daily
       (snapshot_date, area, employee_key, segment, agent_name, department_name, beginning, new_assigned, touched, closed, is_backfilled)
     VALUES ${values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)').join(', ')}`,
    values.flatMap((r) => [day, r.area, r.employeeKey, r.segment, r.agentName, r.departmentName, r.beginning, r.newAssigned, r.touched, r.closed]),
  );
  return true;
}

/** Dry-run productivity reconstruction for one day, summed per (area, segment) —
 *  nothing is written. Keyed 'sales', 'sales:contact_manager', 'csr', etc. so the
 *  validation can eyeball the Contact Manager split. */
export interface ProdMetrics { beginning: number; newAssigned: number; touched: number; closed: number }
export async function reconstructProductivityTotals(day: string): Promise<Record<string, ProdMetrics>> {
  const zero = (): ProdMetrics => ({ beginning: 0, newAssigned: 0, touched: 0, closed: 0 });
  const totals: Record<string, ProdMetrics> = { sales: zero(), csr: zero() };
  const add = (k: string, r: ProdMetrics) => {
    const t = (totals[k] ??= zero());
    t.beginning += r.beginning; t.newAssigned += r.newAssigned; t.touched += r.touched; t.closed += r.closed;
  };
  const acc = await reconstructProductivityDay(day);
  for (const r of acc.values()) {
    if (!totals[r.area]) continue;
    add(r.area, r);                       // per-area total (both segments)
    add(`${r.area}:${r.segment}`, r);     // per-area, per-segment breakdown
  }
  return totals;
}

/** The live report's grand totals per area, straight from ie_fact_ticket_task (buckets vs CURDATE()). */
export async function liveReportTotals(): Promise<Record<string, AreaTotals>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${AREA_CASE} AS area,
            SUM(f.next_contact IS NOT NULL AND DATE(f.next_contact) > CURDATE()) AS cur,
            SUM(f.next_contact IS NOT NULL AND DATE(f.next_contact) = CURDATE()) AS due_today,
            SUM(f.next_contact IS NOT NULL AND DATE(f.next_contact) < CURDATE()) AS past_due
     FROM ie_fact_ticket_task f
     JOIN ie_dim_employee e ON e.is_current = 1 AND e.employee_key = f.employee_key AND e.role_name = '${AGENT_ROLE}'
     JOIN ie_dim_department dpt ON dpt.is_current = 1 AND dpt.department_key = e.department_key
     GROUP BY area`,
    [SALES_DEPT_ROOT_PATH, SALES_DEPT_ROOT_PATH],
  );
  const totals: Record<string, AreaTotals> = {
    sales: { current: 0, dueToday: 0, pastDue: 0 },
    csr: { current: 0, dueToday: 0, pastDue: 0 },
  };
  for (const r of rows) {
    totals[r.area as string] = { current: Number(r.cur), dueToday: Number(r.due_today), pastDue: Number(r.past_due) };
  }
  return totals;
}
