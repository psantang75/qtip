/**
 * New leads a salesperson opened on one day, rendered for the analyzer.
 *
 * WHY THIS EXISTS. `crmActivity.ts` and `crmLink.ts` both answer "what work did
 * the rep LOG?" — one record's note thread, or the notes the rep completed that
 * day. Neither answers "what did the rep CREATE?", and a brand-new lead-task
 * usually has only a scheduled (not completed) action, which crmActivity's
 * `DATE(a.CompletedOn) = ?` bucket deliberately drops. So when a customer
 * mentioned three stores and the rep opened leads for the other two, the model
 * saw no trace of it and reported the expansion as uncaptured. This closes that
 * blind spot for the `group_expansion_not_captured` rule.
 *
 * WHAT COUNTS AS A NEW LEAD. Same definition the warehouse uses in
 * workers/sql/lead.extract.sql: a `tblCustomerLead` with its lead-task
 * (`tblTask.TaskTypeID = 11`), owned through `tblTask.AssignedTo`. Keeping one
 * definition means the report and the Leads dashboard never disagree about
 * whether a lead exists.
 *
 * NOT CITABLE. The rendered refs are deliberately left out of
 * `CrmDayActivity.refs`: this block exists so the model can VERIFY a claim, not
 * so it can attribute a miss to one of these records. A finding still cites the
 * account the call was about, resolved by phone number in crmLink.
 */
import { executeQuery } from '../../../utils/databaseUtils';
import logger from '../../../config/logger';
import { CallCandidate } from './types';

/** Row ceiling — a prospecting day tops out well under this. */
const MAX_ROWS = 50;
/** Trailing bound on the block's contribution to the prompt. */
const MAX_CHARS = 1500;

/**
 * Leads whose lead-task is assigned to this rep, created on the run date.
 *
 * Matched to the phone agent by display name, exactly as crmActivity does:
 * `tblSalesPeople.SalesPersonName` and `tblPhoneUser.Name` are the same
 * human-entered names and the CRM carries no phone-user id to join on. The
 * account label falls back from tblCustomers to tblCustomerLead because an
 * unconverted lead has no CustomerID yet.
 */
const CREATED_LEADS_SQL = `
SELECT
  cl.CustomerLeadID               AS LeadID,
  t.TaskID                        AS TaskID,
  cl.CreatedOn                    AS CreatedOn,
  COALESCE(cu.Name, cl.Name)      AS AccountName,
  ls.LeadSource                   AS LeadSource
FROM tblCustomerLead cl
INNER JOIN tblTask t          ON t.CustomerLeadID = cl.CustomerLeadID AND t.TaskTypeID = 11
LEFT JOIN my_aspnet_users u   ON u.id = t.AssignedTo
INNER JOIN tblSalesPeople sp  ON sp.UserID = u.id
LEFT JOIN tblCustomers cu     ON cu.CustomerID = cl.CustomerID
LEFT JOIN tblLeadSources ls   ON ls.LeadSourceID = cl.LeadSourceID
WHERE DATE(cl.CreatedOn) = ?
  AND sp.SalesPersonName = ?
ORDER BY cl.CreatedOn ASC
LIMIT ${MAX_ROWS}
`;

interface CreatedLeadRow {
  LeadID: number | null;
  TaskID: number | null;
  CreatedOn: Date | string | null;
  AccountName: string | null;
  LeadSource: string | null;
}

/**
 * The rep's newly created leads for one day as one plain-text block.
 *
 * THE TWO EMPTY ANSWERS ARE NOT THE SAME. '' means the lookup ran and the rep
 * created nothing, which is exactly the evidence the expansion rule needs.
 * `null` means the lookup FAILED. Both used to return '', so a CRM outage
 * rendered into the prompt as the sentence "this salesperson created no new
 * leads on this date" — an assertion of fact the contract forbids the model
 * from making about anything the CRM sections do not actually show.
 */
export async function loadCreatedLeadsForDay(
  agentName: string,
  runDate: string,
): Promise<string | null> {
  if (!agentName) return '';

  let rows: CreatedLeadRow[];
  try {
    rows = await executeQuery<CreatedLeadRow>(CREATED_LEADS_SQL, [runDate, agentName], 'crm');
  } catch (err) {
    logger.warn(
      `[MISSED OPPS] CRM created-leads unavailable for ${agentName} on ${runDate}: ${(err as Error).message}`,
    );
    return null;
  }

  const lines: string[] = [];
  let chars = 0;
  for (const row of rows) {
    const leadId = Number(row.LeadID);
    if (!Number.isFinite(leadId) || leadId <= 0) continue;

    const taskId = Number(row.TaskID);
    const head = [
      `LEAD ${leadId}`,
      Number.isFinite(taskId) && taskId > 0 ? `TASK ${taskId}` : '',
      timeOf(row.CreatedOn),
    ].filter(Boolean).join(' · ');
    const label = [row.AccountName, row.LeadSource].filter(Boolean).join(' / ') || 'unnamed lead';
    const line = `[${head}] ${label}`;

    if (chars + line.length > MAX_CHARS) break;
    lines.push(line);
    chars += line.length;
  }
  return lines.join('\n');
}

/** Reads each distinct agent's created leads once and returns them keyed by name. */
export async function loadCreatedLeadsByAgent(
  candidates: CallCandidate[],
  runDate: string,
): Promise<Map<string, string | null>> {
  const names = Array.from(new Set(candidates.map((c) => c.agentName).filter(Boolean)));
  const entries = await Promise.all(
    names.map(async (name) => [name, await loadCreatedLeadsForDay(name, runDate)] as const),
  );
  return new Map(entries);
}

function timeOf(value: Date | string | null): string {
  if (!value) return '';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
