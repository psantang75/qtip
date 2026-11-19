/**
 * Phone call activity logged against a CRM ticket or task.
 *
 * The CRM's phone integration writes one `tblCallActivity` row per Genesys
 * conversation (direction, numbers, duration, disposition and the agent's
 * wrap-up note) and links it to every record it was about through
 * `tblCallActivityLink` (`ItemType` 'task' | 'ticket' | 'job'). A call linked
 * to several records shows on each of them, as it does in the CRM.
 *
 * Display only: the AI reviewer reads `getTaskNotes` / `getTicketNotes` and
 * must not receive these rows.
 */
import { executeQuery } from '../utils/databaseUtils';
import logger from '../config/logger';
import { stripHtmlToPlaintext } from '../utils/htmlText';
import { toCrmDate } from './crmTicketHeader';
import type { TicketTaskKind } from './CRMService';

export interface CRMCallActivity {
  id: number;
  conversation_id: string;
  /** ISO string; when the wrap-up was saved, which is the time the CRM shows. */
  occurred_on: string | null;
  direction: string | null;
  /** The other party's number: ToNumber on outbound, FromNumber on inbound. */
  phone_number: string | null;
  contact_name: string | null;
  duration_sec: number | null;
  disposition: string | null;
  agent_id: number | null;
  agent_name: string | null;
  wrap_up: string;
  /** True if the call's time is strictly after the audit's submitted_at. */
  is_after_audit: boolean;
}

interface CallActivityRow {
  CallActivityID: number;
  ConversationID: string;
  OccurredOn: Date | string | null;
  Direction: string | null;
  FromNumber: string | null;
  ToNumber: string | null;
  ContactName: string | null;
  DurationSec: number | null;
  Disposition: string | null;
  AgentUserID: number | null;
  AgentName: string | null;
  Notes: string | null;
}

const ITEM_TYPE: Record<TicketTaskKind, string> = { TASK: 'task', TICKET: 'ticket' };

const OCCURRED_ON = 'COALESCE(a.WrapupSavedOn, a.EndTime, a.StartTime, a.CreatedOn)';

const CALL_ACTIVITY_SQL = `
  SELECT
    a.CallActivityID,
    a.ConversationID,
    ${OCCURRED_ON} AS OccurredOn,
    a.Direction,
    a.FromNumber,
    a.ToNumber,
    COALESCE(a.ContactName, a.SpokeWithName, a.BusinessName) AS ContactName,
    a.DurationSec,
    d.Label AS Disposition,
    a.AgentUserID,
    sp.SalesPersonName AS AgentName,
    a.Notes
  FROM tblCallActivity a
  LEFT JOIN tblCallDispositions d ON d.DispositionID = a.DispositionID
  LEFT JOIN tblSalesPeople     sp ON sp.UserID = a.AgentUserID AND sp.isDisplayInCRM = 1
  WHERE a.CallActivityID IN (
    SELECT l.CallActivityID FROM tblCallActivityLink l WHERE l.ItemType = ? AND l.ItemID = ?
  )
  ORDER BY OccurredOn DESC, a.CallActivityID DESC
`;

export function mapCallActivityRow(r: CallActivityRow, auditMs: number | null): CRMCallActivity {
  const occurred = toCrmDate(r.OccurredOn);
  const occurredMs = occurred ? occurred.getTime() : null;
  const inbound = (r.Direction ?? '').trim().toLowerCase() === 'inbound';
  return {
    id: r.CallActivityID,
    conversation_id: r.ConversationID,
    occurred_on: occurred?.toISOString() ?? null,
    direction: r.Direction,
    phone_number: (inbound ? r.FromNumber : r.ToNumber)?.trim() || null,
    contact_name: r.ContactName?.trim() || null,
    duration_sec: r.DurationSec == null ? null : Number(r.DurationSec),
    disposition: r.Disposition,
    agent_id: r.AgentUserID,
    agent_name: r.AgentName,
    wrap_up: stripHtmlToPlaintext((r.Notes ?? '').trim()),
    is_after_audit: auditMs != null && occurredMs != null && occurredMs > auditMs,
  };
}

/**
 * Every call linked to the ticket/task, newest first. Sets `is_after_audit`
 * from `auditSubmittedAt` the same way the notes endpoints do.
 */
export async function getCallActivity(
  kind: TicketTaskKind,
  itemId: number,
  auditSubmittedAt?: Date | null,
): Promise<CRMCallActivity[]> {
  try {
    const rows = await executeQuery<CallActivityRow>(CALL_ACTIVITY_SQL, [ITEM_TYPE[kind], itemId], 'crm');
    const auditMs = auditSubmittedAt ? new Date(auditSubmittedAt).getTime() : null;
    return rows.map((r) => mapCallActivityRow(r, auditMs));
  } catch (error) {
    logger.error(`[CRM SERVICE] Failed to fetch call activity for ${kind} ${itemId}`, { error: (error as Error).message });
    throw new Error(`Failed to retrieve call activity for ${kind.toLowerCase()} ${itemId}`);
  }
}
