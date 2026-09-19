/**
 * CRM candidate discovery — the SQL half of resolving which account, opportunity
 * and salesperson a reviewed call belongs to.
 *
 * Three defects from the September 17 assessment live here:
 *
 *   1. ACCOUNT TASKS WERE MISSED. Candidates were keyed on the matched ContactID
 *      or CustomerLeadID only. A real task frequently has a null ContactID, and
 *      a Contact Manager task normally carries CustomerLeadID 0 — so the account's
 *      own CM, which is where the sales history for an existing customer lives,
 *      was invisible. Candidates now also expand through the verified CustomerID.
 *   2. OPEN WAS DETECTED WRONG. `CompletedOn IS NULL` matches nothing: the column
 *      is NOT NULL and an open task carries the `1-1-1` sentinel. And because a
 *      source bug leaves many genuinely finished tasks with no CompletedOn at all,
 *      the authoritative signal is `tblTaskStatus.Closed` — exactly as
 *      `workers/sql/task_open.extract.sql` reads it, including its one documented
 *      exception ('Contact Past Due' is Closed = 1 yet still actionable). The flag
 *      is `tblTaskStatus.Closed`, a BIT the mysql2 driver hands back as a Buffer;
 *      like the proven extract it is resolved on the SQL side (`CAST(... AS
 *      UNSIGNED)`) so the caller compares an integer, never a Buffer, and a value
 *      we cannot parse is reported as unknown rather than promoted to open.
 *   3. LATEST ACTIVITY LEAKED THE FUTURE. The ranking column was `MAX(last
 *      action)` over all time, so a record touched last week outranked the record
 *      the call was actually about. Every activity aggregate here is bounded at
 *      the same day cutoff the note thread uses.
 *
 * Dates come back as `CAST(... AS CHAR)` for the same reason `crmTicketHeader`
 * does it: mysql2 turns a `0000-00-00` into an invalid Date, and `0001-01-01
 * 05:00:00` parses as year 2001. `crmDates` interprets the strings.
 */
import { executeQuery } from '../../../utils/databaseUtils';
import logger from '../../../config/logger';

const inList = (n: number) => Array.from({ length: n }, () => '?').join(',');

/**
 * The CRM runs an older MySQL/MariaDB with no REGEXP_REPLACE, so phone
 * separators are stripped with nested REPLACE (the approach
 * CallTicketLinkerService established) and the last 10 digits compared.
 */
const digits = (col: string) =>
  `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${col}, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), '+', '')`;

/** A task action's real event time: completion when completed, else creation. */
const ACTION_AT = `CASE WHEN a.CompletedOn > '1970-01-01' THEN a.CompletedOn ELSE a.CreatedOn END`;

/** Contacts whose Phone1/Phone2 last-10 matches any of the call's numbers. */
export async function resolveContactIds(numbers: string[]): Promise<number[]> {
  if (numbers.length === 0) return [];
  const ph = inList(numbers.length);
  try {
    const rows = await executeQuery<{ ContactID: number }>(
      `SELECT DISTINCT ContactID FROM tblContactPhone
        WHERE RIGHT(${digits('Phone1')}, 10) IN (${ph})
           OR RIGHT(${digits('Phone2')}, 10) IN (${ph})`,
      [...numbers, ...numbers],
      'crm',
    );
    return rows.map((r) => Number(r.ContactID)).filter((n) => Number.isFinite(n) && n > 0);
  } catch (err) {
    logger.warn(`[MISSED OPPS] contact lookup failed: ${(err as Error).message}`);
    return [];
  }
}

export interface AccountIdentity {
  contactIds: number[];
  /** Verified customer accounts behind those contacts and their leads. */
  customerIds: number[];
  /** Real lead ids only — zero is not a lead, it is "no lead". */
  leadIds: number[];
  /** Account/contact names for corroborating the phone match independently. */
  names: string[];
  /** True when a lookup failed, so an empty result is not a negative answer. */
  unavailable: boolean;
}

/**
 * Customers, leads and names behind the matched contacts.
 *
 * Separate accounts stay separate: this only follows links the CRM itself
 * records (contact -> customer, lead -> customer). A shared phone, brand or
 * owner is not a link.
 */
export async function loadAccountIdentity(contactIds: number[]): Promise<AccountIdentity> {
  const base: AccountIdentity = {
    contactIds, customerIds: [], leadIds: [], names: [], unavailable: false,
  };
  if (contactIds.length === 0) return base;
  const ph = inList(contactIds.length);
  try {
    const leads = await executeQuery<{
      CustomerLeadID: number; CustomerID: number | null; Name: string | null;
    }>(
      `SELECT CustomerLeadID, CustomerID, Name FROM tblCustomerLead
        WHERE ContactID IN (${ph})`,
      contactIds, 'crm',
    );
    const contacts = await executeQuery<{
      CustomerID: number | null; Name: string | null;
    }>(
      `SELECT DISTINCT c.CustomerID, cu.Name
         FROM tblContacts c
         LEFT JOIN tblCustomers cu ON cu.CustomerID = c.CustomerID
        WHERE c.ContactID IN (${ph})`,
      contactIds, 'crm',
    );
    const positive = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    return {
      contactIds,
      customerIds: unique([...leads, ...contacts].map((r) => positive(r.CustomerID))),
      leadIds: unique(leads.map((l) => positive(l.CustomerLeadID))),
      names: unique([...leads, ...contacts].map((r) => (r.Name ?? '').trim() || null)),
      unavailable: false,
    };
  } catch (err) {
    logger.warn(`[MISSED OPPS] account identity lookup failed: ${(err as Error).message}`);
    return { ...base, unavailable: true };
  }
}

function unique<T>(values: Array<T | null>): T[] {
  return [...new Set(values.filter((v): v is T => v !== null))];
}

/** How a candidate task was reached, which is part of whether to trust it. */
export type TaskMatchPath = 'contact' | 'lead' | 'customer';

export interface TaskCandidateRow {
  TaskID: number;
  TaskTypeID: number | null;
  taskType: string | null;
  statusTitle: string | null;
  /** tblTaskStatus.Closed — the CRM's authoritative terminal-status flag. */
  statusClosed: number | null;
  ContactID: number | null;
  CustomerID: number | null;
  CustomerLeadID: number | null;
  accountName: string | null;
  completedOn: string | null;
  createdOn: string | null;
  dueOn: string | null;
  AssignedTo: number | null;
  ownerName: string | null;
  /** Latest action on or before the cutoff — never future activity. */
  lastActionOn: string | null;
  /** Actions on or before the cutoff, so "no history" is distinguishable. */
  actionCount: number;
}

/**
 * Sales work lives on the lead-task (TaskTypeID 11, "Lead Manager") and on
 * Contact Manager. Contact Update Manager and the other types are bookkeeping
 * stubs — grading against an empty "Created Contact Update Manager Task" line
 * instead of the research on the lead is what this narrowing prevents.
 */
const SALES_TASK_SQL = `(t.TaskTypeID = 11 OR tt.Title = 'Contact Manager')`;

/**
 * One projection for every task read, so a candidate found by phone and a
 * successor found by following a duplicate note arrive in the same shape and go
 * through the same validation. The two `?` are both the activity cutoff.
 */
const TASK_SELECT = `
SELECT t.TaskID, t.TaskTypeID, t.ContactID, t.CustomerID, t.CustomerLeadID, t.AssignedTo,
       tt.Title AS taskType,
       ts.Title AS statusTitle,
       CAST(ts.Closed AS UNSIGNED) AS statusClosed,
       sp.SalesPersonName AS ownerName,
       COALESCE(cu.Name, cl.Name) AS accountName,
       CAST(t.CompletedOn AS CHAR) AS completedOn,
       CAST(t.CreatedOn   AS CHAR) AS createdOn,
       CAST(t.DueOn       AS CHAR) AS dueOn,
       CAST(MAX(CASE WHEN ${ACTION_AT} <= ? THEN ${ACTION_AT} END) AS CHAR) AS lastActionOn,
       SUM(CASE WHEN ${ACTION_AT} <= ? THEN 1 ELSE 0 END) AS actionCount
  FROM tblTask t
  LEFT JOIN tblTaskType     tt ON tt.TaskTypeID = t.TaskTypeID
  LEFT JOIN tblTaskStatus   ts ON ts.TaskTypeID = t.TaskTypeID
                              AND ts.TaskStatusID = t.TaskStatusID
  LEFT JOIN my_aspnet_users au ON au.id = t.AssignedTo
  LEFT JOIN tblSalesPeople  sp ON sp.UserID = au.id AND sp.UserID NOT IN (12)
  LEFT JOIN tblAction       a  ON a.TaskID = t.TaskID
  LEFT JOIN tblCustomers    cu ON cu.CustomerID = t.CustomerID
  LEFT JOIN tblCustomerLead cl ON cl.CustomerLeadID = t.CustomerLeadID
`;

const TASK_GROUP_BY = `
GROUP BY t.TaskID, t.TaskTypeID, t.ContactID, t.CustomerID, t.CustomerLeadID, t.AssignedTo,
         tt.Title, ts.Title, ts.Closed, sp.SalesPersonName, accountName,
         t.CompletedOn, t.CreatedOn, t.DueOn
`;

export interface FindTasksArgs {
  contactIds: number[];
  /** Positive lead ids only; the caller must not pass zero. */
  leadIds: number[];
  customerIds: number[];
  /** Activity cutoff, `YYYY-MM-DD HH:MM:SS` — the reviewed day's end. */
  notAfter: string;
}

/**
 * Candidate Lead Manager / Contact Manager tasks on the verified account.
 *
 * Expanded by CustomerID as well as contact and lead, which is what surfaces the
 * account CM (null ContactID, CustomerLeadID 0). The zero lead id is filtered by
 * the caller, never matched here — `CustomerLeadID IN (0)` would union every
 * Contact Manager task in the CRM into one "shared lead".
 */
export async function findTaskCandidates(args: FindTasksArgs): Promise<TaskCandidateRow[] | null> {
  const where: string[] = [];
  const params: Array<number | string> = [];
  if (args.contactIds.length) {
    where.push(`t.ContactID IN (${inList(args.contactIds.length)})`);
    params.push(...args.contactIds);
  }
  const leadIds = args.leadIds.filter((n) => Number.isFinite(n) && n > 0);
  if (leadIds.length) {
    where.push(`t.CustomerLeadID IN (${inList(leadIds.length)})`);
    params.push(...leadIds);
  }
  if (args.customerIds.length) {
    where.push(`t.CustomerID IN (${inList(args.customerIds.length)})`);
    params.push(...args.customerIds);
  }
  if (where.length === 0) return [];

  try {
    return await executeQuery<TaskCandidateRow>(
      `${TASK_SELECT}
        WHERE (${where.join(' OR ')})
          AND ${SALES_TASK_SQL}
        ${TASK_GROUP_BY}
        ORDER BY t.TaskID DESC
        LIMIT 60`,
      [args.notAfter, args.notAfter, ...params],
      'crm',
    );
  } catch (err) {
    logger.warn(`[MISSED OPPS] task candidate lookup failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Specific tasks by id, in the same shape and with the same activity bound as a
 * phone-discovered candidate. Used to VALIDATE a reference extracted from a
 * duplicate-closure note: a note is data, so the id it mentions has to be looked
 * up and checked, never trusted as written.
 */
export async function findTasksByIds(
  taskIds: number[],
  notAfter: string,
): Promise<TaskCandidateRow[] | null> {
  const ids = [...new Set(taskIds.filter((n) => Number.isFinite(n) && n > 0))];
  if (ids.length === 0) return [];
  try {
    return await executeQuery<TaskCandidateRow>(
      `${TASK_SELECT}
        WHERE t.TaskID IN (${inList(ids.length)})
        ${TASK_GROUP_BY}
        LIMIT ${ids.length}`,
      [notAfter, notAfter, ...ids],
      'crm',
    );
  } catch (err) {
    logger.warn(`[MISSED OPPS] task-by-id lookup failed: ${(err as Error).message}`);
    return null;
  }
}

export interface TicketCandidateRow {
  TicketID: number;
  CustomerID: number | null;
  ContactID: number | null;
  accountName: string | null;
  assignedToName: string | null;
  at: string | null;
}

/**
 * Operational tickets on the verified account. Returned in their OWN role: a
 * ticket is support/billing/return truth and recovery context, never the sales
 * documentation an exception has to come from.
 */
export async function findTicketCandidates(
  contactIds: number[],
  customerIds: number[],
  notAfter: string,
): Promise<TicketCandidateRow[] | null> {
  const where: string[] = [];
  const params: Array<number | string> = [];
  if (contactIds.length) {
    where.push(`ti.ContactID IN (${inList(contactIds.length)})`);
    params.push(...contactIds);
  }
  if (customerIds.length) {
    where.push(`ti.CustomerID IN (${inList(customerIds.length)})`);
    params.push(...customerIds);
  }
  if (where.length === 0) return [];
  try {
    return await executeQuery<TicketCandidateRow>(
      `SELECT ti.TicketID, ti.CustomerID, ti.ContactID,
              cu.Name AS accountName,
              sp.SalesPersonName AS assignedToName,
              CAST(ti.CreatedOn AS CHAR) AS at
         FROM tblTicket ti
         LEFT JOIN tblCustomers   cu ON cu.CustomerID = ti.CustomerID
         LEFT JOIN tblSalesPeople sp ON sp.UserID = ti.AssignedToUserID AND sp.isDisplayInCRM = 1
        WHERE (${where.join(' OR ')})
          AND ti.CreatedOn <= ?
        ORDER BY ti.TicketID DESC
        LIMIT 30`,
      [...params, notAfter],
      'crm',
    );
  } catch (err) {
    logger.warn(`[MISSED OPPS] ticket candidate lookup failed: ${(err as Error).message}`);
    return null;
  }
}
