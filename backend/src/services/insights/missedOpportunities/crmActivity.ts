/**
 * The CRM work a salesperson logged on one day, rendered for the analyzer.
 *
 * The model needs this to judge follow-through — "was a dated next step
 * actually recorded?" — and CRM records carry no conversation id, so the whole
 * day's activity goes in as context for each of that agent's calls. One query
 * per agent per day, not per call.
 *
 * BOTH SIDES OF THE CRM. Task actions live in `tblAction` (keyed by TaskID) and
 * ticket notes live in `tblTicketNote` (keyed by TicketID) — separate tables,
 * separate id spaces, the same split `CRMService` reads for the Quality
 * ticket/task panel. A sales rep writes on both, so reading only tasks would
 * hide half their follow-through and make the report accuse them of not logging
 * work they did log.
 *
 * EVERY LINE IS LABELLED WITH ITS REF. Each rendered line opens with a
 * `TASK 12345` / `TICKET 987` token, and the token set comes back alongside the
 * text. That is what lets a finding deep-link to the CRM: the analyzer asks the
 * model to cite the record a miss is about, then validates the citation against
 * this set, so an invented id is discarded instead of linking a manager to a
 * stranger's account. There is no key to join on instead — Genesys has no
 * TaskID/TicketID and the CRM has no ConversationID.
 */
import { executeQuery } from '../../../utils/databaseUtils';
import logger from '../../../config/logger';
import { splitNote } from './crmNotes';
import { CallCandidate, CrmDayActivity, crmRefToken } from './types';

/** Trailing bound on how much note text one call's prompt may carry. */
export const MAX_CRM_NOTE_CHARS = 6000;
/** Per-source row ceiling, so one pathological account can't crowd out the day. */
const MAX_ROWS_PER_SOURCE = 200;

/**
 * Task actions the agent wrote that day, with task type, result, and customer.
 *
 * Matched to the phone agent by display name — `tblSalesPeople.SalesPersonName`
 * and `tblPhoneUser.Name` are the same human-entered names, and the CRM carries
 * no phone-user id to join on. The customer label falls back through
 * tblCustomers to tblCustomerLead because a task on an unconverted lead has no
 * CustomerID yet.
 *
 * DATE/ACTOR BASIS — `CompletedOn`/`CompletedBy`, not `CreatedOn`/`CreatedBy`.
 * A tblAction row is CREATED when the follow-up is scheduled (its CreatedOn ==
 * the prior action's CompletedOn on self-chained tasks) and COMPLETED when the
 * agent actually works it and writes the note. Keying off completion is what
 * every other Touched consumer does (touchedSql, drill-down, backfill) and is
 * what puts the note on the day the rep did the work, attributed to the rep who
 * did it. The DATE(CompletedOn)=? bucket also drops the still-open scheduled
 * row (CompletedOn sentinel), which carries no real note. Aliased AS CreatedOn
 * to keep this module's DTO field name.
 */
const TASK_ACTIONS_SQL = `
SELECT
  a.TaskID                        AS RecordID,
  a.CompletedOn                   AS CreatedOn,
  a.Note,
  tt.Title                        AS Label,
  ar.Title                        AS ActionResult,
  COALESCE(cu.Name, cl.Name)      AS CustomerName,
  a.DueOn
FROM tblAction a
INNER JOIN tblSalesPeople sp ON sp.UserID = a.CompletedBy
LEFT JOIN tblTask         t  ON t.TaskID = a.TaskID
LEFT JOIN tblTaskType     tt ON tt.TaskTypeID = t.TaskTypeID
LEFT JOIN tblActionResult ar ON ar.ActionResultID = a.ActionResultID
LEFT JOIN tblCustomers    cu ON cu.CustomerID = t.CustomerID
LEFT JOIN tblCustomerLead cl ON cl.CustomerLeadID = t.CustomerLeadID
WHERE DATE(a.CompletedOn) = ?
  AND sp.SalesPersonName = ?
ORDER BY a.CompletedOn ASC
LIMIT ${MAX_ROWS_PER_SOURCE}
`;

/**
 * Ticket notes the agent wrote that day. Same agent-by-name match as the task
 * side. A ticket note has no result code or due date — its `NoteTitle` is the
 * closest equivalent label — so those columns come back null and simply do not
 * render.
 */
const TICKET_NOTES_SQL = `
SELECT
  tn.TicketID                     AS RecordID,
  tn.CreatedOn,
  tn.Note,
  tn.NoteTitle                    AS Label,
  NULL                            AS ActionResult,
  cu.Name                         AS CustomerName,
  NULL                            AS DueOn
FROM tblTicketNote tn
INNER JOIN tblSalesPeople sp ON sp.UserID = tn.CreatedBy
LEFT JOIN tblTicket    t  ON t.TicketID = tn.TicketID
LEFT JOIN tblCustomers cu ON cu.CustomerID = t.CustomerID
WHERE DATE(tn.CreatedOn) = ?
  AND sp.SalesPersonName = ?
ORDER BY tn.CreatedOn ASC
LIMIT ${MAX_ROWS_PER_SOURCE}
`;

interface CrmNoteRow {
  RecordID: number | null;
  CreatedOn: Date | string | null;
  Note: string | null;
  Label: string | null;
  ActionResult: string | null;
  CustomerName: string | null;
  DueOn: Date | string | null;
}

const EMPTY: CrmDayActivity = { notes: '', refs: [] };

/**
 * Read one source, degrading to nothing on failure. CRM notes are supporting
 * context, not the primary material; an outage on one side should cost the run
 * that context, not the whole day's analysis.
 */
async function readSource(
  sql: string,
  agentName: string,
  runDate: string,
  source: string,
): Promise<CrmNoteRow[] | null> {
  try {
    return await executeQuery<CrmNoteRow>(sql, [runDate, agentName], 'crm');
  } catch (err) {
    logger.warn(
      `[MISSED OPPS] CRM ${source} unavailable for ${agentName} on ${runDate}: ${(err as Error).message}`,
    );
    return null;
  }
}

/**
 * The agent's same-day CRM activity as one plain-text block plus the set of
 * record refs it cites. Empty when the agent logged nothing — an empty result
 * is meaningful (it is itself evidence of missing follow-through), not an error.
 */
export async function loadCrmActivityForDay(
  agentName: string,
  runDate: string,
): Promise<CrmDayActivity> {
  if (!agentName) return EMPTY;

  const [taskRows, ticketRows] = await Promise.all([
    readSource(TASK_ACTIONS_SQL, agentName, runDate, 'task actions'),
    readSource(TICKET_NOTES_SQL, agentName, runDate, 'ticket notes'),
  ]);

  // Interleaved by time rather than grouped by source: the rep worked one
  // chronological day, and reading it that way is what lets the model line a
  // note up against the call that preceded it.
  const rows = [
    ...(taskRows ?? []).map((r) => ({ row: r, kind: 'TASK' as const })),
    ...(ticketRows ?? []).map((r) => ({ row: r, kind: 'TICKET' as const })),
  ].sort((a, b) => msOf(a.row.CreatedOn) - msOf(b.row.CreatedOn));

  const lines: string[] = [];
  const refs: string[] = [];
  let chars = 0;
  let truncated = (taskRows?.length ?? 0) >= MAX_ROWS_PER_SOURCE
    || (ticketRows?.length ?? 0) >= MAX_ROWS_PER_SOURCE;

  for (const { row, kind } of rows) {
    // Only the auto-status OPENING is dropped. The remainder of a
    // "Task Status Changed … customer wants the other two stores quoted" row is
    // frequently the only place that requirement was ever written down, and
    // discarding the whole row is what made the review blind to it.
    const { prefix, body } = splitNote(row.Note);
    if (!body) continue;

    const id = Number(row.RecordID);
    const ref = Number.isFinite(id) && id > 0 ? crmRefToken(kind, id) : null;

    const meta = [row.Label, row.ActionResult, row.CustomerName].filter(Boolean).join(' / ');
    const due = row.DueOn ? ` (next contact due ${String(row.DueOn).slice(0, 10)})` : '';
    const head = [ref, timeOf(row.CreatedOn)].filter(Boolean).join(' · ');
    const line = `[${head}${meta ? ` — ${meta}` : ''}]${due} ${prefix ? `(auto: ${prefix}) ` : ''}${body}`;

    if (chars + line.length > MAX_CRM_NOTE_CHARS) { truncated = true; break; }
    lines.push(line);
    chars += line.length;
    // Only refs on lines the model can actually see are citable. Collecting the
    // ref before the length cut-off would let it "cite" a note it never read.
    if (ref && !refs.includes(ref)) refs.push(ref);
  }

  return {
    notes: lines.join('\n'), refs, scope: 'day',
    ...(taskRows === null || ticketRows === null ? { unavailable: true } : {}),
    ...(truncated ? { truncated: true } : {}),
  };
}

/** Reads each distinct agent's day activity once and returns it keyed by name. */
export async function loadCrmActivityByAgent(
  candidates: CallCandidate[],
  runDate: string,
): Promise<Map<string, CrmDayActivity>> {
  const names = Array.from(new Set(candidates.map((c) => c.agentName).filter(Boolean)));
  const entries = await Promise.all(
    names.map(async (name) => [name, await loadCrmActivityForDay(name, runDate)] as const),
  );
  return new Map(entries);
}

function msOf(value: Date | string | null): number {
  if (!value) return 0;
  const ms = new Date(String(value)).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function timeOf(value: Date | string | null): string {
  if (!value) return '';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
