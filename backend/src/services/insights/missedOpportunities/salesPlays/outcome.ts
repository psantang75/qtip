/**
 * Outcome labeler — decides whether a mined call belongs to a WON or LOST deal.
 *
 * The miner only wants to learn from calls with a known result: what closers do
 * on WON deals, and (for contrast) what preceded a LOST one. This resolves the
 * call's far-end number to the account's lead(s) — reusing the same phone->contact
 * path as `crmLink` so the linkage rules stay in one place — then labels by the
 * lead's terminal state:
 *
 *   WON     the lead produced an order (tblOrders.OrderType='order').
 *   LOST    a lead-task's status title starts with 'Lost' (the CRM's Lost-* ladder).
 *   UNKNOWN neither is resolvable; the miner skips these (no lesson to learn).
 *
 * WON wins ties: a number that eventually ordered is a win even if an earlier
 * sibling lead was marked lost. Every query degrades to UNKNOWN on failure so a
 * CRM hiccup costs one call its lesson, never the whole mine.
 */
import { executeQuery } from '../../../../utils/databaseUtils';
import logger from '../../../../config/logger';
import { getFarEndNumbers, resolveContactIds } from '../crmLink';

export type CallOutcome = 'WON' | 'LOST' | 'UNKNOWN';

const inList = (n: number) => Array.from({ length: n }, () => '?').join(',');

async function leadIdsForContacts(contactIds: number[]): Promise<number[]> {
  if (contactIds.length === 0) return [];
  try {
    const rows = await executeQuery<{ CustomerLeadID: number }>(
      `SELECT CustomerLeadID FROM tblCustomerLead WHERE ContactID IN (${inList(contactIds.length)})`,
      contactIds,
      'crm',
    );
    return rows.map((r) => Number(r.CustomerLeadID)).filter(Number.isFinite);
  } catch (err) {
    logger.warn(`[SALES PLAYS] lead lookup failed: ${(err as Error).message}`);
    return [];
  }
}

async function hasOrder(leadIds: number[]): Promise<boolean> {
  if (leadIds.length === 0) return false;
  try {
    const rows = await executeQuery<{ n: number }>(
      `SELECT 1 AS n FROM tblOrders
        WHERE OrderType = 'order' AND CustomerLeadID IN (${inList(leadIds.length)})
        LIMIT 1`,
      leadIds,
      'crm',
    );
    return rows.length > 0;
  } catch (err) {
    logger.warn(`[SALES PLAYS] order lookup failed: ${(err as Error).message}`);
    return false;
  }
}

async function hasLostLeadTask(leadIds: number[]): Promise<boolean> {
  if (leadIds.length === 0) return false;
  try {
    const rows = await executeQuery<{ n: number }>(
      `SELECT 1 AS n
         FROM tblTask t
         INNER JOIN tblTaskStatus ts ON ts.TaskStatusID = t.TaskStatusID
        WHERE t.TaskTypeID = 11
          AND t.CustomerLeadID IN (${inList(leadIds.length)})
          AND ts.Title LIKE 'Lost%'
        LIMIT 1`,
      leadIds,
      'crm',
    );
    return rows.length > 0;
  } catch (err) {
    logger.warn(`[SALES PLAYS] lost-status lookup failed: ${(err as Error).message}`);
    return false;
  }
}

/** Label a call by its account's terminal deal state. */
export async function labelCallOutcome(conversationId: string): Promise<CallOutcome> {
  const numbers = await getFarEndNumbers(conversationId);
  if (numbers.length === 0) return 'UNKNOWN';

  const contactIds = await resolveContactIds(numbers);
  if (contactIds.length === 0) return 'UNKNOWN';

  const leadIds = await leadIdsForContacts(contactIds);
  if (leadIds.length === 0) return 'UNKNOWN';

  if (await hasOrder(leadIds)) return 'WON';
  if (await hasLostLeadTask(leadIds)) return 'LOST';
  return 'UNKNOWN';
}
