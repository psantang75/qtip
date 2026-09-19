/**
 * Shared types for the Missed Opportunities analysis pipeline.
 *
 * Flow: candidates.ts selects the day's calls -> analyzer.ts asks the model to
 * apply the rule set -> MissedOpportunitiesWorker persists the findings.
 */

export type MissedOpportunitySeverity = 'low' | 'medium' | 'high';

export const SEVERITIES: readonly MissedOpportunitySeverity[] = ['low', 'medium', 'high'];

export function isSeverity(value: unknown): value is MissedOpportunitySeverity {
  return typeof value === 'string' && (SEVERITIES as readonly string[]).includes(value);
}

/** A rule as the analyzer needs it — the editable row minus admin bookkeeping. */
export interface MissedOpportunityRule {
  rule_key: string;
  rule_name: string;
  category: string;
  severity: MissedOpportunitySeverity;
  body_md: string;
  guidance_md: string | null;
  /**
   * True when the miss is a SKIPPED STEP — the rep did not ask for the order,
   * offer the warranty, size the group. False when it is graded on the CONTENT
   * of something the rep plainly did (voicemail wording, a compliance lapse).
   *
   * Only omission rules go to the verification pass: its one question ("does the
   * transcript show the rep attempting this?") answers "yes, they spoke on the
   * line" for a commission rule and deletes a valid finding. See verify.ts.
   */
  is_omission: boolean;
}

/** One connected sales call selected for analysis, with its material attached. */
export interface CallCandidate {
  conversationId: string;
  agentName: string;
  agentEmail: string | null;
  phoneUserId: string | null;
  startedAt: Date;
  /** YYYYMMDD of the call, matching the ie_dim_date grain. */
  dateKey: number;
  direction: string | null;
  talkSecs: number;
  /** Best available remote-party label (display name, then address, then ANI). */
  remoteParty: string | null;
  wrapUpCode: string | null;
}

/**
 * A CRM work item a finding can cite. Kind matters because task ids
 * (tblAction/tblTask) and ticket ids (tblTicketNote/tblTicket) are separate id
 * spaces — the same number means two different records. Mirrors the
 * `submission_ticket_tasks` (kind + external_id) shape Quality already stores.
 */
export type CrmRefKind = 'TASK' | 'TICKET';

/** The citation token that appears in the prompt, e.g. `TASK 12345`. */
export function crmRefToken(kind: CrmRefKind, id: number): string {
  return `${kind} ${id}`;
}

/**
 * Parse a model-supplied citation, tolerating `TASK 12`, `task#12`, `TASK:12`.
 * Returns null for anything else — the caller still has to check the result
 * against the refs actually shown to the model.
 */
export function parseCrmRef(value: unknown): { kind: CrmRefKind; id: number } | null {
  if (typeof value !== 'string') return null;
  const m = /^\s*(task|ticket)\s*[:#]?\s*(\d{1,10})\s*$/i.exec(value);
  if (!m) return null;
  const id = Number(m[2]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { kind: m[1].toUpperCase() as CrmRefKind, id };
}

/**
 * How confident we are that the CRM records shown belong to this call.
 *
 *   verified     phone match PLUS independent corroboration from the call itself.
 *                The only outcome allowed to override the model's own citation.
 *   provisional  a compatible record, but nothing outside the phone match supports it.
 *   ambiguous    several candidate accounts or opportunities we cannot separate.
 *   unmatched    the lookup ran and found no sales record.
 *   unavailable  the lookup itself failed; absence here is not a negative answer.
 */
export type ResolutionOutcome = 'verified' | 'provisional' | 'ambiguous' | 'unmatched' | 'unavailable';

/** What was actually read, so a gap in history is stated instead of implied. */
export interface CrmCoverage {
  /** Refs whose full history was read, e.g. `['TASK 1120497', 'TASK 135455']`. */
  recordsRead: string[];
  /** Rows the source holds within the cutoff. */
  rowsRetrieved: number;
  /** Rows rendered into the prompt. */
  rowsRendered: number;
  /** Rows the source holds that were NOT read or not rendered. */
  rowsOmitted: number;
  /** History cutoff applied, `YYYY-MM-DD HH:MM:SS`. */
  cutoff: string;
  /** True when any record's history was longer than the retrieval cap. */
  truncated: boolean;
  /** Per-record read failures, so an outage is visible rather than empty. */
  errors: string[];
}

/** Why these records, and what was rejected — the reviewable resolution trail. */
export interface CrmResolutionSummary {
  outcome: ResolutionOutcome;
  reason: string;
  /** The sales record a finding should cite, or null when none was established. */
  primaryRef: string | null;
  /** The sales grading record set (primary first). */
  salesRefs: string[];
  /** Operational tickets, kept in their own role — never sales documentation. */
  ticketRefs: string[];
  /** Duplicate-successor traversal, including why it stopped. */
  duplicatePath: string[];
  /** Candidates deliberately not used, with the reason. */
  rejected: Array<{ ref: string; reason: string }>;
  /** Customer numbers used, with where each came from on the conversation. */
  numbers: Array<{ digits: string; source: string }>;
  /** True when a record sits on a customer the phone match did not establish. */
  crossAccount: boolean;
}

/** One agent's same-day CRM activity: the prompt text and the refs it cites. */
export interface CrmDayActivity {
  /** Coverage flags distinguish an empty result from material we could not see. */
  unavailable?: boolean;
  truncated?: boolean;
  /** Set for a resolved record set; absent for the day-wide fallback. */
  resolution?: CrmResolutionSummary;
  coverage?: CrmCoverage;
  /**
   * Operational ticket context, rendered separately from the sales records so a
   * support note can inform recovery without ever becoming sales credit.
   */
  ticketNotes?: string;
  /** Rendered note lines, already stripped of HTML and length-capped. */
  notes: string;
  /** Citation tokens for the records rendered above, in first-seen order. */
  refs: string[];
  /**
   * 'record' when the notes are the FULL thread of one task/ticket resolved from
   * the call's phone number (so the model can judge the call against what the
   * account history already shows was done); 'day' for the agent's whole-day
   * activity, the fallback used when the number can't be resolved to one record.
   */
  scope?: 'record' | 'day';
  /** Header label for a 'record' scope, e.g. "TASK 123 — New Business Lead / Rusty's". */
  recordLabel?: string;
}

/**
 * Whether a transcript turn on OUR side of the line can be attributed to the
 * REVIEWED salesperson.
 *
 * It usually cannot. `transcriptRender` labels every internal turn "Agent",
 * collapsing the salesperson, a transferred Customer Service rep, an ACD and an
 * IVR into one speaker. So on a transferred call the sentence "there's also a
 * five-year extended option" may be Customer Service's, and crediting it to the
 * reviewed salesperson is exactly the error that withdrew Jason's warranty
 * finding. One internal party means an "Agent" line is theirs; more than one, or
 * an unknown count, means the label proves nothing.
 */
export interface CallAttribution {
  /** Distinct participants on our side of the line; null when not established. */
  internalPartyCount: number | null;
  /** True only when exactly one internal party was on the conversation. */
  soleInternalParty: boolean;
}

/** Candidate plus the text the model reads. */
export interface CallMaterial extends CallCandidate {
  /** Speaker-attributed dialogue, or empty when no transcript exists. */
  transcript: string;
  /**
   * True when the transcript could not be RETRIEVED (phone DB error), as
   * opposed to a call that genuinely has none. Both used to arrive as an empty
   * string, which made an outage indistinguishable from a call with no
   * recording consent — one is a failed review, the other a legitimate skip.
   */
  transcriptUnavailable?: boolean;
  /** The agent's same-day CRM activity, and the records it may cite. */
  crm: CrmDayActivity;
  /**
   * Whether an internal transcript turn is this salesperson's. Required, not
   * optional: a missing value would have to be guessed, and guessing "yes" is
   * what credits one employee with another's offer.
   */
  attribution: CallAttribution;
  /**
   * Rendered new leads the agent opened that day (crmCreated.ts). `crm` above
   * shows work LOGGED, never a record CREATED, so this is what lets the model
   * check whether an opportunity raised on the call — a sibling location, a
   * referral — was actually recorded. Judgment context only: these refs are
   * deliberately not citable in `crm_ref`.
   *
   * EMPTY STRING AND NULL ARE DIFFERENT ANSWERS. '' means the lookup ran and
   * the agent created nothing — which the expansion rule reads as evidence.
   * null means the lookup FAILED, and the prompt must say so rather than
   * render the agent a confident negative it never earned.
   *
   * Required, not optional: an omitted field would have to be guessed at, and
   * guessing either way reintroduces the bug — silently either asserting a
   * negative nobody checked, or withdrawing evidence the expansion rule needs.
   */
  leadsCreated: string | null;
}

/**
 * Who said the evidence quote. The transcript is speaker-labelled, so the model
 * can attribute it; a quote pulled from the rep's own CRM notes is 'AGENT'.
 */
export type EvidenceSpeaker = 'CUSTOMER' | 'AGENT';

/** Normalise a model-supplied speaker to the enum, tolerating rep/customer synonyms. */
export function parseEvidenceSpeaker(value: unknown): EvidenceSpeaker | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (!v || v === 'null') return null;
  if (v === 'customer' || v === 'caller' || v === 'client' || v === 'external') return 'CUSTOMER';
  if (v === 'agent' || v === 'rep' || v === 'salesperson' || v === 'internal') return 'AGENT';
  return null;
}

/** A single miss the model reported for one call. */
export interface AnalyzedFinding {
  ruleKey: string;
  severity: MissedOpportunitySeverity;
  title: string;
  whatHappened: string;
  evidenceQuote: string | null;
  /** Who said evidenceQuote; null when unattributed or there is no quote. */
  evidenceSpeaker: EvidenceSpeaker | null;
  recommendedApproach: string;
  /** Morning-after action to save this account; null when nothing is recoverable. */
  recoveryAction: string | null;
  estValueNote: string | null;
  customerName: string | null;
  /** The CRM record cited for this miss, or null when none was cited. */
  crmRefKind: CrmRefKind | null;
  crmRefId: number | null;
}

/** Result of analyzing one call. `skipped` covers no-transcript and no-op calls. */
export interface AnalyzeCallResult {
  conversationId: string;
  findings: AnalyzedFinding[];
  tokensIn: number;
  tokensOut: number;
  usdCost: number;
  modelUsed: string | null;
  skipped: boolean;
  skipReason?: string;
  error?: string;
}
