/**
 * CallTicketLinkerService — Phase C SPIKE (C1) deliverable.
 *
 * Question we're answering: given a Genesys conversation id, can we
 * deterministically pick the CRM ticket the agent worked on during /
 * because of that call? Combined ticket+call reviews need this link
 * to load both sources into the same `Case` (Phase C C2).
 *
 * What we considered:
 *
 *   1. Genesys schema (PhoneSystem.tblConversations + tblSessions):
 *      stores ConversationId, ANI (caller phone), Direction, Provider,
 *      ParticipantId/UserId — but NO `TicketID` / `TaskID` / external
 *      reference field. Genesys does not know about the CRM. We cannot
 *      get a direct linkage from this side.
 *
 *   2. CRM schema (dmcms_prod.tblTicket / tblTicketNote / tblAction):
 *      stores TicketID, CustomerID, AssignedToUserID, CreatedOn,
 *      Description, NoteTitle/Note. There is no ConversationID column
 *      and no foreign key to Genesys. Some agents paste the conversation
 *      id into the note body, but that is not enforced.
 *
 *   3. Heuristic: ANI (caller phone) + time-window match. Genesys gives
 *      us the caller phone and a precise call start timestamp; the CRM
 *      knows which customer that phone belongs to (via tblCustomer.Phone
 *      or similar) and which tickets that customer has open near the
 *      call time. Out of the three, this is the only path that does NOT
 *      require schema changes on either CRM or Genesys.
 *
 * Chosen path: HEURISTIC (option 3).
 *
 * Confidence levels we emit:
 *   - 'exact'  : the agent paste-linked the conversation id into a note
 *                title/body of exactly one ticket within the last 30 days.
 *                Treat as authoritative.
 *   - 'strong' : ANI matched a known customer AND that customer has
 *                exactly one open/recent ticket whose CreatedOn /
 *                ModifiedOn falls inside the call window.
 *   - 'weak'   : ANI → customer matched but multiple candidate tickets
 *                fall in the window; we pick the closest by time delta
 *                and label the link weak so the UI can surface "we
 *                guessed" semantics.
 *   - null     : no usable signal — caller falls back to call-only
 *                review.
 *
 * Implementation notes for the follow-up engineer (C2):
 *   - The ANI → customer_id lookup column is intentionally pluggable
 *     (`resolveCustomerIdFromAni`) so the SPIKE can ship without
 *     committing to a specific CRM phone column. Likely candidates per
 *     QA: tblCustomer.Phone, tblCustomerPhone.PhoneNumber, or a
 *     normalized lookup table. Pick the one with the best populated
 *     ratio in prod.
 *   - The time window defaults to ±60 minutes either side of the call
 *     start. Calls usually generate the ticket DURING the call, so we
 *     don't need a wide window. If false-negative rate is too high in
 *     review, widen the trailing edge first.
 *   - Cached for the lifetime of one process by conversation_id so
 *     repeated linker calls during a single AI review (e.g. inbox +
 *     submission detail page) only pay the cost once.
 */

import logger from '../config/logger';
import phoneSystemService from './PhoneSystemService';
import { executeQuery } from '../utils/databaseUtils';

export type CallTicketLinkConfidence = 'exact' | 'strong' | 'weak';

export interface CallTicketLink {
  conversation_id: string;
  ticket_id: number;
  confidence: CallTicketLinkConfidence;
  /** Free-text rationale surfaced in the UI ("matched ANI + 12-min window"). */
  rationale: string;
  /** Time delta in seconds between call start and ticket created/modified. */
  time_delta_seconds: number | null;
}

export interface LinkOptions {
  /** Override the ±minutes window. Default 60 minutes. */
  windowMinutes?: number;
  /**
   * Skip the cache for this lookup. The cache is keyed by conversation
   * id so a single review pass doesn't hit Genesys/CRM N times.
   */
  bypassCache?: boolean;
}

const DEFAULT_WINDOW_MINUTES = 60;

const linkCache = new Map<string, { value: CallTicketLink | null; cachedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Tests use this to forget memoized links. */
export function _clearCallTicketLinkCache(): void {
  linkCache.clear();
}

/**
 * Look up a ticket id for the given Genesys conversation id. Returns
 * null when no usable signal exists (the caller — Phase C — should fall
 * back to call-only review when null is returned).
 *
 * The function is intentionally tolerant of partial CRM unavailability:
 * any single sub-lookup failure logs a warning and degrades to a lower
 * confidence path rather than throwing. The AI Reviewer continues to
 * function for ticket-only and call-only reviews even if this linker
 * is misconfigured.
 */
export async function linkCallToTicket(
  conversationId: string,
  opts: LinkOptions = {}
): Promise<CallTicketLink | null> {
  const id = String(conversationId ?? '').trim();
  if (!id) return null;

  if (!opts.bypassCache) {
    const cached = linkCache.get(id);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.value;
    }
  }

  const windowMinutes = opts.windowMinutes ?? DEFAULT_WINDOW_MINUTES;

  let link: CallTicketLink | null = null;
  try {
    // 1) Did the agent paste the conversation id into a ticket note?
    //    This is the cheapest unambiguous signal.
    link = await resolveByPasteLink(id);
    if (link) {
      linkCache.set(id, { value: link, cachedAt: Date.now() });
      return link;
    }

    // 2) Heuristic: ANI → customer → tickets in window.
    const meta = await phoneSystemService.getConversationMetaByConversationId(id).catch(() => null);
    const startEt = meta?.start_et ?? null;
    if (!startEt) {
      linkCache.set(id, { value: null, cachedAt: Date.now() });
      return null;
    }

    const ani = await getAniForConversation(id).catch(() => null);
    if (!ani) {
      linkCache.set(id, { value: null, cachedAt: Date.now() });
      return null;
    }

    const customerId = await resolveCustomerIdFromAni(ani).catch(() => null);
    if (!customerId) {
      linkCache.set(id, { value: null, cachedAt: Date.now() });
      return null;
    }

    const candidates = await findTicketsForCustomerInWindow({
      customerId,
      callStart: startEt,
      windowMinutes,
    }).catch(() => [] as Array<{ ticket_id: number; created_on: Date | null; modified_on: Date | null }>);

    if (candidates.length === 0) {
      linkCache.set(id, { value: null, cachedAt: Date.now() });
      return null;
    }

    const ranked = candidates
      .map((c) => {
        const created = c.created_on ? c.created_on.getTime() : null;
        const modified = c.modified_on ? c.modified_on.getTime() : null;
        const callMs = startEt.getTime();
        const delta = pickClosestDelta(callMs, created, modified);
        return { ticket: c, delta };
      })
      .filter((r) => r.delta != null)
      .sort((a, b) => (a.delta as number) - (b.delta as number));

    if (ranked.length === 0) {
      linkCache.set(id, { value: null, cachedAt: Date.now() });
      return null;
    }

    const best = ranked[0];
    const confidence: CallTicketLinkConfidence = ranked.length === 1 ? 'strong' : 'weak';
    link = {
      conversation_id: id,
      ticket_id: best.ticket.ticket_id,
      confidence,
      rationale:
        confidence === 'strong'
          ? `ANI ${ani} resolved to customer #${customerId}; one ticket within ±${windowMinutes}m of call start (Δ${Math.round((best.delta as number) / 1000)}s).`
          : `ANI ${ani} resolved to customer #${customerId}; ${ranked.length} candidate tickets within ±${windowMinutes}m, picked closest by time (Δ${Math.round((best.delta as number) / 1000)}s).`,
      time_delta_seconds: Math.round((best.delta as number) / 1000),
    };
  } catch (err) {
    logger.warn(`[CALL-TICKET LINKER] linkCallToTicket(${id}) failed: ${(err as Error).message}`);
    link = null;
  }

  linkCache.set(id, { value: link, cachedAt: Date.now() });
  return link;
}

/**
 * Look for tickets in CRM whose note body or title contains the
 * literal conversation id. Limited to the last 30 days for performance.
 */
async function resolveByPasteLink(conversationId: string): Promise<CallTicketLink | null> {
  try {
    const rows = await executeQuery<{ TicketID: number; CreatedOn: Date | null }>(
      `
        SELECT DISTINCT n.TicketID, t.CreatedOn
          FROM tblTicketNote n
          JOIN tblTicket t ON t.TicketID = n.TicketID
         WHERE (n.NoteTitle LIKE ? OR n.Note LIKE ?)
           AND n.CreatedOn >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         ORDER BY n.CreatedOn DESC
         LIMIT 5
      `,
      [`%${conversationId}%`, `%${conversationId}%`],
      'crm'
    );
    if (rows.length === 1) {
      return {
        conversation_id: conversationId,
        ticket_id: rows[0].TicketID,
        confidence: 'exact',
        rationale: 'Conversation id was pasted into a single ticket note within the last 30 days.',
        time_delta_seconds: null,
      };
    }
    return null;
  } catch (err) {
    logger.warn(`[CALL-TICKET LINKER] paste-link lookup failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Pull the caller phone number (ANI) for a conversation. ANI lives on
 * tblSessions; we take the first non-null value for the conversation.
 */
async function getAniForConversation(conversationId: string): Promise<string | null> {
  try {
    const rows = await executeQuery<{ ANI: string | null }>(
      `
        SELECT ANI
          FROM tblSessions
         WHERE ConversationID = ?
           AND ANI IS NOT NULL
           AND ANI <> ''
         ORDER BY ANI ASC
         LIMIT 1
      `,
      [conversationId],
      'phone'
    );
    return rows.length > 0 ? (rows[0].ANI ?? null) : null;
  } catch (err) {
    logger.warn(`[CALL-TICKET LINKER] getAniForConversation(${conversationId}) failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Resolve the CRM customer id for an ANI. The CRM phone column is not
 * yet finalized — the QA team is sampling tblCustomer.Phone vs
 * tblCustomerPhone.PhoneNumber to pick the field with the best
 * populated ratio. Until then this function is best-effort: it tries
 * both, returns the first hit, and stays silent on miss so the linker
 * gracefully degrades to "no link" instead of throwing.
 */
async function resolveCustomerIdFromAni(ani: string): Promise<number | null> {
  const normalized = normalizePhone(ani);
  if (!normalized) return null;
  // Try tblCustomer.Phone first (most common CRM convention). If the
  // column doesn't exist on a particular environment, the query will
  // throw and we fall through to the next attempt.
  const candidateQueries: Array<{ sql: string; pool: 'crm' }> = [
    {
      sql: `SELECT CustomerID FROM tblCustomer WHERE REPLACE(REPLACE(REPLACE(Phone, '-', ''), ' ', ''), '+', '') LIKE ? LIMIT 2`,
      pool: 'crm',
    },
    {
      sql: `SELECT CustomerID FROM tblCustomerPhone WHERE REPLACE(REPLACE(REPLACE(PhoneNumber, '-', ''), ' ', ''), '+', '') LIKE ? LIMIT 2`,
      pool: 'crm',
    },
  ];
  for (const q of candidateQueries) {
    try {
      const rows = await executeQuery<{ CustomerID: number }>(q.sql, [`%${normalized}%`], q.pool);
      if (rows.length === 1) return rows[0].CustomerID;
      // Multiple matches → ambiguous; fall through to next strategy.
    } catch {
      // Column / table doesn't exist in this env — try the next one.
    }
  }
  return null;
}

interface TicketCandidate {
  ticket_id: number;
  created_on: Date | null;
  modified_on: Date | null;
}

async function findTicketsForCustomerInWindow(args: {
  customerId: number;
  callStart: Date;
  windowMinutes: number;
}): Promise<TicketCandidate[]> {
  try {
    const rows = await executeQuery<{
      TicketID: number;
      CreatedOn: Date | null;
      ModifiedOn: Date | null;
    }>(
      `
        SELECT TicketID, CreatedOn, ModifiedOn
          FROM tblTicket
         WHERE CustomerID = ?
           AND (
             (CreatedOn  BETWEEN DATE_SUB(?, INTERVAL ? MINUTE) AND DATE_ADD(?, INTERVAL ? MINUTE)) OR
             (ModifiedOn BETWEEN DATE_SUB(?, INTERVAL ? MINUTE) AND DATE_ADD(?, INTERVAL ? MINUTE))
           )
         ORDER BY CreatedOn DESC
         LIMIT 10
      `,
      [
        args.customerId,
        args.callStart, args.windowMinutes, args.callStart, args.windowMinutes,
        args.callStart, args.windowMinutes, args.callStart, args.windowMinutes,
      ],
      'crm'
    );
    return rows.map((r) => ({
      ticket_id: r.TicketID,
      created_on: r.CreatedOn ?? null,
      modified_on: r.ModifiedOn ?? null,
    }));
  } catch (err) {
    logger.warn(
      `[CALL-TICKET LINKER] findTicketsForCustomerInWindow(${args.customerId}) failed: ${(err as Error).message}`
    );
    return [];
  }
}

/** Strip the usual phone-number formatting noise; return null on empty. */
function normalizePhone(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/[^0-9]/g, '');
  if (digits.length < 7) return null;
  return digits;
}

function pickClosestDelta(callMs: number, ...timestamps: Array<number | null>): number | null {
  let best: number | null = null;
  for (const t of timestamps) {
    if (t == null) continue;
    const d = Math.abs(t - callMs);
    if (best == null || d < best) best = d;
  }
  return best;
}

export default { linkCallToTicket };
