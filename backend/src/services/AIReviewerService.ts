/**
 * AIReviewerService
 *
 * Fills out and submits real qtip audit forms via the existing submission
 * pipeline, attributed to the synthetic "AI Reviewer" user. Tickets ship
 * first; AR-Ops tasks and call transcripts plug in later via the same
 * InteractionAdapter contract.
 *
 * Pipeline (ticket path):
 *   1. Load form + validate ai_enabled, interaction_type, AI feedback question
 *   2. Adapter loads the audited material from the source system (CRM today)
 *   3. BookStack search by classification text → top-N page plaintext
 *   4. Claude Opus 4.7 fills out the form (structured JSON). Provider +
 *      model are env-driven via ANTHROPIC_DEFAULT_MODEL / OPENAI_DEFAULT_MODEL
 *      (see backend/src/config/environment.ts) — the OpenAI fork uses gpt-5.
 *   5. Map LLM JSON → SubmissionAnswer[]; validate every answer
 *   6. Hand off to SubmissionService.submitAudit (same code path humans use)
 *
 * Where to tune behavior (no hardcoded business rules in this file):
 *   - Per-form rules            → Form Builder "AI Reviewer Guidance"
 *                                 textarea (forms.ai_review_guidance), injected
 *                                 into the system prompt as
 *                                 ADDITIONAL FORM-SPECIFIC GRADING RULES.
 *   - Global grading philosophy → backend/src/services/aiReviewerPrompt.ts
 *                                 (the `system` string in buildAiReviewerPrompt).
 *   - KB retrieval depth/scope  → searchKb() below + BookStackService.
 *   - Playbook-driven KB        → tblPlayBookLink.LinkURL on each ticket's
 *                                 classification. searchKb() pulls those
 *                                 pages first (highest authority), then tops
 *                                 up with classification-text search hits,
 *                                 deduped by page id.
 *
 * Errors surface as AIReviewerServiceError with a stable code + statusCode.
 */

import prisma from '../config/prisma';
import { aiConfig } from '../config/ai';
import { aiReviewerConfig } from '../config/environment';
import { getAnthropicClient, isAnthropicConfigured } from './ai/AnthropicClient';
import { getOpenAIClient, isOpenAIConfigured } from './ai/OpenAIClient';
import {
  callChatModel,
  resolveCheapModelName,
  resolveModelName,
  type ModelProvider,
} from './ai/ChatModelClient';
import bookstackService from './BookStackService';
import kbIndexService from './KbIndexService';
import crmService, { type TicketHeader, type TaskHeader, type CRMNote } from './CRMService';
import phoneSystemService from './PhoneSystemService';
import { SubmissionService } from './SubmissionService';
import { MySQLSubmissionRepository } from '../repositories/MySQLSubmissionRepository';
import { AI_REVIEWER_FEEDBACK_QUESTION_TEXT } from '../repositories/MySQLFormRepository';
import logger from '../config/logger';
import type {
  CreateSubmissionAnswerDTO,
  SubmissionMetadataDTO,
  AiTimelineItem,
  AiObservation,
  AiObservationKind,
  AiObservationSeverity,
  AiPlaybookStep,
  AiCoaching,
  AiVerification,
} from '../models/Submission';
import { buildAiReviewerPrompt, loadFormRubrics, type FormForPrompt } from './aiReviewerPrompt';
import {
  buildTracePrompt,
  buildSynthesisPrompt,
  buildReasoningPrompt,
  buildAnswerChunkPrompt,
  groupGradeableQuestionsByCategory,
  type DraftAnswer,
} from './aiReviewerTwoPassPrompts';
import { withCallLog, type CallLogMeta } from './aiCallLogger';
import aiCalibrationService, { type CalibrationCorrection } from './AICalibrationService';
import rulePackService from './RulePackService';
import { estimateUsdCost, formatUsdCost, type CostEstimate } from './aiCostEstimator';
import { checkBudget } from './AIReviewerCostGuard';
import { applyCalibration, applyAnswerCalibration } from './ConfidenceCalibrator';
import { linkCallToTicket } from './CallTicketLinkerService';
import { detectCasePivots, type CasePivot } from './aiReviewerPivotDetector';
import { voteOnTraces, type TraceAgreement } from './aiReviewerTraceVoting';

/** Merge two arrays of strings, dropping duplicates, preserving order. */
function mergeUniqueStrings(a: string[] | undefined, b: string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of [...(a ?? []), ...(b ?? [])]) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

export class AIReviewerServiceError extends Error {
  constructor(message: string, public code: string, public statusCode: number = 400) {
    super(message);
    this.name = 'AIReviewerServiceError';
  }
}

export interface InteractionMaterial {
  /** Compact key/value summary of the audited record (for the prompt header). */
  header: Record<string, string>;
  /** Full ordered notes / transcript. */
  notesOrTranscript: CRMNote[];
  /** Free-text classification used to construct the KB search query. */
  classificationText: string;
  /** Author IDs whose recent notes seed the cut-and-paste heuristic. */
  noteAuthorIds: number[];
  /** When the interaction closed (validates "is closed" guard). */
  closedOn: Date | null;
  /** Status text from the source system (used to validate "is closed"). */
  statusText: string | null;
  /** Display name of the agent who handled the interaction (used to resolve qtip CSR). */
  agentDisplayName: string | null;
  /** Date the interaction took place / opened (drives the "Interaction Date" metadata field). */
  interactionDate: Date | null;
  /**
   * Mandatory KB URLs sourced from the interaction itself (today: the active
   * playbook links on a ticket's classification). These are the documented
   * process the agent was supposed to follow on this exact kind of work, so
   * they go into the prompt FIRST and outrank text-search hits.
   */
  mandatoryKbUrls: string[];
}

/**
 * Payload merged into the SubmissionService.submitAudit / saveDraft
 * call so the AI's submission is linked back to the source interaction.
 *
 * - Tickets and tasks land in `submission_ticket_tasks` (reference-only,
 *   live-fetched at view time).
 * - Calls land in `submission_calls` via the existing `call_ids` +
 *   `call_data` virtual-call upsert path used by the human audit flow.
 *
 * Phase C (C2): broadened from a discriminated union to a flat shape
 * that can carry BOTH ticket-task refs AND call refs in the same
 * payload. This is what unblocks combined ticket+call reviews — the
 * loadCase() loader can attach a call to a ticket-primary case (or
 * vice-versa) and the SubmissionService persists both sides.
 */
export interface SubmissionLinkPayload {
  ticket_tasks?: { kind: 'TICKET' | 'TASK'; external_id: number }[];
  call_ids?: number[];
  call_data?: Array<{
    call_id: string;
    call_date?: string | Date;
    duration?: number;
    recording_url?: string | null;
    transcript?: string | null;
  }>;
}

/**
 * Phase C (C2): typed reference to one source inside a Case. Tickets
 * and tasks use numeric CRM ids; calls use the Genesys conversation id
 * string (calls.call_id), so external_id is intentionally a union.
 */
export interface CaseSourceRef {
  kind: 'TICKET' | 'TASK' | 'CALL';
  external_id: string | number;
}

/**
 * Phase C (C2): a Case is the unit of review the AI reviewer grades.
 * Single-source reviews (ticket-only, call-only, task-only) collapse
 * to `attached: []`. Combined ticket+call reviews populate both sides.
 *
 * `id` is `KIND:external_id` of the primary source — that string is
 * what Phase C C4 stores in `submissions.case_id` so the inbox /
 * absorb / readiness routing can group multiple submissions under the
 * same case (e.g. the AI run + a later sample-review run).
 */
export interface Case {
  id: string;
  primary: CaseSourceRef;
  attached: CaseSourceRef[];
}

/** Format a CaseSourceRef as `KIND:external_id` for case_id. */
export function formatCaseId(ref: CaseSourceRef): string {
  return `${ref.kind}:${ref.external_id}`;
}

interface InteractionAdapter<TId = number> {
  kind: 'TICKET' | 'TASK' | 'CALL';
  /**
   * `auditCutoffAt` (added for call-window scoping): when this source is
   * an ATTACHED ticket/task on a CALL-primary review, the orchestrator
   * passes the call's end time plus a documentation-period grace window.
   * The adapter MUST drop any notes whose `created_on > auditCutoffAt`
   * before returning, so the AI grader never sees post-call commentary
   * (re-opens, supervisor edits, follow-up agent notes) and cannot use
   * it as hindsight fault evidence. CALL adapter ignores the parameter —
   * its single synthetic "note" is the transcript itself.
   */
  loadMaterial(id: TId, auditCutoffAt?: Date | null): Promise<InteractionMaterial>;
  toSubmissionLink(id: TId, material: InteractionMaterial): SubmissionLinkPayload;
  isClosed(material: InteractionMaterial): boolean;
  /** How the source id renders in log / response messages. */
  formatId(id: TId): string;
}

const TicketAdapter: InteractionAdapter<number> = {
  kind: 'TICKET',
  async loadMaterial(
    ticketId: number,
    auditCutoffAt?: Date | null
  ): Promise<InteractionMaterial> {
    const header = await crmService.getTicketHeader(ticketId);
    if (!header) {
      throw new AIReviewerServiceError(`Ticket ${ticketId} not found in CRM`, 'TICKET_NOT_FOUND', 404);
    }
    const [allNotes, playbookLinks] = await Promise.all([
      // Threads the cutoff into CRMService so each row gets stamped with
      // `is_after_audit` based on the same wall-clock anchor we use for
      // human-audit replays. The filtering happens below — keep loaders
      // and filtering separate so the log line below can compare counts.
      crmService.getTicketNotes(ticketId, auditCutoffAt ?? null),
      crmService.getTicketPlaybookLinks(ticketId),
    ]);
    const notes = filterPostAuditNotes(allNotes, auditCutoffAt, {
      sourceKind: 'TICKET',
      sourceId: ticketId,
    });
    const headerFlat = ticketHeaderToFlat(header);
    if (auditCutoffAt) {
      headerFlat['Audit scope'] = renderAuditScopeLine(auditCutoffAt);
    }
    return {
      header: headerFlat,
      notesOrTranscript: notes,
      classificationText: [header.class_name, header.subclass_name].filter(Boolean).join(' '),
      noteAuthorIds: Array.from(new Set(notes.map((n) => n.created_by).filter((v): v is number => v != null))),
      closedOn: header.modified_on, // CRM doesn't expose closed_on directly; modified_on is the closest signal
      statusText: header.status,
      agentDisplayName: header.assigned_to_name,
      interactionDate: header.created_on ?? header.modified_on,
      mandatoryKbUrls: playbookLinks.map((l) => l.link_url).filter(Boolean),
    };
  },
  toSubmissionLink(ticketId) {
    return { ticket_tasks: [{ kind: 'TICKET', external_id: ticketId }] };
  },
  isClosed(material) {
    const s = (material.statusText || '').toLowerCase();
    return s === 'closed' || s === 'resolved';
  },
  formatId(ticketId) {
    return String(ticketId);
  },
};

/**
 * AR-Ops / billing tasks. Same notes-shape as tickets (CRMNote rows), so
 * the existing prompt builder renders them the same way. There's no
 * playbook-link concept on tasks today, so mandatoryKbUrls is empty —
 * KB grounding falls through to the search/semantic layers.
 */
const TaskAdapter: InteractionAdapter<number> = {
  kind: 'TASK',
  async loadMaterial(
    taskId: number,
    auditCutoffAt?: Date | null
  ): Promise<InteractionMaterial> {
    const header = await crmService.getTaskHeader(taskId);
    if (!header) {
      throw new AIReviewerServiceError(`Task ${taskId} not found in CRM`, 'TASK_NOT_FOUND', 404);
    }
    const allNotes = await crmService.getTaskNotes(taskId, auditCutoffAt ?? null);
    const notes = filterPostAuditNotes(allNotes, auditCutoffAt, {
      sourceKind: 'TASK',
      sourceId: taskId,
    });
    const headerFlat = taskHeaderToFlat(header);
    if (auditCutoffAt) {
      headerFlat['Audit scope'] = renderAuditScopeLine(auditCutoffAt);
    }
    return {
      header: headerFlat,
      notesOrTranscript: notes,
      classificationText: header.task_type ?? '',
      noteAuthorIds: Array.from(new Set(notes.map((n) => n.created_by).filter((v): v is number => v != null))),
      closedOn: header.completed_on,
      statusText: header.task_status,
      agentDisplayName: header.assigned_to_name,
      interactionDate: header.created_on,
      mandatoryKbUrls: [],
    };
  },
  toSubmissionLink(taskId) {
    return { ticket_tasks: [{ kind: 'TASK', external_id: taskId }] };
  },
  isClosed(material) {
    const s = (material.statusText || '').toLowerCase();
    // Task statuses use phrasing like "Closed", "Completed", "Resolved" depending on tblTaskStatus rows.
    return s.includes('closed') || s.includes('completed') || s.includes('resolved') || s === 'done';
  },
  formatId(taskId) {
    return String(taskId);
  },
};

/**
 * Phone-system call transcripts (Genesys conversation IDs). Persistence
 * uses the existing virtual-call upsert path (`call_ids: [-1]` + a
 * matching `call_data[0]`) so a `Call` row is materialized in the qtip
 * `calls` table on first use, then linked via `submission_calls`. The
 * AI Reviewer user owns the row so foreign-key constraints are satisfied
 * even when the conversation has never been audited by a human.
 */
const ConversationAdapter: InteractionAdapter<string> = {
  kind: 'CALL',
  async loadMaterial(
    conversationId: string,
    // Intentionally ignored: the CALL adapter's only "note" is the
    // synthetic transcript wrapper. The audit cutoff is derived FROM
    // the call, not applied to it.
    _auditCutoffAt?: Date | null
  ): Promise<InteractionMaterial> {
    const [transcripts, meta] = await Promise.all([
      phoneSystemService.getTranscriptByConversationId(conversationId),
      phoneSystemService.getConversationMetaByConversationId(conversationId),
    ]);

    // Phase B: preserve the raw transcript content (string or JSON-of-turns)
    // and let renderTranscriptBlock in aiReviewerPrompt.ts format it. The
    // old code pretty-printed any JSON it parsed, which forced the model
    // to read indented JSON instead of speaker-turn-flow text.
    const transcriptText = (transcripts ?? [])
      .map((t) => t.transcript ?? '')
      .filter((s) => s && s.trim().length > 0)
      .join('\n\n---\n\n');

    if (!transcriptText) {
      throw new AIReviewerServiceError(
        `Conversation ${conversationId} has no transcript available in PhoneSystem.`,
        'CONVERSATION_NOT_FOUND',
        404
      );
    }

    const startEt = meta?.start_et ?? null;
    // Synthesize a single CRMNote so the existing prompt builder can render
    // the transcript verbatim through the same template path.
    const transcriptAsNote: CRMNote = {
      id: 1,
      note: transcriptText,
      created_on: startEt ? startEt.toISOString() : null,
      created_by: null,
      created_by_name: 'Call Transcript',
      status_after: null,
      next_contact_date: null,
      is_after_audit: false,
    };

    return {
      header: conversationHeaderToFlat(conversationId, meta),
      notesOrTranscript: [transcriptAsNote],
      // Conversations have no classification field today — leave blank
      // and lean on the form's ai_review_guidance + global KB index.
      classificationText: '',
      noteAuthorIds: [],
      closedOn: meta?.end_et ?? null,
      // PhoneSystem only exposes completed conversations through the
      // transcript table, so presence of a transcript implies "closed".
      statusText: 'Closed',
      agentDisplayName: null,
      interactionDate: startEt,
      mandatoryKbUrls: [],
    };
  },
  toSubmissionLink(conversationId, material) {
    const transcript = material.notesOrTranscript[0]?.note ?? null;
    const callDate = material.interactionDate ?? new Date();
    const duration =
      material.closedOn && material.interactionDate
        ? Math.max(0, Math.round((material.closedOn.getTime() - material.interactionDate.getTime()) / 1000))
        : 0;
    return {
      call_ids: [-1],
      call_data: [
        {
          call_id: conversationId,
          call_date: callDate,
          duration,
          recording_url: null,
          transcript,
        },
      ],
    };
  },
  isClosed(material) {
    return material.notesOrTranscript.length > 0;
  },
  formatId(conversationId) {
    return conversationId;
  },
};

function ticketHeaderToFlat(h: TicketHeader): Record<string, string> {
  // Built incrementally so empty optional fields are simply absent rather
  // than rendering as `Key: ` lines in the prompt. The renderer treats
  // empty-string values as missing-but-known; either approach works, but
  // omitting keys keeps the header block compact for tickets that have
  // (e.g.) no site, no order, no job assigned.
  const siteParts: string[] = [];
  if (h.site_name) siteParts.push(h.site_name);
  if (h.site_address) siteParts.push(h.site_address);
  if (h.site_city || h.site_state) {
    siteParts.push(`(${[h.site_city, h.site_state].filter(Boolean).join(', ')})`);
  }
  const siteValue =
    h.site_id != null
      ? `${siteParts.join(' ').trim() || `Site #${h.site_id}`} [id ${h.site_id}]`
      : '';

  const contactName = [h.contact_first_name, h.contact_last_name].filter(Boolean).join(' ').trim();
  const contactValue =
    h.contact_id != null
      ? `${contactName || `Contact #${h.contact_id}`}${h.contact_email ? ` <${h.contact_email}>` : ''} [id ${h.contact_id}]`
      : '';

  const jobValue =
    h.job_id != null
      ? `${h.job_partner_number ? `${h.job_partner_number} ` : ''}[id ${h.job_id}]`
      : '';

  const orderValue =
    h.order_id != null
      ? `${h.order_number ?? ''}${h.po_number ? ` / PO ${h.po_number}` : ''}${h.order_number || h.po_number ? ' ' : ''}[id ${h.order_id}]`.trim()
      : '';

  // Device Type = the dropdown selection (e.g. "PlayerOne", "SXBR3").
  // Distinct from Device ID, which is the serial number (hardware) or
  // username (internet device) stored on tblTicket.RadioIDNum.
  const deviceTypeValue =
    h.device_type_id != null
      ? h.device_type_name ?? `(unknown device type, id ${h.device_type_id})`
      : '';

  // `sites_all` carries every Active site linked to the ticket; surface
  // it whenever the ticket spans more than one site so the AI grader
  // doesn't penalize the agent for naming a location that's "not THE
  // site" when in fact it's one of several linked sites. The single-
  // site `Site` line above stays for back-compat / quick scan; the
  // multi-line `Sites (all linked)` block is the authoritative list.
  const sitesAllValue = (() => {
    if (!h.sites_all) return '';
    const parts = h.sites_all.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
    return parts.length > 1 ? h.sites_all : '';
  })();

  // Per-site device rollup. Surface only when there's more than one
  // device on the ticket — single-device tickets are fine with the
  // bare `Device ID` line above.
  const devicesAllValue = (() => {
    if (!h.devices_all_with_site) return '';
    const parts = h.devices_all_with_site.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    return parts.length > 1 ? h.devices_all_with_site : '';
  })();

  return {
    'Ticket ID': String(h.ticket_id),
    Class: h.class_name ?? '',
    Subclass: h.subclass_name ?? '',
    Status: h.status ?? '',
    Resolution: h.resolution ?? '',
    'Assigned To': h.assigned_to_name ?? (h.assigned_to_id != null ? `User #${h.assigned_to_id}` : ''),
    'Customer ID': h.customer_id != null ? String(h.customer_id) : '',
    Site: siteValue,
    'Sites (all linked)': sitesAllValue,
    Contact: contactValue,
    Job: jobValue,
    Order: orderValue,
    'Device Type': deviceTypeValue,
    'Device ID': h.device_id ?? '',
    'Devices (per site)': devicesAllValue,
    'Created On': h.created_on?.toISOString() ?? '',
    'Modified On': h.modified_on?.toISOString() ?? '',
    Description: h.description ?? '',
  };
}

function taskHeaderToFlat(h: TaskHeader): Record<string, string> {
  return {
    'Task ID': String(h.task_id),
    'Task Type': h.task_type ?? '',
    Status: h.task_status ?? '',
    'Assigned To': h.assigned_to_name ?? (h.assigned_to_id != null ? `User #${h.assigned_to_id}` : ''),
    'Customer ID': h.customer_id != null ? String(h.customer_id) : '',
    'Created On': h.created_on?.toISOString() ?? '',
    'Due On': h.due_on?.toISOString() ?? '',
    'Completed On': h.completed_on?.toISOString() ?? '',
  };
}

function conversationHeaderToFlat(
  conversationId: string,
  meta: { start_et: Date | null; end_et: Date | null; duration_seconds: number } | null
): Record<string, string> {
  return {
    'Conversation ID': conversationId,
    'Started At': meta?.start_et?.toISOString() ?? '',
    'Ended At': meta?.end_et?.toISOString() ?? '',
    'Duration (seconds)': meta?.duration_seconds != null ? String(meta.duration_seconds) : '',
  };
}

/**
 * Phase C (C2): build a multi-source Case from a primary source.
 *
 * Today the only auto-attachment we perform is "given a CALL primary,
 * try to discover the linked CRM ticket" via CallTicketLinkerService
 * (Phase C C1 spike output). Ticket-primary cases stay single-source
 * here; the inverse direction (auto-attach a call to a ticket primary)
 * is intentionally manual until ticket→call linkage has a chosen path
 * — adding it later only requires a parallel branch below.
 *
 * `maxAttachedSources` caps the number of attached refs we surface so
 * the prompt builder cannot blow the cost guard with a runaway case.
 * Defaults to 3 (matches the new forms.ai_max_attached_sources column).
 */
export async function loadCase(
  primary: CaseSourceRef,
  opts: { maxAttachedSources?: number; explicitAttached?: CaseSourceRef[] } = {}
): Promise<Case> {
  const cap = Math.max(0, Math.min(10, opts.maxAttachedSources ?? 3));
  const attached: CaseSourceRef[] = [];
  const seen = new Set<string>([formatCaseId(primary)]);

  // Caller-supplied attachments (e.g. the human reviewer manually
  // attached a call to a ticket review). These are honored first so
  // the auto-discovered links can't crowd them out under the cap.
  if (opts.explicitAttached) {
    for (const ref of opts.explicitAttached) {
      const key = formatCaseId(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      attached.push(ref);
      if (attached.length >= cap) break;
    }
  }

  // Auto-discovery: CALL primary → CRM ticket.
  if (primary.kind === 'CALL' && attached.length < cap) {
    try {
      const link = await linkCallToTicket(String(primary.external_id));
      if (link?.ticket_id) {
        const ticketRef: CaseSourceRef = { kind: 'TICKET', external_id: link.ticket_id };
        const key = formatCaseId(ticketRef);
        if (!seen.has(key)) {
          attached.push(ticketRef);
          seen.add(key);
        }
      }
    } catch (err) {
      logger.warn(`[AI REVIEWER CASE] CALL→TICKET linker failed for ${primary.external_id}: ${(err as Error).message}`);
    }
  }

  return {
    id: formatCaseId(primary),
    primary,
    attached: attached.slice(0, cap),
  };
}

/**
 * Pick the right `InteractionAdapter` for a `CaseSourceRef`. The case
 * model is provider-agnostic — the orchestrator picks the adapter at
 * the boundary so each source's material loads through its existing
 * loader without `reviewCase` having to know about CRM vs Genesys.
 */
function pickAdapter(ref: CaseSourceRef): InteractionAdapter<number> | InteractionAdapter<string> {
  if (ref.kind === 'TICKET') return TicketAdapter;
  if (ref.kind === 'TASK') return TaskAdapter;
  return ConversationAdapter;
}

/**
 * Coerce the union-typed `external_id` into the runtime type each
 * adapter expects (numeric for TICKET/TASK, string for CALL) and call
 * `loadMaterial`. Throws a typed error when the id shape doesn't match
 * the adapter's contract — that's a route-layer validation bug, not a
 * runtime CRM problem.
 */
async function loadAdapterMaterial(
  adapter: InteractionAdapter<number> | InteractionAdapter<string>,
  ref: CaseSourceRef,
  auditCutoffAt?: Date | null
): Promise<InteractionMaterial> {
  if (adapter.kind === 'CALL') {
    const id = String(ref.external_id);
    return (adapter as InteractionAdapter<string>).loadMaterial(id, auditCutoffAt);
  }
  const id = typeof ref.external_id === 'number' ? ref.external_id : Number(ref.external_id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AIReviewerServiceError(
      `${ref.kind} external_id must be a positive integer (got ${JSON.stringify(ref.external_id)})`,
      'INVALID_SOURCE_REF',
      400
    );
  }
  return (adapter as InteractionAdapter<number>).loadMaterial(id, auditCutoffAt);
}

/**
 * Default grace window applied AFTER a call's end_et when deriving the
 * "you can still document this call" cutoff for attached ticket notes.
 * 60 minutes (user-confirmed) is generous enough to cover most agents'
 * documentation periods without bleeding into the next shift's work.
 * Override via `AI_REVIEWER_POST_CALL_DOC_WINDOW_MIN` for special cases.
 */
const DEFAULT_POST_CALL_DOC_WINDOW_MIN = 60;

function resolvePostCallDocWindowMs(): number {
  const raw = Number(process.env.AI_REVIEWER_POST_CALL_DOC_WINDOW_MIN);
  const minutes = Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_POST_CALL_DOC_WINDOW_MIN;
  return Math.round(minutes * 60 * 1000);
}

/**
 * Filter ticket/task notes by the call-window cutoff.
 *
 * Notes whose CRM `is_after_audit === true` were created AFTER the audit
 * cutoff (call_end + doc_window). For CALL-primary reviews these are
 * post-call commentary by other agents (re-opens, supervisor edits,
 * follow-up notes) — they describe what was eventually learned, NOT what
 * the original agent could have known in-flight. Letting them flow into
 * the synthesis prompt produces hindsight-bias grading (the AI faulting
 * the agent for not diagnosing something the customer never surfaced).
 *
 * When `cutoff` is null/undefined we skip the filter entirely (e.g.
 * ticket-primary or task-primary reviews — those audits legitimately
 * cover the full ticket history).
 */
/**
 * Render the human-readable scope line surfaced in attached
 * ticket/task headers so the AI grader knows post-call commentary was
 * deliberately filtered out (vs the ticket genuinely having no later
 * notes). The line itself is informational — the actual filtering
 * happens in `filterPostAuditNotes`.
 */
function renderAuditScopeLine(cutoff: Date): string {
  const minutes =
    Number(process.env.AI_REVIEWER_POST_CALL_DOC_WINDOW_MIN) ||
    DEFAULT_POST_CALL_DOC_WINDOW_MIN;
  return (
    `this call + ticket/task notes created on/before ${cutoff.toISOString()} ` +
    `(call end + ${minutes}min documentation window). ` +
    `Notes added later by other agents (re-opens, supervisor edits, follow-up activity) ` +
    `are OUT OF SCOPE and have been filtered out — do not request them, do not infer their content, ` +
    `and do not fault the agent for what those later notes might reveal.`
  );
}

function filterPostAuditNotes(
  notes: CRMNote[],
  cutoff: Date | null | undefined,
  ctx: { sourceKind: 'TICKET' | 'TASK'; sourceId: number }
): CRMNote[] {
  if (!cutoff) return notes;
  const kept: CRMNote[] = [];
  let dropped = 0;
  for (const n of notes) {
    if (n.is_after_audit) {
      dropped += 1;
    } else {
      kept.push(n);
    }
  }
  if (dropped > 0) {
    logger.info(
      `[AI REVIEWER CASE] dropped ${dropped} post-call note(s) from ${ctx.sourceKind} ${ctx.sourceId} ` +
        `(cutoff=${cutoff.toISOString()}, kept=${kept.length}, total=${notes.length})`
    );
  }
  return kept;
}

/** Render a `CaseSourceRef.external_id` as a string for prompts / logs. */
function formatRefId(ref: CaseSourceRef): string {
  return String(ref.external_id);
}

/**
 * Same source-id coercion used by `loadAdapterMaterial`, but applied at
 * the link-payload boundary so each adapter's `toSubmissionLink` gets
 * its expected runtime type.
 */
function adapterLinkFor(ref: CaseSourceRef, material: InteractionMaterial): SubmissionLinkPayload {
  if (ref.kind === 'CALL') {
    return ConversationAdapter.toSubmissionLink(String(ref.external_id), material);
  }
  const id = typeof ref.external_id === 'number' ? ref.external_id : Number(ref.external_id);
  if (ref.kind === 'TICKET') return TicketAdapter.toSubmissionLink(id, material);
  return TaskAdapter.toSubmissionLink(id, material);
}

/**
 * Merge per-source link payloads into one submission-shaped payload.
 *
 * Tickets and tasks land in `submission_ticket_tasks` (a list of
 * `{ kind, external_id }` refs). Calls land in `submission_calls` via
 * the virtual-call upsert path: `call_ids: [-1]` is a sentinel telling
 * the repository to create a Call row from the matching `call_data[i]`
 * instead of binding to an existing call. Both halves are kept as
 * arrays so a single submission can carry several sources of either
 * kind without losing any.
 */
function mergeSubmissionLinks(parts: SubmissionLinkPayload[]): SubmissionLinkPayload {
  const ticket_tasks: { kind: 'TICKET' | 'TASK'; external_id: number }[] = [];
  const call_ids: number[] = [];
  const call_data: NonNullable<SubmissionLinkPayload['call_data']> = [];
  const seenTickets = new Set<string>();
  const seenCallIds = new Set<string>();
  for (const p of parts) {
    for (const t of p.ticket_tasks ?? []) {
      const key = `${t.kind}:${t.external_id}`;
      if (seenTickets.has(key)) continue;
      seenTickets.add(key);
      ticket_tasks.push(t);
    }
    if (Array.isArray(p.call_ids) && Array.isArray(p.call_data)) {
      for (let i = 0; i < p.call_data.length; i++) {
        const entry = p.call_data[i];
        if (!entry?.call_id) continue;
        if (seenCallIds.has(entry.call_id)) continue;
        seenCallIds.add(entry.call_id);
        call_data.push(entry);
        // Preserve the virtual-call sentinel pairing — repository
        // expects `call_ids[i]` to align with `call_data[i]`.
        call_ids.push(p.call_ids[i] ?? -1);
      }
    }
  }
  const out: SubmissionLinkPayload = {};
  if (ticket_tasks.length > 0) out.ticket_tasks = ticket_tasks;
  if (call_data.length > 0) {
    out.call_ids = call_ids;
    out.call_data = call_data;
  }
  return out;
}

/** Shape of a single hit returned by `searchKb`. Re-declared here so
 *  reviewCase's per-source `kbHits` array has a name (the function's
 *  return type is inlined). */
type KbHit = {
  id: number;
  name: string;
  url: string;
  content: string;
  is_playbook: boolean;
  playbook_steps?: string[] | null;
  linked_from?: { name: string; url: string; hop: number };
};

export interface AIReviewResult {
  submission_id: number;
  /** 0 when status === 'DRAFT' (no scoring runs on drafts). */
  total_score: number;
  /** 'SUBMITTED' for the default flow; 'DRAFT' when the form has ai_submit_as_draft=true (Phase 5). */
  status: 'SUBMITTED' | 'DRAFT';
  message: string;
  ai_model: string;
  kb_pages_cited: { id: number; name: string; url: string }[];
  /**
   * TEMP COST ESTIMATOR — non-persistent per-run USD cost. NOT a database
   * column. Surfaced so the manual-run toast can display the cost. Will
   * be removed when we wire up real usage analytics.
   */
  cost_estimate?: { usd: number; formatted: string; approximated: boolean } | null;
}

export type AiProvider = 'anthropic' | 'openai';

/**
 * Result of running the analysis pipeline WITHOUT writing a submission.
 * Used by tooling (e.g. the dual-provider comparison script) that wants
 * to see what the model would have answered without polluting the audit
 * history.
 */
export interface AIAnalysisResult {
  provider: AiProvider;
  model: string;
  elapsedMs: number;
  retried: boolean;
  /** Header rendered exactly as it would appear in the prompt. */
  header: Record<string, string>;
  /** Notes count fed to the model. */
  notesCount: number;
  /** KB pages we placed into the prompt (with playbook flag). */
  kbPagesProvided: {
    id: number;
    name: string;
    url: string;
    is_playbook: boolean;
    /** Set when this page was added by KB link expansion (BFS from a primary hit). */
    linked_from?: { name: string; url: string; hop: number } | null;
  }[];
  /** Per-question answers, enriched with question text/type for reporting. */
  answers: {
    question_id: number;
    category_name: string;
    question_text: string;
    question_type: string;
    value: string;
    confidence: number | null;
  }[];
  /** Top-level narrative that would have populated the AI Reviewer Feedback. */
  narrative: string;
  /** KB citations the model produced. */
  kbCitations: { id: number; name: string; url: string }[];
  /** Top-level confidence the AI emitted for the whole review (null if not provided). */
  overallConfidence: number | null;
  /** AI-reconstructed chronological action timeline. */
  timeline: AiTimelineItem[];
  /** Non-scored advisory observations. */
  observations: AiObservation[];
}

/**
 * Public service surface. Methods for tasks and calls follow the same
 * shape as `reviewClosedTicket` once their adapters land.
 */
export class AIReviewerService {
  private readonly submissionService: SubmissionService;

  constructor() {
    this.submissionService = new SubmissionService(new MySQLSubmissionRepository());
  }

  isConfigured(): boolean {
    return aiReviewerConfig !== null && isAnthropicConfigured() && bookstackService.isConfigured();
  }

  async reviewClosedTicket(ticketId: number, opts: { formId: number }): Promise<AIReviewResult> {
    return this.review(TicketAdapter, ticketId, opts);
  }

  /**
   * AR-Ops / billing closed task. Mirrors the ticket flow but uses
   * `CRMService.getTaskHeader` + `getTaskNotes` for material loading.
   * Persists with `kind = 'TASK'` in `submission_ticket_tasks`.
   */
  async reviewClosedTask(taskId: number, opts: { formId: number }): Promise<AIReviewResult> {
    return this.review(TaskAdapter, taskId, opts);
  }

  /**
   * Phone-system call transcript (Genesys conversation ID). Materializes
   * a `Call` row in qtip on first use and links via `submission_calls`,
   * matching the existing virtual-call upsert path used by humans.
   */
  async reviewClosedConversation(conversationId: string, opts: { formId: number }): Promise<AIReviewResult> {
    return this.review(ConversationAdapter, conversationId, opts);
  }

  /**
   * Phase C (C2/C3) end-to-end multi-source review.
   *
   * Walks the existing two-pass prompt pipeline:
   *   1. Per source on the case (primary first, then attached) load the
   *      adapter material, classify the call topic when needed, ground
   *      against KB, and run a Pass-1 trace with `buildTracePrompt`
   *      (cheap model — Sonnet by default).
   *   2. Run a single Pass-2 synthesis with `buildSynthesisPrompt`
   *      (expensive model — Opus by default) over all per-source
   *      traces. The synthesis prompt is shaped exactly like the
   *      single-source prompt's output, so `mapClaudeOutputToAnswers`
   *      handles the result with no shape changes.
   *   3. Persist a SINGLE submission whose `case_id` is the case id
   *      and which carries `submission_ticket_tasks` rows for every
   *      TICKET/TASK source plus `submission_calls` rows for every
   *      CALL source. Inbox + readiness routing already groups by
   *      `case_id` (Phase C C4), so a multi-source submission appears
   *      as one row in the AI Inbox.
   *
   * The route layer is responsible for validating + capping the
   * `attached_sources` count (against `forms.ai_max_attached_sources`)
   * and constructing the Case via `loadCase`. Single-source callers
   * keep using `reviewClosedTicket / Task / Conversation`, which stay
   * on the leaner one-call `review()` path. We only pay for the
   * trace+synthesis split when a Case actually has attached sources.
   */
  async reviewCase(
    c: Case,
    opts: {
      formId: number;
      /**
       * Optional explicit provider override for THIS run. When omitted,
       * we resolve from the form's `ai_model_provider` column (defaults
       * to 'anthropic'). Set by the compare-models endpoint to force a
       * specific provider per side without touching the form column.
       * The trace pass always runs on Anthropic — only the synthesis
       * pipeline (reasoning + answer chunks + verification) switches.
       */
      provider?: ModelProvider;
    }
  ): Promise<AIReviewResult> {
    if (!aiReviewerConfig) {
      throw new AIReviewerServiceError('AI Reviewer is not configured (set AI_REVIEWER_USER_ID).', 'NOT_CONFIGURED', 503);
    }
    if (!isAnthropicConfigured()) {
      throw new AIReviewerServiceError('Anthropic is not configured (set ANTHROPIC_API_KEY).', 'NOT_CONFIGURED', 503);
    }
    // Resolve synthesis provider: explicit opts override > form column >
    // default 'anthropic'. We always need Anthropic configured (the
    // trace pass is Anthropic-only); when synthesis is OpenAI we also
    // need OpenAI configured.
    const formRowForProvider = await prisma.form.findUnique({
      where: { id: opts.formId },
      select: { ai_model_provider: true },
    });
    const synthesisProvider: ModelProvider =
      opts.provider ??
      (formRowForProvider?.ai_model_provider === 'openai' ? 'openai' : 'anthropic');
    if (synthesisProvider === 'openai' && !isOpenAIConfigured()) {
      throw new AIReviewerServiceError(
        'Form is configured for OpenAI synthesis but OPENAI_API_KEY is not set.',
        'NOT_CONFIGURED',
        503
      );
    }
    if (!bookstackService.isConfigured()) {
      throw new AIReviewerServiceError('BookStack is not configured.', 'NOT_CONFIGURED', 503);
    }

    const aiUserId = aiReviewerConfig.userId;
    const form = await loadFormForReview(opts.formId);
    const sources: CaseSourceRef[] = [c.primary, ...c.attached];

    // Cost guard: count every source on the case so multi-source runs
    // are priced at trace x N + synthesis x 1 (closes the C5/C6 TODO
    // documented in `review()`). The classifier mini-call adds when
    // ANY source on the case is a CALL.
    const budget = await checkBudget(opts.formId, {
      sourceCount: sources.length,
      willClassify: sources.some((s) => s.kind === 'CALL'),
      expectVerification: false,
    });
    if (!budget.allowed) {
      logger.warn(
        `[AI REVIEWER] form_id=${opts.formId} BUDGET_EXCEEDED (case=${c.id}) mtd=$${budget.mtdUsd.toFixed(2)} cap=$${(budget.budgetUsd ?? 0).toFixed(2)}`
      );
      throw new AIReviewerServiceError(budget.reason, 'BUDGET_EXCEEDED', 503);
    }
    if (budget.warn) {
      logger.warn(
        `[AI REVIEWER] form_id=${opts.formId} budget warn (>=80%) (case=${c.id}) mtd=$${budget.mtdUsd.toFixed(2)} cap=$${(budget.budgetUsd ?? 0).toFixed(2)}`
      );
    }

    // Per-source loop: load material + KB hits, run the trace pass, and
    // collect the Pass-2 inputs. The primary source also seeds the
    // submission's metadata (CSR, interaction date, link payload) so
    // multi-source submissions are filed under the primary's CSR — the
    // attached sources are evidence, not a second submission.
    const tracePayloads: Array<{
      kind: 'TICKET' | 'TASK' | 'CALL';
      id: string;
      traceJson: string;
      kbHits: KbHit[];
      link: SubmissionLinkPayload;
      // Forwarded into the synthesis prompt so Pass-2 / chunked Pass-2B can
      // grade ticket-header questions (Contact, Device Type, Assigned To, ...)
      // against the raw CRM values instead of relying on `traceJson` to have
      // preserved them. Same object the Pass-1 trace prompt already rendered.
      header: Record<string, string>;
    }> = [];

    // Tier-1 N-sample trace voting (Item 1): each per-source trace is
    // run K times in parallel on cheap Sonnet, majority-voted, and the
    // cross-run agreement composite is threaded into the synthesis
    // prompt as a hard ceiling on `overall_confidence`. Empty unless
    // K > 1; the synthesis builder skips the TRACE AGREEMENT block in
    // that case so the prompt stays back-compat with single-sample
    // runs (set AI_REVIEWER_TRACE_SAMPLES=1 to disable).
    const traceAgreements: TraceAgreement[] = [];

    // Per-run cost accumulator. Every pass that goes through
    // `withCallLog` (classifier + N x trace + synthesis + optional
    // verification) feeds its USD estimate into here via the
    // `onCost` sink on its CallLogMeta. The final `cost_estimate`
    // returned to the UI is the sum across passes, broken down per
    // pass in the post-run log line. Without this, the toast only
    // showed the synthesis call's cost and undercounted multi-source
    // runs by 30-50% (the trace x N + classifier + verification
    // calls were silently missing from the number — which is why a
    // CALL+TICKET case looked cheaper than an old single-pass ticket
    // review even though the actual spend was comparable).
    const costAccumulator: Array<{ pass: string; cost: CostEstimate }> = [];
    const accumulateCost = (passLabel: string) => (cost: CostEstimate | null) => {
      if (cost) costAccumulator.push({ pass: passLabel, cost });
    };
    let primaryMaterial: InteractionMaterial | null = null;
    // Keep every loaded material so submission-metadata resolution can
    // fall back to an attached source when the primary doesn't supply a
    // field (e.g. a CALL-primary case where the Genesys adapter has no
    // agentDisplayName but the attached TICKET does). Without this, the
    // CSR dropdown stays empty on the draft.
    const allMaterials: InteractionMaterial[] = [];

    // Phase A — load + validate every source up front. The per-source
    // adapter / ref / material triple is captured into `loaded[]` and
    // reused by Phase C below so we don't reload anything. Splitting
    // load from trace lets Phase B (the pivot detector) see EVERY
    // source's content before any KB lookups happen, which is what
    // makes compound-topic detection (e.g. "Install Refund" vs bare
    // "Refund") possible.
    const loaded: Array<{
      ref: CaseSourceRef;
      adapter: ReturnType<typeof pickAdapter>;
      material: InteractionMaterial;
    }> = [];
    // Call-window scoping: when primary is a CALL, derive an audit
    // cutoff (call_end + grace) AFTER the primary loads so we know the
    // call's end_et. Attached TICKET/TASK loaders then filter out notes
    // created after this cutoff — those notes are post-call commentary
    // by other agents (re-opens, supervisor edits, follow-up notes) and
    // must not flow into the synthesis prompt or the AI will produce
    // hindsight grades.
    let auditCutoffAt: Date | null = null;
    for (let i = 0; i < sources.length; i++) {
      const ref = sources[i];
      const isPrimary = i === 0;
      const adapter = pickAdapter(ref);
      const material = await loadAdapterMaterial(adapter, ref, auditCutoffAt);
      if (!adapter.isClosed(material)) {
        throw new AIReviewerServiceError(
          `${adapter.kind} ${formatRefId(ref)} is not closed (current status: ${material.statusText ?? 'unknown'})`,
          'INTERACTION_NOT_CLOSED',
          422
        );
      }
      allMaterials.push(material);
      if (isPrimary) {
        primaryMaterial = material;
        if (adapter.kind === 'CALL') {
          // Anchor on closedOn (call end_et). Fall back to interactionDate
          // (call start_et) if end_et is missing — better to over-include
          // by the grace window than to filter nothing.
          const anchor = material.closedOn ?? material.interactionDate;
          if (anchor) {
            auditCutoffAt = new Date(anchor.getTime() + resolvePostCallDocWindowMs());
            logger.info(
              `[AI REVIEWER CASE] call-window scoping enabled for case=${c.id}: ` +
                `anchor=${anchor.toISOString()} (${material.closedOn ? 'closedOn' : 'interactionDate'}), ` +
                `cutoff=${auditCutoffAt.toISOString()} (+${process.env.AI_REVIEWER_POST_CALL_DOC_WINDOW_MIN ?? DEFAULT_POST_CALL_DOC_WINDOW_MIN}min)`
            );
          }
        }
      }
      loaded.push({ ref, adapter, material });
    }

    if (!primaryMaterial) {
      throw new AIReviewerServiceError('Primary source material failed to load', 'INTERNAL', 500);
    }

    // Phase B — combined pivot detection + per-pivot KB pool. ONE
    // cheap Sonnet call looks at every source and returns the
    // distinct topical pivots the agent had to handle (primary topic
    // PLUS compound qualifiers). Each pivot drives an independent
    // `searchKb` lookup; the union (deduped by URL, capped) is the
    // shared KB pool that every per-source trace will see in Phase C.
    //
    // Fail-open: when the detector returns no pivots (Anthropic down,
    // bad JSON, empty case), `pivots` is `[]` and Phase C falls back
    // to the legacy per-source `classifyCallTopic`-driven KB lookup
    // — same behaviour the multi-source path had before this change.
    const pivots = await detectCasePivots(
      loaded.map((l) => ({
        kind: l.adapter.kind,
        id: formatRefId(l.ref),
        header: l.material.header,
        notesOrTranscript: l.material.notesOrTranscript.map((n) => ({ note: n.note ?? '' })),
      })),
      { caseId: c.id, formId: opts.formId, onCost: accumulateCost('pivot_detection') }
    );

    const packAnchorUrls = rulePackService.getAlwaysIncludeUrlsForForm(opts.formId);
    // Pivot KB pool + per-pivot coverage. Coverage is persisted into
    // ai_extras.pivots so the KB Coverage dashboard (Tier-2 Item 4)
    // can flag pivots that consistently return zero KB hits as
    // content gaps without re-running the whole pivot detector.
    const { pool: pivotKbPool, coverage: pivotCoverage } =
      pivots.length > 0
        ? await fetchPivotKbPool(pivots, packAnchorUrls)
        : { pool: [] as KbHit[], coverage: [] as PivotKbCoverage[] };

    // Phase C — per-source trace loop. Each source still gets its own
    // trace prompt (sourceKind / id / header / notes), but its KB
    // context now comes from one of two places:
    //   - When the pivot detector found pivots, every trace shares the
    //     pivot KB pool (already merged with the form's rule-pack
    //     anchors and universal URLs). Per-source classifier is SKIPPED.
    //   - When pivots is empty (detector returned nothing), we fall
    //     back to the legacy per-source classifier + searchKb path so
    //     the multi-source review never regresses below pre-pivot
    //     behaviour.
    for (const { ref, adapter, material } of loaded) {
      let kbHits: KbHit[];
      if (pivots.length > 0) {
        const sourceMandatory = mergeUniqueStrings(material.mandatoryKbUrls, packAnchorUrls);
        // Re-run searchKb with an empty query so we still pick up the
        // mandatory + universal URLs for this specific source (e.g. a
        // ticket's playbook links), then merge with the pivot pool.
        const sourceMandatoryHits = await searchKb('', sourceMandatory, UNIVERSAL_KB_URLS, adapter.kind);
        kbHits = mergeKbHitsByUrl(pivotKbPool, sourceMandatoryHits);
      } else {
        // Legacy path: per-source classifier seeds the KB query.
        if (adapter.kind === 'CALL' && !material.classificationText) {
          const classified = await classifyCallTopic(
            formatRefId(ref),
            material.notesOrTranscript[0]?.note ?? '',
            { onCost: accumulateCost('classification') }
          );
          if (classified) {
            material.classificationText = classified;
          }
        }
        const sourceMandatory = mergeUniqueStrings(material.mandatoryKbUrls, packAnchorUrls);
        kbHits = await searchKb(
          material.classificationText,
          sourceMandatory,
          UNIVERSAL_KB_URLS,
          adapter.kind
        );
      }

      const tracePrompt = buildTracePrompt({
        form,
        sourceKind: adapter.kind,
        sourceId: formatRefId(ref),
        header: material.header,
        notes: material.notesOrTranscript,
        kbHits,
      });

      const traceCtx: CallLogMeta = {
        provider: 'anthropic',
        purpose: `ai_reviewer.${adapter.kind.toLowerCase()}.trace`,
        pass: 'trace',
        ticketId: adapter.kind === 'TICKET' && typeof ref.external_id === 'number' ? ref.external_id : null,
        formId: opts.formId,
        caseId: c.id,
        onCost: accumulateCost(`trace:${adapter.kind.toLowerCase()}`),
      };

      // Tier-1 self-consistency K: fire K independent trace samples in
      // parallel, then majority-vote the structured fields. Each
      // sample uses the SAME prompt + KB context — variation comes
      // entirely from the model's stochasticity, which is exactly the
      // signal we want to measure ("what does the model agree with
      // itself about?"). K=1 short-circuits the parallel fan-out so
      // the legacy single-sample behaviour is reachable via env var
      // (AI_REVIEWER_TRACE_SAMPLES=1) for cost-sensitive runs.
      // Promise.all keeps wall time at one trace; cost is K * trace.
      const K_TRACE_SAMPLES = Math.max(1, Number(process.env.AI_REVIEWER_TRACE_SAMPLES ?? 3));
      let traceJson: string;
      if (K_TRACE_SAMPLES === 1) {
        traceJson = await runTracePass(tracePrompt, traceCtx);
      } else {
        const samples = await Promise.all(
          Array.from({ length: K_TRACE_SAMPLES }, () => runTracePass(tracePrompt, traceCtx))
        );
        const { mergedTraceJson, agreement } = voteOnTraces(samples);
        traceJson = mergedTraceJson;
        traceAgreements.push({
          ...agreement,
          sourceKind: adapter.kind,
          sourceId: formatRefId(ref),
        });
        logger.info(
          `[AI REVIEWER] trace voting (case=${c.id}, source=${adapter.kind}:${formatRefId(ref)}) ` +
            `k=${agreement.k} composite=${agreement.composite.toFixed(2)} ` +
            `playbook=${agreement.playbookAgreement.toFixed(2)} claims=${agreement.claimAgreement.toFixed(2)} ` +
            `observations=${agreement.observationAgreement.toFixed(2)} ` +
            `dropped=playbook:${agreement.droppedItems.playbook},obs:${agreement.droppedItems.observations},claims:${agreement.droppedItems.claims}`
        );
      }

      // Adapter-supplied link payload — the persistence layer merges
      // these so a ticket+call case writes both submission_ticket_tasks
      // and submission_calls rows on the same submission.
      const link = adapterLinkFor(ref, material);
      tracePayloads.push({
        kind: adapter.kind,
        id: formatRefId(ref),
        traceJson,
        kbHits,
        link,
        header: material.header,
      });
    }

    // Pass-2 synthesis: same answer/narrative shape as the single-pass
    // path, so callClaude + mapClaudeOutputToAnswers handles it as-is.
    const corrections = await loadCorrectionsForPrompt(opts.formId, primaryMaterial.classificationText);

    // Workstream B2: flat, deduped list of KB pages actually loaded
    // into Pass-1 (across all sources, all pivots). Surfaced to Pass-2
    // as a `KB PAGES LOADED FOR THIS CASE` block so the KB-NA rule in
    // the synthesis addendum can fire deterministically when this list
    // is empty. Without it, synthesis had no idea whether the absence
    // of `kb_citations` in the traces was "KB exists but trace forgot
    // it" vs "KB never existed for this topic" — and would silently
    // fall back to ticket notes as the de-facto playbook.
    const kbAnchorsSeen = new Set<string>();
    const kbAnchors: Array<{ url: string; name: string; is_playbook: boolean }> = [];
    for (const t of tracePayloads) {
      for (const h of t.kbHits) {
        if (!h.url || kbAnchorsSeen.has(h.url)) continue;
        kbAnchorsSeen.add(h.url);
        kbAnchors.push({
          url: h.url,
          name: h.name,
          is_playbook: Boolean(h.is_playbook),
        });
      }
    }

    const synthesisInput = {
      form,
      traces: tracePayloads.map((t) => ({
        sourceKind: t.kind,
        sourceId: t.id,
        traceJson: t.traceJson,
        header: t.header,
      })),
      corrections,
      pivots,
      traceAgreements,
      kbAnchors,
    };

    const ticketIdForLog =
      c.primary.kind === 'TICKET' && typeof c.primary.external_id === 'number' ? c.primary.external_id : null;

    // Built once and shared by both synthesis branches and the
    // downstream verification pass. The verifier overrides `purpose`
    // and `pass` on the spread; everything else (case_id, form_id,
    // ticket_id, accumulator) is consistent across both paths so the
    // verification call-log row joins correctly to the same case.
    const synthesisCtx: CallLogMeta = {
      provider: synthesisProvider,
      purpose: 'ai_reviewer.case.synthesis',
      pass: 'synthesis',
      ticketId: ticketIdForLog,
      formId: opts.formId,
      caseId: c.id,
      onCost: accumulateCost('synthesis'),
    };

    // Chunked synthesis path: large forms (>= AI_REVIEWER_CHUNKED_SYNTHESIS_THRESHOLD
    // gradeable questions) split synthesis into Pass 2A (Opus reasoning,
    // no answers) + parallel Pass 2B (Sonnet, one chunk per category)
    // to dodge the wall-clock cliff that hits monolithic Opus on
    // 50+ question forms (output saturates 16k tokens, takes 5-8 min,
    // and frequently truncates).
    const gradeableCount = form.questions.filter((q) => {
      const t = (q.question_type ?? '').toUpperCase();
      return t !== 'TEXT' && t !== 'INFO_BLOCK' && t !== 'SUB_CATEGORY';
    }).length;
    const chunkedThreshold = Math.max(
      1,
      Number(process.env.AI_REVIEWER_CHUNKED_SYNTHESIS_THRESHOLD) || 30
    );
    const useChunkedSynthesis = gradeableCount >= chunkedThreshold;

    // overallConfidence is `let` rather than `const` because the
    // verification pass (Tier-1 Item 2) applies an asymmetric delta to
    // it before persistence — the calibrated number we store has to
    // reflect the verifier's audit, not the raw synthesis self-report.
    const synthesisOutput: ClaudeOutput = useChunkedSynthesis
      ? await runChunkedSynthesis(synthesisInput, form, {
          formId: opts.formId,
          caseId: c.id,
          ticketId: ticketIdForLog,
          accumulateCost,
          provider: synthesisProvider,
        })
      : await callClaude(buildSynthesisPrompt(synthesisInput), form, synthesisCtx);

    if (useChunkedSynthesis) {
      logger.info(
        `[AI REVIEWER] chunked synthesis used (case=${c.id}, form=${opts.formId}, ` +
          `gradeable_questions=${gradeableCount}, threshold=${chunkedThreshold})`
      );
    }

    const {
      answers,
      narrative,
      kbCitations,
      overallConfidence: rawOverallConfidence,
      timeline,
      observations,
      playbookSteps,
      coaching,
      answerEvidence,
      selfConsistencyWarnings,
      // synthesis cost is captured via the per-pass `onCost` sinks
      // (reasoning + per-chunk for the chunked path, single 'synthesis'
      // sink for the monolithic path); the local `cost` here is
      // intentionally unused so the aggregated `aggregatedCostPayload`
      // below stays the single source of truth.
    } = synthesisOutput;
    let overallConfidence = rawOverallConfidence;

    // Verification pass (Tier-1 Item 2). Trigger band widened from
    // "<0.6" to "0.40 <= overall < 0.85" so genuinely-confident AND
    // genuinely-collapsed cases skip verification, but the wide
    // ambiguous middle band where the model "feels confident but
    // shouldn't" routes through the verifier. Self-consistency
    // warnings (including the new evidence-floor warnings) still
    // force-trigger verification regardless of band. The verifier
    // returns deltas the orchestrator applies before persistence —
    // unlike the legacy implementation, the confidence number we
    // store actually reflects the verifier's audit.
    const VERIFICATION_LO = 0.4;
    const VERIFICATION_HI = 0.85;
    const inAmbiguousBand =
      overallConfidence != null && overallConfidence >= VERIFICATION_LO && overallConfidence < VERIFICATION_HI;
    const needsVerification = inAmbiguousBand || selfConsistencyWarnings.length > 0;
    let verification: AiVerification | null = null;
    if (needsVerification) {
      const triggers: string[] = [];
      if (inAmbiguousBand) triggers.push('ambiguous_confidence');
      if (selfConsistencyWarnings.length > 0) triggers.push('self_consistency');
      try {
        const result = await runVerificationPass(
          { answers, timeline, playbookSteps, observations },
          { ...synthesisCtx, purpose: `${synthesisCtx.purpose}.verification`, pass: 'verification' },
          synthesisProvider
        );
        overallConfidence = applyVerificationDeltas(answers, overallConfidence, result, `case=${c.id}`);
        verification = {
          trigger: triggers.join(','),
          warnings: result.warnings,
          threshold: VERIFICATION_HI,
          overall_delta: result.overall_delta,
          per_answer_deltas: result.per_answer_deltas,
        };
        logger.info(
          `[AI REVIEWER] verification pass (case=${c.id}) triggers=[${triggers.join(',')}] ` +
            `warnings=${result.warnings.length} overall_delta=${result.overall_delta.toFixed(2)} ` +
            `per_answer_deltas=${Object.keys(result.per_answer_deltas).length}`
        );
      } catch (verifyErr) {
        logger.warn(`[AI REVIEWER] verification pass failed (case=${c.id}): ${(verifyErr as Error).message}`);
        verification = {
          trigger: triggers.join(','),
          warnings: [],
          threshold: VERIFICATION_HI,
          overall_delta: 0,
          per_answer_deltas: {},
        };
      }
    }

    // Compose answers (with the auto-managed feedback question), build
    // metadata against the primary, merge per-source link payloads, and
    // persist as ONE submission keyed by case_id.
    const feedbackQuestion = form.questions.find((q) => q.question_text.trim() === AI_REVIEWER_FEEDBACK_QUESTION_TEXT);
    if (!feedbackQuestion) {
      throw new AIReviewerServiceError(
        `Form ${form.id} is missing the auto-managed "AI Reviewer Feedback" question. Re-save the form in the form builder to repair it.`,
        'FORM_MISSING_AI_FEEDBACK_QUESTION',
        422
      );
    }
    const feedbackText = composeFeedback({ narrative, kbCitations });
    const finalAnswers: CreateSubmissionAnswerDTO[] = [
      ...answers,
      { question_id: feedbackQuestion.id, answer: feedbackText },
    ];

    // Resolve agentDisplayName / interactionDate with attached-source
    // fallback: prefer the primary's value, otherwise use the first
    // attached source that supplies one. This is what makes a CALL+TICKET
    // multi-source case populate the CSR dropdown on the draft — the
    // CALL adapter never knows the agent name, but the attached TICKET
    // does (assigned_to_name).
    const resolvedAgentDisplayName =
      primaryMaterial.agentDisplayName ??
      allMaterials.find((m) => m !== primaryMaterial && m.agentDisplayName)?.agentDisplayName ??
      null;
    const resolvedInteractionDate =
      primaryMaterial.interactionDate ??
      allMaterials.find((m) => m !== primaryMaterial && m.interactionDate)?.interactionDate ??
      null;

    const { csrId, metadata } = await buildSubmissionMetadata({
      formId: form.id,
      agentDisplayName: resolvedAgentDisplayName,
      interactionDate: resolvedInteractionDate,
    });

    // CALL-primary cases default the CSR to the AI Reviewer user when
    // the form metadata didn't resolve one (mirrors single-source).
    const hasCallSource = sources.some((s) => s.kind === 'CALL');
    const callCsrId = hasCallSource ? csrId ?? aiUserId : csrId;

    // Per-answer calibration (Tier-1 Item 3). Runs AFTER the verifier
    // has applied its deltas so the calibration sees the final
    // post-verification numbers. Gated by AI_REVIEWER_PER_QUESTION_CALIBRATION
    // inside applyAnswerCalibration — when off this is identity for
    // every answer.
    for (const a of answers) {
      a.ai_confidence = await applyAnswerCalibration(form.id, a.question_id, a.ai_confidence ?? null);
    }
    const calibratedConfidence = await applyCalibration(form.id, overallConfidence ?? null);

    const mergedLink = mergeSubmissionLinks(tracePayloads.map((t) => t.link));

    const payload = {
      form_id: form.id,
      submitted_by: aiUserId,
      csr_id: callCsrId,
      case_id: c.id,
      metadata,
      answers: finalAnswers,
      ai_overall_confidence: overallConfidence,
      ai_calibrated_confidence: calibratedConfidence,
      ai_extras: buildAiExtras({
        timeline,
        observations,
        playbookSteps,
        coaching,
        answerEvidence,
        selfConsistencyWarnings,
        verification,
        pivots: pivotCoverage,
      }),
      ...mergedLink,
    };

    const sourceLabels = sources.map((s) => formatCaseId(s)).join(', ');
    logger.info(
      `[AI REVIEWER] case=${c.id} sources=[${sourceLabels}] ` +
        `overall_confidence=${overallConfidence == null ? 'null' : overallConfidence.toFixed(2)} ` +
        `calibrated_confidence=${calibratedConfidence == null ? 'null' : calibratedConfidence.toFixed(2)} ` +
        `timeline_items=${timeline?.length ?? 0} observations=${observations?.length ?? 0}`
    );

    // Aggregate per-pass costs into a single payload for the UI toast.
    // Sums across classifier + N x trace + synthesis + optional
    // verification, since each pass's `withCallLog` invocation pushed
    // its own CostEstimate via the `onCost` sink wired into its meta.
    // `approximated` is true if ANY pass fell back to FALLBACK_PRICING
    // (e.g. an unknown model id), so the UI can flag the number.
    const totalUsd = costAccumulator.reduce((sum, entry) => sum + entry.cost.usd, 0);
    const anyApproximated = costAccumulator.some((entry) => entry.cost.approximated);
    const aggregatedCostPayload =
      costAccumulator.length > 0
        ? { usd: totalUsd, formatted: formatUsdCost(totalUsd), approximated: anyApproximated }
        : null;
    if (aggregatedCostPayload) {
      const breakdown = costAccumulator
        .map((e) => `${e.pass}=${e.cost.formatted}`)
        .join(' ');
      logger.info(
        `[AI REVIEWER] TEMP COST ESTIMATOR (case=${c.id}) total=${aggregatedCostPayload.formatted} ` +
          `passes=${costAccumulator.length} | ${breakdown}`
      );
    }

    if (form.ai_submit_as_draft) {
      const draftResult = await this.submissionService.saveDraft(payload, aiUserId);
      logger.info(
        `[AI REVIEWER] Saved DRAFT submission_id=${draftResult.submission_id} for case=${c.id} (awaiting human review).`
      );
      return {
        submission_id: draftResult.submission_id,
        total_score: 0,
        status: 'DRAFT',
        message: draftResult.message,
        ai_model: aiConfig.anthropic?.defaultModel ?? 'unknown',
        kb_pages_cited: kbCitations,
        cost_estimate: aggregatedCostPayload,
      };
    }

    const submitResult = await this.submissionService.submitAudit(payload, aiUserId);
    logger.info(
      `[AI REVIEWER] Submitted multi-source audit submission_id=${submitResult.submission_id} for case=${c.id} score=${submitResult.total_score}`
    );
    return {
      submission_id: submitResult.submission_id,
      total_score: submitResult.total_score,
      status: 'SUBMITTED',
      message: submitResult.message,
      ai_model: aiConfig.anthropic?.defaultModel ?? 'unknown',
      kb_pages_cited: kbCitations,
      cost_estimate: aggregatedCostPayload,
    };
  }

  /**
   * Run the analysis pipeline (load form, load material, KB grounding,
   * LLM call, parse, validate) WITHOUT writing a submission. Intended for
   * provider-comparison tooling and offline experimentation. Supports
   * `provider: 'anthropic' | 'openai'` so the same prompt can be evaluated
   * across models.
   */
  async analyzeTicket(
    ticketId: number,
    opts: { formId: number; provider?: AiProvider }
  ): Promise<AIAnalysisResult> {
    return this.analyze(TicketAdapter, ticketId, {
      formId: opts.formId,
      provider: opts.provider ?? 'anthropic',
    });
  }

  /**
   * Phase B (B5): call-side counterpart to {@link analyzeTicket}. Used by
   * the golden-eval runner to replay a CALL-kind golden submission
   * through the same pipeline. `conversationId` is the Genesys
   * conversation id (the string stored in `calls.call_id`), NOT the
   * internal `calls.id` integer — that lookup is the eval runner's
   * responsibility because the golden table indexes Submission ids only.
   */
  async analyzeConversation(
    conversationId: string,
    opts: { formId: number; provider?: AiProvider }
  ): Promise<AIAnalysisResult> {
    return this.analyze(ConversationAdapter, conversationId, {
      formId: opts.formId,
      provider: opts.provider ?? 'anthropic',
    });
  }

  private async analyze<TId>(
    adapter: InteractionAdapter<TId>,
    sourceId: TId,
    opts: { formId: number; provider: AiProvider }
  ): Promise<AIAnalysisResult> {
    if (opts.provider === 'anthropic' && !isAnthropicConfigured()) {
      throw new AIReviewerServiceError('Anthropic is not configured (set ANTHROPIC_API_KEY).', 'NOT_CONFIGURED', 503);
    }
    if (opts.provider === 'openai' && !isOpenAIConfigured()) {
      throw new AIReviewerServiceError('OpenAI is not configured (set OPENAI_API_KEY).', 'NOT_CONFIGURED', 503);
    }
    if (!bookstackService.isConfigured()) {
      throw new AIReviewerServiceError('BookStack is not configured.', 'NOT_CONFIGURED', 503);
    }

    const form = await loadFormForReview(opts.formId);
    const material = await adapter.loadMaterial(sourceId);
    if (!adapter.isClosed(material)) {
      throw new AIReviewerServiceError(
        `${adapter.kind} ${adapter.formatId(sourceId)} is not closed (current status: ${material.statusText ?? 'unknown'})`,
        'INTERACTION_NOT_CLOSED',
        422
      );
    }

    const packAnchorUrls = rulePackService.getAlwaysIncludeUrlsForForm(opts.formId);
    const mandatoryUrls = mergeUniqueStrings(material.mandatoryKbUrls, packAnchorUrls);
    const kbHits = await searchKb(
      material.classificationText,
      mandatoryUrls,
      UNIVERSAL_KB_URLS,
      adapter.kind
    );
    const corrections = await loadCorrectionsForPrompt(opts.formId, material.classificationText);
    const promptParts = buildAiReviewerPrompt({
      form,
      adapterKind: adapter.kind,
      header: material.header,
      notes: material.notesOrTranscript,
      kbHits,
      corrections,
    });

    const started = Date.now();
    const traceCtx: CallLogMeta = {
      provider: opts.provider,
      purpose: `ai_reviewer.${adapter.kind.toLowerCase()}.analyze`,
      pass: 'single_pass',
      ticketId: adapter.kind === 'TICKET' && typeof sourceId === 'number' ? sourceId : null,
      formId: opts.formId,
    };
    const { answers, narrative, kbCitations, overallConfidence, timeline, observations, model, retried } =
      await callLlm(opts.provider, promptParts, form, traceCtx);
    const elapsedMs = Date.now() - started;

    const questionsById = new Map(form.questions.map((q) => [q.id, q]));
    const enrichedAnswers = answers.map((a) => {
      const q = questionsById.get(a.question_id);
      return {
        question_id: a.question_id,
        category_name: q?.category_name ?? '(unknown)',
        question_text: q?.question_text ?? '(unknown)',
        question_type: q?.question_type ?? '(unknown)',
        value: a.answer,
        confidence: a.ai_confidence ?? null,
      };
    });

    return {
      provider: opts.provider,
      model,
      elapsedMs,
      retried,
      header: material.header,
      notesCount: material.notesOrTranscript.length,
      kbPagesProvided: kbHits.map((h) => ({
        id: h.id,
        name: h.name,
        url: h.url,
        is_playbook: h.is_playbook,
        linked_from: h.linked_from ?? null,
      })),
      answers: enrichedAnswers,
      narrative,
      kbCitations,
      overallConfidence,
      timeline,
      observations,
    };
  }

  /**
   * Generic review path shared by every InteractionAdapter. Public methods
   * (reviewClosedTicket / reviewClosedTask / reviewClosedConversation)
   * just pick the adapter and forward through here.
   */
  private async review<TId>(
    adapter: InteractionAdapter<TId>,
    sourceId: TId,
    opts: { formId: number }
  ): Promise<AIReviewResult> {
    if (!aiReviewerConfig) {
      throw new AIReviewerServiceError('AI Reviewer is not configured (set AI_REVIEWER_USER_ID).', 'NOT_CONFIGURED', 503);
    }
    if (!isAnthropicConfigured()) {
      throw new AIReviewerServiceError('Anthropic is not configured (set ANTHROPIC_API_KEY).', 'NOT_CONFIGURED', 503);
    }
    if (!bookstackService.isConfigured()) {
      throw new AIReviewerServiceError('BookStack is not configured.', 'NOT_CONFIGURED', 503);
    }

    const aiUserId = aiReviewerConfig.userId;
    const form = await loadFormForReview(opts.formId);

    // Phase 7b: per-form monthly cost budget. Budget hit -> short-circuit
    // before we burn another LLM call. We surface this as a 503 with code
    // BUDGET_EXCEEDED so the route handler can route the submission to a
    // human reviewer with an explanation rather than silently failing or
    // producing a degraded AI grade.
    // Phase C (C5): tell the cost guard how this run will be priced so
    // it can deny multi-source cases that would push us over the cap
    // *before* we make the LLM calls. Single-source single-pass runs
    // pre-date C5 and the shape is `sourceCount=1`,
    // `expectVerification=false`, `willClassify` only when CALL needs
    // its topic classifier. Multi-source two-pass runs (C3) will pass
    // their actual `attachedSources.length + 1` here once the pipeline
    // is wired through; that's the C6 task.
    const budget = await checkBudget(opts.formId, {
      sourceCount: 1,
      willClassify: adapter.kind === 'CALL',
      expectVerification: false,
    });
    if (!budget.allowed) {
      logger.warn(
        `[AI REVIEWER] form_id=${opts.formId} BUDGET_EXCEEDED mtd=$${budget.mtdUsd.toFixed(2)} cap=$${(budget.budgetUsd ?? 0).toFixed(2)}`
      );
      throw new AIReviewerServiceError(budget.reason, 'BUDGET_EXCEEDED', 503);
    }
    if (budget.warn) {
      logger.warn(
        `[AI REVIEWER] form_id=${opts.formId} budget warn (>=80%) mtd=$${budget.mtdUsd.toFixed(2)} cap=$${(budget.budgetUsd ?? 0).toFixed(2)}`
      );
    }

    const material = await adapter.loadMaterial(sourceId);
    if (!adapter.isClosed(material)) {
      throw new AIReviewerServiceError(
        `${adapter.kind} ${adapter.formatId(sourceId)} is not closed (current status: ${material.statusText ?? 'unknown'})`,
        'INTERACTION_NOT_CLOSED',
        422
      );
    }

    const packAnchorUrls = rulePackService.getAlwaysIncludeUrlsForForm(opts.formId);
    const mandatoryUrls = mergeUniqueStrings(material.mandatoryKbUrls, packAnchorUrls);

    // Phase B: when a call has no classification (the source system
    // doesn't capture a wrap-up code today), run a tiny topic-classifier
    // call so searchKb actually has a query to work with. Without this,
    // CALL reviews skip both BookStack full-text search and semantic
    // search and grade with zero KB grounding.
    if (adapter.kind === 'CALL' && !material.classificationText) {
      const classified = await classifyCallTopic(
        adapter.formatId(sourceId),
        material.notesOrTranscript[0]?.note ?? ''
      );
      if (classified) {
        material.classificationText = classified;
      }
    }

    const kbHits = await searchKb(
      material.classificationText,
      mandatoryUrls,
      UNIVERSAL_KB_URLS,
      adapter.kind
    );
    const corrections = await loadCorrectionsForPrompt(opts.formId, material.classificationText);

    const promptParts = buildAiReviewerPrompt({
      form,
      adapterKind: adapter.kind,
      header: material.header,
      notes: material.notesOrTranscript,
      kbHits,
      corrections,
    });

    const traceCtx: CallLogMeta = {
      provider: 'anthropic',
      purpose: `ai_reviewer.${adapter.kind.toLowerCase()}.review`,
      pass: 'single_pass',
      ticketId: adapter.kind === 'TICKET' && typeof sourceId === 'number' ? sourceId : null,
      formId: opts.formId,
    };
    const {
      answers,
      narrative,
      kbCitations,
      overallConfidence: rawOverallConfidence,
      timeline,
      observations,
      playbookSteps,
      coaching,
      answerEvidence,
      selfConsistencyWarnings,
      cost,
    } = await callClaude(promptParts, form, traceCtx);
    let overallConfidence = rawOverallConfidence;
    const costPayload = cost
      ? { usd: cost.usd, formatted: cost.formatted, approximated: cost.approximated }
      : null;

    // Verification pass (Tier-1 Item 2). Trigger band widened from
    // "<0.6" to "0.40 <= overall < 0.85" so the wide ambiguous middle
    // routes through the verifier. The verifier returns deltas the
    // orchestrator applies before persistence.
    const VERIFICATION_LO = 0.4;
    const VERIFICATION_HI = 0.85;
    const inAmbiguousBand =
      overallConfidence != null && overallConfidence >= VERIFICATION_LO && overallConfidence < VERIFICATION_HI;
    const needsVerification = inAmbiguousBand || selfConsistencyWarnings.length > 0;
    let verification: AiVerification | null = null;
    if (needsVerification) {
      const triggers: string[] = [];
      if (inAmbiguousBand) triggers.push('ambiguous_confidence');
      if (selfConsistencyWarnings.length > 0) triggers.push('self_consistency');
      try {
        const result = await runVerificationPass(
          { answers, timeline, playbookSteps, observations },
          { ...traceCtx, purpose: `${traceCtx.purpose}.verification`, pass: 'verification' }
        );
        overallConfidence = applyVerificationDeltas(answers, overallConfidence, result, `single`);
        verification = {
          trigger: triggers.join(','),
          warnings: result.warnings,
          threshold: VERIFICATION_HI,
          overall_delta: result.overall_delta,
          per_answer_deltas: result.per_answer_deltas,
        };
        logger.info(
          `[AI REVIEWER] verification pass triggers=[${triggers.join(',')}] ` +
            `warnings=${result.warnings.length} overall_delta=${result.overall_delta.toFixed(2)} ` +
            `per_answer_deltas=${Object.keys(result.per_answer_deltas).length}`
        );
      } catch (verifyErr) {
        logger.warn(
          `[AI REVIEWER] verification pass failed: ${(verifyErr as Error).message}`
        );
        verification = {
          trigger: triggers.join(','),
          warnings: [],
          threshold: VERIFICATION_HI,
          overall_delta: 0,
          per_answer_deltas: {},
        };
      }
    }

    // Compose narrative + KB citations into the auto-managed AI Reviewer
    // Feedback question's free-text answer.
    const feedbackQuestion = form.questions.find((q) => q.question_text.trim() === AI_REVIEWER_FEEDBACK_QUESTION_TEXT);
    if (!feedbackQuestion) {
      throw new AIReviewerServiceError(
        `Form ${form.id} is missing the auto-managed "AI Reviewer Feedback" question. Re-save the form in the form builder to repair it.`,
        'FORM_MISSING_AI_FEEDBACK_QUESTION',
        422
      );
    }

    const feedbackText = composeFeedback({ narrative, kbCitations });
    // Feedback question is human-text — no confidence score makes sense for it.
    const finalAnswers: CreateSubmissionAnswerDTO[] = [
      ...answers,
      { question_id: feedbackQuestion.id, answer: feedbackText },
    ];

    const { csrId, metadata } = await buildSubmissionMetadata({
      formId: form.id,
      agentDisplayName: material.agentDisplayName,
      interactionDate: material.interactionDate,
    });

    const link = adapter.toSubmissionLink(sourceId, material);
    // Calls need a CSR on the materialized Call row; default to the AI
    // Reviewer user when the form metadata didn't resolve one.
    const callCsrId = adapter.kind === 'CALL' ? csrId ?? aiUserId : csrId;

    // Per-answer calibration (Tier-1 Item 3). Same gate as the
    // multi-source path: identity unless AI_REVIEWER_PER_QUESTION_CALIBRATION=1
    // AND the form's active map carries a `by_question[<qid>]` entry.
    for (const a of answers) {
      a.ai_confidence = await applyAnswerCalibration(form.id, a.question_id, a.ai_confidence ?? null);
    }
    // Apply per-form confidence calibration. Identity (calibrated === nominal)
    // until the form has an active ai_calibration_map row. Inbox routing
    // queries `ai_calibrated_confidence` so once the calibrator is fit the
    // routing decision automatically uses the empirically-corrected value.
    const calibratedConfidence = await applyCalibration(form.id, overallConfidence ?? null);

    const payload = {
      form_id: form.id,
      submitted_by: aiUserId,
      csr_id: callCsrId,
      metadata,
      answers: finalAnswers,
      ai_overall_confidence: overallConfidence,
      ai_calibrated_confidence: calibratedConfidence,
      ai_extras: buildAiExtras({
        timeline,
        observations,
        playbookSteps,
        coaching,
        answerEvidence,
        selfConsistencyWarnings,
        verification,
      }),
      ...link,
    };

    logger.info(
      `[AI REVIEWER] form_id=${form.id} ${adapter.kind.toLowerCase()}_id=${adapter.formatId(sourceId)} ` +
        `overall_confidence=${overallConfidence == null ? 'null' : overallConfidence.toFixed(2)} ` +
        `calibrated_confidence=${calibratedConfidence == null ? 'null' : calibratedConfidence.toFixed(2)} ` +
        `timeline_items=${timeline?.length ?? 0} observations=${observations?.length ?? 0}`
    );

    // Phase 5 branch: when the form opts in to ai_submit_as_draft, route
    // through saveDraft so the AI's grade lands as DRAFT (no scoring) and
    // a human reviews + promotes it. Default path stays unchanged.
    if (form.ai_submit_as_draft) {
      const draftResult = await this.submissionService.saveDraft(payload, aiUserId);
      logger.info(
        `[AI REVIEWER] Saved DRAFT submission_id=${draftResult.submission_id} ` +
          `for form_id=${form.id} ${adapter.kind.toLowerCase()}_id=${adapter.formatId(sourceId)} ` +
          `(awaiting human review).`
      );

      // Route-to-QA notification (always fires for AI drafts) + low-confidence
      // notification (only when below threshold). Both go to QAs, never CSR.
      try {
        const csrId = (payload as any).csr_id ?? (payload as any).agent_user_id ?? null;
        const csr = csrId
          ? await prisma.user.findUnique({ where: { id: Number(csrId) }, select: { id: true, username: true } })
          : null;
        const threshold = (form as any).ai_sample_low_confidence_threshold;
        const isLowConfidence =
          overallConfidence != null && threshold != null && Number(overallConfidence) < Number(threshold);
        const { default: notificationService } = await import('./notifications/NotificationService');
        const ctx = {
          entityType: 'submission' as const,
          entityId: draftResult.submission_id,
          deepLinkPath: `/app/quality/ai-inbox`,
        };
        const basePayload = {
          form: { id: form.id, form_name: form.form_name, ai_sample_low_confidence_threshold: threshold },
          submission: {
            id: draftResult.submission_id,
            ai_overall_confidence: overallConfidence,
            total_score: 0,
          },
          csr,
          csrId: csr?.id ?? null,
          routingReason: isLowConfidence ? 'low_confidence' : 'ai_draft_review',
        };
        await notificationService.notify('ai.review_routed_to_qa', basePayload, ctx);
        if (isLowConfidence) {
          await notificationService.notify('ai.review_low_confidence', basePayload, ctx);
        }
      } catch (mailErr) {
        logger.warn('[AI REVIEWER] notify failed (draft still saved)', mailErr);
      }

      return {
        submission_id: draftResult.submission_id,
        total_score: 0,
        status: 'DRAFT',
        message: draftResult.message,
        ai_model: aiConfig.anthropic?.defaultModel ?? 'unknown',
        kb_pages_cited: kbCitations,
        cost_estimate: costPayload,
      };
    }

    const submitResult = await this.submissionService.submitAudit(payload, aiUserId);

    logger.info(
      `[AI REVIEWER] Submitted audit submission_id=${submitResult.submission_id} ` +
        `for form_id=${form.id} ${adapter.kind.toLowerCase()}_id=${adapter.formatId(sourceId)} ` +
        `score=${submitResult.total_score}`
    );

    return {
      submission_id: submitResult.submission_id,
      total_score: submitResult.total_score,
      status: 'SUBMITTED',
      message: submitResult.message,
      ai_model: aiConfig.anthropic?.defaultModel ?? 'unknown',
      kb_pages_cited: kbCitations,
      cost_estimate: costPayload,
    };
  }
}

/**
 * Pulls recent human corrections for this form so the prompt builder
 * can inject them as few-shot lessons (closes the calibration feedback
 * loop). Logged at info level on every run so operators can see the
 * loop firing in stdout. Returns [] on any failure — the AI run must
 * never fail because the calibration loop is unavailable.
 */
async function loadCorrectionsForPrompt(
  formId: number,
  classificationText?: string
): Promise<CalibrationCorrection[]> {
  try {
    const corrections = await aiCalibrationService.getRecentCorrections(formId, {
      classificationText,
    });
    if (corrections.length > 0) {
      const totalChars = corrections.reduce(
        (sum, c) =>
          sum +
          c.question_text.length +
          c.ai_value.length +
          c.human_value.length +
          80, // header / label fixed overhead per row
        0
      );
      logger.info(
        `[AI REVIEWER] injected ${corrections.length} learned corrections (~${totalChars} chars) for form_id=${formId}`
      );
    } else {
      logger.info(`[AI REVIEWER] no learned corrections to inject for form_id=${formId}`);
    }
    return corrections;
  } catch (err) {
    logger.warn(
      `[AI REVIEWER] failed to load calibration corrections for form_id=${formId} (continuing without): ${(err as Error).message}`
    );
    return [];
  }
}

/**
 * Loads form definition + validates AI eligibility. Throws on any failure.
 *
 * NOTE: We intentionally do NOT consult `form.interaction_type` here.
 * Per product direction it is informational metadata on the form (so the
 * form list in the builder can group "ticket forms" vs "call forms" for
 * humans) and does NOT gate AI behavior. The actual review path is
 * dictated by the source attached to the run — ticket → ticket review,
 * task → task review, conversation → call review. A QA admin can grade
 * a call against a "ticket" form during calibration without flipping any
 * setting first.
 */
async function loadFormForReview(formId: number): Promise<FormForPrompt & { ai_submit_as_draft: boolean }> {
  const form = await prisma.form.findUnique({
    where: { id: formId },
    include: {
      form_categories: {
        include: { form_questions: { include: { radio_options: true } } },
        orderBy: { sort_order: 'asc' },
      },
    },
  });
  if (!form) throw new AIReviewerServiceError(`Form ${formId} not found`, 'FORM_NOT_FOUND', 404);
  if (!(form as any).ai_enabled) {
    throw new AIReviewerServiceError(
      `Form ${formId} does not have ai_enabled = true. Enable it in the form builder.`,
      'FORM_NOT_AI_ELIGIBLE',
      403
    );
  }

  const formInteractionType = form.interaction_type as string;

  const questions = form.form_categories.flatMap((c) =>
    c.form_questions.map((q) => ({
      id: q.id,
      category_name: c.category_name,
      question_text: q.question_text,
      question_type: q.question_type as string,
      yes_value: q.yes_value,
      no_value: q.no_value,
      na_value: q.na_value,
      is_na_allowed: q.is_na_allowed,
      radio_options: q.radio_options.map((r) => ({ value: r.option_value, text: r.option_text, score: r.score })),
    }))
  );

  return {
    id: form.id,
    form_name: form.form_name,
    interaction_type: formInteractionType,
    ai_review_guidance: ((form as any).ai_review_guidance ?? null) as string | null,
    ai_submit_as_draft: (form as any).ai_submit_as_draft === true,
    categories: form.form_categories.map((c) => ({ id: c.id, category_name: c.category_name })),
    questions,
  };
}

/**
 * Resolves the form's metadata fields for an AI submission:
 *   • Reviewer Name (AUTO)    → "AI Reviewer"
 *   • Review Date  (AUTO)     → today (yyyy-mm-dd)
 *   • CSR          (DROPDOWN) → qtip user.id matched by username == CRM agent display name
 *   • Interaction Date (DATE) → ticket created_on (yyyy-mm-dd)
 * Any other custom metadata fields are left blank — the human can fill them
 * later if needed.
 */
async function buildSubmissionMetadata(args: {
  formId: number;
  agentDisplayName: string | null;
  interactionDate: Date | null;
}): Promise<{ csrId: number | null; metadata: SubmissionMetadataDTO[] }> {
  const fields = await prisma.formMetadataField.findMany({
    where: { form_id: args.formId },
    orderBy: { sort_order: 'asc' },
  });
  if (fields.length === 0) return { csrId: null, metadata: [] };

  const todayIso = new Date().toISOString().slice(0, 10);
  const interactionIso = args.interactionDate ? args.interactionDate.toISOString().slice(0, 10) : '';

  let csrId: number | null = null;
  if (args.agentDisplayName) {
    const matched = await prisma.user.findFirst({
      where: { username: args.agentDisplayName, is_active: true },
      select: { id: true },
    });
    if (matched) {
      csrId = matched.id;
    } else {
      logger.warn(`[AI REVIEWER] Could not match CRM agent "${args.agentDisplayName}" to a qtip user; CSR field will be empty.`);
    }
  }

  const metadata: SubmissionMetadataDTO[] = [];
  for (const f of fields) {
    const name = (f.field_name || '').trim().toLowerCase();
    let value = '';
    if (f.field_type === 'AUTO') {
      if (name.includes('reviewer name') || name.includes('auditor name')) value = 'AI Reviewer';
      else if (name.includes('review date') || name.includes('audit date')) value = todayIso;
    } else if (f.field_type === 'DROPDOWN' && !f.dropdown_source) {
      // user-list dropdown (typically the CSR field)
      if (csrId != null) value = String(csrId);
    } else if (f.field_type === 'DATE') {
      // Substring match so labels like "Agent Interaction Date",
      // "Ticket Date (closed)", or "Task Date" all resolve to the
      // CRM interaction timestamp.
      if (name.includes('interaction date') || name.includes('ticket date') || name.includes('task date')) {
        value = interactionIso;
      }
    }
    if (value) metadata.push({ field_id: f.id, value });
  }
  return { csrId, metadata };
}

/**
 * BookStack KB grounding for the prompt. Three layers, in order:
 *   1. Mandatory pages — the active playbook URLs assigned to the
 *      ticket's classification (tblPlayBookLink.LinkURL). Highest
 *      authority; they're the exact documented process for this ticket.
 *   2. Search hits — top page results from BookStack full-text search
 *      against the ticket's classification text, deduped against layer 1.
 *   3. Semantic hits — top-k pages from the cached KbIndexService
 *      embeddings (Phase 4). Picks up cross-cutting process pages
 *      (e.g. "Ticket Handling Process") that don't share keywords with
 *      the classification text. Runs only if budget remains.
 *
 * Total content is capped (see `charBudget` below) so the prompt stays
 * within the model's comfortable context budget. Each result carries an
 * `is_playbook` flag so the prompt builder can label it appropriately.
 */
/**
 * KB pages that apply to EVERY review, regardless of form / classification.
 * Always pulled into the prompt as `KB PAGE` (not `ASSIGNED PLAYBOOK PAGE`)
 * so the model treats them as standing policy refs, not as the per-ticket
 * playbook. Reviewer ask 2026-05: "Documentation Policy" and
 * "Ticket Handling - Do's and Don'ts" should be visible to the AI on every
 * audit so it can grade documentation quality and ticket-handling best
 * practices consistently across departments.
 *
 * NB: "Ticket Handling Process" is intentionally NOT in this list — it's
 * the per-classification process page and gets injected by the
 * `tech-ticket-process` rule pack via `always_include_urls`, where it
 * correctly lands as a tech-only authority.
 *
 * Phase B (B3): "Call Handling - Do's and Don'ts" is added here so every
 * review (ticket-only, call-only, or combined) can grade against the same
 * baseline call etiquette / process bar. It mirrors the AWS Bedrock
 * customer-service-transcript-analysis 12-category rubric and is intended
 * as the call-side counterpart to "Ticket Handling - Do's and Don'ts".
 */
const UNIVERSAL_KB_URLS = [
  'http://know.crm.dm-us.com/books/general-support-instructions/page/documentation-policy',
  'http://know.crm.dm-us.com/books/job-billing-customer-service/page/ticket-handling-dos-and-donts',
  'http://know.crm.dm-us.com/books/general-support-instructions/page/call-handling-dos-and-donts',
];

/**
 * Phase B topic classifier — runs ONE small Claude call on the first
 * ~60 seconds of a call transcript and returns a short "<class> /
 * <subclass>" string that searchKb() can use as its query. Without
 * this, CALL reviews ship with `classificationText = ''`, which
 * silently disables both the BookStack full-text search AND the
 * semantic-search layers — meaning the AI grades the call with zero KB
 * grounding.
 *
 * Implementation notes:
 *   - Uses the configured "cheap" model (env `ANTHROPIC_CHEAP_MODEL`,
 *     default `claude-sonnet-4-5`). Falls back to the default model when
 *     the cheap one is not set, which preserves correctness if an
 *     operator hasn't configured the env yet.
 *   - Cached per-conversation in-process so repeat reviews of the same
 *     call don't pay for the classifier twice.
 *   - Failures are NEVER fatal — we just return '' and let searchKb
 *     fall back to its existing behaviour. Wrapped in `withCallLog`
 *     with `purpose: 'ai_reviewer.call.classification'` so the cost
 *     and latency show up in `ai_call_logs` for observability.
 */
const TRANSCRIPT_HEAD_CHARS = 4000; // ~ first 60s of dialog at avg pace
const callTopicCache = new Map<string, string>();

async function classifyCallTopic(
  conversationId: string,
  transcriptText: string,
  opts?: { onCost?: (cost: CostEstimate | null) => void }
): Promise<string> {
  const cacheKey = String(conversationId);
  const cached = callTopicCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const head = (transcriptText ?? '').trim().slice(0, TRANSCRIPT_HEAD_CHARS);
  if (!head) {
    callTopicCache.set(cacheKey, '');
    return '';
  }

  let bookList = '';
  try {
    const books = await bookstackService.listBooks();
    bookList = books
      .map((b) => `- ${b.name}${b.description ? `: ${b.description}` : ''}`)
      .join('\n');
  } catch (err) {
    logger.warn(
      `[AI REVIEWER] classifier could not list KB books (${(err as Error).message}); using transcript-only fallback`
    );
  }

  if (!isAnthropicConfigured()) {
    callTopicCache.set(cacheKey, '');
    return '';
  }

  const sysPrompt =
    'You classify call-center transcripts to one of the documented support topics. ' +
    'Read the opening of the transcript and pick the BEST matching topic from the list. ' +
    'Respond with ONLY a single JSON object: {"class": "<topic name verbatim from the list, or short phrase if none fits>", "subclass": "<short phrase or empty string>"}. ' +
    'Do NOT explain. Do NOT include any other fields.';
  const userPrompt =
    `KB TOPICS:\n${bookList || '(no topic list available)'}\n\n` +
    `TRANSCRIPT (first ${TRANSCRIPT_HEAD_CHARS} chars):\n${head}\n\n` +
    'JSON:';

  const cheapModel =
    process.env.ANTHROPIC_CHEAP_MODEL || aiConfig.anthropic?.defaultModel || 'claude-opus-4-7';

  try {
    const out = await withCallLog<string>(
      {
        provider: 'anthropic',
        purpose: 'ai_reviewer.call.classification',
        pass: 'classification',
        onCost: opts?.onCost,
      },
      { system: sysPrompt, user: userPrompt },
      async () => {
        const client = getAnthropicClient();
        const res = await client.messages.create({
          model: cheapModel,
          max_tokens: 200,
          system: sysPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        });
        const usage = (res as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
        const tokensIn = usage?.input_tokens ?? null;
        const tokensOut = usage?.output_tokens ?? null;
        const block = res.content.find((b) => b.type === 'text') as { text: string } | undefined;
        const raw = (block?.text ?? '').trim();
        const parsed = tryParseJson(raw);
        const cls = String(parsed?.class ?? '').trim();
        const sub = String(parsed?.subclass ?? '').trim();
        const composed = sub ? `${cls} / ${sub}` : cls;
        return {
          result: composed,
          model: cheapModel,
          rawResponse: raw,
          retried: false,
          tokensIn,
          tokensOut,
        };
      }
    );
    callTopicCache.set(cacheKey, out);
    if (out) {
      logger.info(
        `[AI REVIEWER] call classifier conversation_id=${conversationId} → "${out}"`
      );
    }
    return out;
  } catch (err) {
    logger.warn(
      `[AI REVIEWER] call classifier failed for conversation_id=${conversationId}: ${(err as Error).message}`
    );
    callTopicCache.set(cacheKey, '');
    return '';
  }
}

/** @internal Test-only: clear the per-conversation classifier cache. */
export function _clearCallTopicCache(): void {
  callTopicCache.clear();
}

/**
 * Default cap on the size of the merged pivot KB pool. With up to 5 pivots
 * each contributing ~5 hits, an unbounded pool could grow to ~25 pages
 * — enough to bloat every per-source trace prompt with the same content.
 * The cap is overridable at runtime via `AI_REVIEWER_PIVOT_KB_POOL_CAP`
 * so cost-tuning can be done without a code change; lowering it shrinks
 * each trace's input proportionally (each KB page is ~3-8k tokens).
 */
const PIVOT_KB_POOL_CAP_DEFAULT = 12;

/**
 * Build the shared pivot KB pool consumed by every per-source trace
 * in `reviewCase`. Runs `searchKb` once per pivot (in parallel),
 * dedupes by URL across results, and trims to the runtime pool cap. The
 * rule-pack anchor URLs are passed as `mandatoryUrls` to every search
 * so the form's always-include pages can never be evicted by the cap.
 *
 * Per-pivot search failures are logged and swallowed so one bad
 * query (e.g. semantic-index hiccup) doesn't poison the whole pool —
 * the pool degrades gracefully to whatever the surviving searches
 * returned.
 */
/**
 * Tier-2 Item 4 (KB Coverage dashboard): per-pivot KB hit count.
 * Surfaces pivots that consistently return zero KB hits as content
 * gaps — the dashboard flags them so Knowledge can author missing
 * pages.
 */
export interface PivotKbCoverage {
  label: string;
  query: string;
  rationale?: string;
  /** Number of KB pages the pivot's individual search returned. */
  kb_hit_count: number;
}

async function fetchPivotKbPool(
  pivots: CasePivot[],
  packAnchorUrls: string[]
): Promise<{ pool: KbHit[]; coverage: PivotKbCoverage[] }> {
  if (pivots.length === 0) return { pool: [], coverage: [] };
  const PIVOT_KB_POOL_CAP = Math.max(
    1,
    Number(process.env.AI_REVIEWER_PIVOT_KB_POOL_CAP ?? PIVOT_KB_POOL_CAP_DEFAULT)
  );
  const settled = await Promise.allSettled(
    pivots.map((p) => searchKb(p.query, packAnchorUrls, UNIVERSAL_KB_URLS, null))
  );
  const merged: KbHit[] = [];
  const seen = new Set<string>();
  const coverage: PivotKbCoverage[] = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    const pivot = pivots[i];
    if (r.status !== 'fulfilled') {
      logger.warn(
        `[AI REVIEWER] pivot KB search failed for pivot="${pivot.label}" query="${pivot.query}": ${(r.reason as Error)?.message ?? r.reason}`
      );
      coverage.push({ label: pivot.label, query: pivot.query, rationale: pivot.rationale, kb_hit_count: 0 });
      continue;
    }
    coverage.push({
      label: pivot.label,
      query: pivot.query,
      rationale: pivot.rationale,
      kb_hit_count: r.value.length,
    });
    for (const hit of r.value) {
      if (seen.has(hit.url)) continue;
      seen.add(hit.url);
      merged.push(hit);
      if (merged.length >= PIVOT_KB_POOL_CAP) break;
    }
    if (merged.length >= PIVOT_KB_POOL_CAP) break;
  }
  logger.info(
    `[AI REVIEWER] pivot KB pool: pivots=${pivots.length} pages=${merged.length} (cap=${PIVOT_KB_POOL_CAP}) ` +
      `per-pivot=[${coverage.map((c) => `${c.label}:${c.kb_hit_count}`).join(', ')}]`
  );
  return { pool: merged, coverage };
}

/**
 * Merge two KbHit lists, deduping by URL while preserving the order
 * (first-seen wins). Used by the per-source trace step in `reviewCase`
 * to overlay each source's mandatory hits on top of the shared pivot
 * pool without duplicating pages.
 */
function mergeKbHitsByUrl(a: KbHit[], b: KbHit[]): KbHit[] {
  const out: KbHit[] = [];
  const seen = new Set<string>();
  for (const hit of [...a, ...b]) {
    if (!hit?.url || seen.has(hit.url)) continue;
    seen.add(hit.url);
    out.push(hit);
  }
  return out;
}

async function searchKb(
  query: string,
  mandatoryUrls: string[] = [],
  universalUrls: string[] = UNIVERSAL_KB_URLS,
  reviewKind: 'TICKET' | 'TASK' | 'CALL' | null = null
): Promise<{
  id: number;
  name: string;
  url: string;
  content: string;
  is_playbook: boolean;
  /** Phase D (D3): canonical step list extracted from kb_pages_meta. */
  playbook_steps?: string[] | null;
  /**
   * KB link expansion: when this page was pulled in by following an
   * in-body hyperlink from another KB page, we record the source page
   * + hop distance so the prompt can label it `LINKED KB PAGE` rather
   * than treating it like a primary search hit. Absent on primary
   * mandatory / universal / search / semantic hits.
   */
  linked_from?: { name: string; url: string; hop: number };
}[]> {
  type KbHit = {
    id: number;
    name: string;
    url: string;
    content: string;
    is_playbook: boolean;
    playbook_steps?: string[] | null;
    linked_from?: { name: string; url: string; hop: number };
  };
  const result: KbHit[] = [];
  const seenIds = new Set<number>();
  // KB link expansion (BFS) state. Tracks every link we know about so
  // we don't re-fetch a page already in the result and don't enqueue
  // duplicates from different source pages.
  const linksByPageId = new Map<number, string[]>();
  const seenLinkUrls = new Set<string>();
  let totalChars = 0;
  // Quality-pass: bumped from 15KB → 60KB so the model gets enough KB
  // grounding to actually compare process steps to notes, especially
  // when multiple rule-pack always-include URLs land alongside the
  // playbook page and 5 search hits + 5 semantic hits. With four
  // anchor URLs ~3-5KB each, the old 15KB was clipping mid-sentence.
  //
  // KB link expansion (Layer 4): we reserve `LINK_EXPANSION_HEADROOM`
  // bytes ON TOP of the primary budget so layers 1-3 can't starve the
  // BFS. Without this split a hot ticket whose playbook + universal
  // anchors + search hits already total ~60KB leaves zero room for
  // back-link traversal — which is the exact scenario where we MOST
  // need the linked parent decision-flow page (e.g. SXBR2/BR3 leaf
  // page → "SXBR2/SXBR3 Troubleshooting Guide" parent).
  const PRIMARY_BUDGET = 60000;
  const LINK_EXPANSION_HEADROOM = 30000;
  const charBudget = PRIMARY_BUDGET + LINK_EXPANSION_HEADROOM;

  /** Helper: fetch a page's plaintext + outgoing in-KB links and record both. */
  async function fetchAndStash(
    pageId: number,
    pageName: string,
    pageUrl: string,
    isPlaybook: boolean,
    linkedFrom?: { name: string; url: string; hop: number }
  ): Promise<KbHit | null> {
    try {
      const { plaintext, links } = await bookstackService.getPageContentWithLinks(pageId);
      const remaining = Math.max(0, charBudget - totalChars);
      if (remaining === 0) return null;
      const truncated = plaintext.length > remaining ? plaintext.slice(0, remaining) + '…' : plaintext;
      const hit: KbHit = {
        id: pageId,
        name: pageName,
        url: pageUrl,
        content: truncated,
        is_playbook: isPlaybook,
        ...(linkedFrom ? { linked_from: linkedFrom } : {}),
      };
      result.push(hit);
      seenIds.add(pageId);
      seenLinkUrls.add(pageUrl);
      linksByPageId.set(pageId, links);
      totalChars += truncated.length;
      return hit;
    } catch (err) {
      logger.warn(`[AI REVIEWER] KB page ${pageId} fetch failed: ${(err as Error).message}`);
      return null;
    }
  }

  for (const url of mandatoryUrls) {
    if (totalChars >= PRIMARY_BUDGET) break;
    try {
      const page = await bookstackService.getPageByUrl(url);
      if (!page) {
        logger.warn(`[AI REVIEWER] Playbook URL did not resolve to a BookStack page: ${url}`);
        continue;
      }
      if (seenIds.has(page.id)) continue;
      await fetchAndStash(page.id, page.name, page.url, true);
    } catch (err) {
      logger.warn(`[AI REVIEWER] Playbook page fetch failed for ${url}: ${(err as Error).message}`);
    }
  }

  // Universal authorities: always-on policy pages tagged is_playbook=false
  // so the prompt labels them `KB PAGE`. Pulled AFTER the per-ticket
  // playbook so the playbook stays first in the prompt (and gets first
  // crack at the char budget).
  for (const url of universalUrls) {
    if (totalChars >= PRIMARY_BUDGET) break;
    try {
      const page = await bookstackService.getPageByUrl(url);
      if (!page) {
        logger.warn(`[AI REVIEWER] Universal KB URL did not resolve to a BookStack page: ${url}`);
        continue;
      }
      if (seenIds.has(page.id)) continue;
      await fetchAndStash(page.id, page.name, page.url, false);
    } catch (err) {
      logger.warn(`[AI REVIEWER] Universal KB page fetch failed for ${url}: ${(err as Error).message}`);
    }
  }

  const trimmed = query.trim();
  if (trimmed && totalChars < PRIMARY_BUDGET) {
    let hits: Awaited<ReturnType<typeof bookstackService.searchByText>> = [];
    try {
      hits = await bookstackService.searchByText(trimmed, { count: 10 });
    } catch (err) {
      logger.warn(`[AI REVIEWER] BookStack search failed for "${trimmed}": ${(err as Error).message}`);
    }

    const pageHits = hits.filter((h) => h.type === 'page').slice(0, 5);
    for (const hit of pageHits) {
      if (totalChars >= PRIMARY_BUDGET) break;
      if (seenIds.has(hit.id)) continue;
      await fetchAndStash(hit.id, hit.name, hit.url, false);
    }
  }

  // Layer 3: semantic hits. Only runs when budget remains AND the index
  // is configured. A failing semanticSearch is non-fatal — we just skip
  // the layer and return what we have, preserving pre-Phase-4 behavior.
  if (trimmed && totalChars < PRIMARY_BUDGET && kbIndexService.isConfigured()) {
    try {
      const semantic = await kbIndexService.semanticSearch(trimmed, 5);
      for (const hit of semantic) {
        if (totalChars >= PRIMARY_BUDGET) break;
        if (seenIds.has(hit.id)) continue;
        await fetchAndStash(hit.id, hit.name, hit.url, false);
      }
    } catch (err) {
      logger.warn(`[AI REVIEWER] Semantic KB layer failed (skipping): ${(err as Error).message}`);
    }
  }

  // Layer 4: KB LINK EXPANSION. Walks in-body links from every page
  // already in the result set, fetching parent / sibling / "see also"
  // pages so the model sees decision-flow gating that leaf pages
  // typically reference but do not document directly. Bounded by hop
  // depth, page count, and the existing char budget so cost stays
  // predictable.
  //
  // Real-world example: a hit on
  //   "SXBR2/SXBR3 Troubleshoot - Not Connected to the Internet"
  // back-links to its parent
  //   "SXBR2/SXBR3 Troubleshoot"
  // which documents the email-vs-phone branching the leaf doesn't
  // cover. Without this layer, the AI grades only against leaf-level
  // troubleshoot steps and misses that the agent's email-path was
  // itself a valid choice from the parent's gate.
  const KB_LINK_MAX_HOPS = 3;
  const KB_LINK_MAX_PAGES = 8;
  type LinkQueueItem = { url: string; sourceName: string; hop: number };
  const queue: LinkQueueItem[] = [];
  let totalSeedLinks = 0;
  for (const seed of result) {
    const seedLinks = linksByPageId.get(seed.id) ?? [];
    totalSeedLinks += seedLinks.length;
    for (const linkUrl of seedLinks) {
      if (!seenLinkUrls.has(linkUrl)) {
        queue.push({ url: linkUrl, sourceName: seed.name, hop: 1 });
      }
    }
  }
  const initialCandidates = queue.length;
  let addedLinkedPages = 0;
  let resolveFailures = 0;
  let alreadySeen = 0;
  while (queue.length > 0 && addedLinkedPages < KB_LINK_MAX_PAGES && totalChars < charBudget) {
    const next = queue.shift()!;
    if (seenLinkUrls.has(next.url)) {
      alreadySeen++;
      continue;
    }
    seenLinkUrls.add(next.url);
    let page: Awaited<ReturnType<typeof bookstackService.getPageByUrl>>;
    try {
      page = await bookstackService.getPageByUrl(next.url);
    } catch (err) {
      logger.warn(`[AI REVIEWER] linked KB resolve failed for ${next.url}: ${(err as Error).message}`);
      resolveFailures++;
      continue;
    }
    if (!page) {
      resolveFailures++;
      continue;
    }
    if (seenIds.has(page.id)) {
      alreadySeen++;
      continue;
    }
    const added = await fetchAndStash(page.id, page.name, page.url, false, {
      name: next.sourceName,
      url: next.url,
      hop: next.hop,
    });
    if (!added) break;
    addedLinkedPages++;
    if (next.hop < KB_LINK_MAX_HOPS) {
      const childLinks = linksByPageId.get(added.id) ?? [];
      for (const childUrl of childLinks) {
        if (!seenLinkUrls.has(childUrl)) {
          queue.push({ url: childUrl, sourceName: added.name, hop: next.hop + 1 });
        }
      }
    }
  }
  logger.info(
    `[AI REVIEWER] KB link expansion: seed_pages=${result.length} seed_links=${totalSeedLinks} initial_candidates=${initialCandidates} added=${addedLinkedPages} skipped_seen=${alreadySeen} resolve_failures=${resolveFailures} (max_hops=${KB_LINK_MAX_HOPS}, max_pages=${KB_LINK_MAX_PAGES})`
  );

  // Phase D (D2 + D3): filter out pages whose front-matter says they
  // don't apply to this review kind, AND attach the prefab playbook
  // step list when one was extracted at crawl time. Pages without a
  // kb_pages_meta row pass through unchanged (back-compat for the bulk
  // of the KB that hasn't been front-matter-tagged yet). Mandatory +
  // universal anchors are always retained so an operator can force a
  // page into the prompt even when its tagging is incomplete.
  if (result.length > 0) {
    try {
      const ids = result.map((p) => p.id);
      const metas = await prisma.kbPageMeta.findMany({
        where: { page_id: { in: ids } },
        select: { page_id: true, qtip_applies_to: true, playbook_steps: true },
      });
      const metaById = new Map<number, { applies: string[] | null; steps: string[] | null }>(
        metas.map((m) => {
          const applies = Array.isArray(m.qtip_applies_to)
            ? (m.qtip_applies_to as unknown as string[])
            : null;
          const steps = Array.isArray(m.playbook_steps)
            ? (m.playbook_steps as unknown as string[])
            : null;
          return [m.page_id, { applies, steps }] as const;
        })
      );
      const mandatorySet = new Set<number>();
      for (const p of result) if (p.is_playbook) mandatorySet.add(p.id);
      for (let i = result.length - 1; i >= 0; i--) {
        const p = result[i];
        const meta = metaById.get(p.id);
        if (meta?.steps && meta.steps.length > 0) {
          p.playbook_steps = meta.steps;
        }
        if (mandatorySet.has(p.id)) continue;
        if (!reviewKind) continue;
        const applies = meta?.applies ?? null;
        if (applies && applies.length > 0 && !applies.includes(reviewKind)) {
          result.splice(i, 1);
        }
      }
    } catch (err) {
      logger.warn(`[AI REVIEWER] kb_pages_meta filter failed (returning unfiltered): ${(err as Error).message}`);
    }
  }

  return result;
}

interface ClaudeOutput {
  answers: CreateSubmissionAnswerDTO[];
  narrative: string;
  kbCitations: { id: number; name: string; url: string }[];
  /** Top-level confidence the AI emits for the whole review (0..1, null if not provided). */
  overallConfidence: number | null;
  /** AI-reconstructed chronological action timeline (empty array if none). */
  timeline: AiTimelineItem[];
  /** Non-scored advisory observations (empty array if none). */
  observations: AiObservation[];
  /** Phase A: explicit playbook checklist emitted before answers (empty array if not provided). */
  playbookSteps: AiPlaybookStep[];
  /** Phase A: SPIN-style coaching block (empty arrays when nothing to say). */
  coaching: AiCoaching;
  /** Phase A: per-answer evidence keyed by question_id. */
  answerEvidence: Record<number, { evidence_source?: string; evidence_quote?: string }>;
  /** Phase A: self-consistency warnings detected at parse time. Empty when consistent. */
  selfConsistencyWarnings: string[];
  /** TEMP COST ESTIMATOR — non-persistent USD cost estimate; null when tokens unknown. */
  cost: CostEstimate | null;
}

interface LlmOutput extends ClaudeOutput {
  model: string;
  retried: boolean;
}

/**
 * Provider-aware LLM dispatcher used by the analyzeTicket() path.
 * The production reviewClosedTicket() path still goes through callClaude()
 * directly to keep its diff minimal and behavior unchanged.
 */
async function callLlm(
  provider: AiProvider,
  promptParts: { system: string; user: string },
  form: FormForPrompt,
  traceCtx?: CallLogMeta
): Promise<LlmOutput> {
  if (provider === 'openai') return callOpenAI(promptParts, form, traceCtx);
  return callAnthropic(promptParts, form, traceCtx);
}

/**
 * Anthropic variant. Mirrors callClaude() but returns the model + retried
 * flag for the analysis path. Wrapped in withCallLog so every invocation
 * lands a trace row in ai_call_logs (Phase 3).
 */
async function callAnthropic(
  promptParts: { system: string; user: string },
  form: FormForPrompt,
  traceCtx?: CallLogMeta
): Promise<LlmOutput> {
  return withCallLog<LlmOutput>(
    traceCtx ?? { provider: 'anthropic', purpose: 'ai_reviewer.unknown' },
    promptParts,
    async () => {
      const client = getAnthropicClient();
      const model = aiConfig.anthropic?.defaultModel ?? 'claude-opus-4-7';
      let retried = false;
      let tokensIn: number | null = null;
      let tokensOut: number | null = null;

      const sendOnce = async (extraSystem?: string) => {
        const res = await client.messages.create(
          {
            model,
            // 16000 (was 8000): see callClaude — same large-form truncation
            // risk on the analyzeTicket sandbox path.
            max_tokens: 16000,
            // Phase A: Anthropic deprecated the `temperature` parameter on
            // opus-4-7+ (sending it returns 400). The model is deterministic
            // by default at the API level, so re-running the same ticket
            // still produces the same answers — we just no longer set the
            // value explicitly.
            system: promptParts.system + (extraSystem ?? ''),
            messages: [{ role: 'user', content: promptParts.user }],
          },
          // Per-call 10-minute override + no SDK retries. See callClaude
          // for the full reasoning.
          { timeout: 600_000, maxRetries: 0 }
        );
        const usage = (res as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
        if (usage) {
          tokensIn = usage.input_tokens ?? null;
          tokensOut = usage.output_tokens ?? null;
        }
        const textBlock = res.content.find((b) => b.type === 'text') as { text: string } | undefined;
        if (!textBlock) throw new Error('Claude returned no text content');
        return textBlock.text;
      };

      let raw = await sendOnce();
      let parsed = tryParseJson(raw);
      if (!parsed) {
        retried = true;
        logger.warn('[AI REVIEWER] First Anthropic response was not valid JSON; retrying once with stricter system prompt.');
        raw = await sendOnce('\n\nIMPORTANT: Your previous response could not be parsed as JSON. Respond with ONLY the JSON object, nothing else, no prose, no code fences.');
        parsed = tryParseJson(raw);
      }
      if (!parsed) {
        throw new AIReviewerServiceError('Anthropic failed to return valid JSON after one retry.', 'AI_OUTPUT_INVALID', 502);
      }
      const out = mapClaudeOutputToAnswers(parsed, form);
      const cost = estimateUsdCost(model, tokensIn, tokensOut);
      if (cost) {
        logger.info(
          `[AI REVIEWER] TEMP COST ESTIMATOR: model=${model} in=${cost.inputTokens} out=${cost.outputTokens} ` +
            `usd=${cost.formatted}${cost.approximated ? ' (approximated)' : ''}`
        );
      }
      return {
        result: { ...out, cost, model, retried },
        model,
        rawResponse: raw,
        retried,
        tokensIn,
        tokensOut,
      };
    }
  );
}

/**
 * OpenAI variant. Uses chat.completions with response_format json_object
 * which guarantees the model returns a parseable JSON object on the first
 * try (the JSON-retry fallback is still present for safety). Wrapped in
 * withCallLog so every invocation lands a trace row in ai_call_logs
 * (Phase 3).
 */
async function callOpenAI(
  promptParts: { system: string; user: string },
  form: FormForPrompt,
  traceCtx?: CallLogMeta
): Promise<LlmOutput> {
  return withCallLog<LlmOutput>(
    traceCtx ?? { provider: 'openai', purpose: 'ai_reviewer.unknown' },
    promptParts,
    async () => {
      const client = getOpenAIClient();
      const model = aiConfig.openai?.defaultModel ?? 'gpt-5';
      let retried = false;
      let tokensIn: number | null = null;
      let tokensOut: number | null = null;

      const sendOnce = async (extraSystem?: string): Promise<string> => {
        const res = await client.chat.completions.create({
          model,
          response_format: { type: 'json_object' },
          // Phase A: temperature 0 for deterministic grading.
          temperature: 0,
          messages: [
            { role: 'system', content: promptParts.system + (extraSystem ?? '') },
            { role: 'user', content: promptParts.user },
          ],
        });
        const usage = res.usage;
        if (usage) {
          tokensIn = usage.prompt_tokens ?? null;
          tokensOut = usage.completion_tokens ?? null;
        }
        return res.choices[0]?.message?.content ?? '';
      };

      let raw = await sendOnce();
      let parsed = tryParseJson(raw);
      if (!parsed) {
        retried = true;
        logger.warn('[AI REVIEWER] First OpenAI response was not valid JSON; retrying once with stricter system prompt.');
        raw = await sendOnce('\n\nIMPORTANT: Your previous response could not be parsed as JSON. Respond with ONLY the JSON object, nothing else, no prose, no code fences.');
        parsed = tryParseJson(raw);
      }
      if (!parsed) {
        throw new AIReviewerServiceError('OpenAI failed to return valid JSON after one retry.', 'AI_OUTPUT_INVALID', 502);
      }
      const out = mapClaudeOutputToAnswers(parsed, form);
      const cost = estimateUsdCost(model, tokensIn, tokensOut);
      if (cost) {
        logger.info(
          `[AI REVIEWER] TEMP COST ESTIMATOR: model=${model} in=${cost.inputTokens} out=${cost.outputTokens} ` +
            `usd=${cost.formatted}${cost.approximated ? ' (approximated)' : ''}`
        );
      }
      return {
        result: { ...out, cost, model, retried },
        model,
        rawResponse: raw,
        retried,
        tokensIn,
        tokensOut,
      };
    }
  );
}

/**
 * Pass-1 trace call for the multi-source orchestrator. Returns the raw
 * JSON string that the synthesis pass embeds verbatim into its prompt.
 *
 * Why a separate wrapper from `callClaude`: the trace prompt's response
 * shape is `{ playbook_steps, timeline, observations, extracted_claims,
 * per_question_evidence }` — no `answers[]`. Routing it through
 * `callClaude` would trip `mapClaudeOutputToAnswers`'s "missing answers
 * field" guard. Instead we keep this wrapper minimal: send + retry once
 * if the response isn't JSON, hand the JSON STRING back to the caller.
 *
 * Model selection: defaults to `ANTHROPIC_CHEAP_MODEL` (Sonnet) with
 * the configured Opus model as fallback — same env contract as
 * `classifyCallTopic`. The trace pass is the labour-intensive bulk
 * read; cheap-model latency + cost dominate when a case has 3+ sources.
 */
async function runTracePass(
  promptParts: { system: string; user: string },
  traceCtx: CallLogMeta
): Promise<string> {
  return withCallLog<string>(
    traceCtx,
    promptParts,
    async () => {
      const client = getAnthropicClient();
      const model =
        process.env.ANTHROPIC_CHEAP_MODEL || aiConfig.anthropic?.defaultModel || 'claude-sonnet-4-5';
      let retried = false;
      let tokensIn: number | null = null;
      let tokensOut: number | null = null;

      const sendOnce = async (extraSystem?: string) => {
        const res = await client.messages.create({
          model,
          // 8000 (was 4000): see callAnthropic — same truncation risk on
          // longer trace JSON, same zero cost on normal runs.
          max_tokens: 8000,
          system: promptParts.system + (extraSystem ?? ''),
          messages: [{ role: 'user', content: promptParts.user }],
        });
        const usage = (res as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
        if (usage) {
          tokensIn = usage.input_tokens ?? null;
          tokensOut = usage.output_tokens ?? null;
        }
        const block = res.content.find((b) => b.type === 'text') as { text: string } | undefined;
        if (!block) throw new Error('Claude trace response had no text content');
        return block.text;
      };

      let raw = await sendOnce();
      let parsed = tryParseJson(raw);
      if (!parsed) {
        retried = true;
        logger.warn('[AI REVIEWER] Trace response was not valid JSON; retrying once with stricter system prompt.');
        raw = await sendOnce(
          '\n\nIMPORTANT: Your previous response could not be parsed as JSON. Respond with ONLY the JSON object, nothing else, no prose, no code fences.'
        );
        parsed = tryParseJson(raw);
      }
      if (!parsed) {
        throw new AIReviewerServiceError(
          'Claude trace pass failed to return valid JSON after one retry.',
          'AI_OUTPUT_INVALID',
          502
        );
      }

      // We intentionally hand back the RAW JSON STRING (not the parsed
      // object) — the synthesis prompt embeds it verbatim so the model
      // sees the literal field names from Pass 1. Re-stringifying a
      // parsed object would silently change formatting.
      const cleaned = JSON.stringify(parsed);
      return {
        result: cleaned,
        model,
        rawResponse: raw,
        retried,
        tokensIn,
        tokensOut,
      };
    }
  );
}

/**
 * Pass 2A of the chunked synthesis pipeline. Runs on Opus and emits
 * the reasoning artefacts only (playbook_steps + timeline + observations
 * + faithfulness + narrative + coaching + kb_citations + overall_confidence)
 * — no `answers[]`. The result is handed off as raw JSON to the
 * parallel Pass-2B answer chunks so each chunk can defer to it as
 * authoritative grading context.
 *
 * Why a separate wrapper from `callClaude`: that wrapper runs
 * `mapClaudeOutputToAnswers` on its result and would trip on the
 * missing `answers[]` field. This wrapper just returns the parsed
 * reasoning object plus its raw JSON string (the chunks embed the
 * latter verbatim in their user prompts).
 *
 * Shares timing/retry behaviour with `callClaude` so big forms have
 * the same generous wall-clock budget on the heavy reasoning step.
 */
async function runReasoningPass(
  promptParts: { system: string; user: string },
  traceCtx: CallLogMeta,
  provider: ModelProvider = 'anthropic'
): Promise<{ parsed: any; raw: string }> {
  return withCallLog<{ parsed: any; raw: string }>(
    { ...traceCtx, provider },
    promptParts,
    async () => {
      const model = resolveModelName(provider);
      let retried = false;
      let tokensIn: number | null = null;
      let tokensOut: number | null = null;
      let lastStopReason: string | null = null;

      const sendOnce = async (extraSystem?: string) => {
        const out = await callChatModel(provider, {
          system: promptParts.system + (extraSystem ?? ''),
          user: promptParts.user,
          model,
          // Reasoning artefacts (no answers[]) cap out around 8k chars
          // / 3k tokens on the largest forms we've seen. 8000 is more
          // than 2x the worst-case budget — same ceiling/no-cost
          // tradeoff as the trace pass.
          maxTokens: 8000,
          timeoutMs: 600_000,
          // JSON mode: ignored by Anthropic (the system prompt already
          // enforces JSON), honoured natively by OpenAI so the answer
          // chunks downstream can parse without prompt-discipline hacks.
          responseFormat: 'json_object',
        });
        tokensIn = out.tokensIn;
        tokensOut = out.tokensOut;
        lastStopReason = out.stopReason;
        if (!out.text) {
          throw new Error(`${provider} reasoning response had no text content`);
        }
        return out.text;
      };

      let raw = await sendOnce();
      let parsed = tryParseJson(raw);
      if (!parsed) {
        retried = true;
        logger.warn(
          `[AI REVIEWER] Reasoning pass: first response was not valid JSON; retrying. ` +
            `stop_reason=${lastStopReason} tokens_out=${tokensOut} raw_len=${raw.length}`
        );
        raw = await sendOnce(
          '\n\nIMPORTANT: Your previous response could not be parsed as JSON. Respond with ONLY the JSON object, nothing else, no prose, no code fences.'
        );
        parsed = tryParseJson(raw);
      }
      if (!parsed) {
        throw new AIReviewerServiceError(
          'Reasoning pass failed to return valid JSON after one retry.',
          'AI_OUTPUT_INVALID',
          502
        );
      }

      // Re-stringify so chunks embed a normalized JSON form (no
      // markdown fences, no leading prose). The original raw string is
      // returned via rawResponse for the call-log record.
      const cleanedJson = JSON.stringify(parsed);
      return {
        result: { parsed, raw: cleanedJson },
        model,
        rawResponse: raw,
        retried,
        tokensIn,
        tokensOut,
      };
    }
  );
}

/**
 * Pass 2B of the chunked synthesis pipeline: ONE answer chunk for ONE
 * form category. Runs on Sonnet (~3-5x faster, ~5x cheaper than Opus).
 * The model has been told to defer to the reasoning pass's artefacts;
 * this call just translates them into verdicts for the listed
 * question_ids.
 *
 * Returns the parsed `answers[]` array (raw — `mapClaudeOutputToAnswers`
 * does the per-question validation downstream once all chunks are
 * merged). Throws AI_OUTPUT_INVALID with the chunk's category name
 * embedded in the message if Sonnet can't produce parseable JSON,
 * which mirrors how a single-pass synthesis failure surfaces today.
 */
async function runAnswerChunkPass(
  promptParts: { system: string; user: string },
  traceCtx: CallLogMeta,
  categoryName: string,
  provider: ModelProvider = 'anthropic'
): Promise<any[]> {
  return withCallLog<any[]>(
    { ...traceCtx, provider },
    promptParts,
    async () => {
      // Cheap-model env contract is per-provider: ANTHROPIC_CHEAP_MODEL
      // for Anthropic, OPENAI_CHEAP_MODEL for OpenAI. resolveCheapModelName
      // centralizes the lookup so the synthesis path doesn't have to
      // know about either env var directly.
      const model = resolveCheapModelName(provider);
      let retried = false;
      let tokensIn: number | null = null;
      let tokensOut: number | null = null;
      let lastStopReason: string | null = null;

      const sendOnce = async (extraSystem?: string) => {
        const out = await callChatModel(provider, {
          system: promptParts.system + (extraSystem ?? ''),
          user: promptParts.user,
          model,
          // 8000: an answers-only chunk for ~15 questions is ~3-4k
          // chars / ~1.5k tokens. 8k leaves comfortable headroom for
          // the largest plausible category without paying for output
          // we'll never use.
          maxTokens: 8000,
          // 5-min per-chunk timeout. Sonnet / GPT-5-mini both complete
          // a chunk in ~30-90 sec; 5 min is paranoia-level headroom for
          // a slow network hiccup. Orchestrator owns retry semantics.
          timeoutMs: 300_000,
          responseFormat: 'json_object',
        });
        tokensIn = out.tokensIn;
        tokensOut = out.tokensOut;
        lastStopReason = out.stopReason;
        if (!out.text) {
          throw new Error(`${provider} answer-chunk response had no text content`);
        }
        return out.text;
      };

      let raw = await sendOnce();
      let parsed = tryParseJson(raw);
      if (!parsed) {
        retried = true;
        logger.warn(
          `[AI REVIEWER] Answer chunk "${categoryName}": first response was not valid JSON; retrying. ` +
            `stop_reason=${lastStopReason} tokens_out=${tokensOut} raw_len=${raw.length}`
        );
        raw = await sendOnce(
          '\n\nIMPORTANT: Your previous response could not be parsed as JSON. Respond with ONLY the JSON object, nothing else, no prose, no code fences.'
        );
        parsed = tryParseJson(raw);
      }
      if (!parsed || !Array.isArray(parsed.answers)) {
        throw new AIReviewerServiceError(
          `Answer chunk "${categoryName}" failed to return a valid answers[] array after one retry.`,
          'AI_OUTPUT_INVALID',
          502
        );
      }

      return {
        result: parsed.answers,
        model,
        rawResponse: raw,
        retried,
        tokensIn,
        tokensOut,
      };
    }
  );
}

/**
 * Pass 2C of the chunked synthesis pipeline: reconcile a SINGLE
 * dissented answer. Called only for questions where the chunk pass
 * (Pass 2B) flagged `dissent: true` — i.e. the chunk model is
 * claiming the rubric + evidence clearly contradict the reasoning
 * pass's draft verdict.
 *
 * Sends a tiny call with: the question text + rubric, the draft
 * verdict + brief_rationale (from the reasoning pass), the chunk's
 * dissenting verdict + dissent_reason + evidence quote, and the
 * narrative excerpt for the category. Returns a single verdict +
 * one-sentence rationale.
 *
 * Falls back to the reasoning draft verdict if the API call fails —
 * we prefer the holistic-context view (reasoning) over the siloed
 * view (chunk) on any error, on the principle that the reasoning
 * pass saw the entire case and the chunk only saw one category.
 */
async function runReconciliationPass(
  args: {
    questionId: number;
    questionText: string;
    rubricMd: string | null;
    draftVerdict: 'yes' | 'no' | 'na';
    draftRationale: string;
    chunkVerdict: 'yes' | 'no' | 'na';
    chunkDissentReason: string;
    chunkEvidenceQuote: string;
    narrativeExcerpt: string;
  },
  traceCtx: CallLogMeta,
  provider: ModelProvider
): Promise<{ verdict: 'yes' | 'no' | 'na'; rationale: string }> {
  const system =
    'You are a quality-assurance arbiter. Two AI passes disagreed on one question. ' +
    'You will receive (a) the question and its rubric, (b) the reasoning pass\'s DRAFT verdict + rationale, ' +
    '(c) the chunk pass\'s DISSENTING verdict + reason + evidence quote, (d) the narrative excerpt for context. ' +
    'Apply the rubric strictly. Pick the verdict that the rubric + evidence most clearly supports. ' +
    'Tie-break in favor of the reasoning pass (it saw the entire case; the chunk only saw one category). ' +
    'Respond with ONE JSON object: {"verdict":"yes"|"no"|"na","rationale":"<one short sentence>"}. ' +
    'NO prose outside the JSON, NO markdown.';
  const user = [
    `QUESTION q${args.questionId}: ${args.questionText}`,
    '',
    'RUBRIC:',
    args.rubricMd ?? '(no rubric configured)',
    '',
    `DRAFT VERDICT (reasoning pass): ${args.draftVerdict.toUpperCase()}`,
    `DRAFT RATIONALE: ${args.draftRationale}`,
    '',
    `CHUNK VERDICT (dissenting): ${args.chunkVerdict.toUpperCase()}`,
    `CHUNK DISSENT REASON: ${args.chunkDissentReason}`,
    `CHUNK EVIDENCE QUOTE: ${args.chunkEvidenceQuote || '(no quote)'}`,
    '',
    'NARRATIVE EXCERPT (for context):',
    args.narrativeExcerpt || '(none)',
  ].join('\n');

  try {
    return await withCallLog<{ verdict: 'yes' | 'no' | 'na'; rationale: string }>(
      { ...traceCtx, provider },
      { system, user },
      async () => {
        const model = resolveCheapModelName(provider);
        const out = await callChatModel(provider, {
          system,
          user,
          model,
          // 256 tokens: a verdict + one-sentence rationale is ~40 chars.
          // Give plenty of headroom for the reasoning-model overhead but
          // not so much that one reconciliation costs as much as a chunk.
          maxTokens: 1000,
          timeoutMs: 120_000,
          responseFormat: 'json_object',
        });
        const parsed = tryParseJson(out.text);
        if (!parsed || typeof parsed.verdict !== 'string') {
          throw new Error('reconciliation response missing verdict');
        }
        const v = String(parsed.verdict).toLowerCase();
        if (v !== 'yes' && v !== 'no' && v !== 'na') {
          throw new Error(`reconciliation returned invalid verdict: ${parsed.verdict}`);
        }
        return {
          result: {
            verdict: v as 'yes' | 'no' | 'na',
            rationale: String(parsed.rationale ?? '').trim() || 'reconciled (no rationale)',
          },
          model,
          rawResponse: out.text,
          retried: false,
          tokensIn: out.tokensIn,
          tokensOut: out.tokensOut,
        };
      }
    );
  } catch (err) {
    // Fail-safe: when reconciliation breaks, defer to the holistic
    // reasoning view rather than the siloed chunk view. This is the
    // OPPOSITE of "keep the chunk's NO" — which is precisely the
    // failure mode this refactor is trying to eliminate.
    logger.warn(
      `[AI REVIEWER] reconciliation q${args.questionId} failed (${(err as Error).message}); ` +
        `falling back to reasoning draft verdict=${args.draftVerdict}`
    );
    return {
      verdict: args.draftVerdict,
      rationale: `reconciliation unavailable; deferred to reasoning draft: ${args.draftRationale}`,
    };
  }
}

/**
 * Orchestrate the chunked synthesis pipeline:
 *   1. Build + run the reasoning prompt on Opus (Pass 2A) — emits
 *      playbook_steps + timeline + observations + faithfulness +
 *      narrative + coaching + kb_citations + overall_confidence
 *      AND `draft_answers[]` (one per gradeable question_id).
 *   2. Group the form's gradeable questions by category, build one
 *      answer-chunk prompt per category (Pass 2B), fire them all in
 *      parallel. Each chunk receives its category's draft verdicts
 *      and produces final answers (confirm + attach evidence, or
 *      flag dissent).
 *   3. Reconcile: for every chunk answer where `dissent === true`,
 *      run a tiny reconciliation call (Pass 2C) that resolves the
 *      disagreement. Skipped entirely when no dissents (zero-cost on
 *      healthy runs).
 *   4. Merge: stitch reasoning + (chunk OR reconciled) answers and
 *      hand the result to `mapClaudeOutputToAnswers`.
 *
 * Cost: each pass writes its own `ai_call_logs` row (one for
 * reasoning, N for the per-category chunks, M for reconciliations
 * where M = number of dissents) and contributes to the `cost`
 * accumulator so the existing rollup picks them up.
 */
async function runChunkedSynthesis(
  synthesisInput: Parameters<typeof buildReasoningPrompt>[0],
  form: FormForPrompt,
  opts: {
    formId: number;
    caseId: string;
    ticketId: number | null;
    accumulateCost: (passLabel: string) => (cost: CostEstimate | null) => void;
    /**
     * Provider override for THIS synthesis run. Defaults to the form's
     * configured `ai_model_provider`. Set explicitly by the
     * compare-models endpoint to force a specific provider per side
     * without touching the form column.
     */
    provider?: ModelProvider;
  }
): Promise<ClaudeOutput> {
  const provider: ModelProvider = opts.provider ?? 'anthropic';
  const reasoningPrompt = buildReasoningPrompt(synthesisInput);
  const reasoningCtx: CallLogMeta = {
    provider,
    purpose: 'ai_reviewer.case.synthesis.reasoning',
    pass: 'syn_reasoning',
    ticketId: opts.ticketId,
    formId: opts.formId,
    caseId: opts.caseId,
    onCost: opts.accumulateCost('synthesis_reasoning'),
  };
  const { parsed: reasoningParsed, raw: reasoningJson } = await runReasoningPass(
    reasoningPrompt,
    reasoningCtx,
    provider
  );

  const categories = groupGradeableQuestionsByCategory(form);
  if (categories.length === 0) {
    throw new AIReviewerServiceError(
      `Form ${opts.formId} has no gradeable categories — chunked synthesis cannot run.`,
      'AI_OUTPUT_INVALID',
      502
    );
  }

  // Parse `draft_answers[]` from the reasoning output into a flat map.
  // The reasoning addendum REQUIRES one draft per gradeable question;
  // any missing ids will surface as MISSING in the chunk prompt and
  // the chunk model will fall back to its rubric reading.
  const draftAnswersById = parseDraftAnswers(reasoningParsed);
  const draftCount = draftAnswersById.size;
  const gradeableCount = categories.reduce((acc, c) => acc + c.questionIds.length, 0);
  if (draftCount < gradeableCount) {
    logger.warn(
      `[AI REVIEWER] reasoning pass emitted ${draftCount} draft_answers but form has ` +
        `${gradeableCount} gradeable questions (case=${opts.caseId}, form=${opts.formId}); ` +
        `${gradeableCount - draftCount} questions will fall back to rubric-only chunk grading`
    );
  }

  // Fan out: one cheap-model call per category in parallel. Each chunk
  // gets its draft verdicts (so it can confirm + attach evidence rather
  // than independently re-grade) plus the full reasoning JSON and per-
  // source traces for evidence anchoring. Promise.all keeps wall time
  // at one chunk; cost is N chunks.
  const chunkResults = await Promise.all(
    categories.map(({ category, questionIds }) => {
      const draftsForChunk: DraftAnswer[] = [];
      for (const qid of questionIds) {
        const d = draftAnswersById.get(qid);
        if (d) draftsForChunk.push(d);
      }
      const chunkPrompt = buildAnswerChunkPrompt({
        form,
        categoryName: category,
        questionIds,
        reasoning: { reasoningJson },
        draftAnswers: draftsForChunk,
        traces: synthesisInput.traces,
        corrections: synthesisInput.corrections,
        pivots: synthesisInput.pivots,
        traceAgreements: synthesisInput.traceAgreements,
        kbAnchors: synthesisInput.kbAnchors,
      });
      const chunkCtx: CallLogMeta = {
        provider,
        purpose: 'ai_reviewer.case.synthesis.answer_chunk',
        pass: 'syn_answers',
        ticketId: opts.ticketId,
        formId: opts.formId,
        caseId: opts.caseId,
        onCost: opts.accumulateCost(`synthesis_answers:${category}`),
      };
      return runAnswerChunkPass(chunkPrompt, chunkCtx, category, provider);
    })
  );

  const mergedAnswers = chunkResults.flat();

  // Reconcile dissents. The chunk model is instructed to set
  // `dissent: true` ONLY when the rubric+evidence clearly contradicts
  // the draft. In a healthy run this fires on 0-5% of questions.
  const narrativeExcerpt = extractNarrative(reasoningParsed);
  const formQuestionsById = new Map<number, FormForPrompt['questions'][number]>();
  for (const q of form.questions) formQuestionsById.set(q.id, q);
  const rubricsById = loadFormRubrics(opts.formId);

  const dissentIndexes: number[] = [];
  for (let i = 0; i < mergedAnswers.length; i++) {
    if (mergedAnswers[i] && mergedAnswers[i].dissent === true) dissentIndexes.push(i);
  }

  if (dissentIndexes.length > 0) {
    logger.info(
      `[AI REVIEWER] chunked synthesis dissents detected: ${dissentIndexes.length} ` +
        `(case=${opts.caseId}, form=${opts.formId}); running reconciliation pass`
    );
    const reconcileCtx: CallLogMeta = {
      provider,
      purpose: 'ai_reviewer.case.synthesis.reconcile',
      pass: 'syn_reconcile',
      ticketId: opts.ticketId,
      formId: opts.formId,
      caseId: opts.caseId,
      onCost: opts.accumulateCost('synthesis_reconcile'),
    };
    const reconciliations = await Promise.all(
      dissentIndexes.map(async (idx) => {
        const chunkAns = mergedAnswers[idx];
        const qid = Number(chunkAns.question_id);
        const draft = draftAnswersById.get(qid);
        const q = formQuestionsById.get(qid);
        const rubric = rubricsById.get(qid) ?? null;
        return runReconciliationPass(
          {
            questionId: qid,
            questionText: q?.question_text ?? '(unknown question)',
            rubricMd: rubric,
            draftVerdict: (draft?.verdict ?? 'no') as 'yes' | 'no' | 'na',
            draftRationale: draft?.brief_rationale ?? '(no draft rationale)',
            chunkVerdict: String(chunkAns.value ?? chunkAns.answer ?? 'no').toLowerCase() as 'yes' | 'no' | 'na',
            chunkDissentReason: String(chunkAns.dissent_reason ?? '(no reason given)'),
            chunkEvidenceQuote: String(chunkAns.evidence_quote ?? ''),
            narrativeExcerpt,
          },
          reconcileCtx,
          provider
        );
      })
    );
    for (let i = 0; i < dissentIndexes.length; i++) {
      const idx = dissentIndexes[i];
      const r = reconciliations[i];
      // Apply reconciled verdict; preserve chunk's evidence quote;
      // average confidence between draft (high signal of holistic
      // view) and chunk (high signal of literal rubric reading).
      const draft = draftAnswersById.get(Number(mergedAnswers[idx].question_id));
      const draftConf = 0.85;
      const chunkConf = Number(mergedAnswers[idx].confidence ?? 0.5);
      mergedAnswers[idx] = {
        ...mergedAnswers[idx],
        value: r.verdict,
        answer: r.verdict,
        confidence: Number(((draftConf + chunkConf) / 2).toFixed(2)),
        reconciled: true,
        reconciled_from: {
          draft: draft?.verdict ?? null,
          chunk: mergedAnswers[idx].value ?? mergedAnswers[idx].answer ?? null,
        },
        reconciliation_rationale: r.rationale,
      };
    }
  }

  // For non-dissented answers, force value to the draft verdict (the
  // chunk model is supposed to confirm; if it accidentally emitted a
  // different verdict without setting dissent=true, that's a chunk
  // protocol violation and we trust the reasoning pass). The chunk's
  // evidence_quote / evidence_source are preserved either way.
  let confirmedFromDraft = 0;
  let chunkOverrodeWithoutDissent = 0;
  for (let i = 0; i < mergedAnswers.length; i++) {
    const a = mergedAnswers[i];
    if (a.reconciled === true) continue;
    if (a.dissent === true) continue; // already handled above
    const draft = draftAnswersById.get(Number(a.question_id));
    if (!draft) continue; // no draft available; trust chunk's rubric reading
    const chunkVerdict = String(a.value ?? a.answer ?? '').toLowerCase();
    if (chunkVerdict !== draft.verdict) {
      chunkOverrodeWithoutDissent++;
      // Force back to draft (silent protocol violation).
      mergedAnswers[i] = {
        ...a,
        value: draft.verdict,
        answer: draft.verdict,
        overridden_from_draft: true,
      };
    } else {
      confirmedFromDraft++;
    }
  }

  const mergedParsed = { ...reasoningParsed, answers: mergedAnswers };

  logger.info(
    `[AI REVIEWER] chunked synthesis assembled (case=${opts.caseId}, form=${opts.formId}, ` +
      `categories=${categories.length}, total_answers=${mergedAnswers.length}, ` +
      `drafts=${draftCount}, confirmed=${confirmedFromDraft}, dissents=${dissentIndexes.length}, ` +
      `silent_overrides=${chunkOverrodeWithoutDissent})`
  );

  return mapClaudeOutputToAnswers(mergedParsed, form);
}

/**
 * Parse `draft_answers[]` out of a reasoning pass's parsed JSON into
 * a flat `Map<question_id, DraftAnswer>`. Tolerant of mild schema
 * drift (the model occasionally normalises `verdict` casing or uses
 * `answer` instead of `verdict`).
 */
function parseDraftAnswers(reasoningParsed: any): Map<number, DraftAnswer> {
  const out = new Map<number, DraftAnswer>();
  const raw = reasoningParsed?.draft_answers;
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const qid = Number(item.question_id);
    if (!Number.isFinite(qid)) continue;
    const verdictRaw = String(item.verdict ?? item.answer ?? '').toLowerCase().trim();
    if (verdictRaw !== 'yes' && verdictRaw !== 'no' && verdictRaw !== 'na') continue;
    out.set(qid, {
      question_id: qid,
      verdict: verdictRaw as 'yes' | 'no' | 'na',
      brief_rationale: String(item.brief_rationale ?? item.rationale ?? '').trim(),
      evidence_pointer: item.evidence_pointer && typeof item.evidence_pointer === 'object'
        ? {
            source_kind: item.evidence_pointer.source_kind ? String(item.evidence_pointer.source_kind) : undefined,
            source_id: item.evidence_pointer.source_id ? String(item.evidence_pointer.source_id) : undefined,
            where: item.evidence_pointer.where ? String(item.evidence_pointer.where) : undefined,
          }
        : undefined,
    });
  }
  return out;
}

/**
 * Pull a short narrative excerpt from the reasoning JSON for the
 * reconciliation prompt. We don't need the full coaching block —
 * just enough context for the arbiter to understand the case.
 */
function extractNarrative(reasoningParsed: any): string {
  const n = reasoningParsed?.narrative;
  if (typeof n === 'string') return n.slice(0, 2000);
  if (Array.isArray(n)) return n.join('\n').slice(0, 2000);
  return '';
}

/**
 * Production-path Claude call (used by review() to actually persist a
 * submission). Wrapped in withCallLog so every prod review writes a trace
 * row to ai_call_logs (Phase 3).
 */
async function callClaude(
  promptParts: { system: string; user: string },
  form: FormForPrompt,
  traceCtx?: CallLogMeta
): Promise<ClaudeOutput> {
  return withCallLog<ClaudeOutput>(
    traceCtx ?? { provider: 'anthropic', purpose: 'ai_reviewer.unknown' },
    promptParts,
    async () => {
      const client = getAnthropicClient();
      const model = aiConfig.anthropic?.defaultModel ?? 'claude-opus-4-7';
      let retried = false;
      let tokensIn: number | null = null;
      let tokensOut: number | null = null;

      let lastStopReason: string | null = null;

      const sendOnce = async (extraSystem?: string) => {
        const res = await client.messages.create(
          {
            // 16000 (was 8000): a 114-question form (Contact Call Review v2
            // AI Pilot, form 99018) blew past the 8000 cap because the
            // synthesis schema requires playbook_steps + timeline +
            // observations + 100+ answers + faithfulness + coaching +
            // narrative — easily 30k+ chars. The cap is a ceiling — Claude
            // only emits what it needs — so the extra headroom costs
            // nothing on shorter forms. Opus 4.7 supports up to 32k
            // output tokens; 16000 leaves headroom without paying for
            // every form to be billed at 32k.
            model,
            max_tokens: 16000,
            // Phase A: deterministic grading is now provided by the model
            // by default (Anthropic deprecated the temperature parameter).
            system: promptParts.system + (extraSystem ?? ''),
            messages: [{ role: 'user', content: promptParts.user }],
          },
          {
            // The shared client uses ANTHROPIC_TIMEOUT_MS (~120s) which is
            // sized for short ticket reviews. The production answer-emitting
            // call on a large form (e.g. 99018 with 114 questions ⇒ ~16k
            // output tokens) takes longer than that to stream — Opus runs at
            // ~2-3k output tokens/min on big JSON. Override per-call to 10
            // minutes so big forms can complete; small forms still finish
            // fast and cost the same.
            timeout: 600_000,
            // No SDK-level retries here: a 10-minute timeout × 2 SDK retries
            // would silently turn into a 30-minute hang. The outer
            // sendOnce/parse-retry loop is the only retry layer we want.
            maxRetries: 0,
          }
        );
        const usage = (res as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
        if (usage) {
          tokensIn = usage.input_tokens ?? null;
          tokensOut = usage.output_tokens ?? null;
        }
        lastStopReason =
          (res as { stop_reason?: string | null }).stop_reason ?? null;
        const textBlock = res.content.find((b) => b.type === 'text') as { text: string } | undefined;
        if (!textBlock) throw new Error('Claude returned no text content');
        return textBlock.text;
      };

      let raw = await sendOnce();
      let parsed = tryParseJson(raw);
      if (!parsed) {
        retried = true;
        logger.warn(
          `[AI REVIEWER] First Claude response was not valid JSON; retrying once with stricter system prompt. ` +
            `stop_reason=${lastStopReason} tokens_out=${tokensOut} raw_len=${raw.length} ` +
            `head=${JSON.stringify(raw.slice(0, 400))} tail=${JSON.stringify(raw.slice(-400))}`
        );
        raw = await sendOnce('\n\nIMPORTANT: Your previous response could not be parsed as JSON. Respond with ONLY the JSON object, nothing else, no prose, no code fences.');
        parsed = tryParseJson(raw);
      }
      if (!parsed) {
        logger.error(
          `[AI REVIEWER] Claude retry ALSO failed JSON parse. ` +
            `stop_reason=${lastStopReason} tokens_out=${tokensOut} raw_len=${raw.length} ` +
            `head=${JSON.stringify(raw.slice(0, 400))} tail=${JSON.stringify(raw.slice(-400))}`
        );
        throw new AIReviewerServiceError(
          'Claude failed to return valid JSON after one retry.',
          'AI_OUTPUT_INVALID',
          502
        );
      }

      const out = mapClaudeOutputToAnswers(parsed, form);
      const cost = estimateUsdCost(model, tokensIn, tokensOut);
      if (cost) {
        logger.info(
          `[AI REVIEWER] TEMP COST ESTIMATOR: model=${model} in=${cost.inputTokens} out=${cost.outputTokens} ` +
            `usd=${cost.formatted}${cost.approximated ? ' (approximated)' : ''}`
        );
      }
      return {
        result: { ...out, cost },
        model,
        rawResponse: raw,
        retried,
        tokensIn,
        tokensOut,
      };
    }
  );
}

/**
 * Strip optional markdown fences and parse the first balanced JSON
 * object out of an LLM response. Exported so sibling LLM-call modules
 * (e.g. the pivot detector) can reuse the same lenient parsing rules
 * without duplicating the regex/fallback logic.
 */
export function tryParseJson(text: string): any | null {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try {
    return JSON.parse(stripped);
  } catch {
    // Sometimes the model puts JSON inside a paragraph — try the first {...} span.
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function mapClaudeOutputToAnswers(parsed: any, form: FormForPrompt): ClaudeOutput {
  if (!parsed || !Array.isArray(parsed.answers)) {
    throw new AIReviewerServiceError('Claude response missing required field: answers[].', 'AI_OUTPUT_INVALID', 502);
  }

  // Map by question_id → expected answer space, validate every answered question.
  const questionsById = new Map(form.questions.map((q) => [q.id, q]));
  const answeredIds = new Set<number>();
  const out: CreateSubmissionAnswerDTO[] = [];
  const answerEvidence: Record<number, { evidence_source?: string; evidence_quote?: string }> = {};

  for (const a of parsed.answers as any[]) {
    const question = questionsById.get(Number(a.question_id));
    if (!question) continue; // ignore stray answers; AI Feedback question is added by caller
    if (question.question_text.trim() === AI_REVIEWER_FEEDBACK_QUESTION_TEXT) continue; // caller fills this
    if (question.question_type === 'TEXT') continue; // human-written commentary fields stay empty for AI runs
    const validated = validateAnswerForQuestion(a.value, question);
    if (validated == null) {
      throw new AIReviewerServiceError(
        `Claude returned an unrecognized value for question_id=${question.id} (${question.question_text}): ${JSON.stringify(a.value)}`,
        'AI_OUTPUT_INVALID',
        502
      );
    }
    out.push({
      question_id: question.id,
      answer: validated,
      ai_confidence: clampConfidence(a.confidence),
    });
    answeredIds.add(question.id);

    // Phase A: capture per-answer evidence. Evidence is best-effort —
    // missing fields are tolerated (we just store what the model gave us).
    const evSource = typeof a.evidence_source === 'string' ? a.evidence_source.trim() : '';
    const evQuoteRaw = typeof a.evidence_quote === 'string' ? a.evidence_quote.trim() : '';
    // Cap the verbatim quote at 240 chars per the prompt contract — the
    // model occasionally exceeds the cap, and an oversized quote bloats
    // ai_extras for no reviewer benefit.
    const evQuote = evQuoteRaw.length > 240 ? evQuoteRaw.slice(0, 240) + '…' : evQuoteRaw;
    if (evSource || evQuote) {
      answerEvidence[question.id] = {
        ...(evSource ? { evidence_source: evSource } : {}),
        ...(evQuote ? { evidence_quote: evQuote } : {}),
      };
    }
  }

  // Every gradeable question must have an answer. TEXT questions are
  // always human-only (except the auto-managed AI Reviewer Feedback,
  // filled by the caller); INFO_BLOCK is non-gradeable display content.
  for (const q of form.questions) {
    if (q.question_text.trim() === AI_REVIEWER_FEEDBACK_QUESTION_TEXT) continue;
    if (q.question_type === 'INFO_BLOCK' || q.question_type === 'TEXT' || q.question_type === 'SUB_CATEGORY') continue;
    if (!answeredIds.has(q.id)) {
      throw new AIReviewerServiceError(
        `Claude did not answer question_id=${q.id} (${q.question_text}).`,
        'AI_OUTPUT_INVALID',
        502
      );
    }
  }

  // Deterministic NA-gate guard. When a parent "summary" question is
  // N/A-allowed AND all of its opportunity gate siblings are answered
  // 'no', the correct verdict per the form's rubric is 'na' (no
  // opportunity arose, so there's nothing to grade). The model often
  // gets this right when the rubric is in the prompt, but occasionally
  // defaults to 'no' anyway — penalizing the agent for an event that
  // never happened. This post-process flips those cases to 'na' as a
  // belt-and-suspenders against model drift. Pure pattern match on
  // question text + category so it works across form versions without
  // needing to thread slug data through FormForPrompt.
  const naGateFlips = applyNaGateGuards(out, form);

  const playbookSteps = parsePlaybookSteps(parsed.playbook_steps);
  const coaching = parseCoachingBlock(parsed.coaching);

  // Phase A self-consistency: when the AI says a "steps followed" question
  // is "no" but doesn't list any missing playbook step, that's a sign the
  // grade and the reasoning artefact disagree. We log it AND surface it as
  // a warning so the orchestrator can trigger a verification pass.
  const selfConsistencyWarnings = detectSelfConsistencyWarnings(out, playbookSteps, form);

  if (naGateFlips.length > 0) {
    selfConsistencyWarnings.push(
      ...naGateFlips.map((f) => `NA-gate guard flipped qid=${f.qid} from 'no' to 'na' (${f.reason})`)
    );
  }

  // Tier-2 (Phase F) evidence-floor enforcement: the synthesis prompt
  // tells the model to prefer "no" when the evidence_quote is empty for
  // a yes verdict, but the model often ignores that rule in practice
  // (it's the single biggest source of overconfident graded-yes answers
  // we saw on closed cases). Move the rule into code so it can't be
  // ignored: any positive verdict (YES on YES_NO, any RADIO/MULTI_SELECT
  // option with a positive score, any SCALE value > 0) MUST be backed by
  // an evidence_quote that is at least 20 chars AND carries a date or
  // transcript-timestamp anchor. Otherwise we cap that answer's
  // ai_confidence at 0.5 and surface a warning so the orchestrator's
  // verification trigger fires the verifier.
  const floorWarnings = enforceEvidenceFloor(out, answerEvidence, form);
  if (floorWarnings.length > 0) {
    selfConsistencyWarnings.push(...floorWarnings);
  }

  if (selfConsistencyWarnings.length > 0) {
    logger.warn(
      `[AI REVIEWER] Self-consistency warnings (${selfConsistencyWarnings.length}): ${selfConsistencyWarnings.join('; ')}`
    );
  }

  return {
    answers: out,
    narrative: typeof parsed.narrative === 'string' ? parsed.narrative : '',
    kbCitations: Array.isArray(parsed.kb_citations)
      ? parsed.kb_citations
          .filter((c: any) => c && Number.isInteger(c.id))
          .map((c: any) => ({ id: Number(c.id), name: String(c.name ?? ''), url: String(c.url ?? '') }))
      : [],
    overallConfidence: clampConfidence(parsed.overall_confidence),
    timeline: parseTimelineArray(parsed.timeline),
    observations: parseObservationsArray(parsed.observations),
    playbookSteps,
    coaching,
    answerEvidence,
    selfConsistencyWarnings,
    cost: null,
  };
}

const PLAYBOOK_STATUSES: ReadonlySet<AiPlaybookStep['status']> = new Set([
  'done',
  'missing',
  'out_of_order',
  'not_applicable',
]);

/**
 * Parse and normalize the model's `playbook_steps[]` output.
 *
 * Backstop for a recurring failure mode where the model emits
 * `{ status: "done", evidence_note_date: null }` even after the prompt's
 * explicit self-validation rule. The schema invariant is: `done` REQUIRES a
 * real evidence anchor (note date, transcript timestamp, or attachment).
 * When the model breaks that invariant, we flip the row to `not_applicable`
 * — by far the most common correct status when evidence is absent because
 * the issue resolved earlier in the troubleshooting sequence (see the
 * RESOLUTION-STOP RULE in `prompts/ai-reviewer/system.v3.md`). Reviewers
 * can edit the verdict if `missing` was actually intended; we'd rather
 * default to "the agent legitimately stopped" than surface a phantom gap.
 */
function parsePlaybookSteps(raw: unknown): AiPlaybookStep[] {
  if (!Array.isArray(raw)) return [];
  const out: AiPlaybookStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const step = String((item as any).step ?? '').trim();
    if (!step) continue;
    const statusRaw = String((item as any).status ?? '').trim().toLowerCase() as AiPlaybookStep['status'];
    let status = PLAYBOOK_STATUSES.has(statusRaw) ? statusRaw : 'done';
    const evRaw = (item as any).evidence_note_date;
    const evidence_note_date = evRaw == null || evRaw === '' ? null : String(evRaw).trim();
    if (status === 'done' && evidence_note_date === null) {
      status = 'not_applicable';
    }
    out.push({ step, evidence_note_date, status });
  }
  return out;
}

function parseCoachingBlock(raw: unknown): AiCoaching {
  const empty: AiCoaching = { wins: [], gaps: [], next_actions: [] };
  if (!raw || typeof raw !== 'object') return empty;
  const arr = (k: string): string[] => {
    const v = (raw as any)[k];
    if (!Array.isArray(v)) return [];
    return v
      .map((x) => (typeof x === 'string' ? x.trim() : ''))
      .filter((s) => s.length > 0);
  };
  return {
    wins: arr('wins'),
    gaps: arr('gaps'),
    next_actions: arr('next_actions'),
  };
}

/**
 * Detect parse-time grade ↔ reasoning mismatches. Today this only catches
 * the "Steps followed = no with no missing playbook step" case (the most
 * common AI failure mode on process audits), but it's the right place to
 * grow more rules into.
 */
function detectSelfConsistencyWarnings(
  answers: CreateSubmissionAnswerDTO[],
  playbookSteps: AiPlaybookStep[],
  form: FormForPrompt
): string[] {
  const warnings: string[] = [];
  const questionsById = new Map(form.questions.map((q) => [q.id, q]));
  const stepsFollowedNo = answers.filter((a) => {
    const q = questionsById.get(a.question_id);
    if (!q) return false;
    if (q.question_type !== 'YES_NO') return false;
    if (a.answer !== 'no') return false;
    // Best-effort match: any question whose text mentions "step" or
    // "process" and is graded "no" by the AI. This is intentionally
    // broad — a missed step is the highest-stakes parse-time mismatch
    // we have today.
    const text = q.question_text.toLowerCase();
    return text.includes('step') || text.includes('follow process') || text.includes('process');
  });
  if (stepsFollowedNo.length === 0) return warnings;
  const hasMissingStep = playbookSteps.some((s) => s.status === 'missing' || s.status === 'out_of_order');
  if (!hasMissingStep) {
    warnings.push(
      `Answer says "${stepsFollowedNo[0].answer}" on question_id=${stepsFollowedNo[0].question_id} (steps/process question) but playbook_steps[] has no missing/out_of_order row.`
    );
  }
  return warnings;
}

/**
 * Tier-2 evidence-floor enforcement (Phase F).
 *
 * Rule: any "positive verdict" (YES on YES_NO, RADIO/MULTI_SELECT options
 * with score > 0, SCALE > 0) MUST be backed by an evidence_quote that
 * is at least 20 chars AND contains a date or transcript-timestamp
 * anchor. Otherwise we cap that answer's `ai_confidence` at 0.5 and
 * push a self-consistency warning so the orchestrator's verification
 * trigger fires for that case.
 *
 * Why code, not prompt: the synthesis prompt has carried "AI graders
 * are biased toward yes — when the evidence_quote is empty for a yes
 * verdict, prefer no" since system.v3 / synthesis.v1, but the model
 * routinely violates it (this is the single biggest source of
 * overconfident "yes" answers we saw on closed cases). Moving the
 * rule into post-parse code makes it unconditional.
 *
 * Negative verdicts (NO on YES_NO, score-0 options on RADIO/MULTI_SELECT,
 * SCALE === 0) are intentionally left alone — an empty-evidence "no" is
 * the documented absent-evidence pattern (see synthesis.v1.md "Notes:
 * Incomplete" guidance), so capping it would be wrong.
 *
 * MUTATES `answers` in place — same pattern as existing `parsePlaybookSteps`
 * which auto-corrects rows. Returns the per-answer warnings so the
 * caller can fold them into `selfConsistencyWarnings`.
 */
function enforceEvidenceFloor(
  answers: CreateSubmissionAnswerDTO[],
  evidence: Record<number, { evidence_source?: string; evidence_quote?: string }>,
  form: FormForPrompt
): string[] {
  const warnings: string[] = [];
  const questionsById = new Map(form.questions.map((q) => [q.id, q]));
  // Anchor patterns: month-day ("Apr 28"), ISO date ("2026-05-13"),
  // numeric date ("4/28" or "04-28-2026"), or transcript timestamp
  // ("03:14" / "1:23:45"). Any of these proves the model pinned the
  // quote to a specific moment in evidence rather than paraphrasing.
  const anchorRe = /\b(\d{1,2}[:/-]\d{1,2}|\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
  const MIN_QUOTE_CHARS = 20;
  for (const a of answers) {
    if (!isPositiveVerdict(a, questionsById.get(a.question_id))) continue;
    const ev = evidence[a.question_id];
    const quote = (ev?.evidence_quote ?? '').trim();
    const quoteLooksReal = quote.length >= MIN_QUOTE_CHARS && anchorRe.test(quote);
    // The evidence_source field (e.g. "Apr 28 by Bethany") often carries
    // the date even when the quote itself doesn't. Treat it as a valid
    // anchor when present so we don't false-positive on quotes that are
    // intrinsically dateless ("Customer requested refund.") but are
    // pinned to a specific note via evidence_source.
    const sourceLooksAnchored = anchorRe.test((ev?.evidence_source ?? '').trim());
    if (quoteLooksReal || (quote.length > 0 && sourceLooksAnchored)) continue;
    const before = a.ai_confidence ?? 1;
    if (before > 0.5) a.ai_confidence = 0.5;
    warnings.push(
      `Q${a.question_id} positive verdict "${a.answer}" lacks anchored evidence (quote_len=${quote.length}, anchored=${sourceLooksAnchored}); confidence capped from ${before.toFixed(2)} to 0.50`
    );
  }
  return warnings;
}

/**
 * Whether an answer represents a "positive" / scored verdict for its
 * question type. Used by `enforceEvidenceFloor` to decide which answers
 * need anchored evidence (negative verdicts get a free pass — empty
 * evidence on a "no" is the documented absent-evidence pattern).
 */
function isPositiveVerdict(
  a: CreateSubmissionAnswerDTO,
  q: FormForPrompt['questions'][number] | undefined
): boolean {
  if (!q) return false;
  const v = String(a.answer ?? '').trim();
  if (!v) return false;
  switch (q.question_type) {
    case 'YES_NO':
      // NA always gets a pass (not a positive grade); only "yes" is
      // graded as positive evidence-bearing here.
      return v.toLowerCase() === 'yes';
    case 'RADIO':
      return (q.radio_options.find((o) => o.value === v)?.score ?? 0) > 0;
    case 'MULTI_SELECT':
      return v
        .split(',')
        .map((p) => p.trim())
        .some((p) => (q.radio_options.find((o) => o.value === p)?.score ?? 0) > 0);
    case 'SCALE': {
      const n = Number(v);
      return Number.isFinite(n) && n > 0;
    }
    default:
      return false;
  }
}

/**
 * Coerce an arbitrary AI-emitted value into a confidence score in
 * [0, 1] or null. Tolerant of strings ("0.85"), missing keys, and
 * out-of-range values — the AI run never fails because of a bad
 * confidence number; we just drop it.
 */
function clampConfidence(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 1) return 1;
  // Two-decimal storage matches the DECIMAL(3,2) column.
  return Math.round(n * 100) / 100;
}

/**
 * Parse the AI's `timeline` array into a sanitized AiTimelineItem[].
 * Bad shapes log a warn and return [] — the timeline is advisory and
 * must never break the AI run.
 */
function parseTimelineArray(raw: unknown): AiTimelineItem[] {
  if (!Array.isArray(raw)) return [];
  const out: AiTimelineItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const when = String((item as any).when ?? '').trim();
    const who = String((item as any).who ?? '').trim();
    const action = String((item as any).action ?? '').trim();
    if (!action) continue; // an empty action is meaningless
    const kbStepRaw = (item as any).kb_step;
    const kb_step = kbStepRaw == null || kbStepRaw === '' ? null : String(kbStepRaw).trim();
    out.push({ when, who, action, kb_step });
  }
  return out;
}

const OBSERVATION_KINDS: ReadonlySet<AiObservationKind> = new Set([
  'documentation',
  'best_practice',
  'cadence',
  'process_drift',
  'pii',
  'other',
]);

const OBSERVATION_SEVERITIES: ReadonlySet<AiObservationSeverity> = new Set(['info', 'warn']);

/**
 * Parse the AI's `observations` array into sanitized AiObservation[].
 * Unknown kinds bucket to 'other'; unknown severities default to 'info'.
 * Empty messages are dropped.
 */
/**
 * Phase A: collapse all AI-side outputs into the ai_extras JSON payload
 * stored on the submission. Returns null when there's nothing worth
 * persisting (preserves the legacy "no extras → null column" behaviour).
 */
function buildAiExtras(parts: {
  timeline: AiTimelineItem[];
  observations: AiObservation[];
  playbookSteps: AiPlaybookStep[];
  coaching: AiCoaching;
  answerEvidence: Record<number, { evidence_source?: string; evidence_quote?: string }>;
  selfConsistencyWarnings: string[];
  verification: AiVerification | null;
  /**
   * Tier-2 Item 4: per-pivot KB hit count for the case. Persisted so
   * the KB Coverage dashboard can aggregate without re-running the
   * pivot detector. Empty / absent when the case ran the legacy
   * (no-pivot) KB grounding path.
   */
  pivots?: PivotKbCoverage[];
}): Record<string, unknown> | null {
  const hasTimeline = parts.timeline.length > 0;
  const hasObservations = parts.observations.length > 0;
  const hasPlaybook = parts.playbookSteps.length > 0;
  const hasCoaching =
    parts.coaching.wins.length + parts.coaching.gaps.length + parts.coaching.next_actions.length > 0;
  const hasEvidence = Object.keys(parts.answerEvidence).length > 0;
  const hasSelfWarnings = parts.selfConsistencyWarnings.length > 0;
  const hasPivots = !!parts.pivots && parts.pivots.length > 0;
  if (
    !hasTimeline &&
    !hasObservations &&
    !hasPlaybook &&
    !hasCoaching &&
    !hasEvidence &&
    !hasSelfWarnings &&
    !parts.verification &&
    !hasPivots
  ) {
    return null;
  }
  return {
    timeline: parts.timeline,
    observations: parts.observations,
    ...(hasPlaybook ? { playbook_steps: parts.playbookSteps } : {}),
    ...(hasCoaching ? { coaching: parts.coaching } : {}),
    ...(hasEvidence ? { answer_evidence: parts.answerEvidence } : {}),
    ...(hasSelfWarnings ? { self_consistency_warnings: parts.selfConsistencyWarnings } : {}),
    ...(parts.verification ? { verification: parts.verification } : {}),
    ...(hasPivots ? { pivots: parts.pivots } : {}),
  };
}

/**
 * Verifier output shape (Tier-1 Item 2).
 *
 * The verifier no longer just returns warnings — it returns asymmetric
 * deltas the orchestrator applies to `overall_confidence` and to each
 * answer's `ai_confidence` before persistence.
 *
 * Asymmetric clamps (the anti-gaming safeguard):
 *   - `overall_delta` is bounded `[-0.20, +0.10]`.
 *   - `per_answer_deltas[qid]` is bounded `[-0.20, +0.05]`.
 *   - Negative range is twice the positive range. The verifier exists
 *     to catch problems, not to validate; even a confused verifier
 *     can't materially inflate confidence.
 */
export interface VerificationResult {
  warnings: string[];
  overall_delta: number;
  per_answer_deltas: Record<number, number>;
}

/** Bound a number to [min, max], coercing NaN/null to 0. */
function clampDelta(raw: unknown, min: number, max: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (n < min) return min;
  if (n > max) return max;
  return Math.round(n * 100) / 100;
}

/**
 * Tier-1 verification pass (Item 2). Runs ONE Claude call asking the
 * model to audit its own previous output against the trace artefacts
 * (timeline + playbook + observations) and emit:
 *   - warnings:   the legacy per-answer flag list
 *   - overall_delta:  signed adjustment to overall_confidence
 *                     (bounded [-0.20, +0.10])
 *   - per_answer_deltas: signed adjustment to ai_confidence per
 *                        question_id (bounded [-0.20, +0.05])
 *
 * Capped at one verifier call per review by the orchestrator. Always
 * wrapped in withCallLog so the extra cost shows up in `ai_call_logs`
 * with `pass: 'verification'`.
 *
 * Throws on hard provider failures; caller catches and proceeds with
 * the original answers (verification is advisory, never fails a run).
 */
async function runVerificationPass(
  ctx: {
    answers: CreateSubmissionAnswerDTO[];
    timeline: AiTimelineItem[];
    playbookSteps: AiPlaybookStep[];
    observations: AiObservation[];
  },
  traceCtx: CallLogMeta,
  provider: ModelProvider = 'anthropic'
): Promise<VerificationResult> {
  // The new prompt asks for warnings AND deltas in one shot. We
  // explicitly call out the asymmetric clamp so the model knows it
  // cannot inflate confidence by more than +0.10. Worked examples
  // anchor the magnitude — empirically, models follow shape better
  // when given a few "small/medium/large" calibration points.
  const verifySystem =
    'You are auditing your own previous output as the QA reviewer. Examine the answers, timeline, playbook_steps, and observations below.\n\n' +
    'Two outputs are required:\n' +
    '  1. warnings[]: one short sentence per flagged answer (e.g. yes-verdict with no supporting timeline item, or no-verdict with no missing playbook step). Empty array is fine when nothing is mismatched.\n' +
    '  2. confidence_deltas: signed adjustments you would make to the original confidence numbers. Negative numbers REDUCE confidence (use this for unsupported answers); positive numbers INCREASE it (use ONLY when the trace is unambiguously stronger than the original confidence reflected).\n\n' +
    'Bounds (we will clamp anything outside these — emit values within them):\n' +
    '  - overall_delta: [-0.20, +0.10]   (negative half is wider on purpose — the verifier exists to catch problems, not to validate).\n' +
    '  - per_answer_deltas[<question_id>]: [-0.20, +0.05] per question.\n\n' +
    'Magnitude calibration:\n' +
    '  - 0.00  = no change (the original number was right)\n' +
    '  - -0.05 = small concern (one weak supporting quote)\n' +
    '  - -0.10 = moderate concern (verdict and trace partially disagree)\n' +
    '  - -0.20 = strong concern (verdict directly contradicted by the trace)\n' +
    '  - +0.05 = trace fully supports the verdict and the original confidence was unjustifiably low\n' +
    '  - +0.10 = whole-review picture is materially stronger than the per-answer numbers reflected\n\n' +
    'Bias toward catching problems. If you are unsure, lean negative. Do NOT use positive deltas as a "vote of confidence" — they are reserved for cases where the original number understated objective trace support.\n\n' +
    'Respond with ONLY this JSON object (no prose, no code fences):\n' +
    '{ "warnings": ["<one short sentence per flagged answer>"], "overall_delta": <number>, "per_answer_deltas": { "<question_id>": <number>, ... } }';
  const verifyUser = JSON.stringify(
    {
      answers: ctx.answers.map((a) => ({
        question_id: a.question_id,
        value: a.answer,
        ai_confidence: a.ai_confidence ?? null,
      })),
      timeline: ctx.timeline,
      playbook_steps: ctx.playbookSteps,
      observations: ctx.observations,
    },
    null,
    2
  );

  return withCallLog<VerificationResult>(
    { ...traceCtx, provider },
    { system: verifySystem, user: verifyUser },
    async () => {
      const model = resolveModelName(provider);
      const out = await callChatModel(provider, {
        system: verifySystem,
        user: verifyUser,
        model,
        maxTokens: 1500,
        timeoutMs: 300_000,
        responseFormat: 'json_object',
      });
      const tokensIn = out.tokensIn;
      const tokensOut = out.tokensOut;
      const raw = out.text;
      const parsed = tryParseJson(raw);
      const warnings: string[] =
        parsed && Array.isArray(parsed.warnings)
          ? parsed.warnings
              .map((w: unknown) => (typeof w === 'string' ? w.trim() : ''))
              .filter((s: string) => s.length > 0)
          : [];
      const overall_delta = clampDelta(parsed?.overall_delta, -0.2, 0.1);
      const per_answer_deltas: Record<number, number> = {};
      const rawPer = parsed?.per_answer_deltas;
      if (rawPer && typeof rawPer === 'object') {
        for (const [k, v] of Object.entries(rawPer)) {
          const qid = Number(k);
          if (!Number.isInteger(qid)) continue;
          const d = clampDelta(v, -0.2, 0.05);
          if (d !== 0) per_answer_deltas[qid] = d;
        }
      }
      return {
        result: { warnings, overall_delta, per_answer_deltas },
        model,
        rawResponse: raw,
        retried: false,
        tokensIn,
        tokensOut,
      };
    }
  );
}

/**
 * Apply a verifier `VerificationResult`'s deltas to the answers + the
 * overall confidence in place. Returns the (clamped) new
 * `overallConfidence` so callers can persist the moved value.
 *
 * Mutates `answers[].ai_confidence` so downstream calibration sees the
 * post-verifier numbers. Logs before/after so we can audit whether the
 * verifier is actually moving the confidence.
 */
function applyVerificationDeltas(
  answers: CreateSubmissionAnswerDTO[],
  overallConfidence: number | null,
  result: VerificationResult,
  caseLabel: string
): number | null {
  let newOverall = overallConfidence;
  if (overallConfidence != null && result.overall_delta !== 0) {
    newOverall = clampConfidence(overallConfidence + result.overall_delta);
    logger.info(
      `[AI REVIEWER] verification overall delta (${caseLabel}) ${overallConfidence.toFixed(2)} -> ${(newOverall ?? 0).toFixed(2)} (delta=${result.overall_delta.toFixed(2)})`
    );
  }
  for (const a of answers) {
    const d = result.per_answer_deltas[a.question_id] ?? 0;
    if (d === 0) continue;
    const before = a.ai_confidence ?? 0;
    a.ai_confidence = clampConfidence(before + d);
    logger.info(
      `[AI REVIEWER] verification per-answer delta (${caseLabel}, q=${a.question_id}) ${before.toFixed(2)} -> ${(a.ai_confidence ?? 0).toFixed(2)} (delta=${d.toFixed(2)})`
    );
  }
  return newOverall;
}

function parseObservationsArray(raw: unknown): AiObservation[] {
  if (!Array.isArray(raw)) return [];
  const out: AiObservation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const message = String((item as any).message ?? '').trim();
    if (!message) continue;
    const kindRaw = String((item as any).kind ?? 'other').trim().toLowerCase() as AiObservationKind;
    const kind = OBSERVATION_KINDS.has(kindRaw) ? kindRaw : 'other';
    const sevRaw = String((item as any).severity ?? 'info').trim().toLowerCase() as AiObservationSeverity;
    const severity = OBSERVATION_SEVERITIES.has(sevRaw) ? sevRaw : 'info';
    const evidence = String((item as any).evidence ?? '').trim() || undefined;
    out.push({ kind, severity, message, evidence });
  }
  return out;
}

/**
 * Pattern-driven NA gate guard. Identifies parent "summary" questions
 * whose rubric defines an N/A precondition keyed off a small set of
 * sibling "opportunity" questions, and flips the parent to 'na' when
 * all of its gates resolved to 'no'. Works across form versions
 * (99018, 99019, future revisions) because we match on question text
 * + category, not on hardcoded question IDs that change every save.
 *
 * Current parents covered:
 *   - Contact Management → "Were all required contact-management actions handled correctly?"
 *     Gates: questions in same category whose text starts with
 *     "Did the call provide an opportunity",
 *     "Did the customer reference a person not currently in the CRM",
 *     "Did the customer indicate someone has left",
 *     "Did the call indicate a contact owner/role change"
 *   - Hold / Transfer → "Were all hold and transfer procedures followed correctly?"
 *     Gates: questions in same category whose text starts with
 *     "Did the agent place the customer on hold at any point",
 *     "Did a call transfer take place"
 *
 * Returns a list of flips for logging / surfacing as self-consistency
 * warnings. Mutates the answers array in place — caller's `out` is
 * updated when a flip applies.
 */
interface NaGateConfig {
  parentTextPrefix: string;
  categoryNameContains: string;
  gateTextPrefixes: string[];
}
const NA_GATE_CONFIGS: readonly NaGateConfig[] = [
  {
    parentTextPrefix: 'were all required contact-management actions',
    categoryNameContains: 'contact',
    gateTextPrefixes: [
      'did the call provide an opportunity',
      'did the customer reference a person not currently in the crm',
      'did the customer indicate someone has left',
      'did the call indicate a contact owner',
    ],
  },
  {
    parentTextPrefix: 'were all hold and transfer procedures',
    categoryNameContains: 'transfer',
    gateTextPrefixes: [
      'did the agent place the customer on hold at any point',
      'did a call transfer take place',
    ],
  },
  // Workstream C1: clarifying-questions parent gated on troubleshooting.
  // When the call wasn't a troubleshooting call (gate q "Did the call
  // require troubleshooting?" = no), there's no diagnostic exchange to
  // grade — flip the parent from NO -> NA so direct-action calls
  // (password reset, remote-code retrieval, billing-only) don't get
  // penalized for skipping diagnostics they didn't need.
  //
  // Single-gate variant: the helper's "all gates NO -> flip parent NA"
  // semantics work correctly for a one-element gate set (the set of one
  // is all-NO iff that one is NO).
  {
    parentTextPrefix: 'did the agent ask clarifying questions',
    categoryNameContains: 'problem',
    gateTextPrefixes: ['did the call require troubleshooting'],
  },
];

interface NaGateFlip {
  qid: number;
  reason: string;
}

function applyNaGateGuards(
  answers: CreateSubmissionAnswerDTO[],
  form: FormForPrompt
): NaGateFlip[] {
  const flips: NaGateFlip[] = [];
  const answerByQid = new Map(answers.map((a) => [a.question_id, a]));

  for (const cfg of NA_GATE_CONFIGS) {
    const parentQuestion = form.questions.find((q) => {
      const txt = q.question_text.trim().toLowerCase();
      const cat = (q.category_name || '').toLowerCase();
      return (
        q.question_type === 'YES_NO' &&
        q.is_na_allowed &&
        txt.startsWith(cfg.parentTextPrefix) &&
        cat.includes(cfg.categoryNameContains)
      );
    });
    if (!parentQuestion) continue;

    const parentAnswer = answerByQid.get(parentQuestion.id);
    if (!parentAnswer || parentAnswer.answer !== 'no') continue;

    const gateQuestions = form.questions.filter((q) => {
      if (q.id === parentQuestion.id) return false;
      if (q.question_type !== 'YES_NO') return false;
      if ((q.category_name || '') !== parentQuestion.category_name) return false;
      const txt = q.question_text.trim().toLowerCase();
      return cfg.gateTextPrefixes.some((prefix) => txt.startsWith(prefix));
    });
    if (gateQuestions.length === 0) continue;

    const allGatesNo = gateQuestions.every((gq) => {
      const ga = answerByQid.get(gq.id);
      return ga != null && ga.answer === 'no';
    });
    if (!allGatesNo) continue;

    parentAnswer.answer = 'na';
    parentAnswer.ai_confidence = Math.max(parentAnswer.ai_confidence ?? 0, 0.95);
    flips.push({
      qid: parentQuestion.id,
      reason: `all ${gateQuestions.length} opportunity gate(s) answered 'no' in category "${parentQuestion.category_name}"`,
    });
  }

  return flips;
}

function validateAnswerForQuestion(value: unknown, question: FormForPrompt['questions'][number]): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  switch (question.question_type) {
    case 'YES_NO': {
      const lower = s.toLowerCase();
      if (lower === 'yes' || lower === '1' || lower === 'true') return 'yes';
      if (lower === 'no' || lower === '0' || lower === 'false') return 'no';
      if (lower === 'na' || lower === 'n/a') {
        // Persist lowercase 'na' to match the lowercase 'yes' / 'no' convention
        // emitted above. The editable form renderer compares against lowercase
        // option values, so uppercase 'NA' rendered as unmarked. Other consumers
        // (analytics, scoreRenderer) already compare case-insensitively.
        if (question.is_na_allowed) return 'na';
        // Graceful fallback: model picked NA on a question that doesn't allow it.
        // Treat as "no" rather than crashing the whole review — documented evidence
        // of the step is what we asked for, and the model couldn't find it.
        logger.warn(
          `[AI REVIEWER] question_id=${question.id} returned "NA" but is_na_allowed=false; coercing to "no".`
        );
        return 'no';
      }
      return null;
    }
    case 'TEXT':
      return s;
    case 'SCALE': {
      const n = Number(s);
      return Number.isFinite(n) ? String(n) : null;
    }
    case 'RADIO': {
      const opt = question.radio_options.find((o) => o.value === s || o.text === s);
      return opt ? opt.value : null;
    }
    case 'MULTI_SELECT': {
      const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
      const matched = parts
        .map((p) => question.radio_options.find((o) => o.value === p || o.text === p)?.value)
        .filter((v): v is string => !!v);
      return matched.length > 0 ? matched.join(',') : null;
    }
    default:
      return s;
  }
}

/**
 * Compose the AI Reviewer Feedback free-text. Output is HTML so the
 * RichTextDisplay component renders KB references as clickable links
 * straight to the BookStack page (per reviewer ask 2026-05: "make the
 * links in the notes a hyperlink so we can click to the KB page").
 *
 * Strategy:
 *   1. Parse the narrative into bullet lines. The prompt instructs the
 *      model to emit one `Label: verdict` line per audit-chain step
 *      (Description, Subclass, Steps followed, Notes, Resolution,
 *      Closure) plus optional cross-cutting findings. We render each
 *      line as `<li><strong>Label:</strong> …verdict…</li>` so the
 *      reviewer sees a proper bulleted checklist instead of a wall of
 *      `<br>`-joined text. Lines without a recognisable `Label:` prefix
 *      become plain `<li>` items so we never lose content.
 *   2. Linkify in-narrative mentions of any cited KB page name. We
 *      match the page name in quotes (the prompt instructs the model to
 *      cite "by name" — e.g. *(per "Ticket Handling Process")*) and
 *      replace just the quoted name with an <a> tag. Longest names
 *      first so "Ticket Handling Process" wins over a substring like
 *      "Process".
 *   3. Footer "Knowledge Base Citations:" list also rendered as
 *      <a>-tag bullets so reviewers always have a clickable index even
 *      if the model forgets to mention a page in the narrative.
 *
 * Escaping: every model-supplied string (narrative + page name + url)
 * goes through escapeHtml() before assembly. The downstream renderer
 * (RichTextDisplay) also runs DOMPurify, so this is belt-and-suspenders.
 */
function composeFeedback(parts: {
  narrative: string;
  kbCitations: { id: number; name: string; url: string }[];
}): string {
  const cites = parts.kbCitations.filter((c) => c.name && c.url);
  const narrativeText = (parts.narrative ?? '').trim();

  // Pre-build the citation linkifier so we can apply it to each parsed
  // bullet's verdict text.
  const sortedByLen = [...cites].sort((a, b) => b.name.length - a.name.length);
  const linkifyKb = (htmlEscaped: string): string => {
    let out = htmlEscaped;
    for (const c of sortedByLen) {
      const safeName = escapeHtml(c.name);
      const safeUrl = escapeHtml(c.url);
      const anchor = `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeName}</a>`;
      const escapedForRegex = safeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match quoted name (straight or curly quotes) — the dominant form
      // is `(per "Name")` but be lenient.
      const re = new RegExp(`([\"'\u2018\u2019\u201C\u201D])${escapedForRegex}\\1`, 'g');
      out = out.replace(re, (_m, q: string) => `${q}${anchor}${q}`);
    }
    return out;
  };

  // Recognise lines like `Steps followed: incomplete — switch-to-internet…`.
  // Label = letters/spaces/hyphens followed by a colon + space. We accept
  // any label the model emits (not just the canonical six) so future
  // additions to the audit chain don't fall through to plain-bullet.
  const labelRe = /^([A-Za-z][A-Za-z \-/&]{1,40}):\s+(.+)$/;

  const segments: string[] = [];

  if (narrativeText) {
    const rawLines = narrativeText
      .split(/\r?\n+/)
      .map((l) => l.replace(/^\s*[-*•]\s+/, '').trim()) // strip stray markdown bullets
      .filter((l) => l.length > 0);

    const items: string[] = [];
    for (const line of rawLines) {
      const m = labelRe.exec(line);
      if (m) {
        const label = escapeHtml(m[1].trim());
        const verdict = linkifyKb(escapeHtml(m[2].trim()));
        items.push(`<li><strong>${label}:</strong> ${verdict}</li>`);
      } else {
        items.push(`<li>${linkifyKb(escapeHtml(line))}</li>`);
      }
    }

    if (items.length > 0) {
      segments.push(`<ul>${items.join('')}</ul>`);
    }
  }

  if (segments.length === 0) {
    // Safety net — see Phase 2026-05 reviewer ask: "If it doesn't return
    // anything, instead of showing blank, we should have a note about the
    // AI not returning a narrative referred to Advisory Observations."
    // This fires when the model emits an empty/missing `narrative` field
    // despite the prompt requiring one. Without this, reviewers see only
    // the citations list (or nothing) and assume the AI ran broken.
    segments.push(
      '<p><em>The AI Reviewer did not return a narrative for this submission. ' +
        'See the Advisory Observations panel and the cited Knowledge Base pages below ' +
        'for context, or re-run the AI Reviewer against this ticket to try again.</em></p>'
    );
  }

  if (cites.length > 0) {
    const citationItems = cites
      .map((c) => {
        const safeName = escapeHtml(c.name);
        const safeUrl = escapeHtml(c.url);
        return `<li><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeName}</a></li>`;
      })
      .join('');
    segments.push(`<p><strong>Knowledge Base Citations:</strong></p><ul>${citationItems}</ul>`);
  }
  return segments.join('');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const aiReviewerService = new AIReviewerService();
export default aiReviewerService;

/**
 * @internal Test-only exports. The Phase A self-consistency rule is a
 * private parse-time check that downgrades the AI's confidence when its
 * answers contradict its own playbook trace. Exposed here so the unit
 * test can exercise the rule without spinning up Claude or the DB.
 */
export const _internal = {
  mapClaudeOutputToAnswers,
  parsePlaybookSteps,
  parseCoachingBlock,
  detectSelfConsistencyWarnings,
  enforceEvidenceFloor,
  mergeSubmissionLinks,
  applyNaGateGuards,
  filterPostAuditNotes,
  resolvePostCallDocWindowMs,
  renderAuditScopeLine,
  parseDraftAnswers,
  extractNarrative,
  runReconciliationPass,
};

