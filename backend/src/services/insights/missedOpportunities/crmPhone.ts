/**
 * Which phone number on a conversation belongs to the CUSTOMER.
 *
 * The previous implementation unioned ANI, DNIS and Remote across every session
 * on the conversation and matched contacts against all of them. On any real
 * call that set contains our own numbers too — the inbound DID the customer
 * dialled, the outbound caller ID we present, the queue, an extension, the
 * second agent's line on a transfer — so a contact lookup could match the
 * company's own number and attach the call to whichever unrelated account
 * happens to carry it. That is the mechanism behind Lakeland and Keys both
 * resolving to a La Mesa task.
 *
 * THE NEAR END IS DERIVED, NOT BLACKLISTED. Each session is one leg with a
 * direction, so the near end is knowable: on an inbound leg the DNIS is ours and
 * the ANI is theirs; on an outbound leg it is the other way round. Every near-end
 * number found anywhere on the conversation goes into an exclusion set that wins
 * over any far-end candidate — which is what removes queues, extensions, service
 * numbers and transferred-agent lines without naming a single customer or a
 * single company number in code.
 *
 * A POSITIVE PARTICIPANT ID BEATS A TRANSFER-LEG DIRECTION. The exclusion above
 * is a heuristic about OUR numbers, and a transfer breaks it: a handed-off leg
 * can be recorded inbound with the customer's own number as its DNIS, so the
 * customer number lands in the near-end set with the direction flipped. On Fair
 * Oaks and Irish Isle that erased the real customer — it was excluded on the
 * transfer leg even though a genuine `customer`/`external` participant leg had
 * already identified it. So a number affirmatively seen as the far end of a
 * customer/external participant is kept even when it also appears as a near end;
 * the near-end heuristic only removes numbers no participant leg vouched for.
 * This reconciles the two sources rather than letting the transfer artifact win,
 * and it names no customer number in code.
 *
 * PROVENANCE TRAVELS WITH THE NUMBER. A match on a genuine customer-participant
 * leg is stronger evidence of identity than a match on the far end of an agent
 * leg whose direction we could not read, and the resolver has to be able to say
 * which one it used. So this returns candidates, ordered, each carrying where it
 * came from — not a bare string array.
 */
import { executeQuery } from '../../../utils/databaseUtils';
import logger from '../../../config/logger';

/** More distinct external numbers than this means we cannot say who called. */
const MAX_EXTERNAL_NUMBERS = 4;

/** Participant purposes that are the human on the other end of the call. */
const EXTERNAL_PURPOSES = new Set(['customer', 'external']);
/** Participant purposes that are one of our own people. */
const AGENT_PURPOSES = new Set(['agent', 'user']);

export type NumberSource = 'customer-participant' | 'agent-leg-far-end';

export interface ExternalNumber {
  /** Digits-only last 10, the form the CRM phone columns are compared in. */
  digits: string;
  /** Strongest source that produced this number. */
  source: NumberSource;
  /** Every session field it came from, e.g. `Customer/Inbound/ANI`. */
  provenance: string[];
}

export interface ExternalNumberResult {
  numbers: ExternalNumber[];
  /** True when the phone lookup itself failed — distinct from "no numbers". */
  unavailable: boolean;
  /** Set when there were more distinct external numbers than we can attribute. */
  ambiguous: boolean;
  /** Near-end numbers withheld as ours, for the diagnostic record. */
  excluded: string[];
  /**
   * How many distinct EMPLOYEE participants the conversation had.
   *
   * This is the attribution gate. A transcript labels every internal turn
   * "Agent" — `transcriptRender.genesysSpeaker` collapses agent, ACD, IVR and
   * system into that one label — so on a transferred conversation an "Agent" line
   * may be the reviewed salesperson OR the Customer Service rep they handed off
   * to. Two or more means an internal quote cannot be attributed by label alone;
   * `null` means we could not establish it, which is also not attribution.
   *
   * ACD, IVR and system legs are deliberately NOT counted, even though they also
   * render as "Agent". They are on almost every queued inbound call, so counting
   * them would mark nearly every conversation unattributable and disable the
   * verification pass that keeps false positives down — while the thing they
   * could contaminate, a quote showing a SALES ATTEMPT, is not something a queue
   * announcement produces. The prompt handles their generic prompts instead.
   */
  internalPartyCount: number | null;
}

interface SessionRow {
  ParticipantID: string | null;
  purpose: string | null;
  Direction: string | null;
  ANI: string | null;
  Dnis: string | null;
  Remote: string | null;
}

/**
 * Sessions with the purpose of the participant that owns each one. LEFT JOIN
 * because a session whose participant row is missing is still a leg — it simply
 * cannot be attributed, and an unattributed leg must not silently vanish into
 * "no numbers found".
 */
const SESSIONS_SQL = `
SELECT s.ParticipantID, p.purpose, s.Direction, s.ANI, s.Dnis, s.Remote
  FROM tblSessions s
  LEFT JOIN tblParticipants p
    ON p.ParticipantID = s.ParticipantID
   AND p.ConversationID = s.ConversationID
 WHERE s.ConversationID = ?
`;

const last10 = (raw: string | null): string | null => {
  const d = String(raw ?? '').replace(/[^0-9]/g, '');
  // Under 10 digits is an extension or a short code, never a customer line.
  return d.length >= 10 ? d.slice(-10) : null;
};

type Leg = 'inbound' | 'outbound' | 'unknown';

function legOf(direction: string | null): Leg {
  const d = (direction ?? '').trim().toLowerCase();
  if (d.startsWith('inbound')) return 'inbound';
  if (d.startsWith('outbound')) return 'outbound';
  return 'unknown';
}

/**
 * The near end of a leg — our side. Inbound: we are the dialled number (DNIS).
 * Outbound: we are the calling number (ANI). Direction unknown contributes
 * nothing here, because guessing would exclude the customer half the time.
 */
function nearEndOf(row: SessionRow, leg: Leg): Array<string | null> {
  if (leg === 'inbound') return [row.Dnis];
  if (leg === 'outbound') return [row.ANI];
  return [];
}

/** The far end of a leg — them. `Remote` is the leg's other party either way. */
function farEndOf(row: SessionRow, leg: Leg): Array<[string | null, string]> {
  if (leg === 'inbound') return [[row.ANI, 'ANI'], [row.Remote, 'Remote']];
  if (leg === 'outbound') return [[row.Dnis, 'Dnis'], [row.Remote, 'Remote']];
  return [[row.Remote, 'Remote']];
}

/**
 * The customer's number(s) on one conversation, with provenance.
 *
 * Degrades to `unavailable` rather than throwing: a phone-DB hiccup must cost
 * the call its CRM history, not the whole run.
 */
export async function resolveExternalNumbers(conversationId: string): Promise<ExternalNumberResult> {
  let rows: SessionRow[];
  try {
    rows = await executeQuery<SessionRow>(SESSIONS_SQL, [conversationId], 'phone');
  } catch (err) {
    logger.warn(`[MISSED OPPS] session lookup failed for ${conversationId}: ${(err as Error).message}`);
    return {
      numbers: [], unavailable: true, ambiguous: false, excluded: [], internalPartyCount: null,
    };
  }

  const nearEnd = new Set<string>();
  const customerFarEnd = new Set<string>();
  const found = new Map<string, ExternalNumber>();
  const internalParties = new Set<string>();

  // Pass 1: establish OUR near-end numbers AND the numbers a genuine
  // customer/external participant leg puts on its far end. Both have to be known
  // before any exclusion decision, because a transfer leg can record the
  // customer's own number as a near end with the direction flipped, and that
  // artifact must not delete a number a participant leg positively identified.
  for (const row of rows) {
    const leg = legOf(row.Direction);
    for (const raw of nearEndOf(row, leg)) {
      const d = last10(raw);
      if (d) nearEnd.add(d);
    }
    if (EXTERNAL_PURPOSES.has((row.purpose ?? '').trim().toLowerCase())) {
      for (const [raw] of farEndOf(row, leg)) {
        const d = last10(raw);
        if (d) customerFarEnd.add(d);
      }
    }
  }

  for (const row of rows) {
    const purpose = (row.purpose ?? '').trim().toLowerCase();
    const isExternal = EXTERNAL_PURPOSES.has(purpose);
    const isAgent = AGENT_PURPOSES.has(purpose);
    // Employees only — a second one on the line is what makes an "Agent" turn
    // unattributable. See internalPartyCount for why queues and IVRs are not
    // counted here.
    if (isAgent && row.ParticipantID) internalParties.add(String(row.ParticipantID));
    // An ACD/IVR/voicemail/workflow leg is infrastructure: its far end is a
    // queue or a flow, not an account we could grade a salesperson against.
    if (!isExternal && !isAgent) continue;

    const leg = legOf(row.Direction);
    for (const [raw, field] of farEndOf(row, leg)) {
      const digits = last10(raw);
      if (!digits) continue;
      // Near-end numbers are ours and excluded — unless a customer/external
      // participant leg vouched for the same number, in which case the positive
      // identification wins over the transfer-leg direction that put it here.
      const reconciled = customerFarEnd.has(digits);
      if (nearEnd.has(digits) && !reconciled) continue;
      const source: NumberSource = isExternal ? 'customer-participant' : 'agent-leg-far-end';
      const tag = nearEnd.has(digits)
        ? `${row.purpose ?? 'unattributed'}/${row.Direction ?? 'unknown'}/${field} (near-end reconciled)`
        : `${row.purpose ?? 'unattributed'}/${row.Direction ?? 'unknown'}/${field}`;
      const prior = found.get(digits);
      if (!prior) {
        found.set(digits, { digits, source, provenance: [tag] });
        continue;
      }
      if (!prior.provenance.includes(tag)) prior.provenance.push(tag);
      // A customer-participant sighting upgrades a number first seen on an
      // agent leg; never the reverse.
      if (source === 'customer-participant') prior.source = source;
    }
  }

  const numbers = [...found.values()].sort((a, b) =>
    (a.source === b.source ? 0 : a.source === 'customer-participant' ? -1 : 1));
  const internalPartyCount = internalParties.size > 0 ? internalParties.size : null;
  // The diagnostic reports what we actually withheld — a number reconciled back
  // to the customer was not excluded, so it must not read as though it were.
  const excluded = [...nearEnd].filter((d) => !customerFarEnd.has(d));

  // More than a handful of distinct outside numbers means a conference or a
  // chain of transfers we cannot attribute to one account. Report the ambiguity
  // instead of picking one and calling it the customer.
  if (numbers.length > MAX_EXTERNAL_NUMBERS) {
    return {
      numbers: [], unavailable: false, ambiguous: true, excluded, internalPartyCount,
    };
  }
  return {
    numbers, unavailable: false, ambiguous: false, excluded, internalPartyCount,
  };
}
