/**
 * Raw note/action retrieval for a resolved CRM record, with coverage accounting.
 *
 * FOUR THINGS THE OLD LOADER LOST.
 *
 *   1. It took `LIMIT 26` and called that the account's history, so "newest 25"
 *      silently became "all notes" — and a topic decision older than 25 rows
 *      (the prior warranty decline the exception turns on) could not be found at
 *      all. Retrieval is now paged to an explicit cap and reports what it read,
 *      what it skipped, and whether anything was left behind.
 *   2. It trimmed rows BEFORE removing boilerplate, then dropped a whole row
 *      whose first words matched an auto-status prefix. "Task Status Changed from
 *      Open to Working — customer wants the other two stores quoted" vanished
 *      entirely. The prefix is now separated from the remainder, and only the
 *      prefix is discarded.
 *   3. It required a non-empty note, so a real scheduled follow-up carrying only
 *      a due date was invisible — and the timeframe rule then fired on a rep who
 *      had set one.
 *   4. It carried no author, action id, due date or task relationship, so a note
 *      could not be attributed, cited, or checked for whether it even belongs to
 *      the reviewed salesperson's opportunity.
 *
 * ORDERING USES THE REAL EVENT TIME. `COALESCE(CompletedOn, CreatedOn)` cannot
 * work on a NOT NULL sentinel column, so the event time is expressed here the way
 * the rest of the warehouse expresses it, and `crmDates.crmEventTime` decides
 * whether a row is completed work or a still-scheduled commitment.
 */
import { executeQuery } from '../../../utils/databaseUtils';
import { stripHtmlToPlaintext } from '../../../utils/htmlText';
import logger from '../../../config/logger';

/** Hard ceiling on rows read for one record, paged to get there. */
export const MAX_RECORD_ROWS = 300;
const PAGE_SIZE = 100;

/** A task action's real event time: completion when completed, else creation. */
const ACTION_AT = `CASE WHEN a.CompletedOn > '1970-01-01' THEN a.CompletedOn ELSE a.CreatedOn END`;

/** One row per UserID — tblSalesPeople carries duplicates that would fan out joins. */
const PEOPLE = `(SELECT UserID, MAX(SalesPersonName) AS SalesPersonName
                   FROM tblSalesPeople WHERE UserID NOT IN (12) GROUP BY UserID)`;

export interface ActionRow {
  ActionID: number;
  TaskID: number;
  Note: string | null;
  createdOn: string | null;
  completedOn: string | null;
  dueOn: string | null;
  actionResult: string | null;
  createdByName: string | null;
  completedByName: string | null;
}

const ACTION_SELECT = `
SELECT a.ActionID, a.TaskID, a.Note,
       CAST(a.CreatedOn   AS CHAR) AS createdOn,
       CAST(a.CompletedOn AS CHAR) AS completedOn,
       CAST(a.DueOn       AS CHAR) AS dueOn,
       ar.Title AS actionResult,
       cr.SalesPersonName AS createdByName,
       cp.SalesPersonName AS completedByName
  FROM tblAction a
  LEFT JOIN tblActionResult ar ON ar.ActionResultID = a.ActionResultID
  LEFT JOIN ${PEOPLE} cr ON cr.UserID = a.CreatedBy
  LEFT JOIN ${PEOPLE} cp ON cp.UserID = a.CompletedBy
 WHERE a.TaskID = ?
   AND ${ACTION_AT} <= ?
`;

export interface TicketNoteRow {
  TicketNoteID: number;
  TicketID: number;
  Note: string | null;
  createdOn: string | null;
  noteTitle: string | null;
  createdByName: string | null;
}

const TICKET_NOTE_SELECT = `
SELECT tn.TicketNoteID, tn.TicketID, tn.Note,
       CAST(tn.CreatedOn AS CHAR) AS createdOn,
       tn.NoteTitle AS noteTitle,
       cr.SalesPersonName AS createdByName
  FROM tblTicketNote tn
  LEFT JOIN ${PEOPLE} cr ON cr.UserID = tn.CreatedBy
 WHERE tn.TicketID = ?
   AND tn.CreatedOn <= ?
`;

export interface RowLoad<T> {
  rows: T[];
  /** Rows the source holds within the cutoff, so omission is countable. */
  total: number;
  /** True when `total` exceeded the cap and rows were left unread. */
  truncated: boolean;
  /** Set when the read failed — an empty result is then not a negative answer. */
  unavailable: boolean;
}

async function countRows(sql: string, params: unknown[]): Promise<number | null> {
  try {
    const rows = await executeQuery<{ n: number }>(sql, params, 'crm');
    return Number(rows[0]?.n ?? 0);
  } catch {
    return null;
  }
}

/**
 * Every action on one task within the cutoff, newest first, paged to the cap.
 *
 * Rows with an empty note are DELIBERATELY included: a scheduled follow-up whose
 * evidence is its due date is exactly the record the follow-through rules need,
 * and filtering on note text is what hid it.
 */
export async function loadTaskActions(
  taskId: number,
  notAfter: string,
  cap = MAX_RECORD_ROWS,
): Promise<RowLoad<ActionRow>> {
  const total = await countRows(
    `SELECT COUNT(*) AS n FROM tblAction a WHERE a.TaskID = ? AND ${ACTION_AT} <= ?`,
    [taskId, notAfter],
  );
  const rows: ActionRow[] = [];
  try {
    for (let offset = 0; offset < cap; offset += PAGE_SIZE) {
      const page = await executeQuery<ActionRow>(
        `${ACTION_SELECT} ORDER BY ${ACTION_AT} DESC, a.ActionID DESC
          LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
        [taskId, notAfter],
        'crm',
      );
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
  } catch (err) {
    logger.warn(`[MISSED OPPS] action load failed for TASK ${taskId}: ${(err as Error).message}`);
    return { rows, total: total ?? rows.length, truncated: false, unavailable: true };
  }
  const known = total ?? rows.length;
  return { rows, total: known, truncated: known > rows.length, unavailable: false };
}

/** Every note on one ticket within the cutoff, newest first, paged to the cap. */
export async function loadTicketNotes(
  ticketId: number,
  notAfter: string,
  cap = MAX_RECORD_ROWS,
): Promise<RowLoad<TicketNoteRow>> {
  const total = await countRows(
    'SELECT COUNT(*) AS n FROM tblTicketNote tn WHERE tn.TicketID = ? AND tn.CreatedOn <= ?',
    [ticketId, notAfter],
  );
  const rows: TicketNoteRow[] = [];
  try {
    for (let offset = 0; offset < cap; offset += PAGE_SIZE) {
      const page = await executeQuery<TicketNoteRow>(
        `${TICKET_NOTE_SELECT} ORDER BY tn.CreatedOn DESC, tn.TicketNoteID DESC
          LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
        [ticketId, notAfter],
        'crm',
      );
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
  } catch (err) {
    logger.warn(`[MISSED OPPS] note load failed for TICKET ${ticketId}: ${(err as Error).message}`);
    return { rows, total: total ?? rows.length, truncated: false, unavailable: true };
  }
  const known = total ?? rows.length;
  return { rows, total: known, truncated: known > rows.length, unavailable: false };
}

/**
 * The auto-generated OPENING of a bookkeeping note. Only the opening: the rest
 * of the row is frequently the only place the customer's scope, offer or next
 * step was ever written down.
 */
const BOILERPLATE_PREFIX_RE = new RegExp(
  '^\\s*(?:'
  + 'task\\s+(?:created|assigned|closed|reopened)'
  + '|task\\s+status\\s+changed'
  + '|status\\s+changed'
  + '|auto[-\\s]?generated'
  + '|system'
  + '|created\\s+(?:contact\\s+update\\s+manager(?:\\s+task)?'
  + '|contact\\s+manager(?:\\s+task)?|lead)'
  + ')\\b',
  'i',
);

/**
 * The boilerplate clause that follows the prefix — "from Open to Working",
 * "by J. Smith", "because a new lead was created".
 *
 * Each clause stops at a separator (`.:;,` an en/em dash, or a hyphen) as well as
 * a newline, because that separator is where the human sentence starts. Allowing
 * the clause to run 60 characters through a dash is not a cosmetic bug: on
 * "Task Status Changed from Open to Working - customer wants the other two stores
 * quoted" it consumed the customer's scope and the row rendered as auto-status
 * only, which is the exact loss this function exists to prevent. A status title
 * that itself contains a hyphen leaves a stray word at the front of the body —
 * noise, and much cheaper than dropping the sentence.
 */
const CLAUSE_BODY = '[^.:;,\\u2013\\u2014\\n-]';
/**
 * The `by <author>` clause is matched as a NAME rather than as "anything up to a
 * separator", because a name legitimately contains the one character a sentence
 * ends with: "Created Lead by J. Smith — customer asked for a quote" has to keep
 * the customer's request while discarding "J. Smith". Up to four name-ish words,
 * each optionally ending in a period, stops at the dash without cutting "J.".
 */
const CLAUSE_NAME = "[A-Za-z][A-Za-z']*\\.?(?:\\s+[A-Za-z][A-Za-z'\\-]*\\.?){0,3}";
const BOILERPLATE_CLAUSE_RE = new RegExp(
  `^(?:\\s*(?:from\\s+${CLAUSE_BODY}{0,60}?\\s+to\\s+${CLAUSE_BODY}{0,60}`
  + `|by\\s+${CLAUSE_NAME}`
  + `|because\\s+${CLAUSE_BODY}{0,80}))?[\\s.:;,\\u2013\\u2014-]*`,
  'i',
);

/** Below this the remainder is a fragment, not a substantive note. */
const MIN_SUBSTANTIVE_CHARS = 12;

export interface SplitNote {
  /** The auto-status opening, kept so the source of a row is never erased. */
  prefix: string | null;
  /** The human remainder, '' when the row was pure boilerplate. */
  body: string;
}

/**
 * Separate a note's auto-status opening from its substantive remainder.
 *
 * Returning both is the point: the rendered line can say a row was
 * system-stamped AND still show what a person typed after the stamp, instead of
 * choosing between a misleading "the rep wrote nothing" and a thread full of
 * status noise.
 */
export function splitNote(raw: string | null): SplitNote {
  const text = stripHtmlToPlaintext(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return { prefix: null, body: '' };
  const prefixMatch = BOILERPLATE_PREFIX_RE.exec(text);
  if (!prefixMatch) return { prefix: null, body: text };

  const afterPrefix = text.slice(prefixMatch[0].length);
  const clauseMatch = BOILERPLATE_CLAUSE_RE.exec(afterPrefix);
  const clause = clauseMatch?.[0] ?? '';
  const remainder = afterPrefix.slice(clause.length).trim();
  const prefix = `${prefixMatch[0].trim()}${clause.trim() ? ` ${clause.trim()}` : ''}`;
  return {
    prefix,
    body: remainder.length >= MIN_SUBSTANTIVE_CHARS ? remainder : '',
  };
}
