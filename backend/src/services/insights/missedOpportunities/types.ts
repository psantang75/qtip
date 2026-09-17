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

/** One agent's same-day CRM activity: the prompt text and the refs it cites. */
export interface CrmDayActivity {
  /** Coverage flags distinguish an empty result from material we could not see. */
  unavailable?: boolean;
  truncated?: boolean;
  matchConfidence?: 'strong' | 'weak';
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
